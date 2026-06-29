-- Make class school association optional for global catalog classes
ALTER TABLE "classes"
  ALTER COLUMN "school_id" DROP NOT NULL;

-- Enforce uniqueness for global classes by academic year and name
CREATE UNIQUE INDEX IF NOT EXISTS "classes_global_academic_year_name_idx"
  ON "classes" ("academic_year_id", "name")
  WHERE "school_id" IS NULL;

-- Ensure school_classes table exists with stable structure for per-school approval
CREATE TABLE IF NOT EXISTS "school_classes" (
  "id" SERIAL PRIMARY KEY,
  "school_id" INTEGER REFERENCES "schools"("id") NOT NULL,
  "class_id" INTEGER REFERENCES "classes"("id") ON DELETE CASCADE NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "created_at" TIMESTAMP DEFAULT NOW(),
  "updated_at" TIMESTAMP DEFAULT NOW()
);

ALTER TABLE "school_classes"
  ALTER COLUMN "school_id" SET NOT NULL;

ALTER TABLE "school_classes"
  ALTER COLUMN "class_id" SET NOT NULL;

ALTER TABLE "school_classes"
  ALTER COLUMN "status" SET DEFAULT 'pending';

CREATE UNIQUE INDEX IF NOT EXISTS "school_classes_school_id_class_id_idx"
  ON "school_classes" ("school_id", "class_id");
