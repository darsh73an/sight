-- Denormalize level onto error_groups. Filtering the group list by level
-- (as the dashboard needs) would otherwise require joining error_events
-- for every group on every request - expensive at scale. Level is stable
-- per error type in practice, so it's set once at group creation.

ALTER TABLE error_groups
  ADD COLUMN IF NOT EXISTS level VARCHAR(20) NOT NULL DEFAULT 'error';

CREATE INDEX IF NOT EXISTS idx_error_groups_level ON error_groups(project_id, level);
