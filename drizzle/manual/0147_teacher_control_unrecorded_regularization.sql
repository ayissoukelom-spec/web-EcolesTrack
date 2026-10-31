-- Unify regularization requests for incomplete sessions, immediate incidents,
-- and late declarations. Review and apply only through the approved migration
-- process; application startup never executes this file.
BEGIN;

ALTER TABLE public.teacher_control_sessions
  ALTER COLUMN start_distance_meters DROP NOT NULL,
  ALTER COLUMN start_accuracy_meters DROP NOT NULL,
  ALTER COLUMN start_geofence_radius_meters DROP NOT NULL,
  ADD COLUMN start_source TEXT NOT NULL DEFAULT 'gps',
  ADD COLUMN regularization_origin TEXT,
  ADD COLUMN regularization_request_id INTEGER;

ALTER TABLE public.teacher_control_sessions
  DROP CONSTRAINT teacher_control_sessions_gps_values_check,
  ADD CONSTRAINT teacher_control_sessions_start_source_check CHECK (
    (start_source = 'gps'
      AND start_distance_meters IS NOT NULL
      AND start_accuracy_meters IS NOT NULL
      AND start_geofence_radius_meters IS NOT NULL)
    OR (start_source = 'regularization'
      AND start_distance_meters IS NULL
      AND start_accuracy_meters IS NULL
      AND start_geofence_radius_meters IS NULL)
  ),
  ADD CONSTRAINT teacher_control_sessions_regularization_origin_check CHECK (
    (start_source = 'gps'
      AND regularization_origin IS NULL
      AND regularization_request_id IS NULL)
    OR (start_source = 'regularization'
      AND regularization_origin IS NOT NULL
      AND regularization_origin IN ('immediate_report', 'late_declaration')
      AND regularization_request_id IS NOT NULL)
  ),
  ADD CONSTRAINT teacher_control_sessions_gps_values_check CHECK (
    (start_distance_meters IS NULL OR start_distance_meters >= 0)
    AND (start_accuracy_meters IS NULL OR start_accuracy_meters BETWEEN 0 AND 100)
    AND (start_geofence_radius_meters IS NULL OR start_geofence_radius_meters > 0)
    AND (end_distance_meters IS NULL OR end_distance_meters >= 0)
    AND (end_accuracy_meters IS NULL OR end_accuracy_meters BETWEEN 0 AND 100)
    AND (end_geofence_radius_meters IS NULL OR end_geofence_radius_meters > 0)
  );

ALTER TABLE public.teacher_control_regularization_requests
  ALTER COLUMN session_id DROP NOT NULL,
  ALTER COLUMN proposed_ended_at DROP NOT NULL,
  ADD COLUMN request_type TEXT NOT NULL DEFAULT 'incomplete_session',
  ADD COLUMN class_id INTEGER,
  ADD COLUMN class_name_snapshot TEXT,
  ADD COLUMN subject_id INTEGER,
  ADD COLUMN subject_name_snapshot TEXT,
  ADD COLUMN reference_started_at TIMESTAMPTZ,
  ADD COLUMN declared_started_at TIMESTAMPTZ,
  ADD COLUMN description TEXT,
  ADD COLUMN incident_type TEXT,
  ADD COLUMN technical_details JSONB,
  ADD COLUMN gps_latitude NUMERIC(9, 6),
  ADD COLUMN gps_longitude NUMERIC(10, 6),
  ADD COLUMN gps_accuracy_meters NUMERIC(10, 2);

ALTER TABLE public.teacher_control_regularization_requests
  ADD CONSTRAINT teacher_control_regularization_request_type_check CHECK (
    request_type IN ('incomplete_session', 'immediate_report', 'late_declaration')
  ),
  ADD CONSTRAINT teacher_control_regularization_request_source_check CHECK (
    (request_type = 'incomplete_session'
      AND session_id IS NOT NULL
      AND proposed_ended_at IS NOT NULL)
    OR (request_type = 'immediate_report'
      AND session_id IS NULL
      AND reference_started_at IS NOT NULL)
    OR (request_type = 'late_declaration'
      AND session_id IS NULL
      AND declared_started_at IS NOT NULL
      AND proposed_ended_at IS NOT NULL)
  ),
  ADD CONSTRAINT teacher_control_regularization_class_subject_check CHECK (
    (request_type = 'incomplete_session'
      AND class_id IS NULL AND class_name_snapshot IS NULL
      AND subject_id IS NULL AND subject_name_snapshot IS NULL)
    OR (request_type IN ('immediate_report', 'late_declaration')
      AND class_id IS NOT NULL AND class_name_snapshot IS NOT NULL
      AND subject_id IS NOT NULL AND subject_name_snapshot IS NOT NULL)
  ),
  ADD CONSTRAINT teacher_control_regularization_gps_check CHECK (
    (gps_latitude IS NULL AND gps_longitude IS NULL AND gps_accuracy_meters IS NULL)
    OR (gps_latitude IS NOT NULL
      AND gps_longitude IS NOT NULL
      AND gps_accuracy_meters IS NOT NULL
      AND gps_latitude BETWEEN -90 AND 90
      AND gps_longitude BETWEEN -180 AND 180
      AND gps_accuracy_meters >= 0)
  ),
  ADD CONSTRAINT teacher_control_regularization_incident_type_check CHECK (
    incident_type IS NULL
    OR incident_type IN ('gps_unavailable', 'gps_accuracy', 'permission_denied', 'network', 'application', 'other')
  ),
  ADD CONSTRAINT teacher_control_regularization_immediate_incident_check CHECK (
    request_type <> 'immediate_report' OR incident_type IS NOT NULL
  );

CREATE INDEX teacher_control_regularization_school_teacher_history_idx
  ON public.teacher_control_regularization_requests (school_id, teacher_id, created_at);

ALTER TABLE public.teacher_control_sessions
  ADD CONSTRAINT teacher_control_sessions_regularization_request_id_teacher_control_regularization_requests_id_fk
  FOREIGN KEY (regularization_request_id)
  REFERENCES public.teacher_control_regularization_requests(id)
  ON DELETE RESTRICT;

CREATE UNIQUE INDEX teacher_control_sessions_regularization_request_uidx
  ON public.teacher_control_sessions (regularization_request_id)
  WHERE regularization_request_id IS NOT NULL;

ALTER TABLE public.teacher_control_regularization_decisions
  ALTER COLUMN session_id DROP NOT NULL,
  ALTER COLUMN previous_proposed_ended_at DROP NOT NULL,
  ADD COLUMN previous_proposed_started_at TIMESTAMPTZ,
  ADD COLUMN decided_started_at TIMESTAMPTZ;

ALTER TABLE public.teacher_control_regularization_decisions
  DROP CONSTRAINT teacher_control_regularization_decision_end_time_check,
  ADD CONSTRAINT teacher_control_regularization_decision_end_time_check CHECK (
    (decision = 'rejected' AND decided_ended_at IS NULL AND decided_started_at IS NULL)
    OR (decision IN ('accepted', 'modified_accepted') AND decided_ended_at IS NOT NULL)
  );

COMMIT;
