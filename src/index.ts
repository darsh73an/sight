import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { config } from './config';
import { testConnection, pool } from './config/database';
import { redis, testRedisConnection } from './config/redis';
import { logger } from './utils/logger';
import authRoutes from './routes/auth';
import projectsRoutes from './routes/projects';
import ingestRoutes from './routes/ingest';
import errorsRoutes from './routes/errors';

const app = express();

// Required for req.ip to reflect the real client behind a reverse proxy
// or Docker's networking - without this, the auth rate limiter below
// would key every request by the proxy's IP instead of the caller's,
// making it either useless (everyone shares one bucket) or block
// everyone at once. Trusts exactly one hop; adjust if there's more than
// one proxy layer in front of this service.
app.set('trust proxy', 1);

app.use(helmet());
app.use(express.json({ limit: '1mb' }));

// Dashboard-facing routes (JWT auth): restrict to known origins in
// production. In development, no CORS_ORIGIN is required, so it's left
// open for convenience running the Vite dev server on any port.
// In production with nothing configured, this denies all cross-origin
// calls rather than silently falling back to wide-open - a loud "you
// forgot to configure this" instead of an invisible security hole.
if (config.env === 'production' && config.cors.allowedOrigins.length === 0) {
  logger.warn(
    'CORS_ORIGIN is not set in production - dashboard API will reject all cross-origin requests until it is configured'
  );
}
const dashboardCors = cors({
  origin:
    config.cors.allowedOrigins.length > 0
      ? config.cors.allowedOrigins
      : config.env === 'production'
        ? false
        : true,
  credentials: true,
});

app.get('/health', async (_req: Request, res: Response) => {
  const [dbOk, redisOk] = await Promise.all([
    testConnection().then(
      () => true,
      () => false
    ),
    testRedisConnection().then(
      () => true,
      () => false
    ),
  ]);

  const healthy = dbOk && redisOk;
  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'ok' : 'degraded',
    checks: { database: dbOk, redis: redisOk },
  });
});

app.use('/api/auth', dashboardCors, authRoutes);
app.use('/api/projects', dashboardCors, projectsRoutes);
app.use('/api/errors', dashboardCors, errorsRoutes);

// Deliberately NOT behind dashboardCors - the SDK runs on arbitrary
// third-party sites/apps, which is the entire point of ingestion. A
// restrictive origin policy here would break every customer's install.
app.use('/api/ingest', cors(), ingestRoutes);

// 404 fallback
app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: 'NotFound', message: 'Route not found' });
});

// Central error handler
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  logger.error('Unhandled error', err);
  res.status(500).json({ error: 'InternalError', message: 'Something went wrong' });
});

async function start() {
  try {
    await testConnection();
    logger.info('Database connection OK');
  } catch (err) {
    logger.error('Database connection failed', err);
    process.exit(1);
  }

  try {
    await testRedisConnection();
    logger.info('Redis connection OK');
  } catch (err) {
    // Not fatal the way the DB is: the rate limiter fails open on Redis
    // errors (see middleware/rateLimit.ts) and ingestion will surface its
    // own errors per-request if the queue is actually unreachable. Log
    // loudly rather than refuse to boot - an API that won't even start
    // because of a side-car dependency is often a worse outage than a
    // degraded one.
    logger.error('Redis connection failed at startup - continuing anyway', err);
  }

  const server = app.listen(config.port, () => {
    logger.info(`ErrSight API listening on port ${config.port}`);
  });

  // Container orchestrators (Docker, Kubernetes) send SIGTERM on
  // redeploy/scale-down. Without handling it, in-flight requests get cut
  // off mid-response instead of finishing first.
  let shuttingDown = false;
  async function shutdown(signal: string) {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`${signal} received - shutting down gracefully`);

    server.close(() => {
      logger.info('HTTP server closed - no longer accepting new connections');
    });

    try {
      await pool.end();
      logger.info('Database pool closed');
    } catch (err) {
      logger.error('Error closing database pool', err);
    }

    try {
      await redis.quit();
      logger.info('Redis connection closed');
    } catch (err) {
      logger.error('Error closing Redis connection', err);
    }

    process.exit(0);
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

start();

export default app;
