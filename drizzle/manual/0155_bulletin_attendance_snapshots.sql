BEGIN;

ALTER TABLE public.bulletins
  ADD COLUMN IF NOT EXISTS term_start_date_snapshot text,
  ADD COLUMN IF NOT EXISTS term_end_date_snapshot text,
  ADD COLUMN IF NOT EXISTS unjustified_absences_count integer,
  ADD COLUMN IF NOT EXISTS unjustified_late_arrival_minutes integer;

DO $$
DECLARE
  invalid_column text;
BEGIN
  SELECT expected.column_name
  INTO invalid_column
  FROM (VALUES
    ('term_start_date_snapshot', 'text'),
    ('term_end_date_snapshot', 'text'),
    ('unjustified_absences_count', 'integer'),
    ('unjustified_late_arrival_minutes', 'integer')
  ) AS expected(column_name, data_type)
  LEFT JOIN information_schema.columns actual
    ON actual.table_schema = 'public'
   AND actual.table_name = 'bulletins'
   AND actual.column_name = expected.column_name
  WHERE actual.column_name IS NULL
     OR actual.data_type IS DISTINCT FROM expected.data_type
     OR actual.is_nullable IS DISTINCT FROM 'YES'
     OR actual.column_default IS NOT NULL
  LIMIT 1;

  IF invalid_column IS NOT NULL THEN
    RAISE EXCEPTION 'Incompatible structure for public.bulletins.%', invalid_column;
  END IF;
END $$;

DO $$
DECLARE
  snapshot_constraint_oid oid;
  snapshot_constraint_comment text;
  snapshot_constraint_definition text;
  snapshot_constraint_validated boolean;
  expected_comment_prefix constant text := 'EcoleTrack bulletin attendance snapshot invariant v1:';
BEGIN
  SELECT oid
  INTO snapshot_constraint_oid
  FROM pg_constraint
  WHERE conrelid = 'public.bulletins'::regclass
    AND contype = 'c'
    AND conname = 'bulletins_attendance_snapshot_complete_check';

  IF snapshot_constraint_oid IS NULL THEN
    ALTER TABLE public.bulletins
      ADD CONSTRAINT bulletins_attendance_snapshot_complete_check
      CHECK (
        (
          term_start_date_snapshot IS NULL
          AND term_end_date_snapshot IS NULL
          AND unjustified_absences_count IS NULL
          AND unjustified_late_arrival_minutes IS NULL
        )
        OR (
          term_start_date_snapshot IS NOT NULL
          AND term_end_date_snapshot IS NOT NULL
          AND unjustified_absences_count IS NOT NULL
          AND unjustified_late_arrival_minutes IS NOT NULL
          AND term_start_date_snapshot ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
          AND term_end_date_snapshot ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
          AND to_char(term_start_date_snapshot::date, 'YYYY-MM-DD') = term_start_date_snapshot
          AND to_char(term_end_date_snapshot::date, 'YYYY-MM-DD') = term_end_date_snapshot
          AND term_start_date_snapshot::date <= term_end_date_snapshot::date
          AND unjustified_absences_count >= 0
          AND unjustified_late_arrival_minutes >= 0
        )
      );
    SELECT oid
    INTO snapshot_constraint_oid
    FROM pg_constraint
    WHERE conrelid = 'public.bulletins'::regclass
      AND contype = 'c'
      AND conname = 'bulletins_attendance_snapshot_complete_check';
    SELECT pg_get_constraintdef(snapshot_constraint_oid, true)
    INTO snapshot_constraint_definition;
    snapshot_constraint_comment := expected_comment_prefix || md5(snapshot_constraint_definition);
    EXECUTE format(
      'COMMENT ON CONSTRAINT bulletins_attendance_snapshot_complete_check ON public.bulletins IS %L',
      snapshot_constraint_comment
    );
  ELSE
    SELECT obj_description(snapshot_constraint_oid, 'pg_constraint')
    INTO snapshot_constraint_comment;

    SELECT convalidated
    INTO snapshot_constraint_validated
    FROM pg_constraint
    WHERE oid = snapshot_constraint_oid;

    SELECT pg_get_constraintdef(snapshot_constraint_oid, true)
    INTO snapshot_constraint_definition;

    IF snapshot_constraint_comment IS DISTINCT FROM
         expected_comment_prefix || md5(snapshot_constraint_definition)
       OR snapshot_constraint_validated IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'Existing bulletins_attendance_snapshot_complete_check is incompatible; review it manually';
    END IF;
  END IF;
END $$;

COMMIT;
