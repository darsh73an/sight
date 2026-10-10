-- Refresh tokens are stored hashed (sha256 hex), never raw - same reason
-- passwords are hashed: a DB leak shouldn't hand out usable credentials.
-- Rotation (old token revoked, new one issued on every /auth/refresh
-- call) means a stolen-but-unused refresh token becomes invalid the
-- moment the legitimate owner's client refreshes again.

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash VARCHAR(64) UNIQUE NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_hash ON refresh_tokens(token_hash);
