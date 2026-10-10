import { Router, Response } from 'express';
import { ErrorGroupModel, ErrorGroup } from '../models/ErrorGroup';
import { ErrorEventModel } from '../models/ErrorEvent';
import { ProjectModel } from '../models/Project';
import { requireAuth, AuthenticatedRequest } from '../middleware/auth';
import { logger } from '../utils/logger';

const router = Router();

router.use(requireAuth);

/**
 * A group id alone doesn't say whose it is - this is the check that
 * prevents cross-project/cross-user leaks: load the group, then confirm
 * its parent project belongs to the caller. Returns null for "not found"
 * and "found but not yours" alike, so the two are indistinguishable to
 * the caller.
 */
async function loadOwnedGroup(
  groupId: string,
  userId: string
): Promise<ErrorGroup | null> {
  const group = await ErrorGroupModel.findById(groupId);
  if (!group) return null;

  const owns = await ProjectModel.belongsToOwner(group.project_id, userId);
  if (!owns) return null;

  return group;
}

// GET /api/errors/:groupId - group + its last 20 events
router.get('/:groupId', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const group = await loadOwnedGroup(req.params.groupId, req.user!.id);
    if (!group) {
      res.status(404).json({ error: 'NotFound', message: 'Error group not found' });
      return;
    }

    const events = await ErrorEventModel.listByGroup(group.id, 20);
    res.status(200).json({ group, events });
  } catch (err) {
    logger.error('Get error group failed', err);
    res.status(500).json({ error: 'InternalError', message: 'Could not fetch error group' });
  }
});

// POST /api/errors/:groupId/resolve
router.post('/:groupId/resolve', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const group = await loadOwnedGroup(req.params.groupId, req.user!.id);
    if (!group) {
      res.status(404).json({ error: 'NotFound', message: 'Error group not found' });
      return;
    }

    const updated = await ErrorGroupModel.updateStatus(group.id, 'resolved');
    res.status(200).json({ group: updated });
  } catch (err) {
    logger.error('Resolve error group failed', err);
    res.status(500).json({ error: 'InternalError', message: 'Could not resolve error group' });
  }
});

export default router;
