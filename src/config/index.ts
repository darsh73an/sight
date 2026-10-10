import dotenv from 'dotenv';

dotenv.config();

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

const env = required('NODE_ENV', 'development');
const isProduction = env === 'production';

/**
 * JWT_SECRET is the one env var that must NEVER silently fall back to a
 * default - a fallback here means every deployment that forgets to set it
 * shares the same publicly-known signing key ('dev-secret-change-me' is
 * sitting in this very file's git history), which lets anyone forge a
 * valid token for any user. Fail fast at startup instead: refusing to
 * boot is far cheaper than an undetected auth bypass in production.
 * The insecure default is still allowed in development, purely so a
 * fresh clone runs immediately without needing a .env file first.
 */
function requiredJwtSecret(): string {
  const value = process.env.JWT_SECRET;
  if (value) return value;

  if (isProduction) {
    throw new Error(
      'JWT_SECRET must be set when NODE_ENV=production - refusing to start with no signing secret configured'
    );
  }

  return 'dev-secret-change-me';
}

export const config = {
  env,
  port: parseInt(required('PORT', '4000'), 10),

  db: {
    connectionString: required(
      'DATABASE_URL',
      'postgresql://errsight:errsight@localhost:5432/errsight'
    ),
  },

  redis: {
    host: required('REDIS_HOST', 'localhost'),
    port: parseInt(required('REDIS_PORT', '6379'), 10),
  },

  jwt: {
    secret: requiredJwtSecret(),
    // This now governs the short-lived ACCESS token - a refresh token
    // (see refreshToken below) handles staying signed in long-term. 7d
    // was fine when this was the only token; now that a stolen access
    // token's blast radius matters more (refresh tokens can be revoked,
    // a bare JWT can't), short-lived is the point.
    expiresIn: required('JWT_EXPIRES_IN', '15m'),
  },

  refreshToken: {
    expiresDays: parseInt(required('REFRESH_TOKEN_EXPIRES_DAYS', '30'), 10),
  },

  /** Used to build links in verification/password-reset emails (logged, not actually sent - see README). */
  appUrl: required('APP_URL', 'http://localhost:5173'),

  rateLimit: {
    ingestWindowMs: parseInt(required('INGEST_RATE_WINDOW_MS', '60000'), 10),
    ingestMaxRequests: parseInt(required('INGEST_RATE_MAX', '100'), 10),
    // Stricter window for login/register - brute-force/credential-stuffing
    // protection, not just abuse prevention like the ingest limiter above.
    authWindowMs: parseInt(required('AUTH_RATE_WINDOW_MS', '900000'), 10), // 15 min
    authMaxRequests: parseInt(required('AUTH_RATE_MAX', '10'), 10),
  },

  alerts: {
    // Optional - if unset, alerts just get logged instead of sent anywhere
    slackWebhookUrl: process.env.SLACK_WEBHOOK_URL,
  },

  cors: {
    // Comma-separated list of origins allowed to call the JWT-authed
    // dashboard endpoints (auth/projects/errors). Deliberately does NOT
    // apply to /api/ingest - that endpoint exists specifically to accept
    // requests from arbitrary third-party sites running the SDK, so
    // restricting its origin would break the product.
    allowedOrigins: (process.env.CORS_ORIGIN ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  },
};
