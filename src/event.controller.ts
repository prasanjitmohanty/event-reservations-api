import { Controller, Post, Body, Param, Get, Inject, ValidationPipe, UsePipes, HttpException, HttpStatus } from '@nestjs/common';
import { EventService } from './event.service';
import { CreateEventDto } from './event/dto/create-event.dto'; // Corrected path
import { HoldSeatDto } from './event/dto/hold-seat.dto'; // Corrected path
import { ReserveSeatDto } from './event/dto/reserve-seat.dto'; // Corrected path
import { RefreshHoldDto } from './event/dto/refresh-hold.dto'; // Corrected path
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { v4 as uuidv4 } from 'uuid';

@Controller('events')
export class EventController {
  constructor(
    private readonly eventService: EventService,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
  ) {}

  @Post()
  @UsePipes(new ValidationPipe({ transform: true }))
  async createEvent(@Body() createEventDto: CreateEventDto) {
    if (createEventDto.numberOfSeats < 10 || createEventDto.numberOfSeats > 1000) {
      throw new HttpException('Number of seats must be between 10 and 1000', HttpStatus.BAD_REQUEST);
    }
    const eventId = uuidv4();
    await this.eventService.createEvent(eventId, createEventDto.numberOfSeats);
    return { eventId, message: 'Event created successfully' };
  }

  @Post(':eventId/seats/:seatId/hold')
  @UsePipes(new ValidationPipe({ transform: true }))
  async holdSeat(
    @Param('eventId') eventId: string,
    @Param('seatId') seatId: string,
    @Body() holdSeatDto: HoldSeatDto,
  ) {
    return this.eventService.holdSeat(eventId, seatId, holdSeatDto.userId);
  }

  @Post(':eventId/seats/:seatId/reserve')
  @UsePipes(new ValidationPipe({ transform: true }))
  async reserveSeat(
    @Param('eventId') eventId: string,
    @Param('seatId') seatId: string,
    @Body() reserveSeatDto: ReserveSeatDto,
  ) {
    return this.eventService.reserveSeat(eventId, seatId, reserveSeatDto.userId);
  }

  @Get(':eventId/seats/available')
  async getAvailableSeats(@Param('eventId') eventId: string) {
    return this.eventService.getAvailableSeats(eventId);
  }

  @Post(':eventId/seats/:seatId/refresh-hold')
  @UsePipes(new ValidationPipe({ transform: true }))
  async refreshHold(
    @Param('eventId') eventId: string,
    @Param('seatId') seatId: string,
    @Body() refreshHoldDto: RefreshHoldDto,
  ) {
    return this.eventService.refreshHold(eventId, seatId, refreshHoldDto.userId);
  }
}
