import { IsNotEmpty, IsUUID } from 'class-validator';

export class HoldSeatDto {
  @IsNotEmpty()
  @IsUUID()
  userId: string;
}
