import { IsNotEmpty, IsUUID } from 'class-validator';

export class ReserveSeatDto {
  @IsNotEmpty()
  @IsUUID()
  userId: string;
}
