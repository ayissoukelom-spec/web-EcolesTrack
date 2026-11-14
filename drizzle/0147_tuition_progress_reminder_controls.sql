ALTER TABLE "schools"
  ADD COLUMN "time_zone" text;
--> statement-breakpoint
CREATE TABLE "tuition_progress_reminder_controls" (
  "id" serial PRIMARY KEY NOT NULL,
  "school_id" integer NOT NULL,
  "academic_year_id" integer NOT NULL,
  "cycle_id" integer NOT NULL,
  "student_id" integer NOT NULL,
  "month_start" date NOT NULL,
  "stage" text NOT NULL,
  "scheduled_at" timestamp with time zone NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "time_zone" text NOT NULL,
  "status" text NOT NULL DEFAULT 'scheduled',
  "target_amount" integer,
  "net_paid_amount" integer,
  "shortfall_amount" integer,
  "last_calculated_at" timestamp with time zone,
  "attempt_count" integer NOT NULL DEFAULT 0,
  "last_attempt_at" timestamp with time zone,
  "next_attempt_at" timestamp with time zone NOT NULL,
  "lease_token" uuid,
  "lease_expires_at" timestamp with time zone,
  "last_error" text,
  "notification_id" integer,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "tuition_progress_reminder_controls_school_fk"
    FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT,
  CONSTRAINT "tuition_progress_reminder_controls_academic_year_fk"
    FOREIGN KEY ("academic_year_id") REFERENCES "academic_years"("id") ON DELETE RESTRICT,
  CONSTRAINT "tuition_progress_reminder_controls_cycle_fk"
    FOREIGN KEY ("cycle_id") REFERENCES "cycles"("id") ON DELETE RESTRICT,
  CONSTRAINT "tuition_progress_reminder_controls_student_fk"
    FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE RESTRICT,
  CONSTRAINT "tuition_progress_reminder_controls_notification_fk"
    FOREIGN KEY ("notification_id") REFERENCES "notifications"("id") ON DELETE SET NULL,
  CONSTRAINT "tuition_progress_reminder_controls_notification_unique"
    UNIQUE ("notification_id"),
  CONSTRAINT "tuition_progress_reminder_controls_scope_unique"
    UNIQUE ("school_id", "academic_year_id", "cycle_id", "student_id", "month_start", "stage"),
  CONSTRAINT "tuition_progress_reminder_controls_month_start_check"
    CHECK (EXTRACT(DAY FROM "month_start") = 1),
  CONSTRAINT "tuition_progress_reminder_controls_stage_check"
    CHECK ("stage" IN ('penultimate', 'last')),
  CONSTRAINT "tuition_progress_reminder_controls_status_check"
    CHECK ("status" IN (
      'scheduled',
      'checking',
      'retry_pending',
      'checked_up_to_date',
      'checked_below_target',
      'skipped_ambiguous',
      'skipped_invalid_calendar',
      'skipped_no_recipient',
      'suppressed_paid',
      'expired',
      'failed'
    )),
  CONSTRAINT "tuition_progress_reminder_controls_time_zone_check"
    CHECK (btrim("time_zone") <> ''),
  CONSTRAINT "tuition_progress_reminder_controls_expiration_check"
    CHECK ("scheduled_at" <= "expires_at"),
  CONSTRAINT "tuition_progress_reminder_controls_attempt_count_check"
    CHECK ("attempt_count" >= 0),
  CONSTRAINT "tuition_progress_reminder_controls_lease_check"
    CHECK (
      ("lease_token" IS NULL AND "lease_expires_at" IS NULL)
      OR ("lease_token" IS NOT NULL AND "lease_expires_at" IS NOT NULL)
    ),
  CONSTRAINT "tuition_progress_reminder_controls_amounts_check"
    CHECK (
      ("target_amount" IS NULL AND "net_paid_amount" IS NULL AND "shortfall_amount" IS NULL)
      OR (
        "target_amount" IS NOT NULL
        AND "net_paid_amount" IS NOT NULL
        AND "shortfall_amount" IS NOT NULL
        AND "shortfall_amount" = GREATEST("target_amount" - "net_paid_amount", 0)
      )
    ),
  CONSTRAINT "tuition_progress_reminder_controls_target_nonnegative_check"
    CHECK ("target_amount" IS NULL OR "target_amount" >= 0),
  CONSTRAINT "tuition_progress_reminder_controls_paid_nonnegative_check"
    CHECK ("net_paid_amount" IS NULL OR "net_paid_amount" >= 0),
  CONSTRAINT "tuition_progress_reminder_controls_shortfall_nonnegative_check"
    CHECK ("shortfall_amount" IS NULL OR "shortfall_amount" >= 0)
);
--> statement-breakpoint
CREATE INDEX "tuition_progress_reminder_controls_due_idx"
  ON "tuition_progress_reminder_controls" ("next_attempt_at", "id")
  WHERE "status" IN ('scheduled', 'retry_pending');
--> statement-breakpoint
CREATE INDEX "tuition_progress_reminder_controls_expired_lease_idx"
  ON "tuition_progress_reminder_controls" ("lease_expires_at", "id")
  WHERE "status" = 'checking' AND "lease_expires_at" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "notification_delivery_outbox"
  ADD COLUMN "transport_state" text,
  ADD COLUMN "relay_job_ids" jsonb,
  ADD COLUMN "relay_accepted_at" timestamp with time zone,
  ADD COLUMN "fcm_accepted_at" timestamp with time zone,
  ADD COLUMN "delivered_at" timestamp with time zone,
  ADD CONSTRAINT "notification_delivery_outbox_transport_state_check"
    CHECK (
      "transport_state" IS NULL
      OR "transport_state" IN ('relay_accepted', 'uncertain', 'fcm_accepted', 'delivered')
    );
