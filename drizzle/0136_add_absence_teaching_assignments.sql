CREATE TABLE IF NOT EXISTS "teacher_class_subjects" (
  "id" serial PRIMARY KEY NOT NULL,
  "teacher_id" integer NOT NULL REFERENCES "teachers"("id") ON DELETE CASCADE,
  "school_id" integer NOT NULL REFERENCES "schools"("id") ON DELETE CASCADE,
  "class_id" integer NOT NULL REFERENCES "classes"("id") ON DELETE CASCADE,
  "subject_id" integer NOT NULL REFERENCES "subjects"("id") ON DELETE CASCADE,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "teacher_class_subjects_teacher_school_class_subject_unique"
    UNIQUE ("teacher_id", "school_id", "class_id", "subject_id")
);

CREATE INDEX IF NOT EXISTS "teacher_class_subjects_school_teacher_active_idx"
  ON "teacher_class_subjects" ("school_id", "teacher_id", "is_active");

ALTER TABLE "absences"
  ADD COLUMN IF NOT EXISTS "teaching_assignment_id" integer
  REFERENCES "teacher_class_subjects"("id") ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS "absences_teaching_assignment_id_idx"
  ON "absences" ("teaching_assignment_id");