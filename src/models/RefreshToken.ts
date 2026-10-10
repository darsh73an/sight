import { query, queryOne, db, DbExecutor } from '../config/database';

export interface RefreshToken {
  id: string;
  user_id: string;
  token_hash: string;
  expires_at: Date;
  revoked_at: Date | null;
  created_at: Date;
}

export const RefreshTokenModel = {
  async create(
    userId: string,
    tokenHash: string,
    expiresAt: Date,
    exec: DbExecutor = db
  ): Promise<RefreshToken> {
    const row = await exec.queryOne<RefreshToken>(
      `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [userId, tokenHash, expiresAt]
    );
    if (!row) throw new Error('Failed to create refresh token');
    return row;
  },

  /** Only returns a token that's actually usable right now - not revoked, not expired. */
  async findValidByHash(tokenHash: string): Promise<RefreshToken | null> {
    return queryOne<RefreshToken>(
      `SELECT * FROM refresh_tokens
       WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > NOW()`,
      [tokenHash]
    );
  },

  async revoke(id: string): Promise<void> {
    await query('UPDATE refresh_tokens SET revoked_at = NOW() WHERE id = $1', [id]);
  },

  /** Used on password reset - a reset implies "assume compromise", so every session gets signed out. */
  async revokeAllForUser(userId: string): Promise<void> {
    await query(
      'UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL',
      [userId]
    );
  },
};
