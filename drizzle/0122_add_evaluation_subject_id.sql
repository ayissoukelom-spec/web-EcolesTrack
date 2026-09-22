ALTER TABLE "evaluations"
  ADD COLUMN IF NOT EXISTS "subject_id" integer REFERENCES "subjects"("id") ON DELETE SET NULL;
