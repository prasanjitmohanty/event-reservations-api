import { IsNotEmpty, IsUUID } from 'class-validator';

export class RefreshHoldDto {
  @IsNotEmpty()
  @IsUUID()
  userId: string;
}
