ALTER TABLE "grades"
ADD COLUMN IF NOT EXISTS "updated_at" timestamp DEFAULT now();
