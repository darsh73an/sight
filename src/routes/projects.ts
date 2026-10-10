import { Router, Response } from 'express';
import { z } from 'zod';
import { ProjectModel } from '../models/Project';
import { ErrorGroupModel, ErrorGroupStatus, ErrorGroupLevel } from '../models/ErrorGroup';
import { requireAuth, AuthenticatedRequest } from '../middleware/auth';
import { validateBody } from '../middleware/validate';
import { encodeCursor, decodeCursor } from '../utils/cursor';
import { logger } from '../utils/logger';

const router = Router();

router.use(requireAuth);

const createProjectSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(255),
  platform: z.string().trim().max(50).optional(),
});

const VALID_STATUSES = new Set<ErrorGroupStatus>(['unresolved', 'resolved', 'ignored']);
const VALID_LEVELS = new Set<ErrorGroupLevel>(['error', 'warning', 'info']);

function clampInt(value: unknown, def: number, min: number, max: number): number {
  const n = typeof value === 'string' ? parseInt(value, 10) : NaN;
  if (Number.isNaN(n)) return def;
  return Math.min(Math.max(n, min), max);
}

// GET /api/projects - only the caller's own projects
router.get('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const projects = await ProjectModel.findByOwner(req.user!.id);
    res.status(200).json({ projects });
  } catch (err) {
    logger.error('List projects failed', err);
    res.status(500).json({ error: 'InternalError', message: 'Could not list projects' });
  }
});

// POST /api/projects
router.post(
  '/',
  validateBody(createProjectSchema),
  async (req: AuthenticatedRequest, res: Response) => {
    const { name, platform } = req.body;

    try {
      const project = await ProjectModel.create({
        name,
        ownerId: req.user!.id,
        platform,
      });
      res.status(201).json({ project });
    } catch (err) {
      logger.error('Create project failed', err);
      res.status(500).json({ error: 'InternalError', message: 'Could not create project' });
    }
  }
);

// GET /api/projects/:projectId/errors - error groups for one project
router.get('/:projectId/errors', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { projectId } = req.params;

    const owns = await ProjectModel.belongsToOwner(projectId, req.user!.id);
    if (!owns) {
      // 404, not empty list - don't confirm/deny another user's project exists
      res.status(404).json({ error: 'NotFound', message: 'Project not found' });
      return;
    }

    const statusParam = req.query.status;
    const status =
      typeof statusParam === 'string' && VALID_STATUSES.has(statusParam as ErrorGroupStatus)
        ? (statusParam as ErrorGroupStatus)
        : undefined;

    const levelParam = req.query.level;
    const level =
      typeof levelParam === 'string' && VALID_LEVELS.has(levelParam as ErrorGroupLevel)
        ? (levelParam as ErrorGroupLevel)
        : undefined;

    const limit = clampInt(req.query.limit, 50, 1, 100);

    const cursorParam = req.query.cursor;
    let cursor: { lastSeen: string; id: string } | undefined;
    if (typeof cursorParam === 'string') {
      const decoded = decodeCursor(cursorParam);
      if (!decoded) {
        res.status(400).json({ error: 'ValidationError', message: 'Invalid cursor' });
        return;
      }
      cursor = decoded;
    }

    // Filtering happens in the SQL WHERE clause (see ErrorGroupModel.listByProject) -
    // never fetch everything and .filter() in JS, that throws away the whole
    // point of an index and drags every row across the wire for nothing.
    const groups = await ErrorGroupModel.listByProject(projectId, {
      status,
      level,
      limit,
      cursor,
    });

    // A full page might mean there's more - give the client a cursor to
    // ask for it. A partial page means we've hit the end, no cursor.
    const nextCursor =
      groups.length === limit
        ? encodeCursor({
            lastSeen: groups[groups.length - 1].last_seen.toISOString(),
            id: groups[groups.length - 1].id,
          })
        : null;

    res.status(200).json({ groups, limit, nextCursor });
  } catch (err) {
    logger.error('List project errors failed', err);
    res.status(500).json({ error: 'InternalError', message: 'Could not list errors' });
  }
});

// GET /api/projects/:id
router.get('/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const project = await ProjectModel.findById(req.params.id);

    if (!project || project.owner_id !== req.user!.id) {
      // 404 either way - don't reveal that a project exists but belongs to someone else
      res.status(404).json({ error: 'NotFound', message: 'Project not found' });
      return;
    }

    res.status(200).json({ project });
  } catch (err) {
    logger.error('Get project failed', err);
    res.status(500).json({ error: 'InternalError', message: 'Could not fetch project' });
  }
});

// POST /api/projects/:id/regenerate-key - invalidates the old key immediately
router.post('/:id/regenerate-key', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const project = await ProjectModel.findById(req.params.id);

    if (!project || project.owner_id !== req.user!.id) {
      res.status(404).json({ error: 'NotFound', message: 'Project not found' });
      return;
    }

    const updated = await ProjectModel.regenerateApiKey(project.id);
    if (!updated) {
      res.status(500).json({ error: 'InternalError', message: 'Could not regenerate API key' });
      return;
    }

    res.status(200).json({ project: updated });
  } catch (err) {
    logger.error('Regenerate API key failed', err);
    res.status(500).json({ error: 'InternalError', message: 'Could not regenerate API key' });
  }
});

// DELETE /api/projects/:id
router.delete('/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const project = await ProjectModel.findById(req.params.id);

    if (!project || project.owner_id !== req.user!.id) {
      res.status(404).json({ error: 'NotFound', message: 'Project not found' });
      return;
    }

    await ProjectModel.delete(project.id);
    res.status(204).send();
  } catch (err) {
    logger.error('Delete project failed', err);
    res.status(500).json({ error: 'InternalError', message: 'Could not delete project' });
  }
});

export default router;
