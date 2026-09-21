ALTER TABLE "absences" ADD COLUMN IF NOT EXISTS "justification_status" text;
ALTER TABLE "absences" ADD COLUMN IF NOT EXISTS "rejection_reason" text;
ALTER TABLE "absences" ADD COLUMN IF NOT EXISTS "reviewed_by" integer REFERENCES "users"("id") ON DELETE SET NULL;
ALTER TABLE "absences" ADD COLUMN IF NOT EXISTS "reviewed_at" timestamp;
UPDATE "absences"
SET "justification_status" = 'APPROVED'
WHERE "is_justified" = true AND "justification_status" IS NULL;