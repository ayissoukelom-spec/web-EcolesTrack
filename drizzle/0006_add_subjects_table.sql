-- Create subjects table for managing school subjects/courses
CREATE TABLE IF NOT EXISTS "subjects" (
  "id" SERIAL PRIMARY KEY,
  "school_id" INTEGER NOT NULL REFERENCES "schools"("id"),
  "name" TEXT NOT NULL,
  "code" TEXT,
  "created_at" TIMESTAMP DEFAULT NOW(),
  "updated_at" TIMESTAMP DEFAULT NOW()
);

-- Create index on school_id for faster queries
CREATE INDEX IF NOT EXISTS "idx_subjects_school_id" ON "subjects"("school_id");
CREATE INDEX IF NOT EXISTS "idx_subjects_name" ON "subjects"("name");
