CREATE TABLE IF NOT EXISTS "teacher_subjects" (
  "id" serial PRIMARY KEY NOT NULL,
  "teacher_id" integer NOT NULL REFERENCES "teachers"("id") ON DELETE CASCADE,
  "subject_id" integer NOT NULL REFERENCES "subjects"("id") ON DELETE CASCADE,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "teacher_subjects_teacher_id_subject_id_idx"
  ON "teacher_subjects" ("teacher_id", "subject_id");