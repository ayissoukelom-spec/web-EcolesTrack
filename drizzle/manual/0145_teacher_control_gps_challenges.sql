-- Single-use, short-lived server challenges for teacher-control GPS operations.
-- Apply only after the approved 0144 foundation migration.
-- This file is intentionally not executed by application startup.
BEGIN;

CREATE TABLE public.teacher_control_gps_challenges (
  id SERIAL PRIMARY KEY,
  challenge_hash TEXT NOT NULL UNIQUE,
  actor_user_id INTEGER NOT NULL,
  school_id INTEGER NOT NULL,
  action TEXT NOT NULL,
  resource_id INTEGER,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT teacher_control_gps_challenges_action_check
    CHECK (action IN ('start_session', 'end_session'))
);

CREATE INDEX teacher_control_gps_challenges_scope_expiry_idx
  ON public.teacher_control_gps_challenges (actor_user_id, school_id, action, expires_at);

COMMIT;
