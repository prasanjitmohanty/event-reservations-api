export interface Seat {
  seatId: string;
  status: 'available' | 'held' | 'reserved';
  userId?: string;
  holdExpiresAt?: number;
}

export interface Event {
  eventId: string;
  seats: Seat[];
  totalSeats: number;
}