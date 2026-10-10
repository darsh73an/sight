import { query, queryOne } from '../config/database';

export interface PasswordResetToken {
  id: string;
  user_id: string;
  token_hash: string;
  expires_at: Date;
  used_at: Date | null;
  created_at: Date;
}

export const PasswordResetTokenModel = {
  async create(userId: string, tokenHash: string, expiresAt: Date): Promise<PasswordResetToken> {
    const row = await queryOne<PasswordResetToken>(
      `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [userId, tokenHash, expiresAt]
    );
    if (!row) throw new Error('Failed to create password reset token');
    return row;
  },

  /** Unused, unexpired - a used or expired token is not "found" as far as the caller is concerned. */
  async findValidByHash(tokenHash: string): Promise<PasswordResetToken | null> {
    return queryOne<PasswordResetToken>(
      `SELECT * FROM password_reset_tokens
       WHERE token_hash = $1 AND used_at IS NULL AND expires_at > NOW()`,
      [tokenHash]
    );
  },

  async markUsed(id: string): Promise<void> {
    await query('UPDATE password_reset_tokens SET used_at = NOW() WHERE id = $1', [id]);
  },
};
