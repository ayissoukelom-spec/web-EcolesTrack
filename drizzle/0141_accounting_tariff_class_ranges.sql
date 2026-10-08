ALTER TABLE accounting_tariffs
  ALTER COLUMN class_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS class_from_id integer REFERENCES classes(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS class_to_id integer REFERENCES classes(id) ON DELETE RESTRICT;

DROP INDEX IF EXISTS accounting_tariffs_school_year_class_category_idx;

CREATE UNIQUE INDEX IF NOT EXISTS accounting_tariffs_school_year_class_category_idx
  ON accounting_tariffs (school_id, academic_year_id, class_id, category_id);

CREATE UNIQUE INDEX IF NOT EXISTS accounting_tariffs_school_year_class_range_category_idx
  ON accounting_tariffs (school_id, academic_year_id, class_from_id, class_to_id, category_id)
  WHERE class_id IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'accounting_tariffs_class_scope_check'
      AND conrelid = 'accounting_tariffs'::regclass
  ) THEN
    ALTER TABLE accounting_tariffs
      ADD CONSTRAINT accounting_tariffs_class_scope_check CHECK (
        (class_id IS NOT NULL AND class_from_id IS NULL AND class_to_id IS NULL)
        OR (class_id IS NULL AND class_from_id IS NOT NULL AND class_to_id IS NOT NULL)
      );
  END IF;
END $$;
