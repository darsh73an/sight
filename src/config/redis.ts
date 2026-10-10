import Redis from 'ioredis';
import { config } from './index';
import { logger } from '../utils/logger';

export const redis = new Redis({
  host: config.redis.host,
  port: config.redis.port,
});

redis.on('error', (err) => {
  logger.error('Redis client error', err);
});

export async function testRedisConnection(): Promise<void> {
  await redis.ping();
}
