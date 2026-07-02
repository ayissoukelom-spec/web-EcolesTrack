-- Migration: add is_archived to evaluations
-- Safe: use IF NOT EXISTS so re-running is idempotent
BEGIN;

ALTER TABLE evaluations
  ADD COLUMN IF NOT EXISTS is_archived BOOLEAN DEFAULT false;

-- Ensure NOT NULL for new column (existing rows with NULL will be rejected; we allow NULLs until backfill)
-- After running backfill, run:
-- ALTER TABLE evaluations ALTER COLUMN is_archived SET NOT NULL;

COMMIT;
