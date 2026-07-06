-- Migration: add must_reset column to local_auths
BEGIN;

-- Add column if it does not exist
ALTER TABLE public.local_auths
  ADD COLUMN IF NOT EXISTS must_reset boolean DEFAULT true;

-- Ensure existing rows have the flag set
UPDATE public.local_auths
  SET must_reset = true
  WHERE must_reset IS NULL;

-- Enforce NOT NULL and default
ALTER TABLE public.local_auths
  ALTER COLUMN must_reset SET DEFAULT true;
ALTER TABLE public.local_auths
  ALTER COLUMN must_reset SET NOT NULL;

COMMIT;
