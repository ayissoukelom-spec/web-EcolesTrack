CREATE TABLE IF NOT EXISTS "bulletins" (
	"id" serial PRIMARY KEY NOT NULL,
	"student_id" integer NOT NULL,
	"class_id" integer NOT NULL,
	"school_year_id" integer NOT NULL,
	"term_id" integer NOT NULL,
	"average" text,
	"total_points" text NOT NULL,
	"total_coefficients" text NOT NULL,
	"rank" integer,
	"mention" text,
	"appreciation" text,
	"generated_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bulletin_lines" (
	"id" serial PRIMARY KEY NOT NULL,
	"bulletin_id" integer NOT NULL,
	"subject_id" integer,
	"subject_name" text NOT NULL,
	"coefficient" integer NOT NULL,
	"average" text,
	"teacher_comment" text,
	"rank" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bulletins" ADD CONSTRAINT "bulletins_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "bulletins" ADD CONSTRAINT "bulletins_class_id_classes_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "bulletins" ADD CONSTRAINT "bulletins_school_year_id_academic_years_id_fk" FOREIGN KEY ("school_year_id") REFERENCES "public"."academic_years"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "bulletins" ADD CONSTRAINT "bulletins_term_id_school_terms_id_fk" FOREIGN KEY ("term_id") REFERENCES "public"."school_terms"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "bulletin_lines" ADD CONSTRAINT "bulletin_lines_bulletin_id_bulletins_id_fk" FOREIGN KEY ("bulletin_id") REFERENCES "public"."bulletins"("id") ON DELETE cascade ON UPDATE no action;