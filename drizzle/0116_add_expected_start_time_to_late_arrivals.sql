ALTER TABLE "late_arrivals" ADD COLUMN IF NOT EXISTS "expected_start_time" text;
UPDATE "late_arrivals" SET "expected_start_time" = "arrival_time" WHERE "expected_start_time" IS NULL;
ALTER TABLE "late_arrivals" ALTER COLUMN "expected_start_time" SET NOT NULL;