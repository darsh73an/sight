import { Queue } from 'bullmq';
import { config } from '../config';

export const QUEUE_NAME = 'error-events';

export const eventQueue = new Queue(QUEUE_NAME, {
  connection: {
    host: config.redis.host,
    port: config.redis.port,
  },
});

eventQueue.on('error', (err) => {
  // eslint-disable-next-line no-console
  console.error('Event queue error', err);
});
