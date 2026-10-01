CREATE TABLE IF NOT EXISTS "school_period_type_approvals" (
  "id" serial PRIMARY KEY NOT NULL,
  "school_id" integer NOT NULL REFERENCES "schools"("id") ON DELETE CASCADE,
  "period_type" text NOT NULL CHECK ("period_type" IN ('trimester', 'semester')),
  "status" text NOT NULL DEFAULT 'pending' CHECK ("status" IN ('pending', 'approved', 'rejected')),
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "school_period_type_approvals_school_type_unique" UNIQUE ("school_id", "period_type")
);