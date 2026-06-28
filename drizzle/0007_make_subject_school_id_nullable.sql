-- Make subject school association optional for global subjects
ALTER TABLE "subjects"
  ALTER COLUMN "school_id" DROP NOT NULL;

-- Ensure school_subjects table exists with stable structure for per-school approval
CREATE TABLE IF NOT EXISTS "school_subjects" (
  "id" SERIAL PRIMARY KEY,
  "school_id" INTEGER REFERENCES "schools"("id") NOT NULL,
  "subject_id" INTEGER REFERENCES "subjects"("id") ON DELETE CASCADE NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "created_at" TIMESTAMP DEFAULT NOW(),
  "updated_at" TIMESTAMP DEFAULT NOW()
);

ALTER TABLE "school_subjects"
  ALTER COLUMN "school_id" SET NOT NULL;

ALTER TABLE "school_subjects"
  ALTER COLUMN "subject_id" SET NOT NULL;

ALTER TABLE "school_subjects"
  ALTER COLUMN "status" SET DEFAULT 'pending';
