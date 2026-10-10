import { randomUUID } from 'crypto';
import { eventQueue } from '../queues';

export interface IngestContext {
  timestamp?: string;
  userAgent?: string;
  url?: string;
  [key: string]: unknown;
}

export interface IngestPayload {
  message: string;
  stack?: string;
  level?: 'error' | 'warning' | 'info';
  context?: IngestContext;
}

export interface IngestJobData extends IngestPayload {
  eventId: string;
  projectId: string;
  receivedAt: string;
}

/**
 * The entire job of the request handler: generate an id, push the raw
 * payload onto the queue, return. No DB writes, no fingerprinting, no
 * scrubbing here - all of that happens in the Phase 4 worker, off the
 * request path.
 */
export async function ingestEvent(
  projectId: string,
  payload: IngestPayload
): Promise<string> {
  const eventId = randomUUID();

  const jobData: IngestJobData = {
    eventId,
    projectId,
    receivedAt: new Date().toISOString(),
    ...payload,
  };

  await eventQueue.add('process-event', jobData, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 1000 },
    removeOnComplete: 100,
    removeOnFail: 500,
  });

  return eventId;
}
