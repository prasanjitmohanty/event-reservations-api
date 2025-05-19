import { IsInt, IsNotEmpty, IsUUID } from 'class-validator';

export class CreateEventDto {
  @IsInt()
  numberOfSeats: number;
}
