CREATE TABLE "evaluation_publications" (
  "id" serial PRIMARY KEY NOT NULL,
  "school_id" integer NOT NULL,
  "academic_year_id" integer NOT NULL,
  "created_by_user_id" integer,
  "kind" text NOT NULL,
  "period_type" text NOT NULL DEFAULT 'trimester',
  "period_order_index" integer NOT NULL,
  "start_date" date NOT NULL,
  "end_date" date NOT NULL,
  "idempotency_key" text NOT NULL,
  "request_hash" text NOT NULL,
  "created_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "evaluation_publications_school_id_schools_id_fk"
    FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT,
  CONSTRAINT "evaluation_publications_academic_year_id_academic_years_id_fk"
    FOREIGN KEY ("academic_year_id") REFERENCES "academic_years"("id") ON DELETE RESTRICT,
  CONSTRAINT "evaluation_publications_created_by_user_id_users_id_fk"
    FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "evaluation_publications_date_range_check"
    CHECK ("start_date" <= "end_date"),
  CONSTRAINT "evaluation_publications_kind_check"
    CHECK ("kind" IN ('devoir', 'examen')),
  CONSTRAINT "evaluation_publications_period_check"
    CHECK ("period_type" = 'trimester' AND "period_order_index" > 0),
  CONSTRAINT "evaluation_publications_idempotency_key_check"
    CHECK ("idempotency_key" = btrim("idempotency_key") AND length("idempotency_key") BETWEEN 8 AND 128),
  CONSTRAINT "evaluation_publications_request_hash_check"
    CHECK ("request_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE UNIQUE INDEX "evaluation_publications_id_school_id_unique"
  ON "evaluation_publications" ("id", "school_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "evaluation_publications_school_idempotency_unique"
  ON "evaluation_publications" ("school_id", "idempotency_key");
--> statement-breakpoint
CREATE INDEX "evaluation_publications_school_start_date_idx"
  ON "evaluation_publications" ("school_id", "start_date");
--> statement-breakpoint
CREATE INDEX "evaluation_publications_created_by_user_id_idx"
  ON "evaluation_publications" ("created_by_user_id");
--> statement-breakpoint
ALTER TABLE "evaluations"
  ALTER COLUMN "teacher_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "evaluations"
  ADD COLUMN "publication_id" integer;
--> statement-breakpoint
ALTER TABLE "evaluations"
  ADD CONSTRAINT "evaluations_publication_school_fk"
  FOREIGN KEY ("publication_id", "school_id")
  REFERENCES "evaluation_publications" ("id", "school_id")
  ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "evaluations"
  ADD CONSTRAINT "evaluations_publication_teacher_check"
  CHECK (
    ("publication_id" IS NULL AND "teacher_id" IS NOT NULL)
    OR
    ("publication_id" IS NOT NULL AND "teacher_id" IS NULL AND "school_id" IS NOT NULL AND "term_id" IS NOT NULL)
  );
--> statement-breakpoint
CREATE INDEX "evaluations_publication_id_idx"
  ON "evaluations" ("publication_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "evaluations_publication_class_subject_unique"
  ON "evaluations" ("publication_id", "class_id", "subject_id")
  WHERE "publication_id" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "notifications"
  ADD COLUMN "publication_id" integer;
--> statement-breakpoint
ALTER TABLE "notifications"
  ADD CONSTRAINT "notifications_publication_id_evaluation_publications_id_fk"
  FOREIGN KEY ("publication_id")
  REFERENCES "evaluation_publications" ("id")
  ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "notifications"
  ADD CONSTRAINT "notifications_publication_evaluation_check"
  CHECK ("publication_id" IS NULL OR "evaluation_id" IS NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_publication_user_unique"
  ON "notifications" ("publication_id", "user_id")
  WHERE "publication_id" IS NOT NULL;
--> statement-breakpoint
CREATE TABLE "notification_delivery_outbox" (
  "id" serial PRIMARY KEY NOT NULL,
  "notification_id" integer NOT NULL,
  "channel" text NOT NULL,
  "status" text NOT NULL DEFAULT 'pending',
  "attempt_count" integer NOT NULL DEFAULT 0,
  "next_attempt_at" timestamp NOT NULL DEFAULT now(),
  "last_error" text,
  "sent_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "notification_delivery_outbox_notification_id_notifications_id_fk"
    FOREIGN KEY ("notification_id") REFERENCES "notifications"("id") ON DELETE CASCADE,
  CONSTRAINT "notification_delivery_outbox_channel_check"
    CHECK ("channel" = 'push'),
  CONSTRAINT "notification_delivery_outbox_status_check"
    CHECK ("status" IN ('pending', 'sending', 'sent', 'failed')),
  CONSTRAINT "notification_delivery_outbox_attempt_count_check"
    CHECK ("attempt_count" >= 0),
  CONSTRAINT "notification_delivery_outbox_notification_channel_unique"
    UNIQUE ("notification_id", "channel")
);
--> statement-breakpoint
CREATE INDEX "notification_delivery_outbox_pending_idx"
  ON "notification_delivery_outbox" ("next_attempt_at", "id")
  WHERE "status" = 'pending';
--> statement-breakpoint
CREATE INDEX "notification_delivery_outbox_sending_updated_idx"
  ON "notification_delivery_outbox" ("updated_at", "id")
  WHERE "status" = 'sending';
