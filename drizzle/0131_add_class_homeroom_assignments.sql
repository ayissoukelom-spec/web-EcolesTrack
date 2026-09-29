CREATE TABLE IF NOT EXISTS "class_homeroom_assignments" (
  "id" serial PRIMARY KEY NOT NULL,
  "school_id" integer NOT NULL REFERENCES "schools"("id") ON DELETE CASCADE,
  "class_id" integer NOT NULL REFERENCES "classes"("id") ON DELETE CASCADE,
  "teacher_id" integer NOT NULL REFERENCES "teachers"("id") ON DELETE CASCADE,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "class_homeroom_assignments_school_class_unique" UNIQUE ("school_id", "class_id")
);

CREATE INDEX IF NOT EXISTS "class_homeroom_assignments_school_class_teacher_idx"
  ON "class_homeroom_assignments" ("school_id", "teacher_id");

INSERT INTO "class_homeroom_assignments" ("school_id", "class_id", "teacher_id")
SELECT class_row."school_id", class_row."id", class_row."teacher_id"
FROM "classes" AS class_row
INNER JOIN "teachers" AS teacher_row ON teacher_row."id" = class_row."teacher_id"
WHERE class_row."school_id" IS NOT NULL
  AND class_row."teacher_id" IS NOT NULL
  AND (
    teacher_row."school_id" = class_row."school_id"
    OR EXISTS (
      SELECT 1
      FROM "user_schools" AS membership
      WHERE membership."user_id" = teacher_row."user_id"
        AND membership."school_id" = class_row."school_id"
        AND membership."role" = 'teacher'
        AND membership."is_active" = true
    )
  )
ON CONFLICT ("school_id", "class_id") DO NOTHING;