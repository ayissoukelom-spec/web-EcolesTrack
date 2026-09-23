CREATE TABLE IF NOT EXISTS "bulletin_generations" (
  "id" serial PRIMARY KEY NOT NULL,
  "class_id" integer NOT NULL REFERENCES "classes"("id") ON DELETE CASCADE,
  "school_year_id" integer NOT NULL REFERENCES "academic_years"("id") ON DELETE CASCADE,
  "term_id" integer NOT NULL REFERENCES "school_terms"("id") ON DELETE CASCADE,
  "generation_type" text NOT NULL,
  "expected_count" integer NOT NULL,
  "completed_count" integer DEFAULT 0 NOT NULL,
  "status" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "completed_at" timestamp
);

ALTER TABLE "bulletins" ADD COLUMN IF NOT EXISTS "generation_id" integer REFERENCES "bulletin_generations"("id") ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS "bulletin_generations_lookup_idx" ON "bulletin_generations" ("class_id", "school_year_id", "term_id", "generation_type", "status");
CREATE INDEX IF NOT EXISTS "bulletins_generation_id_idx" ON "bulletins" ("generation_id");