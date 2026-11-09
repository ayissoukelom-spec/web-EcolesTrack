-- Web multifonction: generation-bound access sessions.
-- Manual migration; not part of application startup or the Drizzle journal.
BEGIN;

DO $access_sessions_preflight$
DECLARE
  users_oid oid;
  users_id_type oid;
  users_id_not_null boolean;
BEGIN
  users_oid := to_regclass('public.users');

  IF users_oid IS NULL THEN
    RAISE EXCEPTION
      'Cannot create Web access sessions: public.users does not exist.';
  END IF;

  SELECT attribute_row.atttypid, attribute_row.attnotnull
  INTO users_id_type, users_id_not_null
  FROM pg_attribute AS attribute_row
  WHERE attribute_row.attrelid = users_oid
    AND attribute_row.attname = 'id'
    AND NOT attribute_row.attisdropped;

  IF users_id_type IS DISTINCT FROM 'integer'::regtype
    OR users_id_not_null IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION
      'Cannot create Web access sessions: public.users.id is not a NOT NULL integer.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_attribute AS attribute_row
    WHERE attribute_row.attrelid = users_oid
      AND attribute_row.attname IN (
        'access_session_generation',
        'deactivation_generation_aware'
      )
      AND NOT attribute_row.attisdropped
  ) THEN
    RAISE EXCEPTION
      'Cannot create Web access sessions: one or more generation columns already exist; inspect their definitions before proceeding.';
  END IF;

  IF to_regclass('public.access_sessions') IS NOT NULL THEN
    RAISE EXCEPTION
      'Cannot create Web access sessions: public.access_sessions already exists; inspect its definition before proceeding.';
  END IF;
END
$access_sessions_preflight$;

ALTER TABLE public.users
  ADD COLUMN access_session_generation BIGINT NOT NULL DEFAULT 1;

ALTER TABLE public.users
  ADD CONSTRAINT users_access_session_generation_nonnegative_check
  CHECK (access_session_generation >= 0);

-- Intentionally nullable and without a SQL default:
-- existing accounts remain NULL; Drizzle supplies FALSE for new inserts.
ALTER TABLE public.users
  ADD COLUMN deactivation_generation_aware BOOLEAN;

CREATE TABLE public.access_sessions (
  id TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  observed_generation BIGINT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  context_version INTEGER NOT NULL DEFAULT 0,
  context JSONB,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now(),
  revoked_at TIMESTAMP,
  CONSTRAINT access_sessions_pkey PRIMARY KEY (id),
  CONSTRAINT access_sessions_user_id_users_id_fk
    FOREIGN KEY (user_id)
    REFERENCES public.users (id)
    ON DELETE CASCADE
    ON UPDATE NO ACTION,
  CONSTRAINT access_sessions_status_check
    CHECK (status IN ('active', 'revoked', 'expired')),
  CONSTRAINT access_sessions_observed_generation_nonnegative_check
    CHECK (observed_generation >= 0)
);

CREATE INDEX access_sessions_user_status_idx
  ON public.access_sessions (user_id, status);

CREATE INDEX access_sessions_expires_at_idx
  ON public.access_sessions (expires_at);

COMMIT;
