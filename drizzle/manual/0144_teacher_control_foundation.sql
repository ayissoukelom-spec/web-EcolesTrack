-- Teacher control module foundations.
-- Review and apply only through the approved deployment migration process.
-- This file is intentionally not executed by application startup.
BEGIN;

CREATE TABLE public.teacher_control_gps_settings (
  id SERIAL PRIMARY KEY,
  school_id INTEGER NOT NULL UNIQUE,
  school_name_snapshot TEXT NOT NULL,
  is_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  latitude NUMERIC(9, 6),
  longitude NUMERIC(10, 6),
  geofence_radius_meters INTEGER NOT NULL DEFAULT 200,
  updated_by_user_id INTEGER,
  updated_by_name_snapshot TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT teacher_control_gps_radius_check CHECK (geofence_radius_meters > 0),
  CONSTRAINT teacher_control_gps_latitude_check CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),
  CONSTRAINT teacher_control_gps_longitude_check CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180),
  CONSTRAINT teacher_control_gps_enabled_coordinates_check
    CHECK (is_enabled = FALSE OR (latitude IS NOT NULL AND longitude IS NOT NULL))
);

CREATE TABLE public.teacher_control_hourly_rates (
  id SERIAL PRIMARY KEY,
  school_id INTEGER NOT NULL,
  school_name_snapshot TEXT NOT NULL,
  teacher_id INTEGER NOT NULL,
  teacher_name_snapshot TEXT NOT NULL,
  hourly_rate_xof INTEGER NOT NULL,
  updated_by_user_id INTEGER,
  updated_by_name_snapshot TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT teacher_control_hourly_rates_amount_check CHECK (hourly_rate_xof >= 0)
);

CREATE UNIQUE INDEX teacher_control_hourly_rates_school_teacher_uidx
  ON public.teacher_control_hourly_rates (school_id, teacher_id);

CREATE TABLE public.teacher_control_sessions (
  id SERIAL PRIMARY KEY,
  school_id INTEGER NOT NULL,
  school_name_snapshot TEXT NOT NULL,
  teacher_id INTEGER NOT NULL,
  teacher_user_id INTEGER NOT NULL,
  teacher_name_snapshot TEXT NOT NULL,
  teaching_assignment_id INTEGER NOT NULL,
  class_id INTEGER NOT NULL,
  class_name_snapshot TEXT NOT NULL,
  subject_id INTEGER NOT NULL,
  subject_name_snapshot TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  started_at TIMESTAMPTZ NOT NULL,
  start_distance_meters INTEGER NOT NULL,
  start_accuracy_meters INTEGER NOT NULL,
  start_geofence_radius_meters INTEGER NOT NULL,
  validated_ended_at TIMESTAMPTZ,
  end_source TEXT,
  end_distance_meters INTEGER,
  end_accuracy_meters INTEGER,
  end_geofence_radius_meters INTEGER,
  closed_at TIMESTAMPTZ,
  closed_by_user_id INTEGER,
  closed_by_name_snapshot TEXT,
  close_reason TEXT,
  hourly_rate_xof_snapshot INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT teacher_control_sessions_status_check
    CHECK (status IN ('open', 'completed', 'closed_without_end')),
  CONSTRAINT teacher_control_sessions_state_times_check CHECK (
    (status = 'open' AND validated_ended_at IS NULL AND closed_at IS NULL)
    OR (status = 'completed' AND validated_ended_at IS NOT NULL AND closed_at IS NULL)
    OR (status = 'closed_without_end' AND validated_ended_at IS NULL AND closed_at IS NOT NULL)
  ),
  CONSTRAINT teacher_control_sessions_end_source_check CHECK (
    (validated_ended_at IS NULL AND end_source IS NULL)
    OR (validated_ended_at IS NOT NULL AND end_source IN ('gps', 'regularization'))
  ),
  CONSTRAINT teacher_control_sessions_end_after_start_check
    CHECK (validated_ended_at IS NULL OR validated_ended_at >= started_at),
  CONSTRAINT teacher_control_sessions_gps_values_check CHECK (
    start_distance_meters >= 0 AND start_accuracy_meters BETWEEN 0 AND 100
    AND start_geofence_radius_meters > 0
    AND (end_distance_meters IS NULL OR end_distance_meters >= 0)
    AND (end_accuracy_meters IS NULL OR end_accuracy_meters BETWEEN 0 AND 100)
    AND (end_geofence_radius_meters IS NULL OR end_geofence_radius_meters > 0)
  ),
  CONSTRAINT teacher_control_sessions_end_gps_values_check CHECK (
    (end_source = 'gps' AND end_distance_meters IS NOT NULL AND end_accuracy_meters IS NOT NULL AND end_geofence_radius_meters IS NOT NULL)
    OR (end_source = 'regularization' AND end_distance_meters IS NULL AND end_accuracy_meters IS NULL AND end_geofence_radius_meters IS NULL)
    OR (end_source IS NULL AND end_distance_meters IS NULL AND end_accuracy_meters IS NULL AND end_geofence_radius_meters IS NULL)
  ),
  CONSTRAINT teacher_control_sessions_rate_snapshot_check
    CHECK (hourly_rate_xof_snapshot IS NULL OR hourly_rate_xof_snapshot >= 0)
);

CREATE UNIQUE INDEX teacher_control_sessions_one_open_per_teacher_school_uidx
  ON public.teacher_control_sessions (school_id, teacher_id)
  WHERE status = 'open';
CREATE INDEX teacher_control_sessions_school_teacher_started_idx
  ON public.teacher_control_sessions (school_id, teacher_id, started_at);
CREATE INDEX teacher_control_sessions_school_started_idx
  ON public.teacher_control_sessions (school_id, started_at);

CREATE TABLE public.teacher_control_regularization_requests (
  id SERIAL PRIMARY KEY,
  session_id INTEGER NOT NULL REFERENCES public.teacher_control_sessions(id) ON DELETE RESTRICT,
  school_id INTEGER NOT NULL,
  school_name_snapshot TEXT NOT NULL,
  teacher_id INTEGER NOT NULL,
  teacher_name_snapshot TEXT NOT NULL,
  proposed_ended_at TIMESTAMPTZ NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  submitted_by_user_id INTEGER NOT NULL,
  submitted_by_name_snapshot TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT teacher_control_regularization_status_check
    CHECK (status IN ('pending', 'accepted', 'rejected', 'modified_accepted')),
  CONSTRAINT teacher_control_regularization_reason_check CHECK (BTRIM(reason) <> '')
);

CREATE UNIQUE INDEX teacher_control_regularization_one_pending_per_session_uidx
  ON public.teacher_control_regularization_requests (session_id)
  WHERE status = 'pending';
CREATE INDEX teacher_control_regularization_session_history_idx
  ON public.teacher_control_regularization_requests (session_id, created_at);

CREATE TABLE public.teacher_control_regularization_decisions (
  id SERIAL PRIMARY KEY,
  request_id INTEGER NOT NULL REFERENCES public.teacher_control_regularization_requests(id) ON DELETE RESTRICT,
  session_id INTEGER NOT NULL,
  school_id INTEGER NOT NULL,
  school_name_snapshot TEXT NOT NULL,
  decision TEXT NOT NULL,
  previous_proposed_ended_at TIMESTAMPTZ NOT NULL,
  decided_ended_at TIMESTAMPTZ,
  reason TEXT,
  actor_user_id INTEGER,
  actor_role TEXT NOT NULL,
  actor_name_snapshot TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT teacher_control_regularization_decision_check
    CHECK (decision IN ('accepted', 'rejected', 'modified_accepted')),
  CONSTRAINT teacher_control_regularization_decision_reason_check CHECK (
    decision NOT IN ('rejected', 'modified_accepted')
    OR (reason IS NOT NULL AND BTRIM(reason) <> '')
  ),
  CONSTRAINT teacher_control_regularization_decision_end_time_check CHECK (
    (decision = 'rejected' AND decided_ended_at IS NULL)
    OR (decision IN ('accepted', 'modified_accepted') AND decided_ended_at IS NOT NULL)
  )
);

CREATE INDEX teacher_control_regularization_decisions_request_history_idx
  ON public.teacher_control_regularization_decisions (request_id, created_at);

CREATE TABLE public.teacher_control_audit_events (
  id SERIAL PRIMARY KEY,
  school_id INTEGER NOT NULL,
  school_name_snapshot TEXT NOT NULL,
  actor_user_id INTEGER,
  actor_role TEXT NOT NULL,
  actor_email_snapshot TEXT,
  actor_name_snapshot TEXT NOT NULL,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id INTEGER,
  before_values JSONB,
  after_values JSONB,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX teacher_control_audit_school_history_idx
  ON public.teacher_control_audit_events (school_id, created_at);
CREATE INDEX teacher_control_audit_resource_history_idx
  ON public.teacher_control_audit_events (resource_type, resource_id, created_at);

CREATE FUNCTION public.prevent_teacher_control_history_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Teacher control history is append-only';
END;
$$;

CREATE TRIGGER teacher_control_audit_events_append_only
  BEFORE UPDATE OR DELETE ON public.teacher_control_audit_events
  FOR EACH ROW EXECUTE FUNCTION public.prevent_teacher_control_history_mutation();
CREATE TRIGGER teacher_control_regularization_decisions_append_only
  BEFORE UPDATE OR DELETE ON public.teacher_control_regularization_decisions
  FOR EACH ROW EXECUTE FUNCTION public.prevent_teacher_control_history_mutation();
CREATE TRIGGER teacher_control_sessions_no_delete
  BEFORE DELETE ON public.teacher_control_sessions
  FOR EACH ROW EXECUTE FUNCTION public.prevent_teacher_control_history_mutation();
CREATE TRIGGER teacher_control_regularization_requests_no_delete
  BEFORE DELETE ON public.teacher_control_regularization_requests
  FOR EACH ROW EXECUTE FUNCTION public.prevent_teacher_control_history_mutation();

COMMIT;
