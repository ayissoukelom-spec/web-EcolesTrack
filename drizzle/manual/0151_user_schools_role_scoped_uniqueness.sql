-- Replace user_schools uniqueness by the (user, school, role) invariant.
-- Review and apply only through the approved deployment migration process.
-- This file is intentionally not executed by application startup or Drizzle's journal.
BEGIN;

DO $user_schools_role_scoped_uniqueness$
DECLARE
  duplicate_triplet_groups bigint;
  null_role_rows bigint;
  object_name name;
  role_index_oid oid;
  role_index_matches boolean;
  role_index_kind "char";
BEGIN
  IF to_regclass('public.user_schools') IS NULL THEN
    RAISE EXCEPTION 'Cannot update user_schools uniqueness: public.user_schools does not exist.'
      USING ERRCODE = 'undefined_table';
  END IF;

  SELECT COUNT(*)
  INTO null_role_rows
  FROM public.user_schools
  WHERE role IS NULL;

  SELECT COUNT(*)
  INTO duplicate_triplet_groups
  FROM (
    SELECT user_id, school_id, role
    FROM public.user_schools
    GROUP BY user_id, school_id, role
    HAVING COUNT(*) > 1
  ) AS duplicate_groups;

  IF null_role_rows > 0 OR duplicate_triplet_groups > 0 THEN
    RAISE EXCEPTION
      'Cannot enforce user_schools (user_id, school_id, role) uniqueness: % rows have a NULL role and % duplicate triplet groups exist. No rows were changed; review and resolve these records before rerunning.',
      null_role_rows,
      duplicate_triplet_groups
      USING ERRCODE = 'unique_violation';
  END IF;

  ALTER TABLE public.user_schools
    ALTER COLUMN role SET NOT NULL;

  FOR object_name IN
    SELECT constraint_row.conname
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
  LOOP
    EXECUTE format(
      'ALTER TABLE public.user_schools DROP CONSTRAINT %I',
      object_name
    );
  END LOOP;

  FOR object_name IN
    SELECT index_relation.relname
    FROM pg_index AS index_row
    JOIN pg_class AS index_relation
      ON index_relation.oid = index_row.indexrelid
    JOIN pg_namespace AS index_namespace
      ON index_namespace.oid = index_relation.relnamespace
    WHERE index_namespace.nspname = 'public'
      AND index_row.indrelid = 'public.user_schools'::regclass
      AND index_row.indisunique
      AND index_row.indnkeyatts = 2
      AND index_row.indpred IS NULL
      AND index_row.indexprs IS NULL
      AND NOT EXISTS (
        SELECT 1
        FROM pg_constraint AS owning_constraint
        WHERE owning_constraint.conindid = index_row.indexrelid
      )
      AND (
        SELECT array_agg(attribute_row.attname::text ORDER BY attribute_row.attname::text)
        FROM unnest(index_row.indkey) WITH ORDINALITY AS key_column(attnum, position)
        JOIN pg_attribute AS attribute_row
          ON attribute_row.attrelid = index_row.indrelid
          AND attribute_row.attnum = key_column.attnum
        WHERE key_column.position <= index_row.indnkeyatts
      ) = ARRAY['school_id', 'user_id']::text[]
  LOOP
    EXECUTE format('DROP INDEX public.%I', object_name);
  END LOOP;

  SELECT relation_row.oid, relation_row.relkind
  INTO role_index_oid, role_index_kind
  FROM pg_class AS relation_row
  JOIN pg_namespace AS relation_namespace
    ON relation_namespace.oid = relation_row.relnamespace
  WHERE relation_namespace.nspname = 'public'
    AND relation_row.relname = 'user_schools_user_id_school_id_role_idx';

  IF role_index_oid IS NOT NULL AND role_index_kind NOT IN ('i', 'I') THEN
    RAISE EXCEPTION
      'Cannot enforce user_schools role uniqueness: public.user_schools_user_id_school_id_role_idx exists but is not an index.';
  END IF;

  IF role_index_oid IS NOT NULL THEN
    SELECT
      index_row.indisunique
      AND index_row.indisvalid
      AND index_row.indisready
      AND NOT index_row.indisprimary
      AND NOT index_row.indnullsnotdistinct
      AND index_row.indnkeyatts = 3
      AND index_row.indnatts = 3
      AND index_row.indpred IS NULL
      AND index_row.indexprs IS NULL
      AND NOT EXISTS (
        SELECT 1
        FROM pg_constraint AS primary_constraint
        WHERE primary_constraint.conindid = index_row.indexrelid
          AND primary_constraint.contype = 'p'
      )
      AND (
        SELECT array_agg(attribute_row.attname::text ORDER BY attribute_row.attname::text)
        FROM unnest(index_row.indkey) WITH ORDINALITY AS key_column(attnum, position)
        JOIN pg_attribute AS attribute_row
          ON attribute_row.attrelid = index_row.indrelid
          AND attribute_row.attnum = key_column.attnum
        WHERE key_column.position <= index_row.indnkeyatts
      ) = ARRAY['role', 'school_id', 'user_id']::text[]
    INTO role_index_matches
    FROM pg_index AS index_row
    WHERE index_row.indexrelid = role_index_oid
      AND index_row.indrelid = 'public.user_schools'::regclass;

    IF role_index_matches IS DISTINCT FROM TRUE THEN
      RAISE EXCEPTION
        'Cannot enforce user_schools role uniqueness: public.user_schools_user_id_school_id_role_idx exists with an unexpected or invalid definition.';
    END IF;
  ELSE
    EXECUTE 'CREATE UNIQUE INDEX user_schools_user_id_school_id_role_idx ON public.user_schools (user_id, school_id, role)';
  END IF;
END
$user_schools_role_scoped_uniqueness$;

COMMIT;
