-- Persist the administrator-configurable GPS accuracy threshold, defaulting to 500 m.
-- Expand stored session evidence to the maximum configurable threshold.
BEGIN;

ALTER TABLE public.teacher_control_gps_settings
  ADD COLUMN IF NOT EXISTS max_gps_accuracy_meters INTEGER NOT NULL DEFAULT 500;

CREATE TEMP TABLE _teacher_control_0150_expected_checks (
  start_distance_meters INTEGER,
  start_accuracy_meters INTEGER,
  start_geofence_radius_meters INTEGER,
  end_distance_meters INTEGER,
  end_accuracy_meters INTEGER,
  end_geofence_radius_meters INTEGER,
  max_gps_accuracy_meters INTEGER
) ON COMMIT DROP;

ALTER TABLE pg_temp._teacher_control_0150_expected_checks
  ADD CONSTRAINT expected_accuracy_check
    CHECK (max_gps_accuracy_meters BETWEEN 1 AND 5000),
  ADD CONSTRAINT expected_sessions_0144_check CHECK (
    start_distance_meters >= 0 AND start_accuracy_meters BETWEEN 0 AND 100
    AND start_geofence_radius_meters > 0
    AND (end_distance_meters IS NULL OR end_distance_meters >= 0)
    AND (end_accuracy_meters IS NULL OR end_accuracy_meters BETWEEN 0 AND 100)
    AND (end_geofence_radius_meters IS NULL OR end_geofence_radius_meters > 0)
  ),
  ADD CONSTRAINT expected_sessions_0149_check CHECK (
    (start_distance_meters IS NULL OR start_distance_meters >= 0)
    AND (start_accuracy_meters IS NULL OR start_accuracy_meters BETWEEN 0 AND 500)
    AND (start_geofence_radius_meters IS NULL OR start_geofence_radius_meters > 0)
    AND (end_distance_meters IS NULL OR end_distance_meters >= 0)
    AND (end_accuracy_meters IS NULL OR end_accuracy_meters BETWEEN 0 AND 500)
    AND (end_geofence_radius_meters IS NULL OR end_geofence_radius_meters > 0)
  ),
  ADD CONSTRAINT expected_sessions_0150_check CHECK (
    (start_distance_meters IS NULL OR start_distance_meters >= 0)
    AND (start_accuracy_meters IS NULL OR start_accuracy_meters BETWEEN 0 AND 5000)
    AND (start_geofence_radius_meters IS NULL OR start_geofence_radius_meters > 0)
    AND (end_distance_meters IS NULL OR end_distance_meters >= 0)
    AND (end_accuracy_meters IS NULL OR end_accuracy_meters BETWEEN 0 AND 5000)
    AND (end_geofence_radius_meters IS NULL OR end_geofence_radius_meters > 0)
  );

DO $$
DECLARE
  accuracy_column_type TEXT;
  accuracy_column_not_null BOOLEAN;
  accuracy_column_default TEXT;
  current_accuracy_check TEXT;
  current_accuracy_check_valid BOOLEAN;
  expected_accuracy_check TEXT;
  current_sessions_check TEXT;
  current_sessions_check_valid BOOLEAN;
  expected_sessions_0144_check TEXT;
  expected_sessions_0149_check TEXT;
  expected_sessions_0150_check TEXT;
BEGIN
  SELECT format_type(attribute.atttypid, attribute.atttypmod),
    attribute.attnotnull,
    pg_get_expr(default_value.adbin, default_value.adrelid)
  INTO accuracy_column_type, accuracy_column_not_null, accuracy_column_default
  FROM pg_attribute AS attribute
  LEFT JOIN pg_attrdef AS default_value
    ON default_value.adrelid = attribute.attrelid
    AND default_value.adnum = attribute.attnum
  WHERE attribute.attrelid = 'public.teacher_control_gps_settings'::regclass
    AND attribute.attname = 'max_gps_accuracy_meters'
    AND attribute.attnum > 0
    AND NOT attribute.attisdropped;

  IF accuracy_column_type IS DISTINCT FROM 'integer'
    OR accuracy_column_not_null IS NOT TRUE
    OR regexp_replace(coalesce(accuracy_column_default, ''), '\s', '', 'g') <> '500' THEN
    RAISE EXCEPTION 'Unexpected definition for teacher_control_gps_settings.max_gps_accuracy_meters';
  END IF;

  SELECT pg_get_expr(conbin, conrelid)
  INTO expected_accuracy_check
  FROM pg_constraint
  WHERE conrelid = 'pg_temp._teacher_control_0150_expected_checks'::regclass
    AND conname = 'expected_accuracy_check';

  SELECT pg_get_expr(conbin, conrelid), convalidated
  INTO current_accuracy_check, current_accuracy_check_valid
  FROM pg_constraint
  WHERE conrelid = 'public.teacher_control_gps_settings'::regclass
    AND conname = 'teacher_control_gps_accuracy_check';

  IF current_accuracy_check IS NULL THEN
    ALTER TABLE public.teacher_control_gps_settings
      ADD CONSTRAINT teacher_control_gps_accuracy_check
        CHECK (max_gps_accuracy_meters BETWEEN 1 AND 5000);
  ELSIF current_accuracy_check_valid IS NOT TRUE THEN
    RAISE EXCEPTION 'Unvalidated definition for teacher_control_gps_settings.teacher_control_gps_accuracy_check';
  ELSIF current_accuracy_check IS DISTINCT FROM expected_accuracy_check THEN
    RAISE EXCEPTION 'Unknown definition for teacher_control_gps_settings.teacher_control_gps_accuracy_check';
  END IF;

  SELECT pg_get_expr(conbin, conrelid)
  INTO expected_sessions_0144_check
  FROM pg_constraint
  WHERE conrelid = 'pg_temp._teacher_control_0150_expected_checks'::regclass
    AND conname = 'expected_sessions_0144_check';

  SELECT pg_get_expr(conbin, conrelid)
  INTO expected_sessions_0149_check
  FROM pg_constraint
  WHERE conrelid = 'pg_temp._teacher_control_0150_expected_checks'::regclass
    AND conname = 'expected_sessions_0149_check';

  SELECT pg_get_expr(conbin, conrelid)
  INTO expected_sessions_0150_check
  FROM pg_constraint
  WHERE conrelid = 'pg_temp._teacher_control_0150_expected_checks'::regclass
    AND conname = 'expected_sessions_0150_check';

  SELECT pg_get_expr(conbin, conrelid), convalidated
  INTO current_sessions_check, current_sessions_check_valid
  FROM pg_constraint
  WHERE conrelid = 'public.teacher_control_sessions'::regclass
    AND conname = 'teacher_control_sessions_gps_values_check';

  IF current_sessions_check IS NULL THEN
    ALTER TABLE public.teacher_control_sessions
      ADD CONSTRAINT teacher_control_sessions_gps_values_check CHECK (
        (start_distance_meters IS NULL OR start_distance_meters >= 0)
        AND (start_accuracy_meters IS NULL OR start_accuracy_meters BETWEEN 0 AND 5000)
        AND (start_geofence_radius_meters IS NULL OR start_geofence_radius_meters > 0)
        AND (end_distance_meters IS NULL OR end_distance_meters >= 0)
        AND (end_accuracy_meters IS NULL OR end_accuracy_meters BETWEEN 0 AND 5000)
        AND (end_geofence_radius_meters IS NULL OR end_geofence_radius_meters > 0)
      );
  ELSIF current_sessions_check_valid IS NOT TRUE THEN
    RAISE EXCEPTION 'Unvalidated definition for teacher_control_sessions.teacher_control_sessions_gps_values_check';
  ELSIF current_sessions_check IS NOT DISTINCT FROM expected_sessions_0150_check THEN
    NULL;
  ELSIF current_sessions_check IS NOT DISTINCT FROM expected_sessions_0144_check
    OR current_sessions_check IS NOT DISTINCT FROM expected_sessions_0149_check THEN
    ALTER TABLE public.teacher_control_sessions
      DROP CONSTRAINT teacher_control_sessions_gps_values_check;

    ALTER TABLE public.teacher_control_sessions
      ADD CONSTRAINT teacher_control_sessions_gps_values_check CHECK (
        (start_distance_meters IS NULL OR start_distance_meters >= 0)
        AND (start_accuracy_meters IS NULL OR start_accuracy_meters BETWEEN 0 AND 5000)
        AND (start_geofence_radius_meters IS NULL OR start_geofence_radius_meters > 0)
        AND (end_distance_meters IS NULL OR end_distance_meters >= 0)
        AND (end_accuracy_meters IS NULL OR end_accuracy_meters BETWEEN 0 AND 5000)
        AND (end_geofence_radius_meters IS NULL OR end_geofence_radius_meters > 0)
      );
  ELSE
    RAISE EXCEPTION 'Unknown definition for teacher_control_sessions.teacher_control_sessions_gps_values_check';
  END IF;
END;
$$;

COMMIT;
