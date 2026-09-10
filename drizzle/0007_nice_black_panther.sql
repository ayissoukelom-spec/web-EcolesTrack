CREATE TABLE "cycle_period_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"cycle_id" integer NOT NULL,
	"period_type" text NOT NULL,
	"name" text NOT NULL,
	"order_index" integer DEFAULT 1 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "cycles" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "cycles_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "levels" (
	"id" serial PRIMARY KEY NOT NULL,
	"cycle_id" integer NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"order_index" integer DEFAULT 1 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "levels_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "notification_attachments" (
	"id" serial PRIMARY KEY NOT NULL,
	"notification_id" integer NOT NULL,
	"file_name" text NOT NULL,
	"file_path" text NOT NULL,
	"mime_type" text NOT NULL,
	"file_size" integer NOT NULL,
	"uploaded_by" integer NOT NULL,
	"uploaded_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "school_cycles" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"cycle_id" integer NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "student_academic_year_statuses" (
	"id" serial PRIMARY KEY NOT NULL,
	"student_id" integer NOT NULL,
	"academic_year_id" integer NOT NULL,
	"status" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "student_academic_year_statuses_status_check" CHECK ("student_academic_year_statuses"."status" IS NULL OR "student_academic_year_statuses"."status" IN ('Nouveau', 'Doublant', 'Triplant', 'Quadruplant', 'Quintuplant', 'Sextuplant'))
);
--> statement-breakpoint
CREATE TABLE "subject_types" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer,
	"name" text NOT NULL,
	"description" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "bulletin_lines" ALTER COLUMN "coefficient" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "classes" ADD COLUMN "level_id" integer;--> statement-breakpoint
ALTER TABLE "evaluations" ADD COLUMN "type" text;--> statement-breakpoint
ALTER TABLE "evaluations" ADD COLUMN "sequence_number" integer;--> statement-breakpoint
ALTER TABLE "evaluations" ADD COLUMN "generated_name" text;--> statement-breakpoint
ALTER TABLE "school_subjects" ADD COLUMN "subject_type_id" integer;--> statement-breakpoint
ALTER TABLE "school_terms" ADD COLUMN "cycle_id" integer;--> statement-breakpoint
ALTER TABLE "school_terms" ADD COLUMN "template_id" integer;--> statement-breakpoint
ALTER TABLE "school_terms" ADD COLUMN "period_type" text;--> statement-breakpoint
ALTER TABLE "schools" ADD COLUMN "official_name" text;--> statement-breakpoint
ALTER TABLE "schools" ADD COLUMN "abbreviation" text;--> statement-breakpoint
ALTER TABLE "schools" ADD COLUMN "motto" text;--> statement-breakpoint
ALTER TABLE "schools" ADD COLUMN "postal_box" text;--> statement-breakpoint
ALTER TABLE "schools" ADD COLUMN "email" text;--> statement-breakpoint
ALTER TABLE "schools" ADD COLUMN "city" text;--> statement-breakpoint
ALTER TABLE "schools" ADD COLUMN "region" text;--> statement-breakpoint
ALTER TABLE "schools" ADD COLUMN "education_direction" text;--> statement-breakpoint
ALTER TABLE "schools" ADD COLUMN "students_creation_locked" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "matricule" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "subjects" ADD COLUMN "subject_type_id" integer;--> statement-breakpoint
ALTER TABLE "token_blacklist" ADD COLUMN "token_jti" text;--> statement-breakpoint
ALTER TABLE "cycle_period_templates" ADD CONSTRAINT "cycle_period_templates_cycle_id_cycles_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "public"."cycles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "levels" ADD CONSTRAINT "levels_cycle_id_cycles_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "public"."cycles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_attachments" ADD CONSTRAINT "notification_attachments_notification_id_notifications_id_fk" FOREIGN KEY ("notification_id") REFERENCES "public"."notifications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_attachments" ADD CONSTRAINT "notification_attachments_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "school_cycles" ADD CONSTRAINT "school_cycles_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "school_cycles" ADD CONSTRAINT "school_cycles_cycle_id_cycles_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "public"."cycles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_academic_year_statuses" ADD CONSTRAINT "student_academic_year_statuses_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_academic_year_statuses" ADD CONSTRAINT "student_academic_year_statuses_academic_year_id_academic_years_id_fk" FOREIGN KEY ("academic_year_id") REFERENCES "public"."academic_years"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subject_types" ADD CONSTRAINT "subject_types_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "cycle_period_templates_cycle_order_idx" ON "cycle_period_templates" USING btree ("cycle_id","order_index");--> statement-breakpoint
CREATE UNIQUE INDEX "school_cycles_school_id_cycle_id_idx" ON "school_cycles" USING btree ("school_id","cycle_id");--> statement-breakpoint
CREATE UNIQUE INDEX "student_academic_year_statuses_student_year_idx" ON "student_academic_year_statuses" USING btree ("student_id","academic_year_id");--> statement-breakpoint
CREATE UNIQUE INDEX "subject_types_school_id_name_idx" ON "subject_types" USING btree ("school_id","name");--> statement-breakpoint
ALTER TABLE "classes" ADD CONSTRAINT "classes_level_id_levels_id_fk" FOREIGN KEY ("level_id") REFERENCES "public"."levels"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "school_subjects" ADD CONSTRAINT "school_subjects_subject_type_id_subject_types_id_fk" FOREIGN KEY ("subject_type_id") REFERENCES "public"."subject_types"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "school_terms" ADD CONSTRAINT "school_terms_cycle_id_cycles_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "public"."cycles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "school_terms" ADD CONSTRAINT "school_terms_template_id_cycle_period_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."cycle_period_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subjects" ADD CONSTRAINT "subjects_subject_type_id_subject_types_id_fk" FOREIGN KEY ("subject_type_id") REFERENCES "public"."subject_types"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "students" ADD CONSTRAINT "students_matricule_unique" UNIQUE("matricule");