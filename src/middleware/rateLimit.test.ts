import { describe, it, expect, vi } from 'vitest';
import { Request, Response } from 'express';
import { createRateLimiter, RateLimitRedisClient } from './rateLimit';

/** Minimal fakes - just enough surface for the middleware under test. */
function fakeReq(ip: string): Request {
  return { ip } as Request;
}

function fakeRes(): Response {
  const res: Partial<Response> = {};
  res.setHeader = vi.fn().mockReturnValue(res);
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res as Response;
}

/**
 * In-memory stand-in for the 3 ioredis methods the limiter uses, with the
 * same semantics: INCR auto-creates at 1, PEXPIRE sets a TTL, keys that
 * outlive their TTL behave as if they don't exist (next INCR starts at 1
 * again) - mirrors real Redis closely enough to test the limiter's logic
 * without needing a live Redis connection.
 */
function fakeRedisClient(): RateLimitRedisClient {
  const store = new Map<string, { count: number; expiresAt: number }>();

  return {
    async incr(key) {
      const now = Date.now();
      const entry = store.get(key);
      if (!entry || entry.expiresAt <= now) {
        store.set(key, { count: 1, expiresAt: Infinity });
        return 1;
      }
      entry.count += 1;
      return entry.count;
    },
    async pexpire(key, ms) {
      const entry = store.get(key);
      if (!entry) return 0;
      entry.expiresAt = Date.now() + ms;
      return 1;
    },
    async pttl(key) {
      const entry = store.get(key);
      if (!entry) return -2;
      return Math.max(entry.expiresAt - Date.now(), 0);
    },
  };
}

describe('createRateLimiter', () => {
  it('allows requests under the limit', async () => {
    const limiter = createRateLimiter({
      windowMs: 60_000,
      max: 3,
      keyFn: (r) => r.ip!,
      message: 'blocked',
      prefix: 'test',
      redisClient: fakeRedisClient(),
    });
    const next = vi.fn();
    const res = fakeRes();

    await limiter(fakeReq('1.1.1.1'), res, next);
    await limiter(fakeReq('1.1.1.1'), res, next);
    await limiter(fakeReq('1.1.1.1'), res, next);

    expect(next).toHaveBeenCalledTimes(3);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('blocks with 429 once the limit is exceeded', async () => {
    const limiter = createRateLimiter({
      windowMs: 60_000,
      max: 2,
      keyFn: (r) => r.ip!,
      message: 'blocked',
      prefix: 'test',
      redisClient: fakeRedisClient(),
    });
    const next = vi.fn();
    const res = fakeRes();

    await limiter(fakeReq('2.2.2.2'), res, next); // 1 - ok
    await limiter(fakeReq('2.2.2.2'), res, next); // 2 - ok
    await limiter(fakeReq('2.2.2.2'), res, next); // 3 - over limit

    expect(next).toHaveBeenCalledTimes(2);
    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'RateLimitExceeded', message: 'blocked' })
    );
  });

  it('tracks separate keys independently', async () => {
    const limiter = createRateLimiter({
      windowMs: 60_000,
      max: 1,
      keyFn: (r) => r.ip!,
      message: 'blocked',
      prefix: 'test',
      redisClient: fakeRedisClient(),
    });
    const next = vi.fn();
    const res = fakeRes();

    await limiter(fakeReq('3.3.3.1'), res, next); // ok
    await limiter(fakeReq('3.3.3.1'), res, next); // blocked (2nd for this key)
    await limiter(fakeReq('3.3.3.2'), res, next); // different key - ok

    expect(next).toHaveBeenCalledTimes(2);
    expect(res.status).toHaveBeenCalledTimes(1);
  });

  it('resets the count after the window elapses', async () => {
    vi.useFakeTimers();
    try {
      const limiter = createRateLimiter({
        windowMs: 1000,
        max: 1,
        keyFn: (r) => r.ip!,
        message: 'blocked',
        prefix: 'test',
        redisClient: fakeRedisClient(),
      });
      const next = vi.fn();
      const res = fakeRes();

      await limiter(fakeReq('4.4.4.4'), res, next); // ok
      await limiter(fakeReq('4.4.4.4'), res, next); // blocked

      vi.advanceTimersByTime(1001); // past the window

      await limiter(fakeReq('4.4.4.4'), res, next); // ok again - new window

      expect(next).toHaveBeenCalledTimes(2);
      expect(res.status).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('fails OPEN when the Redis client errors - request is allowed through, not blocked', async () => {
    const brokenClient: RateLimitRedisClient = {
      incr: vi.fn().mockRejectedValue(new Error('connection refused')),
      pexpire: vi.fn(),
      pttl: vi.fn(),
    };
    const limiter = createRateLimiter({
      windowMs: 60_000,
      max: 1,
      keyFn: (r) => r.ip!,
      message: 'blocked',
      prefix: 'test',
      redisClient: brokenClient,
    });
    const next = vi.fn();
    const res = fakeRes();

    await limiter(fakeReq('5.5.5.5'), res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });
});
