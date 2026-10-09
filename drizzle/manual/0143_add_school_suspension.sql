-- Apply this SQL manually after review and before deploying code that reads
-- schools.is_suspended. Do not run npm run db:migrate for this change.
-- This migration is intentionally not in the Drizzle journal or app startup.
BEGIN;

ALTER TABLE public.schools
  ADD COLUMN IF NOT EXISTS is_suspended BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.schools.is_suspended IS
  'Reversible platform-level suspension; school data and memberships remain unchanged.';

COMMIT;

-- Verify after applying:
-- SELECT id, name, is_suspended FROM public.schools ORDER BY id;
