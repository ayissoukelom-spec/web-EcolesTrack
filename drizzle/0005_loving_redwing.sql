CREATE TYPE "public"."notification_category_enum" AS ENUM('evaluation_created', 'grade_created', 'absence_created', 'info');--> statement-breakpoint
CREATE TABLE "evaluation_participations" (
	"id" serial PRIMARY KEY NOT NULL,
	"evaluation_id" integer NOT NULL,
	"student_id" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "school_classes" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"class_id" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "school_subjects" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"subject_id" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "token_blacklist" (
	"id" serial PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"user_id" integer,
	"blacklisted_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL,
	CONSTRAINT "token_blacklist_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "token_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"refresh_token_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"last_used_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"revoked_at" timestamp,
	CONSTRAINT "token_sessions_refresh_token_id_unique" UNIQUE("refresh_token_id")
);
--> statement-breakpoint
CREATE TABLE "user_schools" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"school_id" integer NOT NULL,
	"role" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "absences" DROP CONSTRAINT "absences_student_id_students_id_fk";
--> statement-breakpoint
ALTER TABLE "absences" DROP CONSTRAINT "absences_class_id_classes_id_fk";
--> statement-breakpoint
ALTER TABLE "academic_years" DROP CONSTRAINT "academic_years_school_id_schools_id_fk";
--> statement-breakpoint
ALTER TABLE "audit_events" DROP CONSTRAINT "audit_events_actor_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "audit_events" DROP CONSTRAINT "audit_events_school_id_schools_id_fk";
--> statement-breakpoint
ALTER TABLE "bulletins" DROP CONSTRAINT "bulletins_student_id_students_id_fk";
--> statement-breakpoint
ALTER TABLE "bulletins" DROP CONSTRAINT "bulletins_class_id_classes_id_fk";
--> statement-breakpoint
ALTER TABLE "bulletins" DROP CONSTRAINT "bulletins_school_year_id_academic_years_id_fk";
--> statement-breakpoint
ALTER TABLE "bulletins" DROP CONSTRAINT "bulletins_term_id_school_terms_id_fk";
--> statement-breakpoint
ALTER TABLE "class_teachers" DROP CONSTRAINT "class_teachers_class_id_classes_id_fk";
--> statement-breakpoint
ALTER TABLE "class_teachers" DROP CONSTRAINT "class_teachers_teacher_id_teachers_id_fk";
--> statement-breakpoint
ALTER TABLE "classes" DROP CONSTRAINT "classes_school_id_schools_id_fk";
--> statement-breakpoint
ALTER TABLE "classes" DROP CONSTRAINT "classes_academic_year_id_academic_years_id_fk";
--> statement-breakpoint
ALTER TABLE "classes" DROP CONSTRAINT "classes_teacher_id_teachers_id_fk";
--> statement-breakpoint
ALTER TABLE "evaluations" DROP CONSTRAINT "evaluations_class_id_classes_id_fk";
--> statement-breakpoint
ALTER TABLE "evaluations" DROP CONSTRAINT "evaluations_teacher_id_teachers_id_fk";
--> statement-breakpoint
ALTER TABLE "evaluations" DROP CONSTRAINT "evaluations_term_id_school_terms_id_fk";
--> statement-breakpoint
ALTER TABLE "grade_history" DROP CONSTRAINT "grade_history_changed_by_users_id_fk";
--> statement-breakpoint
ALTER TABLE "grades" DROP CONSTRAINT "grades_evaluation_id_evaluations_id_fk";
--> statement-breakpoint
ALTER TABLE "grades" DROP CONSTRAINT "grades_student_id_students_id_fk";
--> statement-breakpoint
ALTER TABLE "local_auths" DROP CONSTRAINT "local_auths_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "parents" DROP CONSTRAINT "parents_school_id_schools_id_fk";
--> statement-breakpoint
ALTER TABLE "school_terms" DROP CONSTRAINT "school_terms_school_id_schools_id_fk";
--> statement-breakpoint
ALTER TABLE "school_terms" DROP CONSTRAINT "school_terms_academic_year_id_academic_years_id_fk";
--> statement-breakpoint
ALTER TABLE "students" DROP CONSTRAINT "students_school_id_schools_id_fk";
--> statement-breakpoint
ALTER TABLE "students" DROP CONSTRAINT "students_class_id_classes_id_fk";
--> statement-breakpoint
ALTER TABLE "students" DROP CONSTRAINT "students_parent_id_parents_id_fk";
--> statement-breakpoint
ALTER TABLE "students" DROP CONSTRAINT "students_school_admin_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "subjects" DROP CONSTRAINT "subjects_school_id_schools_id_fk";
--> statement-breakpoint
ALTER TABLE "teachers" DROP CONSTRAINT "teachers_school_id_schools_id_fk";
--> statement-breakpoint
ALTER TABLE "users" DROP CONSTRAINT "users_school_id_schools_id_fk";
--> statement-breakpoint
ALTER TABLE "users" DROP CONSTRAINT "users_academic_year_id_academic_years_id_fk";
--> statement-breakpoint
ALTER TABLE "classes" ALTER COLUMN "school_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "subjects" ALTER COLUMN "school_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "local_auths" ADD COLUMN "must_reset" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "evaluation_id" integer;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "category" "notification_category_enum";--> statement-breakpoint
ALTER TABLE "evaluation_participations" ADD CONSTRAINT "evaluation_participations_evaluation_id_evaluations_id_fk" FOREIGN KEY ("evaluation_id") REFERENCES "public"."evaluations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_participations" ADD CONSTRAINT "evaluation_participations_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "school_classes" ADD CONSTRAINT "school_classes_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "school_classes" ADD CONSTRAINT "school_classes_class_id_classes_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "school_subjects" ADD CONSTRAINT "school_subjects_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "school_subjects" ADD CONSTRAINT "school_subjects_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "token_blacklist" ADD CONSTRAINT "token_blacklist_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "token_sessions" ADD CONSTRAINT "token_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_schools" ADD CONSTRAINT "user_schools_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_schools" ADD CONSTRAINT "user_schools_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "evaluation_participations_evaluation_id_student_id_idx" ON "evaluation_participations" USING btree ("evaluation_id","student_id");--> statement-breakpoint
CREATE INDEX "evaluation_participations_evaluation_id_status_idx" ON "evaluation_participations" USING btree ("evaluation_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "school_classes_school_id_class_id_idx" ON "school_classes" USING btree ("school_id","class_id");--> statement-breakpoint
CREATE UNIQUE INDEX "school_subjects_school_id_subject_id_idx" ON "school_subjects" USING btree ("school_id","subject_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_schools_user_id_school_id_idx" ON "user_schools" USING btree ("user_id","school_id");--> statement-breakpoint
ALTER TABLE "absences" ADD CONSTRAINT "absences_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "absences" ADD CONSTRAINT "absences_class_id_classes_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic_years" ADD CONSTRAINT "academic_years_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bulletins" ADD CONSTRAINT "bulletins_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bulletins" ADD CONSTRAINT "bulletins_class_id_classes_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bulletins" ADD CONSTRAINT "bulletins_school_year_id_academic_years_id_fk" FOREIGN KEY ("school_year_id") REFERENCES "public"."academic_years"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bulletins" ADD CONSTRAINT "bulletins_term_id_school_terms_id_fk" FOREIGN KEY ("term_id") REFERENCES "public"."school_terms"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_teachers" ADD CONSTRAINT "class_teachers_class_id_classes_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_teachers" ADD CONSTRAINT "class_teachers_teacher_id_teachers_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."teachers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "classes" ADD CONSTRAINT "classes_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "classes" ADD CONSTRAINT "classes_academic_year_id_academic_years_id_fk" FOREIGN KEY ("academic_year_id") REFERENCES "public"."academic_years"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "classes" ADD CONSTRAINT "classes_teacher_id_teachers_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."teachers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluations" ADD CONSTRAINT "evaluations_class_id_classes_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluations" ADD CONSTRAINT "evaluations_teacher_id_teachers_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."teachers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluations" ADD CONSTRAINT "evaluations_term_id_school_terms_id_fk" FOREIGN KEY ("term_id") REFERENCES "public"."school_terms"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grade_history" ADD CONSTRAINT "grade_history_changed_by_users_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grades" ADD CONSTRAINT "grades_evaluation_id_evaluations_id_fk" FOREIGN KEY ("evaluation_id") REFERENCES "public"."evaluations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grades" ADD CONSTRAINT "grades_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "local_auths" ADD CONSTRAINT "local_auths_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_evaluation_id_evaluations_id_fk" FOREIGN KEY ("evaluation_id") REFERENCES "public"."evaluations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parents" ADD CONSTRAINT "parents_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "school_terms" ADD CONSTRAINT "school_terms_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "school_terms" ADD CONSTRAINT "school_terms_academic_year_id_academic_years_id_fk" FOREIGN KEY ("academic_year_id") REFERENCES "public"."academic_years"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "students" ADD CONSTRAINT "students_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "students" ADD CONSTRAINT "students_class_id_classes_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "students" ADD CONSTRAINT "students_parent_id_parents_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."parents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "students" ADD CONSTRAINT "students_school_admin_id_users_id_fk" FOREIGN KEY ("school_admin_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subjects" ADD CONSTRAINT "subjects_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teachers" ADD CONSTRAINT "teachers_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_academic_year_id_academic_years_id_fk" FOREIGN KEY ("academic_year_id") REFERENCES "public"."academic_years"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "class_teachers_class_id_teacher_id_idx" ON "class_teachers" USING btree ("class_id","teacher_id");--> statement-breakpoint
CREATE UNIQUE INDEX "classes_school_academic_year_name_idx" ON "classes" USING btree ("school_id","academic_year_id","name");