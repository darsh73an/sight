import { query, queryOne, db, DbExecutor } from '../config/database';

export interface Breadcrumb {
  message: string;
  category?: string;
  timestamp: string;
  data?: Record<string, unknown>;
}

export interface ErrorEvent {
  id: string;
  event_id: string;
  error_group_id: string;
  project_id: string;
  message: string;
  stack_trace: string | null;
  level: string;
  release: string | null;
  environment: string;
  user_id_hash: string | null;
  breadcrumbs: Breadcrumb[];
  context: Record<string, unknown>;
  url: string | null;
  user_agent: string | null;
  created_at: Date;
}

export interface CreateErrorEventInput {
  /**
   * Idempotency key generated once by the ingestion API (see
   * services/ingestion.ts) and carried through the BullMQ job. Required -
   * this is what makes a redelivered job a safe no-op instead of a
   * duplicate row.
   */
  eventId: string;
  errorGroupId: string;
  projectId: string;
  message: string;
  stackTrace?: string;
  level?: string;
  release?: string;
  environment?: string;
  userIdHash?: string;
  breadcrumbs?: Breadcrumb[];
  context?: Record<string, unknown>;
  url?: string;
  userAgent?: string;
}

export const ErrorEventModel = {
  /**
   * ON CONFLICT (event_id) DO NOTHING - a second insert attempt with the
   * same event_id (BullMQ redelivering an already-completed job) returns
   * null instead of throwing or creating a duplicate row. The caller
   * treats null as "already processed, do nothing further" rather than
   * an error.
   */
  async create(
    input: CreateErrorEventInput,
    exec: DbExecutor = db
  ): Promise<ErrorEvent | null> {
    return exec.queryOne<ErrorEvent>(
      `INSERT INTO error_events
        (event_id, error_group_id, project_id, message, stack_trace, level,
         release, environment, user_id_hash, breadcrumbs, context, url, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       ON CONFLICT (event_id) DO NOTHING
       RETURNING *`,
      [
        input.eventId,
        input.errorGroupId,
        input.projectId,
        input.message,
        input.stackTrace ?? null,
        input.level ?? 'error',
        input.release ?? null,
        input.environment ?? 'production',
        input.userIdHash ?? null,
        JSON.stringify(input.breadcrumbs ?? []),
        JSON.stringify(input.context ?? {}),
        input.url ?? null,
        input.userAgent ?? null,
      ]
    );
  },

  async findById(id: string): Promise<ErrorEvent | null> {
    return queryOne<ErrorEvent>('SELECT * FROM error_events WHERE id = $1', [
      id,
    ]);
  },

  async listByGroup(
    errorGroupId: string,
    limit = 20,
    offset = 0
  ): Promise<ErrorEvent[]> {
    return query<ErrorEvent>(
      `SELECT * FROM error_events
       WHERE error_group_id = $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [errorGroupId, limit, offset]
    );
  },

  async countDistinctUsersByGroup(
    errorGroupId: string,
    exec: DbExecutor = db
  ): Promise<number> {
    const row = await exec.queryOne<{ count: string }>(
      `SELECT COUNT(DISTINCT user_id_hash) as count
       FROM error_events
       WHERE error_group_id = $1 AND user_id_hash IS NOT NULL`,
      [errorGroupId]
    );
    return parseInt(row?.count ?? '0', 10);
  },
};
