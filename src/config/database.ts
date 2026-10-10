import { Pool, QueryResultRow } from 'pg';
import { config } from './index';

export const pool = new Pool({
  connectionString: config.db.connectionString,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  // eslint-disable-next-line no-console
  console.error('Unexpected PostgreSQL pool error', err);
});

/**
 * Run a query, return all rows.
 */
export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[]
): Promise<T[]> {
  const result = await pool.query<T>(text, params);
  return result.rows;
}

/**
 * Run a query, return the first row (or null).
 * Use for lookups by id/unique key.
 */
export async function queryOne<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[]
): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}

export async function testConnection(): Promise<void> {
  await pool.query('SELECT 1');
}

/**
 * Models accept this as an optional last argument so the same method can
 * run against the global pool (the default) OR inside a withTransaction()
 * callback - without that, calling a model method inside a transaction
 * would silently use a *different* connection than the transaction,
 * defeating the point of wrapping things in BEGIN/COMMIT at all.
 */
export interface DbExecutor {
  query: typeof query;
  queryOne: typeof queryOne;
}

export const db: DbExecutor = { query, queryOne };

/**
 * Run multiple queries in a single transaction.
 * Pass a callback that receives a client-scoped query/queryOne pair;
 * commits on success, rolls back on any thrown error.
 *
 * Usage:
 *   await withTransaction(async (t) => {
 *     await t.query('UPDATE ...', [..]);
 *     await t.queryOne('INSERT ...', [..]);
 *   });
 */
export async function withTransaction<T>(
  callback: (t: DbExecutor) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const scoped: DbExecutor = {
      query: async <R extends QueryResultRow = QueryResultRow>(
        text: string,
        params?: unknown[]
      ): Promise<R[]> => {
        const result = await client.query<R>(text, params);
        return result.rows;
      },
      queryOne: async <R extends QueryResultRow = QueryResultRow>(
        text: string,
        params?: unknown[]
      ): Promise<R | null> => {
        const result = await client.query<R>(text, params);
        return result.rows[0] ?? null;
      },
    };

    const result = await callback(scoped);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
