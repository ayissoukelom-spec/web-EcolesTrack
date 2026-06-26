CREATE TABLE IF NOT EXISTS "school_terms" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer,
	"academic_year_id" integer NOT NULL,
	"name" text NOT NULL,
	"start_date" text,
	"end_date" text,
	"order_index" integer DEFAULT 1 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "school_terms" ADD CONSTRAINT "school_terms_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "school_terms" ADD CONSTRAINT "school_terms_academic_year_id_academic_years_id_fk" FOREIGN KEY ("academic_year_id") REFERENCES "public"."academic_years"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluations" ADD COLUMN IF NOT EXISTS "term_id" integer;--> statement-breakpoint
ALTER TABLE "evaluations" ADD COLUMN IF NOT EXISTS "count_in_bulletin" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "evaluations" ADD CONSTRAINT "evaluations_term_id_school_terms_id_fk" FOREIGN KEY ("term_id") REFERENCES "public"."school_terms"("id") ON DELETE no action ON UPDATE no action;