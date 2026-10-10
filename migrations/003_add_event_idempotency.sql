-- Idempotency key for error_events. The ingestion API generates a UUID
-- per accepted request (see src/services/ingestion.ts) and threads it
-- through the BullMQ job; the worker uses it here as a conflict target
-- so a redelivered job (BullMQ's at-least-once delivery) can never
-- insert the same event twice or double-count it on a group.
--
-- Inline UNIQUE + IF NOT EXISTS: on a re-run where the column already
-- exists, the whole clause is skipped (Postgres emits a NOTICE, not an
-- error) - so this migration file stays safe to re-run, unlike a bare
-- `ADD CONSTRAINT ... UNIQUE`, which Postgres has no IF NOT EXISTS form
-- for and would fail on a second run.
ALTER TABLE error_events
  ADD COLUMN IF NOT EXISTS event_id UUID UNIQUE NOT NULL DEFAULT gen_random_uuid();
