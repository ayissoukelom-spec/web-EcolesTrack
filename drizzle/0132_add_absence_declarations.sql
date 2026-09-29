CREATE TABLE IF NOT EXISTS "absence_declarations" (
  "id" serial PRIMARY KEY NOT NULL,
  "student_id" integer NOT NULL REFERENCES "students"("id") ON DELETE CASCADE,
  "parent_id" integer NOT NULL REFERENCES "parents"("id") ON DELETE CASCADE,
  "date" text NOT NULL,
  "start_time" text NOT NULL,
  "end_time" text NOT NULL,
  "reason" text,
  "status" text NOT NULL DEFAULT 'RECEIVED',
  "rejection_reason" text,
  "reviewed_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "reviewed_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "absence_declarations_parent_date_idx"
  ON "absence_declarations" ("parent_id", "date");
CREATE INDEX IF NOT EXISTS "absence_declarations_student_date_status_idx"
  ON "absence_declarations" ("student_id", "date", "status");

ALTER TABLE "absences"
  ADD COLUMN IF NOT EXISTS "declaration_id" integer REFERENCES "absence_declarations"("id") ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS "absences_declaration_id_idx"
  ON "absences" ("declaration_id");