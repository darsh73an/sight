import crypto from 'crypto';

/**
 * Generates a high-entropy opaque token (not a JWT) plus its hash.
 * The raw token is what goes to the client/email; only the hash is
 * stored in the DB - same reasoning as password hashing: a DB leak
 * shouldn't hand out directly usable credentials.
 */
export function generateOpaqueToken(): { raw: string; hash: string } {
  const raw = crypto.randomBytes(32).toString('hex');
  const hash = hashToken(raw);
  return { raw, hash };
}

export function hashToken(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex');
}
