CREATE TABLE IF NOT EXISTS "absence_justifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"absence_id" integer NOT NULL,
	"file_name" text NOT NULL,
	"file_path" text NOT NULL,
	"mime_type" text NOT NULL,
	"file_size" integer NOT NULL,
	"uploaded_by" integer NOT NULL,
	"uploaded_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now()
);

ALTER TABLE "absence_justifications" ADD CONSTRAINT "absence_justifications_absence_id_absences_id_fk" FOREIGN KEY ("absence_id") REFERENCES "public"."absences"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "absence_justifications" ADD CONSTRAINT "absence_justifications_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;