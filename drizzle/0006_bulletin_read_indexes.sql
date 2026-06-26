CREATE INDEX IF NOT EXISTS "idx_bulletins_generated_at" ON "bulletins" ("generated_at" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_bulletins_school_year_term_class_student" ON "bulletins" ("school_year_id", "term_id", "class_id", "student_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_bulletins_student_term" ON "bulletins" ("student_id", "term_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_bulletins_class_term" ON "bulletins" ("class_id", "term_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_bulletin_lines_bulletin_id" ON "bulletin_lines" ("bulletin_id");