-- Preserve canonical assignment ids for historical sessions while allowing new
-- sessions to snapshot the existing class_teachers and teacher_subjects rows.
-- The API validates both rows, their teacher/school scope, and the approved
-- class/subject scope before writing the session; no association rows are created.
BEGIN;

ALTER TABLE public.teacher_control_sessions
  ALTER COLUMN teaching_assignment_id DROP NOT NULL,
  ADD COLUMN class_teacher_association_id INTEGER,
  ADD COLUMN teacher_subject_association_id INTEGER,
  ADD CONSTRAINT teacher_control_sessions_assignment_source_check CHECK (
    (
      teaching_assignment_id IS NOT NULL
      AND class_teacher_association_id IS NULL
      AND teacher_subject_association_id IS NULL
    )
    OR (
      teaching_assignment_id IS NULL
      AND class_teacher_association_id IS NOT NULL
      AND teacher_subject_association_id IS NOT NULL
    )
  );

COMMIT;
