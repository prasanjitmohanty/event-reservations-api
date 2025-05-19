import { IsInt, IsNotEmpty } from 'class-validator';

export class CreateEventDto {
    @IsNotEmpty()
    name: string;

    @IsInt()
    numberOfSeats: number;
}
