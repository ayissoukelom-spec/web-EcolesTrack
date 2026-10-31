-- Allow accepted unrecorded regularization requests to link their created session.
-- Apply manually only after reviewing the target database and current constraint.
BEGIN;

ALTER TABLE public.teacher_control_regularization_requests
  DROP CONSTRAINT teacher_control_regularization_request_source_check,
  ADD CONSTRAINT teacher_control_regularization_request_source_check CHECK (
    (request_type = 'incomplete_session'
      AND session_id IS NOT NULL
      AND proposed_ended_at IS NOT NULL)
    OR (request_type = 'immediate_report'
      AND reference_started_at IS NOT NULL
      AND (
        (status IN ('pending', 'rejected') AND session_id IS NULL)
        OR (status IN ('accepted', 'modified_accepted')
          AND session_id IS NOT NULL
          AND proposed_ended_at IS NOT NULL)
      ))
    OR (request_type = 'late_declaration'
      AND declared_started_at IS NOT NULL
      AND proposed_ended_at IS NOT NULL
      AND (
        (status IN ('pending', 'rejected') AND session_id IS NULL)
        OR (status IN ('accepted', 'modified_accepted') AND session_id IS NOT NULL)
      ))
  );

COMMIT;
