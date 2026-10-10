import { Router, Response } from 'express';
import { z } from 'zod';
import { requireApiKey, ApiKeyRequest } from '../middleware/auth';
import { ingestRateLimit } from '../middleware/rateLimit';
import { validateBody } from '../middleware/validate';
import { ingestEvent } from '../services/ingestion';
import { logger } from '../utils/logger';

const router = Router();

const breadcrumbSchema = z.object({
  message: z.string().max(500),
  category: z.string().max(100).optional(),
  timestamp: z.string(),
  // Zod v4: z.record() requires an explicit key schema (was single-arg in v3)
  data: z.record(z.string(), z.unknown()).optional(),
});

const contextSchema = z
  .object({
    timestamp: z.string().optional(),
    userAgent: z.string().max(500).optional(),
    url: z.string().max(2000).optional(),
    // Both are actually persisted by the worker (error_events.release,
    // .breadcrumbs) - validated here rather than left to the untyped
    // catchall below, since malformed breadcrumbs would otherwise reach
    // the DB as whatever shape the caller happened to send.
    release: z.string().max(100).optional(),
    breadcrumbs: z.array(breadcrumbSchema).max(20).optional(),
  })
  .catchall(z.unknown())
  .optional();

const ingestSchema = z.object({
  message: z.string().min(1).max(1000),
  stack: z.string().max(5000).optional(),
  level: z.enum(['error', 'warning', 'info']).optional(),
  context: contextSchema,
});

// Order matters: api key resolves the project -> rate limit uses that
// project -> body validation -> handler only ever does a queue push.
router.post(
  '/',
  requireApiKey,
  ingestRateLimit,
  validateBody(ingestSchema),
  async (req: ApiKeyRequest, res: Response) => {
    try {
      const eventId = await ingestEvent(req.project!.id, req.body);
      res.status(200).json({ eventId });
    } catch (err) {
      // Queue push failed (e.g. Redis down). Fail fast - never make the
      // SDK caller wait on retries in the request path.
      logger.error('Ingestion enqueue failed', err);
      res.status(500).json({ error: 'InternalError', message: 'Could not accept event' });
    }
  }
);

export default router;
