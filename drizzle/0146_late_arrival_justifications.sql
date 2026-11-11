CREATE TABLE "late_arrival_justifications" (
  "id" serial PRIMARY KEY NOT NULL,
  "late_arrival_id" integer NOT NULL,
  "submitted_by" integer,
  "justification_reason" text NOT NULL,
  "status" text DEFAULT 'PENDING' NOT NULL,
  "rejection_reason" text,
  "reviewed_by" integer,
  "reviewed_at" timestamp,
  "revision" integer DEFAULT 1 NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "late_arrival_justifications_status_check"
    CHECK ("status" IN ('PENDING', 'APPROVED', 'REJECTED')),
  CONSTRAINT "late_arrival_justifications_revision_check"
    CHECK ("revision" > 0),
  CONSTRAINT "late_arrival_justifications_late_arrival_id_late_arrivals_id_fk"
    FOREIGN KEY ("late_arrival_id") REFERENCES "late_arrivals"("id") ON DELETE RESTRICT,
  CONSTRAINT "late_arrival_justifications_submitted_by_users_id_fk"
    FOREIGN KEY ("submitted_by") REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "late_arrival_justifications_reviewed_by_users_id_fk"
    FOREIGN KEY ("reviewed_by") REFERENCES "users"("id") ON DELETE SET NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "late_arrival_justifications_late_arrival_id_unique"
  ON "late_arrival_justifications" ("late_arrival_id");
--> statement-breakpoint
CREATE INDEX "late_arrival_justifications_status_created_idx"
  ON "late_arrival_justifications" ("status", "created_at");
--> statement-breakpoint
CREATE TABLE "late_arrival_justification_events" (
  "id" serial PRIMARY KEY NOT NULL,
  "justification_id" integer NOT NULL,
  "revision" integer NOT NULL,
  "action" text NOT NULL,
  "from_status" text,
  "to_status" text NOT NULL,
  "reason" text,
  "actor_user_id" integer,
  "actor_role" text NOT NULL,
  "actor_email" text,
  "actor_name" text,
  "occurred_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "late_arrival_justification_events_revision_unique"
    UNIQUE ("justification_id", "revision"),
  CONSTRAINT "late_arrival_justification_events_action_check"
    CHECK ("action" IN ('SUBMITTED', 'APPROVED', 'REJECTED', 'REEXAMINED_APPROVED')),
  CONSTRAINT "late_arrival_justification_events_from_status_check"
    CHECK ("from_status" IS NULL OR "from_status" IN ('PENDING', 'APPROVED', 'REJECTED')),
  CONSTRAINT "late_arrival_justification_events_to_status_check"
    CHECK ("to_status" IN ('PENDING', 'APPROVED', 'REJECTED')),
  CONSTRAINT "late_arrival_justification_events_revision_check"
    CHECK ("revision" > 0),
  CONSTRAINT "late_arrival_justification_events_justification_id_fk"
    FOREIGN KEY ("justification_id") REFERENCES "late_arrival_justifications"("id") ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE TABLE "late_arrival_justification_files" (
  "id" serial PRIMARY KEY NOT NULL,
  "justification_id" integer NOT NULL,
  "file_name" text NOT NULL,
  "file_path" text NOT NULL,
  "mime_type" text NOT NULL,
  "file_size" integer NOT NULL,
  "uploaded_by" integer,
  "uploaded_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "late_arrival_justification_files_justification_id_fk"
    FOREIGN KEY ("justification_id") REFERENCES "late_arrival_justifications"("id") ON DELETE CASCADE,
  CONSTRAINT "late_arrival_justification_files_uploaded_by_users_id_fk"
    FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE SET NULL
);
--> statement-breakpoint
CREATE INDEX "late_arrival_justification_files_justification_idx"
  ON "late_arrival_justification_files" ("justification_id");
--> statement-breakpoint
CREATE FUNCTION prevent_late_arrival_justification_event_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Late-arrival justification events are append-only';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER late_arrival_justification_events_append_only
BEFORE UPDATE OR DELETE ON "late_arrival_justification_events"
FOR EACH ROW EXECUTE FUNCTION prevent_late_arrival_justification_event_mutation();
--> statement-breakpoint
CREATE TRIGGER late_arrival_justification_events_no_truncate
BEFORE TRUNCATE ON "late_arrival_justification_events"
FOR EACH STATEMENT EXECUTE FUNCTION prevent_late_arrival_justification_event_mutation();
