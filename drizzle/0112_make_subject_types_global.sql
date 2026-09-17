ALTER TABLE "subject_types"
  DROP CONSTRAINT "subject_types_school_id_schools_id_fk";

DROP INDEX "subject_types_school_id_name_idx";

ALTER TABLE "subject_types"
  DROP COLUMN "school_id";

CREATE UNIQUE INDEX "subject_types_name_unique_idx"
  ON "subject_types" USING btree ("name");