-- Idempotent migration: copy legacy principal teacher assignments
-- from `classes.teacher_id` into the many-to-many `class_teachers` table.
-- Safe to run multiple times.
BEGIN;

INSERT INTO class_teachers (class_id, teacher_id)
SELECT c.id, c.teacher_id
FROM classes c
WHERE c.teacher_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM class_teachers ct
    WHERE ct.class_id = c.id AND ct.teacher_id = c.teacher_id
  );

COMMIT;
