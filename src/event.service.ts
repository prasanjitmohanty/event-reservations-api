import { Injectable, Inject, HttpException, HttpStatus, Logger, OnModuleDestroy } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { ConfigService } from '@nestjs/config';
import { Seat, Event } from './event/model/event.model';
import { CreateEventDto } from './event/dto/create-event.dto';
import * as crypto from 'crypto';
import { Redis } from 'ioredis';
import { REDIS_CLIENT } from './redis.provider';

@Injectable()
export class EventService implements OnModuleDestroy {
    private readonly holdDuration: number;
    private readonly maxHeldSeatsPerUser: number;
    private readonly logger = new Logger(EventService.name);

    constructor(
        @Inject(CACHE_MANAGER) private cacheManager: Cache,
        private configService: ConfigService,
        @Inject(REDIS_CLIENT) private readonly redisClient: Redis
    ) {
        this.holdDuration = (this.configService.get<number>('CACHE_TTL') || 60) * 1000;
        this.maxHeldSeatsPerUser = this.configService.get<number>('MAX_HELD_SEATS_PER_USER') || 5;



        if (!this.redisClient) {
            this.logger.error('Redis client (\'REDIS_CLIENT\') not injected. Distributed locks will not work.');

        } else {
            this.logger.log('Redis client successfully injected into EventService.');
            if (typeof this.redisClient.ping === 'function') {
                this.redisClient.ping((err: any) => {
                    if (err) {
                        this.logger.error('Failed to ping Redis server after injection:', err);
                    } else {
                        this.logger.log('Redis server ping successful after injection.');
                    }
                });
            }
        }
    }

    async createEvent(eventId: string, createEventDto: CreateEventDto): Promise<void> {
        const { name, numberOfSeats } = createEventDto;
        const seats: Seat[] = [];
        for (let i = 1; i <= numberOfSeats; i++) {
            seats.push({ seatId: `seat-${i}`, status: 'available' });
        }
        const event: Event = { eventId, seats, name, totalSeats: numberOfSeats };
        await this.cacheManager.set(`event:${eventId}`, event, 0); // Store indefinitely until explicitly removed or Redis persistence handles it
    }

    private async getEvent(eventId: string): Promise<Event> {
        const event = await this.cacheManager.get<Event>(`event:${eventId}`);
        if (!event) {
            throw new HttpException('Event not found', HttpStatus.NOT_FOUND);
        }
        return event;
    }

    private async saveEvent(event: Event): Promise<void> {
        await this.cacheManager.set(`event:${event.eventId}`, event, 0);
    }


    // This method is responsible for holding a seat for a user.
    // It uses a distributed lock to ensure that only one request can hold a seat at a time.
    // The lock is acquired using Redis, and the seat is held for a specified duration.
    // If the seat is already held or reserved, an error is thrown.
    async holdSeat(eventId: string, seatId: string, userId: string): Promise<any> {
        const lockKey = `lock:event:${eventId}:seat:${seatId}`;
        const lockValue = crypto.randomUUID(); // Unique value for this lock attempt
        const lockTtl = 5000; // Lock TTL: 5 seconds, adjust based on expected operation time

        let acquired = false;
        try {
            acquired = await this.acquireLock(lockKey, lockValue, lockTtl);
            if (!acquired) {
                throw new HttpException('Seat is currently being processed by another request, please try again shortly.', HttpStatus.CONFLICT);
            }

            const event = await this.getEvent(eventId);
            const seat = event.seats.find(s => s.seatId === seatId);

            if (!seat) {
                throw new HttpException('Seat not found', HttpStatus.NOT_FOUND);
            }

            //Limit the number of seats a given user can hold in one event.
            const userHeldSeats = event.seats.filter(s => s.userId === userId && s.status === 'held');
            if (userHeldSeats.length >= this.maxHeldSeatsPerUser) {
                throw new HttpException(`User cannot hold more than ${this.maxHeldSeatsPerUser} seats`, HttpStatus.BAD_REQUEST);
            }

            if (seat.status === 'available' || (seat.status === 'held' && seat.holdExpiresAt && seat.holdExpiresAt < Date.now())) {
                seat.status = 'held';
                seat.userId = userId;
                seat.holdExpiresAt = Date.now() + this.holdDuration;
                await this.saveEvent(event);
                return { message: 'Seat held successfully', holdExpiresAt: new Date(seat.holdExpiresAt) };
            } else {
                throw new HttpException('Seat not available or already held', HttpStatus.CONFLICT);
            }
        } finally {
            if (acquired) {
                const released = await this.releaseLock(lockKey, lockValue);
                if (!released) {
                    this.logger.warn(`Failed to release lock or lock expired for key: ${lockKey}. This might indicate the operation took longer than the lock TTL.`);
                }
            }
        }
    }

    // This method is responsible for reserving a seat that has been held by a user.
    async reserveSeat(eventId: string, seatId: string, userId: string): Promise<{ message: string }> {
        const event = await this.getEvent(eventId);
        const seat = event.seats.find(s => s.seatId === seatId);

        if (!seat) {
            throw new HttpException('Seat not found', HttpStatus.NOT_FOUND);
        }

        if (
            seat.status === 'held' &&
            seat.userId === userId &&
            seat.holdExpiresAt &&
            seat.holdExpiresAt >= Date.now()
        ) {
            seat.status = 'reserved';
            delete seat.holdExpiresAt;
            await this.saveEvent(event);
            return { message: 'Seat reserved successfully' };
        }

        if (seat.status === 'reserved' && seat.userId === userId) {
            return { message: 'Seat already reserved by you' };
        }

        if (seat.status === 'held' && seat.userId !== userId) {
            throw new HttpException('Seat held by another user', HttpStatus.CONFLICT);
        }

        if (seat.status === 'held' && seat.holdExpiresAt && seat.holdExpiresAt < Date.now()) {
            throw new HttpException('Hold on seat expired', HttpStatus.BAD_REQUEST);
        }

        if (seat.status === 'held' && !seat.holdExpiresAt) {
            throw new HttpException('Seat hold status is inconsistent', HttpStatus.INTERNAL_SERVER_ERROR);
        }

        throw new HttpException('Seat not held by user or hold expired', HttpStatus.BAD_REQUEST);
    }

    async getAvailableSeats(eventId: string): Promise<Seat[]> {
        const event = await this.getEvent(eventId);
        return event.seats.filter(seat => seat.status === 'available' || (seat.status === 'held' && seat.holdExpiresAt && seat.holdExpiresAt < Date.now()));
    }

    async refreshHold(eventId: string, seatId: string, userId: string): Promise<{ message: string; holdExpiresAt: Date }> {
        const event = await this.getEvent(eventId);
        const seat = event.seats.find(s => s.seatId === seatId);

        if (!seat) {
            throw new HttpException('Seat not found', HttpStatus.NOT_FOUND);
        }

        if (
            seat.status === 'held' &&
            seat.userId === userId &&
            seat.holdExpiresAt &&
            seat.holdExpiresAt >= Date.now()
        ) {
            seat.holdExpiresAt = Date.now() + this.holdDuration;
            await this.saveEvent(event);
            return { message: 'Hold refreshed successfully', holdExpiresAt: new Date(seat.holdExpiresAt) };
        }

        if (
            seat.status === 'held' &&
            seat.userId === userId &&
            seat.holdExpiresAt &&
            seat.holdExpiresAt < Date.now()
        ) {
            throw new HttpException('Hold on seat expired, cannot refresh', HttpStatus.BAD_REQUEST);
        }

        if (seat.status !== 'held' || seat.userId !== userId) {
            throw new HttpException('Seat not held by user', HttpStatus.BAD_REQUEST);
        }

        throw new HttpException('Cannot refresh hold on this seat', HttpStatus.BAD_REQUEST);
    }

    private async acquireLock(key: string, value: string, ttlMillis: number): Promise<boolean> {
        if (!this.redisClient || typeof this.redisClient.set !== 'function') {
            this.logger.error(`Redis client not available or \'set\' method missing, cannot acquire lock for key: ${key}.`);
            throw new HttpException('Server configuration error: Lock service unavailable.', HttpStatus.INTERNAL_SERVER_ERROR);
        }
        try {
            const reply = await this.redisClient.set(key, value, 'PX', ttlMillis, 'NX');
            return reply === 'OK';
        } catch (error: any) {
            this.logger.error(`Error acquiring lock for key ${key}: ${error.message}`, error.stack);
            throw new HttpException('Failed to process lock request.', HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }

    private async releaseLock(key: string, value: string): Promise<boolean> {
        if (!this.redisClient || typeof this.redisClient.eval !== 'function') {
            this.logger.warn(`Redis client not available or \'eval\' method missing, cannot release lock for key: ${key}.`);
            return false;
        }
        // Lua script to ensure atomic delete only if the value matches
        const script = `
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("del", KEYS[1])
      else
        return 0
      end
    `;
        try {
            // The structure for eval (keys, arguments) can vary slightly between redis client libraries.
            // This assumes a common pattern. Adjust if your client (e.g., ioredis, node-redis v4) expects a different format.
            const result = await this.redisClient.eval(script, 1, key, value);
            return result === 1;
        } catch (error: any) {
            this.logger.error(`Error releasing lock for key ${key}: ${error.message}`, error.stack);
            return false; // Don\'t throw from finally or cleanup logic if possible
        }
    }

    onModuleDestroy() {
        if (this.redisClient && typeof this.redisClient.quit === 'function') {
            this.redisClient.quit();
            this.logger.log('Redis client connection closed via EventService.');
        } else if (this.redisClient && typeof this.redisClient.disconnect === 'function') {
            this.redisClient.disconnect(); // Some clients use disconnect
            this.logger.log('Redis client disconnected via EventService.');
        }
    }
}
