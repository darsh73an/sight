-- The cursor pagination query in ErrorGroupModel.listByProject orders by
-- (last_seen DESC, id DESC) and filters on the same pair. The original
-- idx_error_groups_last_seen index only covered (project_id, last_seen),
-- so Postgres could use it to narrow down by project_id+last_seen but
-- would still need extra work to resolve the id tiebreaker. This index
-- covers the exact (project_id, last_seen DESC, id DESC) shape the query
-- actually needs.

CREATE INDEX IF NOT EXISTS idx_error_groups_cursor
  ON error_groups (project_id, last_seen DESC, id DESC);

-- Superseded by the index above - every query the old one served, the
-- new one serves too (it's a strict prefix match), so there's no reason
-- to keep both.
DROP INDEX IF EXISTS idx_error_groups_last_seen;
