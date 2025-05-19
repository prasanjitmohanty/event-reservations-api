import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { EventModule } from './event/event.module';
import { EventController } from './event.controller';
import { EventService } from './event.service';

@Module({
  imports: [EventModule],
  controllers: [AppController, EventController],
  providers: [ EventService],
})
export class AppModule {}
