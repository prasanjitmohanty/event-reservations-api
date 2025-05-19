
import { FactoryProvider } from '@nestjs/common';
import Redis from 'ioredis';

export const REDIS_CLIENT = 'REDIS_CLIENT';

export const RedisProvider: FactoryProvider<Redis> = {
  provide: REDIS_CLIENT,
  useFactory:  () => {
    const client = new Redis({
      host: process.env.REDIS_HOST,
      port: parseInt(process.env.REDIS_PORT || '6379', 10),
    });

    client.on('error', (err) => console.error('Redis error:', err));

    return client;
  },
};
