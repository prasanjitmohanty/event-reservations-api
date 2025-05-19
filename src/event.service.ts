import { Injectable, Inject, HttpException, HttpStatus } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { ConfigService } from '@nestjs/config';
import { Seat, Event } from './event/model/event.model';

@Injectable()
export class EventService {
  private readonly holdDuration: number;
  private readonly maxHeldSeatsPerUser: number;

  constructor(
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
    private configService: ConfigService,
  ) {
    this.holdDuration = (this.configService.get<number>('CACHE_TTL') || 60) * 1000; // Default to 60s if not set
    this.maxHeldSeatsPerUser = this.configService.get<number>('MAX_HELD_SEATS_PER_USER') || 5; // Default to 5 if not set
  }

  async createEvent(eventId: string, numberOfSeats: number): Promise<void> {
    const seats: Seat[] = [];
    for (let i = 1; i <= numberOfSeats; i++) {
      seats.push({ seatId: `seat-${i}`, status: 'available' });
    }
    const event: Event = { eventId, seats, totalSeats: numberOfSeats };
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

  async holdSeat(eventId: string, seatId: string, userId: string): Promise<any> {
    const event = await this.getEvent(eventId);
    const seat = event.seats.find(s => s.seatId === seatId);

    if (!seat) {
      throw new HttpException('Seat not found', HttpStatus.NOT_FOUND);
    }

    // Bonus: Limit the number of seats a given user can hold in one event.
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
  }

  async reserveSeat(eventId: string, seatId: string, userId: string): Promise<any> {
    const event = await this.getEvent(eventId);
    const seat = event.seats.find(s => s.seatId === seatId);

    if (!seat) {
      throw new HttpException('Seat not found', HttpStatus.NOT_FOUND);
    }

    if (seat.status === 'held' && seat.userId === userId && seat.holdExpiresAt && seat.holdExpiresAt >= Date.now()) {
      seat.status = 'reserved';
      delete seat.holdExpiresAt; // Remove expiration as it's now permanently reserved
      await this.saveEvent(event);
      return { message: 'Seat reserved successfully' };
    } else if (seat.status === 'reserved' && seat.userId === userId) {
        return { message: 'Seat already reserved by you' };
    } else if (seat.status === 'held' && seat.userId !== userId) {
        throw new HttpException('Seat held by another user', HttpStatus.CONFLICT);
    } else if (seat.status === 'held' && seat.holdExpiresAt && seat.holdExpiresAt < Date.now()) {
        throw new HttpException('Hold on seat expired', HttpStatus.BAD_REQUEST);
    } else if (seat.status === 'held' && !seat.holdExpiresAt) { // Case where holdExpiresAt might be undefined unexpectedly
        throw new HttpException('Seat hold status is inconsistent', HttpStatus.INTERNAL_SERVER_ERROR);
    } else {
      throw new HttpException('Seat not held by user or hold expired', HttpStatus.BAD_REQUEST);
    }
  }

  async getAvailableSeats(eventId: string): Promise<Seat[]> {
    const event = await this.getEvent(eventId);
    return event.seats.filter(seat => seat.status === 'available' || (seat.status === 'held' && seat.holdExpiresAt && seat.holdExpiresAt < Date.now()));
  }

  async refreshHold(eventId: string, seatId: string, userId: string): Promise<any> {
    const event = await this.getEvent(eventId);
    const seat = event.seats.find(s => s.seatId === seatId);

    if (!seat) {
      throw new HttpException('Seat not found', HttpStatus.NOT_FOUND);
    }

    if (seat.status === 'held' && seat.userId === userId && seat.holdExpiresAt && seat.holdExpiresAt >= Date.now()) {
      seat.holdExpiresAt = Date.now() + this.holdDuration;
      await this.saveEvent(event);
      return { message: 'Hold refreshed successfully', holdExpiresAt: new Date(seat.holdExpiresAt) };
    } else if (seat.status === 'held' && seat.userId === userId && seat.holdExpiresAt && seat.holdExpiresAt < Date.now()) {
      throw new HttpException('Hold on seat expired, cannot refresh', HttpStatus.BAD_REQUEST);
    } else if (seat.status !== 'held' || seat.userId !== userId) {
      throw new HttpException('Seat not held by user', HttpStatus.BAD_REQUEST);
    } else {
      throw new HttpException('Cannot refresh hold on this seat', HttpStatus.BAD_REQUEST);
    }
  }
}
