import { Request, Response, NextFunction } from 'express';
import { config } from '../config';
import { redis } from '../config/redis';
import { logger } from '../utils/logger';
import { ApiKeyRequest } from './auth';

/**
 * The subset of ioredis's API this needs - lets tests inject a fake
 * in-memory implementation instead of mocking the ioredis module.
 */
export interface RateLimitRedisClient {
  incr(key: string): Promise<number>;
  pexpire(key: string, milliseconds: number): Promise<number>;
  pttl(key: string): Promise<number>;
}

interface RateLimiterOptions {
  windowMs: number;
  max: number;
  /** How to key the bucket - per project, per IP, per IP+email, etc. */
  keyFn: (req: Request) => string;
  message: string;
  /** Namespaces this limiter's keys in Redis - limiters share one keyspace. */
  prefix: string;
  /** Defaults to the shared client; tests inject a fake instead. */
  redisClient?: RateLimitRedisClient;
}

/**
 * Redis-backed: INCR + PEXPIRE on a per-window key. Fixes two things the
 * previous in-memory Map version had: (1) counts are shared across every
 * instance of this API, so the real limit is the configured max, not
 * (max x instance count) - and (2) Redis's own TTL expires the key, so
 * there's no unbounded Map growth to leak memory over the life of the
 * process (the old version never evicted stale entries at all).
 */
export function createRateLimiter(opts: RateLimiterOptions) {
  const client = opts.redisClient ?? redis;

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const key = `ratelimit:${opts.prefix}:${opts.keyFn(req)}`;

    try {
      const count = await client.incr(key);
      if (count === 1) {
        // First hit in this window - start the TTL. A race here (two
        // requests both INCR to 1 before either sets the expiry) would at
        // worst leave the key without a TTL for a brief moment; the next
        // window's first request still resets it correctly, so this
        // isn't worth the extra round trip a Lua script/transaction would
        // cost for a rate limiter.
        await client.pexpire(key, opts.windowMs);
      }

      if (count > opts.max) {
        const ttlMs = await client.pttl(key);
        const retryAfterSec = Math.ceil(Math.max(ttlMs, 0) / 1000);
        res.setHeader('Retry-After', String(retryAfterSec));
        res.status(429).json({ error: 'RateLimitExceeded', message: opts.message });
        return;
      }

      next();
    } catch (err) {
      // Fail OPEN, not closed: if Redis is down, letting login/ingestion
      // through unthrottled is a better tradeoff than taking the entire
      // API offline because the rate limiter's dependency had a hiccup.
      // Logged loudly so an outage here doesn't go unnoticed.
      logger.error('Rate limiter Redis error - failing open (request allowed)', err);
      next();
    }
  };
}

export const ingestRateLimit = createRateLimiter({
  windowMs: config.rateLimit.ingestWindowMs,
  max: config.rateLimit.ingestMaxRequests,
  keyFn: (req) => (req as ApiKeyRequest).project!.id,
  message: `Max ${config.rateLimit.ingestMaxRequests} events/min exceeded for this project`,
  prefix: 'ingest',
});

/**
 * Keyed by IP, not by the submitted email - keying by email would let an
 * attacker rotate through target emails from one IP with no limit at all,
 * which defeats the point. IP-based is the standard baseline; a stricter
 * setup could combine both (IP AND email) for tighter brute-force
 * protection, but that needs the request body already parsed and
 * validated first, which this middleware runs ahead of.
 */
export const authRateLimit = createRateLimiter({
  windowMs: config.rateLimit.authWindowMs,
  max: config.rateLimit.authMaxRequests,
  keyFn: (req) => req.ip ?? 'unknown',
  message: `Too many attempts - max ${config.rateLimit.authMaxRequests} per ${
    config.rateLimit.authWindowMs / 60000
  } minutes`,
  prefix: 'auth',
});
