import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { CacheModule } from '@nestjs/cache-manager';
import { EventController } from '../event.controller'; // Corrected path
import { EventService } from '../event.service'; // Corrected path
import * as redisStore from 'cache-manager-redis-store';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true, // Make the configuration available globally
    }),
    CacheModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        store: redisStore, // If redisStore is a function, it might need to be called: redisStore()
        host: configService.get<string>('REDIS_HOST'),
        port: configService.get<number>('REDIS_PORT'),
        ttl: configService.get<number>('CACHE_TTL'), // Default TTL for cache entries
      }),
      inject: [ConfigService],
      isGlobal: true, // Make the CacheModule available globally
    }),
  ],
  controllers: [EventController],
  providers: [EventService],
  exports: [EventService], // Add EventService to exports
})
export class EventModule {}
