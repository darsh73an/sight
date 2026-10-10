import crypto from 'crypto';
import { Worker, Job } from 'bullmq';
import { config } from '../config';
import { withTransaction, DbExecutor } from '../config/database';
import { QUEUE_NAME } from '../queues';
import { IngestJobData } from '../services/ingestion';
import { scrubPII, scrubContext } from '../services/scrubber';
import { generateFingerprint } from '../services/fingerprint';
import { ErrorGroupModel, ErrorGroup } from '../models/ErrorGroup';
import { ErrorEventModel, Breadcrumb } from '../models/ErrorEvent';
import { sendAlert } from '../services/alert';
import { logger } from '../utils/logger';

function extractErrorType(message: string): string | undefined {
  const match = message.match(/^([A-Za-z]+Error)\b/);
  return match ? match[1] : undefined;
}

/**
 * find-or-create for the group, race-safe WITHOUT throwing: ErrorGroupModel
 * .create() uses ON CONFLICT DO NOTHING and returns null instead of
 * throwing 23505, specifically so this can run inside a transaction - a
 * thrown error would abort the whole transaction and poison the
 * connection for every query after it, including the "just re-fetch what
 * the other worker created" fallback.
 */
async function findOrCreateGroup(
  projectId: string,
  fingerprint: string,
  title: string,
  errorType: string | undefined,
  level: 'error' | 'warning' | 'info',
  t: DbExecutor
): Promise<{ group: ErrorGroup; isNewGroup: boolean }> {
  const existing = await ErrorGroupModel.findByFingerprint(projectId, fingerprint, t);
  if (existing) {
    return { group: existing, isNewGroup: false };
  }

  const created = await ErrorGroupModel.create(
    { projectId, fingerprint, title, errorType, level },
    t
  );
  if (created) {
    return { group: created, isNewGroup: true };
  }

  // null means ON CONFLICT fired - another worker won the race between
  // our lookup and our insert. No error was thrown, so the transaction
  // is still healthy; just fetch what they created.
  const winner = await ErrorGroupModel.findByFingerprint(projectId, fingerprint, t);
  if (!winner) {
    throw new Error(`Group insert conflicted but no row found for fingerprint ${fingerprint}`);
  }
  return { group: winner, isNewGroup: false };
}

type ProcessResult =
  | { duplicate: true }
  | { duplicate: false; group: ErrorGroup; isNewGroup: boolean };

async function processEvent(job: Job<IngestJobData>): Promise<void> {
  const { eventId, projectId, message, stack, level, context } = job.data;

  // 1. Scrub PII - only place in the pipeline this happens, and recurses
  // into nested context objects/arrays, not just top-level keys.
  const scrubbedMessage = scrubPII(message);
  const scrubbedStack = stack ? scrubPII(stack) : undefined;
  const scrubbedContext = context ? scrubContext(context) : {};

  // 2. Fingerprint
  const fingerprint = generateFingerprint(scrubbedMessage, scrubbedStack);
  const title = scrubbedMessage.slice(0, 500);
  const errorType = extractErrorType(scrubbedMessage);

  const userId = scrubbedContext.userId;
  const userIdHash =
    typeof userId === 'string' || typeof userId === 'number'
      ? crypto.createHash('sha256').update(String(userId)).digest('hex')
      : undefined;

  const release = typeof scrubbedContext.release === 'string' ? scrubbedContext.release : undefined;
  const breadcrumbs: Breadcrumb[] = Array.isArray(scrubbedContext.breadcrumbs)
    ? (scrubbedContext.breadcrumbs as Breadcrumb[])
    : [];

  // 3-5. Group resolution, the idempotent event insert, and counter bumps
  // all happen in ONE transaction. If the event insert hits a conflict
  // (this eventId was already processed by an earlier, redelivered
  // attempt of this same job), the whole transaction is abandoned -
  // including any group creation/counter bump this attempt just did -
  // so a retry can never double-count.
  const result = await withTransaction<ProcessResult>(async (t) => {
    const { group, isNewGroup } = await findOrCreateGroup(
      projectId,
      fingerprint,
      title,
      errorType,
      level ?? 'error',
      t
    );

    const insertedEvent = await ErrorEventModel.create(
      {
        eventId,
        errorGroupId: group.id,
        projectId,
        message: scrubbedMessage,
        stackTrace: scrubbedStack,
        level,
        release,
        environment:
          typeof scrubbedContext.environment === 'string' ? scrubbedContext.environment : 'production',
        userIdHash,
        breadcrumbs,
        context: scrubbedContext,
        url: typeof scrubbedContext.url === 'string' ? scrubbedContext.url : undefined,
        userAgent: typeof scrubbedContext.userAgent === 'string' ? scrubbedContext.userAgent : undefined,
      },
      t
    );

    if (!insertedEvent) {
      // event_id conflict - this exact event was already fully processed
      // by a prior attempt. Do NOT bump any counters here; that already
      // happened when it was first (successfully) inserted.
      return { duplicate: true };
    }

    // Only reached once per unique eventId - safe to bump exactly once.
    const bumped = await ErrorGroupModel.recordOccurrence(group.id, t);
    let finalGroup = bumped ?? group;

    // user_count is a distinct count, not additive - recompute it rather
    // than incrementing, and only bother when this event actually carried
    // a user id (saves a query on anonymous events).
    if (userIdHash) {
      const distinctUsers = await ErrorEventModel.countDistinctUsersByGroup(group.id, t);
      const withUserCount = await ErrorGroupModel.updateUserCount(group.id, distinctUsers, t);
      finalGroup = withUserCount ?? finalGroup;
    }

    return { duplicate: false, group: finalGroup, isNewGroup };
  });

  if (result.duplicate) {
    logger.info(`Event ${eventId} already processed - skipping duplicate (idempotent retry)`);
    return;
  }

  // Alert only on brand-new groups, never on repeat occurrences - and
  // only after the transaction committed, so we never alert on work that
  // got rolled back.
  if (result.isNewGroup) {
    await sendAlert(projectId, result.group);
  }

  logger.info(
    `Processed event ${eventId} -> group ${result.group.id} (new: ${result.isNewGroup}, fingerprint: ${fingerprint})`
  );
}

export const eventWorker = new Worker<IngestJobData>(
  QUEUE_NAME,
  async (job) => {
    // No try/catch here - letting the error propagate is what tells
    // BullMQ to retry using the attempts/backoff set at queue.add() time.
    await processEvent(job);
  },
  {
    connection: { host: config.redis.host, port: config.redis.port },
    concurrency: 5,
  }
);

eventWorker.on('completed', (job) => {
  logger.info(`Job ${job.id} completed (event ${job.data.eventId})`);
});

eventWorker.on('failed', (job, err) => {
  logger.error(
    `Job ${job?.id} failed (event ${job?.data.eventId}), attempt ${job?.attemptsMade}: ${err.message}`
  );
});

logger.info('ErrSight worker started, listening on queue:', QUEUE_NAME);

// Worker.close() stops pulling new jobs and waits for whatever's
// currently active to finish before resolving - important here
// specifically because a job mid-transaction (see withTransaction above)
// killed outright would roll back cleanly, but killed via SIGKILL after
// a redelivery timeout wouldn't get that chance.
let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`${signal} received - closing worker (waiting for active jobs to finish)`);

  try {
    await eventWorker.close();
    logger.info('Worker closed');
  } catch (err) {
    logger.error('Error closing worker', err);
  }

  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
