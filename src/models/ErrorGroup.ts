import { query, queryOne, db, DbExecutor } from '../config/database';

export type ErrorGroupStatus = 'unresolved' | 'resolved' | 'ignored';
export type ErrorGroupLevel = 'error' | 'warning' | 'info';

export interface ErrorGroup {
  id: string;
  project_id: string;
  fingerprint: string;
  title: string;
  error_type: string | null;
  status: ErrorGroupStatus;
  level: ErrorGroupLevel;
  event_count: number;
  user_count: number;
  first_seen: Date;
  last_seen: Date;
  created_at: Date;
  updated_at: Date;
}

export interface CreateErrorGroupInput {
  projectId: string;
  fingerprint: string;
  title: string;
  errorType?: string;
  level?: ErrorGroupLevel;
}

export const ErrorGroupModel = {
  async findByFingerprint(
    projectId: string,
    fingerprint: string,
    exec: DbExecutor = db
  ): Promise<ErrorGroup | null> {
    return exec.queryOne<ErrorGroup>(
      'SELECT * FROM error_groups WHERE project_id = $1 AND fingerprint = $2',
      [projectId, fingerprint]
    );
  },

  /**
   * ON CONFLICT DO NOTHING instead of a bare INSERT: two workers can race
   * to create the same brand-new fingerprint. A bare INSERT would throw a
   * 23505 unique-violation - fine outside a transaction, but fatal *inside*
   * one, since Postgres aborts the whole transaction on any error and
   * refuses further commands until ROLLBACK. Returning null on conflict
   * lets the caller just re-fetch, no error/rollback involved either way.
   */
  async create(
    input: CreateErrorGroupInput,
    exec: DbExecutor = db
  ): Promise<ErrorGroup | null> {
    return exec.queryOne<ErrorGroup>(
      `INSERT INTO error_groups (project_id, fingerprint, title, error_type, level)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (project_id, fingerprint) DO NOTHING
       RETURNING *`,
      [
        input.projectId,
        input.fingerprint,
        input.title,
        input.errorType ?? null,
        input.level ?? 'error',
      ]
    );
  },

  /**
   * Atomically bump the counters and last_seen timestamp for a group.
   * Used by the worker on every incoming event for an existing fingerprint.
   */
  async recordOccurrence(id: string, exec: DbExecutor = db): Promise<ErrorGroup | null> {
    return exec.queryOne<ErrorGroup>(
      `UPDATE error_groups
       SET event_count = event_count + 1,
           last_seen = NOW(),
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [id]
    );
  },

  /**
   * Bumps event_count by an arbitrary amount in one round trip - for
   * seeding/backfilling where recordOccurrence's +1 would mean one await
   * per unit (e.g. 203 sequential UPDATE queries for a count of 203).
   */
  async incrementEventCount(
    id: string,
    by: number,
    exec: DbExecutor = db
  ): Promise<ErrorGroup | null> {
    return exec.queryOne<ErrorGroup>(
      `UPDATE error_groups
       SET event_count = event_count + $2,
           last_seen = NOW(),
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [id, by]
    );
  },

  /**
   * Sets user_count to an exact value (the caller computes the current
   * distinct-user count via ErrorEventModel.countDistinctUsersByGroup).
   * Not a += bump like recordOccurrence, because "distinct users" isn't
   * additive - the same user_id_hash showing up twice shouldn't count
   * twice, so the count has to be recomputed, not incremented.
   */
  async updateUserCount(
    id: string,
    userCount: number,
    exec: DbExecutor = db
  ): Promise<ErrorGroup | null> {
    return exec.queryOne<ErrorGroup>(
      `UPDATE error_groups SET user_count = $2, updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [id, userCount]
    );
  },

  async findById(id: string): Promise<ErrorGroup | null> {
    return queryOne<ErrorGroup>('SELECT * FROM error_groups WHERE id = $1', [
      id,
    ]);
  },

  /**
   * Cursor-based instead of OFFSET-based: OFFSET N forces Postgres to
   * scan and discard N rows on every request, which gets linearly more
   * expensive the deeper you page. A keyset cursor (last_seen, id)
   * instead jumps straight to the right spot using
   * idx_error_groups_cursor, regardless of how deep the page is.
   *
   * (last_seen, id) as a pair, not last_seen alone, because last_seen
   * isn't unique - two groups updated in the same instant would
   * otherwise be ambiguous/skippable at a page boundary. id as the
   * tiebreaker makes the ordering total.
   */
  async listByProject(
    projectId: string,
    opts: {
      status?: ErrorGroupStatus;
      level?: ErrorGroupLevel;
      limit?: number;
      cursor?: { lastSeen: string; id: string };
    } = {}
  ): Promise<ErrorGroup[]> {
    const conditions = ['project_id = $1'];
    const params: unknown[] = [projectId];

    if (opts.status) {
      params.push(opts.status);
      conditions.push(`status = $${params.length}`);
    }

    if (opts.level) {
      params.push(opts.level);
      conditions.push(`level = $${params.length}`);
    }

    if (opts.cursor) {
      params.push(opts.cursor.lastSeen, opts.cursor.id);
      // Row comparison: strictly "older" than the cursor row in
      // (last_seen DESC, id DESC) order.
      conditions.push(
        `(last_seen, id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`
      );
    }

    const limit = opts.limit ?? 50;
    params.push(limit);

    return query<ErrorGroup>(
      `SELECT * FROM error_groups
       WHERE ${conditions.join(' AND ')}
       ORDER BY last_seen DESC, id DESC
       LIMIT $${params.length}`,
      params
    );
  },

  async updateStatus(
    id: string,
    status: ErrorGroupStatus
  ): Promise<ErrorGroup | null> {
    return queryOne<ErrorGroup>(
      `UPDATE error_groups SET status = $2, updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [id, status]
    );
  },

  async countByProject(
    projectId: string,
    status?: ErrorGroupStatus
  ): Promise<number> {
    const row = status
      ? await queryOne<{ count: string }>(
          'SELECT COUNT(*) as count FROM error_groups WHERE project_id = $1 AND status = $2',
          [projectId, status]
        )
      : await queryOne<{ count: string }>(
          'SELECT COUNT(*) as count FROM error_groups WHERE project_id = $1',
          [projectId]
        );
    return parseInt(row?.count ?? '0', 10);
  },
};
