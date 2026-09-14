CREATE TABLE IF NOT EXISTS "absence_controls" (
  "id" serial PRIMARY KEY NOT NULL,
  "school_id" integer NOT NULL REFERENCES "schools"("id") ON DELETE CASCADE,
  "class_id" integer NOT NULL REFERENCES "classes"("id") ON DELETE CASCADE,
  "teacher_id" integer NOT NULL REFERENCES "teachers"("id") ON DELETE CASCADE,
  "date" text NOT NULL,
  "period" text,
  "subject_id" integer REFERENCES "subjects"("id") ON DELETE SET NULL,
  "start_time" text,
  "end_time" text,
  "control_type" text DEFAULT 'none' NOT NULL,
  "created_at" timestamp DEFAULT now()
);
