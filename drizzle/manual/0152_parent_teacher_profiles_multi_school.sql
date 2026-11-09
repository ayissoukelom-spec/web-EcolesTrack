-- Scope Parent and Teacher profiles to one user-school pair.
-- Review and apply only through the approved deployment migration process.
-- This file is intentionally not executed by application startup or Drizzle's journal.
-- Requires 0151_user_schools_role_scoped_uniqueness to have been applied first.
BEGIN;

DO $profiles_multi_school_preflight$
DECLARE
  parent_null_school_count bigint;
  parent_invalid_school_count bigint;
  teacher_invalid_school_count bigint;
  duplicate_parent_profile_count bigint;
  duplicate_teacher_profile_count bigint;
  linked_parent_student_school_mismatch_count bigint;
  legacy_parent_student_school_mismatch_count bigint;
  teacher_school_scope_mismatch_count bigint;
  teacher_control_scope_mismatch_count bigint;
  parent_without_active_membership_count bigint;
  teacher_without_active_membership_count bigint;
  teacher_control_table_count integer;
BEGIN
  IF to_regclass('public.parents') IS NULL
    OR to_regclass('public.teachers') IS NULL
    OR to_regclass('public.students') IS NULL
    OR to_regclass('public.schools') IS NULL
    OR to_regclass('public.users') IS NULL
    OR to_regclass('public.user_schools') IS NULL
    OR to_regclass('public.classes') IS NULL
    OR to_regclass('public.class_teachers') IS NULL
    OR to_regclass('public.teacher_subjects') IS NULL
    OR to_regclass('public.teacher_class_subjects') IS NULL
    OR to_regclass('public.class_homeroom_assignments') IS NULL
    OR to_regclass('public.evaluations') IS NULL
    OR to_regclass('public.absence_controls') IS NULL THEN
    RAISE EXCEPTION
      'Cannot scope Parent and Teacher profiles: one or more required public tables are missing. No rows were changed.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_index AS index_row
    JOIN pg_class AS index_relation ON index_relation.oid = index_row.indexrelid
    JOIN pg_namespace AS index_namespace ON index_namespace.oid = index_relation.relnamespace
    WHERE index_namespace.nspname = 'public'
      AND index_row.indrelid = 'public.user_schools'::regclass
      AND index_row.indisunique
      AND index_row.indisvalid
      AND index_row.indisready
      AND NOT index_row.indisprimary
      AND NOT index_row.indnullsnotdistinct
      AND index_row.indnkeyatts = 3
      AND index_row.indnatts = 3
      AND index_row.indpred IS NULL
      AND index_row.indexprs IS NULL
      AND (
        SELECT array_agg(attribute_row.attname::text ORDER BY key_column.position)
        FROM unnest(index_row.indkey) WITH ORDINALITY AS key_column(attnum, position)
        JOIN pg_attribute AS attribute_row
          ON attribute_row.attrelid = index_row.indrelid
          AND attribute_row.attnum = key_column.attnum
        WHERE key_column.position <= index_row.indnkeyatts
      ) = ARRAY['user_id', 'school_id', 'role']::text[]
  ) THEN
    RAISE EXCEPTION
      'Cannot scope profiles safely: apply and verify 0151_user_schools_role_scoped_uniqueness first. No rows were changed.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_constraint AS constraint_row
    WHERE constraint_row.conrelid = 'public.user_schools'::regclass
      AND constraint_row.contype = 'u'
      AND cardinality(constraint_row.conkey) = 2
      AND (
        SELECT array_agg(attribute_row.attname::text ORDER BY attribute_row.attname::text)
        FROM unnest(constraint_row.conkey) AS key_column(attnum)
        JOIN pg_attribute AS attribute_row
          ON attribute_row.attrelid = constraint_row.conrelid
          AND attribute_row.attnum = key_column.attnum
      ) = ARRAY['school_id', 'user_id']::text[]
  ) OR EXISTS (
    SELECT 1
    FROM pg_index AS index_row
    WHERE index_row.indrelid = 'public.user_schools'::regclass
      AND index_row.indisunique
      AND index_row.indnkeyatts = 2
      AND index_row.indpred IS NULL
      AND index_row.indexprs IS NULL
      AND (
        SELECT array_agg(attribute_row.attname::text ORDER BY attribute_row.attname::text)
        FROM unnest(index_row.indkey) WITH ORDINALITY AS key_column(attnum, position)
        JOIN pg_attribute AS attribute_row
          ON attribute_row.attrelid = index_row.indrelid
          AND attribute_row.attnum = key_column.attnum
        WHERE key_column.position <= index_row.indnkeyatts
      ) = ARRAY['school_id', 'user_id']::text[]
  ) THEN
    RAISE EXCEPTION
      'Cannot scope profiles safely: the legacy user_schools (user_id, school_id) uniqueness still prevents multiple functions in one school. Apply 0151 first. No rows were changed.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint AS constraint_row
    WHERE constraint_row.conrelid = 'public.parents'::regclass
      AND constraint_row.contype = 'f'
      AND constraint_row.confrelid = 'public.users'::regclass
      AND cardinality(constraint_row.conkey) = 1
      AND cardinality(constraint_row.confkey) = 1
      AND constraint_row.conkey[1] = (
        SELECT attribute_row.attnum FROM pg_attribute AS attribute_row
        WHERE attribute_row.attrelid = 'public.parents'::regclass
          AND attribute_row.attname = 'user_id'
          AND NOT attribute_row.attisdropped
      )
      AND constraint_row.confkey[1] = (
        SELECT attribute_row.attnum FROM pg_attribute AS attribute_row
        WHERE attribute_row.attrelid = 'public.users'::regclass
          AND attribute_row.attname = 'id'
          AND NOT attribute_row.attisdropped
      )
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_constraint AS constraint_row
    WHERE constraint_row.conrelid = 'public.teachers'::regclass
      AND constraint_row.contype = 'f'
      AND constraint_row.confrelid = 'public.users'::regclass
      AND cardinality(constraint_row.conkey) = 1
      AND cardinality(constraint_row.confkey) = 1
      AND constraint_row.conkey[1] = (
        SELECT attribute_row.attnum FROM pg_attribute AS attribute_row
        WHERE attribute_row.attrelid = 'public.teachers'::regclass
          AND attribute_row.attname = 'user_id'
          AND NOT attribute_row.attisdropped
      )
      AND constraint_row.confkey[1] = (
        SELECT attribute_row.attnum FROM pg_attribute AS attribute_row
        WHERE attribute_row.attrelid = 'public.users'::regclass
          AND attribute_row.attname = 'id'
          AND NOT attribute_row.attisdropped
      )
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_constraint AS constraint_row
    WHERE constraint_row.conrelid = 'public.teachers'::regclass
      AND constraint_row.contype = 'f'
      AND constraint_row.confrelid = 'public.schools'::regclass
      AND cardinality(constraint_row.conkey) = 1
      AND cardinality(constraint_row.confkey) = 1
      AND constraint_row.conkey[1] = (
        SELECT attribute_row.attnum FROM pg_attribute AS attribute_row
        WHERE attribute_row.attrelid = 'public.teachers'::regclass
          AND attribute_row.attname = 'school_id'
          AND NOT attribute_row.attisdropped
      )
      AND constraint_row.confkey[1] = (
        SELECT attribute_row.attnum FROM pg_attribute AS attribute_row
        WHERE attribute_row.attrelid = 'public.schools'::regclass
          AND attribute_row.attname = 'id'
          AND NOT attribute_row.attisdropped
      )
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_constraint AS constraint_row
    WHERE constraint_row.conrelid = 'public.students'::regclass
      AND constraint_row.contype = 'f'
      AND constraint_row.confrelid = 'public.parents'::regclass
      AND cardinality(constraint_row.conkey) = 1
      AND cardinality(constraint_row.confkey) = 1
      AND constraint_row.conkey[1] = (
        SELECT attribute_row.attnum FROM pg_attribute AS attribute_row
        WHERE attribute_row.attrelid = 'public.students'::regclass
          AND attribute_row.attname = 'parent_id'
          AND NOT attribute_row.attisdropped
      )
      AND constraint_row.confkey[1] = (
        SELECT attribute_row.attnum FROM pg_attribute AS attribute_row
        WHERE attribute_row.attrelid = 'public.parents'::regclass
          AND attribute_row.attname = 'id'
          AND NOT attribute_row.attisdropped
      )
  ) THEN
    RAISE EXCEPTION
      'Cannot scope profiles safely: one or more expected user, school, or Parent-student foreign keys are missing or inconsistent. No rows were changed.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_constraint AS constraint_row
    WHERE constraint_row.conrelid = 'public.parents'::regclass
      AND constraint_row.contype = 'f'
      AND (
        SELECT attribute_row.attnum
        FROM pg_attribute AS attribute_row
        WHERE attribute_row.attrelid = 'public.parents'::regclass
          AND attribute_row.attname = 'school_id'
          AND NOT attribute_row.attisdropped
      ) = ANY(constraint_row.conkey)
      AND NOT (
        constraint_row.confrelid = 'public.schools'::regclass
        AND cardinality(constraint_row.conkey) = 1
        AND cardinality(constraint_row.confkey) = 1
        AND constraint_row.conkey[1] = (
          SELECT attribute_row.attnum
          FROM pg_attribute AS attribute_row
          WHERE attribute_row.attrelid = 'public.parents'::regclass
            AND attribute_row.attname = 'school_id'
            AND NOT attribute_row.attisdropped
        )
        AND constraint_row.confkey[1] = (
          SELECT attribute_row.attnum
          FROM pg_attribute AS attribute_row
          WHERE attribute_row.attrelid = 'public.schools'::regclass
            AND attribute_row.attname = 'id'
            AND NOT attribute_row.attisdropped
        )
      )
  ) THEN
    RAISE EXCEPTION
      'Cannot preserve historical Parent school references: an unexpected foreign key uses parents.school_id. Review it before applying this migration. No rows were changed.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint AS constraint_row
    WHERE constraint_row.conrelid = 'public.parents'::regclass
      AND constraint_row.contype = 'u'
      AND cardinality(constraint_row.conkey) = 1
      AND constraint_row.conkey[1] = (
        SELECT attribute_row.attnum
        FROM pg_attribute AS attribute_row
        WHERE attribute_row.attrelid = 'public.parents'::regclass
          AND attribute_row.attname = 'user_id'
          AND NOT attribute_row.attisdropped
      )
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_constraint AS constraint_row
    WHERE constraint_row.conrelid = 'public.teachers'::regclass
      AND constraint_row.contype = 'u'
      AND cardinality(constraint_row.conkey) = 1
      AND constraint_row.conkey[1] = (
        SELECT attribute_row.attnum
        FROM pg_attribute AS attribute_row
        WHERE attribute_row.attrelid = 'public.teachers'::regclass
          AND attribute_row.attname = 'user_id'
          AND NOT attribute_row.attisdropped
      )
  ) THEN
    RAISE EXCEPTION
      'Cannot replace profile uniqueness: a simple UNIQUE (user_id) constraint is missing or has an unexpected definition on parents or teachers. No rows were changed.';
  END IF;

  SELECT COUNT(*) INTO parent_null_school_count
  FROM public.parents
  WHERE school_id IS NULL;

  SELECT COUNT(*) INTO parent_invalid_school_count
  FROM public.parents AS parent_row
  LEFT JOIN public.schools AS school_row ON school_row.id = parent_row.school_id
  WHERE parent_row.school_id IS NOT NULL
    AND school_row.id IS NULL;

  SELECT COUNT(*) INTO teacher_invalid_school_count
  FROM public.teachers AS teacher_row
  LEFT JOIN public.schools AS school_row ON school_row.id = teacher_row.school_id
  WHERE school_row.id IS NULL;

  SELECT COUNT(*) INTO duplicate_parent_profile_count
  FROM (
    SELECT user_id, school_id
    FROM public.parents
    WHERE school_id IS NOT NULL
    GROUP BY user_id, school_id
    HAVING COUNT(*) > 1
  ) AS duplicate_groups;

  SELECT COUNT(*) INTO duplicate_teacher_profile_count
  FROM (
    SELECT user_id, school_id
    FROM public.teachers
    GROUP BY user_id, school_id
    HAVING COUNT(*) > 1
  ) AS duplicate_groups;

  SELECT COUNT(*) INTO linked_parent_student_school_mismatch_count
  FROM public.parents AS parent_row
  JOIN public.schools AS school_row ON school_row.id = parent_row.school_id
  JOIN public.students AS student_row ON student_row.parent_id = parent_row.id
  WHERE student_row.school_id <> parent_row.school_id;

  SELECT COUNT(*) INTO legacy_parent_student_school_mismatch_count
  FROM public.parents AS parent_row
  JOIN public.schools AS school_row ON school_row.id = parent_row.school_id
  JOIN public.students AS student_row ON student_row.id = parent_row.student_id
  WHERE student_row.school_id <> parent_row.school_id;

  SELECT
    (SELECT COUNT(*) FROM public.class_teachers AS assignment_row
      JOIN public.teachers AS teacher_row ON teacher_row.id = assignment_row.teacher_id
      WHERE assignment_row.school_id IS NOT NULL
        AND assignment_row.school_id <> teacher_row.school_id)
    + (SELECT COUNT(*) FROM public.teacher_subjects AS assignment_row
      JOIN public.teachers AS teacher_row ON teacher_row.id = assignment_row.teacher_id
      WHERE assignment_row.school_id IS NOT NULL
        AND assignment_row.school_id <> teacher_row.school_id)
    + (SELECT COUNT(*) FROM public.teacher_class_subjects AS assignment_row
      JOIN public.teachers AS teacher_row ON teacher_row.id = assignment_row.teacher_id
      WHERE assignment_row.school_id <> teacher_row.school_id)
    + (SELECT COUNT(*) FROM public.class_homeroom_assignments AS assignment_row
      JOIN public.teachers AS teacher_row ON teacher_row.id = assignment_row.teacher_id
      WHERE assignment_row.school_id <> teacher_row.school_id)
    + (SELECT COUNT(*) FROM public.classes AS class_row
      JOIN public.teachers AS teacher_row ON teacher_row.id = class_row.teacher_id
      WHERE class_row.school_id IS NOT NULL
        AND class_row.school_id <> teacher_row.school_id)
    + (SELECT COUNT(*) FROM public.evaluations AS evaluation_row
      JOIN public.teachers AS teacher_row ON teacher_row.id = evaluation_row.teacher_id
      WHERE evaluation_row.school_id IS NOT NULL
        AND evaluation_row.school_id <> teacher_row.school_id)
    + (SELECT COUNT(*) FROM public.absence_controls AS control_row
      JOIN public.teachers AS teacher_row ON teacher_row.id = control_row.teacher_id
      WHERE control_row.school_id <> teacher_row.school_id)
  INTO teacher_school_scope_mismatch_count;

  SELECT COUNT(*) INTO teacher_control_table_count
  FROM (
    VALUES
      (to_regclass('public.teacher_control_hourly_rates') IS NOT NULL),
      (to_regclass('public.teacher_control_sessions') IS NOT NULL),
      (to_regclass('public.teacher_control_regularization_requests') IS NOT NULL)
  ) AS control_tables(is_present)
  WHERE is_present;

  IF teacher_control_table_count NOT IN (0, 3) THEN
    RAISE EXCEPTION
      'Cannot validate Teacher Control history: only some expected Teacher Control tables exist. No rows were changed.';
  END IF;

  IF teacher_control_table_count = 3 THEN
    EXECUTE $query$
      SELECT
        (SELECT COUNT(*) FROM public.teacher_control_hourly_rates AS rate_row
          JOIN public.teachers AS teacher_row ON teacher_row.id = rate_row.teacher_id
          WHERE rate_row.school_id <> teacher_row.school_id)
        + (SELECT COUNT(*) FROM public.teacher_control_sessions AS session_row
          JOIN public.teachers AS teacher_row ON teacher_row.id = session_row.teacher_id
          WHERE session_row.school_id <> teacher_row.school_id)
        + (SELECT COUNT(*) FROM public.teacher_control_regularization_requests AS request_row
          JOIN public.teachers AS teacher_row ON teacher_row.id = request_row.teacher_id
          WHERE request_row.school_id <> teacher_row.school_id)
    $query$
    INTO teacher_control_scope_mismatch_count;
    teacher_school_scope_mismatch_count :=
      teacher_school_scope_mismatch_count + teacher_control_scope_mismatch_count;
  END IF;

  SELECT COUNT(*) INTO parent_without_active_membership_count
  FROM public.parents AS parent_row
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.user_schools AS membership_row
    WHERE membership_row.user_id = parent_row.user_id
      AND membership_row.school_id = parent_row.school_id
      AND membership_row.role = 'parent'
      AND membership_row.is_active IS TRUE
  );

  SELECT COUNT(*) INTO teacher_without_active_membership_count
  FROM public.teachers AS teacher_row
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.user_schools AS membership_row
    WHERE membership_row.user_id = teacher_row.user_id
      AND membership_row.school_id = teacher_row.school_id
      AND membership_row.role = 'teacher'
      AND membership_row.is_active IS TRUE
  );

  RAISE NOTICE
    'Preserving profiles without an active matching user_schools membership (Parent: %, Teacher: %); no memberships or permissions will be created.',
    parent_without_active_membership_count,
    teacher_without_active_membership_count;

  RAISE NOTICE
    'Preserving historical Parent profiles with NULL school IDs: %, or references to deleted schools: %; these profiles remain unusable for active school access.',
    parent_null_school_count,
    parent_invalid_school_count;

  IF teacher_invalid_school_count > 0
    OR duplicate_parent_profile_count > 0
    OR duplicate_teacher_profile_count > 0
    OR linked_parent_student_school_mismatch_count > 0
    OR legacy_parent_student_school_mismatch_count > 0
    OR teacher_school_scope_mismatch_count > 0 THEN
    RAISE EXCEPTION
      'Cannot scope profiles safely: Teacher invalid school rows %, duplicate non-NULL Parent pairs %, duplicate Teacher pairs %, linked active Parent/student school mismatches %, legacy active Parent/student school mismatches %, teacher/assignment/history school mismatches %. No rows were changed; resolve these records explicitly and rerun.',
      teacher_invalid_school_count,
      duplicate_parent_profile_count,
      duplicate_teacher_profile_count,
      linked_parent_student_school_mismatch_count,
      legacy_parent_student_school_mismatch_count,
      teacher_school_scope_mismatch_count
      USING ERRCODE = 'check_violation';
  END IF;
END
$profiles_multi_school_preflight$;

DO $drop_profile_constraints$
DECLARE
  constraint_name name;
  dropped_parent_unique_count integer := 0;
  dropped_teacher_unique_count integer := 0;
BEGIN
  FOR constraint_name IN
    SELECT constraint_row.conname
    FROM pg_constraint AS constraint_row
    WHERE constraint_row.conrelid = 'public.parents'::regclass
      AND constraint_row.contype = 'u'
      AND cardinality(constraint_row.conkey) = 1
      AND constraint_row.conkey[1] = (
        SELECT attribute_row.attnum
        FROM pg_attribute AS attribute_row
        WHERE attribute_row.attrelid = 'public.parents'::regclass
          AND attribute_row.attname = 'user_id'
          AND NOT attribute_row.attisdropped
      )
  LOOP
    EXECUTE format('ALTER TABLE public.parents DROP CONSTRAINT %I', constraint_name);
    dropped_parent_unique_count := dropped_parent_unique_count + 1;
  END LOOP;

  FOR constraint_name IN
    SELECT constraint_row.conname
    FROM pg_constraint AS constraint_row
    WHERE constraint_row.conrelid = 'public.teachers'::regclass
      AND constraint_row.contype = 'u'
      AND cardinality(constraint_row.conkey) = 1
      AND constraint_row.conkey[1] = (
        SELECT attribute_row.attnum
        FROM pg_attribute AS attribute_row
        WHERE attribute_row.attrelid = 'public.teachers'::regclass
          AND attribute_row.attname = 'user_id'
          AND NOT attribute_row.attisdropped
      )
  LOOP
    EXECUTE format('ALTER TABLE public.teachers DROP CONSTRAINT %I', constraint_name);
    dropped_teacher_unique_count := dropped_teacher_unique_count + 1;
  END LOOP;

  FOR constraint_name IN
    SELECT constraint_row.conname
    FROM pg_constraint AS constraint_row
    WHERE constraint_row.conrelid = 'public.parents'::regclass
      AND constraint_row.contype = 'f'
      AND cardinality(constraint_row.conkey) = 1
      AND cardinality(constraint_row.confkey) = 1
      AND constraint_row.conkey[1] = (
        SELECT attribute_row.attnum
        FROM pg_attribute AS attribute_row
        WHERE attribute_row.attrelid = 'public.parents'::regclass
          AND attribute_row.attname = 'school_id'
          AND NOT attribute_row.attisdropped
      )
      AND constraint_row.confrelid = 'public.schools'::regclass
      AND constraint_row.confkey[1] = (
        SELECT attribute_row.attnum
        FROM pg_attribute AS attribute_row
        WHERE attribute_row.attrelid = 'public.schools'::regclass
          AND attribute_row.attname = 'id'
          AND NOT attribute_row.attisdropped
      )
  LOOP
    EXECUTE format('ALTER TABLE public.parents DROP CONSTRAINT %I', constraint_name);
  END LOOP;

  IF dropped_parent_unique_count = 0 OR dropped_teacher_unique_count = 0 THEN
    RAISE EXCEPTION
      'Cannot replace profile uniqueness: expected simple UNIQUE (user_id) constraints were not found at removal time.';
  END IF;
END
$drop_profile_constraints$;

CREATE UNIQUE INDEX parents_user_id_school_id_idx
  ON public.parents (user_id, school_id)
  WHERE school_id IS NOT NULL;

CREATE UNIQUE INDEX teachers_user_id_school_id_idx
  ON public.teachers (user_id, school_id);

COMMIT;
