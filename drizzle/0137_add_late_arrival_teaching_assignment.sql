ALTER TABLE "late_arrivals"
  ADD COLUMN IF NOT EXISTS "teaching_assignment_id" integer
  REFERENCES "teacher_class_subjects"("id") ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS "late_arrivals_teaching_assignment_id_idx"
  ON "late_arrivals" ("teaching_assignment_id");