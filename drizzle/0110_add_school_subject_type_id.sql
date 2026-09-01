ALTER TABLE "school_subjects"
  ADD COLUMN "subject_type_id" integer;

ALTER TABLE "school_subjects"
  ADD CONSTRAINT "school_subjects_subject_type_id_subject_types_id_fk"
  FOREIGN KEY ("subject_type_id") REFERENCES "public"."subject_types"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
