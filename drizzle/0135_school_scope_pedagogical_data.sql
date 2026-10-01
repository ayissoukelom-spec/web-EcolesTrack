BEGIN;

ALTER TABLE "class_teachers"
  ADD COLUMN "school_id" integer REFERENCES "schools"("id") ON DELETE CASCADE;

UPDATE "class_teachers" AS assignment
SET "school_id" = teacher."school_id"
FROM "teachers" AS teacher
WHERE assignment."teacher_id" = teacher."id"
  AND assignment."school_id" IS NULL;

DROP INDEX IF EXISTS "class_teachers_class_id_teacher_id_idx";
CREATE UNIQUE INDEX IF NOT EXISTS "class_teachers_school_class_teacher_idx"
  ON "class_teachers" ("school_id", "class_id", "teacher_id");

ALTER TABLE "teacher_subjects"
  ADD COLUMN "school_id" integer REFERENCES "schools"("id") ON DELETE CASCADE;

UPDATE "teacher_subjects" AS assignment
SET "school_id" = teacher."school_id"
FROM "teachers" AS teacher
WHERE assignment."teacher_id" = teacher."id"
  AND assignment."school_id" IS NULL;

DROP INDEX IF EXISTS "teacher_subjects_teacher_id_subject_id_idx";
CREATE UNIQUE INDEX IF NOT EXISTS "teacher_subjects_teacher_school_subject_idx"
  ON "teacher_subjects" ("teacher_id", "school_id", "subject_id");

ALTER TABLE "evaluations"
  ADD COLUMN "school_id" integer REFERENCES "schools"("id") ON DELETE CASCADE;

UPDATE "evaluations" AS evaluation
SET "school_id" = teacher."school_id"
FROM "teachers" AS teacher
WHERE evaluation."teacher_id" = teacher."id"
  AND evaluation."school_id" IS NULL;

CREATE INDEX IF NOT EXISTS "evaluations_school_class_subject_idx"
  ON "evaluations" ("school_id", "class_id", "subject_id");

DROP INDEX IF EXISTS "evaluations_term_class_sequence_unique";
CREATE UNIQUE INDEX IF NOT EXISTS "evaluations_school_term_class_sequence_idx"
  ON "evaluations" ("school_id", "term_id", "class_id", "sequence_number")
  WHERE "sequence_number" IS NOT NULL;

ALTER TABLE "bulletins"
  ADD COLUMN "school_scope_version" integer NOT NULL DEFAULT 0;

COMMIT;
