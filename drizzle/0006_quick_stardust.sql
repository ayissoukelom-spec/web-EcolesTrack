CREATE TABLE "evaluation_participations" (
	"id" serial PRIMARY KEY NOT NULL,
	"evaluation_id" integer NOT NULL,
	"student_id" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "absences" ADD COLUMN "subject_id" integer;--> statement-breakpoint
ALTER TABLE "absences" ADD COLUMN "start_time" text;--> statement-breakpoint
ALTER TABLE "absences" ADD COLUMN "end_time" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "phone" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "last_login_at" timestamp;--> statement-breakpoint
ALTER TABLE "evaluation_participations" ADD CONSTRAINT "evaluation_participations_evaluation_id_evaluations_id_fk" FOREIGN KEY ("evaluation_id") REFERENCES "public"."evaluations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_participations" ADD CONSTRAINT "evaluation_participations_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "evaluation_participations_evaluation_student_idx" ON "evaluation_participations" USING btree ("evaluation_id","student_id");--> statement-breakpoint
ALTER TABLE "absences" ADD CONSTRAINT "absences_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "classes_global_name_academic_year_idx" ON "classes" USING btree ("name","academic_year_id") WHERE "classes"."school_id" IS NULL;