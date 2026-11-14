BEGIN;

DO $$
BEGIN
  IF to_regclass('public.audit_events') IS NULL
     OR to_regclass('public.user_login_events') IS NULL
     OR to_regclass('public.teacher_control_audit_events') IS NULL THEN
    RAISE EXCEPTION 'A required historical journal table is missing';
  END IF;
END
$$;

-- Drop only the six confirmed journal-to-business-table relationships.
DO $$
DECLARE
  fk record;
BEGIN
  FOR fk IN
    SELECT child_ns.nspname AS child_schema,
           child.relname AS child_table,
           con.conname
    FROM pg_constraint con
    JOIN pg_class child ON child.oid = con.conrelid
    JOIN pg_namespace child_ns ON child_ns.oid = child.relnamespace
    JOIN pg_class parent ON parent.oid = con.confrelid
    JOIN pg_namespace parent_ns ON parent_ns.oid = parent.relnamespace
    JOIN pg_attribute child_col
      ON child_col.attrelid = con.conrelid
     AND child_col.attnum = con.conkey[1]
    JOIN pg_attribute parent_col
      ON parent_col.attrelid = con.confrelid
     AND parent_col.attnum = con.confkey[1]
    WHERE con.contype = 'f'
      AND array_length(con.conkey, 1) = 1
      AND array_length(con.confkey, 1) = 1
      AND child_ns.nspname = 'public'
      AND parent_ns.nspname = 'public'
      AND (
        (child.relname = 'audit_events'
          AND child_col.attname = 'actor_user_id'
          AND parent.relname = 'users'
          AND parent_col.attname = 'id')
        OR
        (child.relname = 'audit_events'
          AND child_col.attname = 'school_id'
          AND parent.relname = 'schools'
          AND parent_col.attname = 'id')
        OR
        (child.relname = 'user_login_events'
          AND child_col.attname = 'user_id'
          AND parent.relname = 'users'
          AND parent_col.attname = 'id')
        OR
        (child.relname = 'user_login_events'
          AND child_col.attname = 'school_id'
          AND parent.relname = 'schools'
          AND parent_col.attname = 'id')
        OR
        (child.relname = 'grade_history'
          AND child_col.attname = 'grade_id'
          AND parent.relname = 'grades'
          AND parent_col.attname = 'id')
        OR
        (child.relname = 'grade_history'
          AND child_col.attname = 'changed_by'
          AND parent.relname = 'users'
          AND parent_col.attname = 'id')
      )
  LOOP
    EXECUTE format(
      'ALTER TABLE %I.%I DROP CONSTRAINT %I',
      fk.child_schema, fk.child_table, fk.conname
    );
  END LOOP;
END
$$;

ALTER TABLE public.audit_events
  ADD COLUMN IF NOT EXISTS active_function_id text,
  ADD COLUMN IF NOT EXISTS active_function_name text,
  ADD COLUMN IF NOT EXISTS school_name_snapshot text,
  ADD COLUMN IF NOT EXISTS occurred_at timestamptz,
  ADD COLUMN IF NOT EXISTS module text,
  ADD COLUMN IF NOT EXISTS result text,
  ADD COLUMN IF NOT EXISTS source text,
  ADD COLUMN IF NOT EXISTS before_values jsonb,
  ADD COLUMN IF NOT EXISTS after_values jsonb,
  ADD COLUMN IF NOT EXISTS ip_address text,
  ADD COLUMN IF NOT EXISTS user_agent text,
  ADD COLUMN IF NOT EXISTS correlation_id text,
  ADD COLUMN IF NOT EXISTS reason text;

ALTER TABLE public.user_login_events
  ADD COLUMN IF NOT EXISTS actor_name_snapshot text,
  ADD COLUMN IF NOT EXISTS actor_email_snapshot text,
  ADD COLUMN IF NOT EXISTS school_name_snapshot text,
  ADD COLUMN IF NOT EXISTS active_function_id text,
  ADD COLUMN IF NOT EXISTS active_function_name text,
  ADD COLUMN IF NOT EXISTS occurred_at timestamptz,
  ADD COLUMN IF NOT EXISTS result text,
  ADD COLUMN IF NOT EXISTS source text,
  ADD COLUMN IF NOT EXISTS ip_address text,
  ADD COLUMN IF NOT EXISTS user_agent text,
  ADD COLUMN IF NOT EXISTS correlation_id text;

-- Reject incompatible pre-existing columns before setting the future timestamp default.
DO $$
DECLARE
  spec record;
  actual_type text;
  actual_nullable text;
  actual_default text;
BEGIN
  FOR spec IN
    SELECT * FROM (VALUES
      ('audit_events', 'active_function_id', 'text', false),
      ('audit_events', 'active_function_name', 'text', false),
      ('audit_events', 'school_name_snapshot', 'text', false),
      ('audit_events', 'occurred_at', 'timestamp with time zone', true),
      ('audit_events', 'module', 'text', false),
      ('audit_events', 'result', 'text', false),
      ('audit_events', 'source', 'text', false),
      ('audit_events', 'before_values', 'jsonb', false),
      ('audit_events', 'after_values', 'jsonb', false),
      ('audit_events', 'ip_address', 'text', false),
      ('audit_events', 'user_agent', 'text', false),
      ('audit_events', 'correlation_id', 'text', false),
      ('audit_events', 'reason', 'text', false),
      ('user_login_events', 'actor_name_snapshot', 'text', false),
      ('user_login_events', 'actor_email_snapshot', 'text', false),
      ('user_login_events', 'school_name_snapshot', 'text', false),
      ('user_login_events', 'active_function_id', 'text', false),
      ('user_login_events', 'active_function_name', 'text', false),
      ('user_login_events', 'occurred_at', 'timestamp with time zone', true),
      ('user_login_events', 'result', 'text', false),
      ('user_login_events', 'source', 'text', false),
      ('user_login_events', 'ip_address', 'text', false),
      ('user_login_events', 'user_agent', 'text', false),
      ('user_login_events', 'correlation_id', 'text', false)
    ) AS expected(table_name, column_name, expected_type, uses_now_default)
  LOOP
    SELECT actual.data_type, actual.is_nullable, actual.column_default
      INTO actual_type, actual_nullable, actual_default
    FROM information_schema.columns actual
    WHERE actual.table_schema = 'public'
      AND actual.table_name = spec.table_name
      AND actual.column_name = spec.column_name;

    IF NOT FOUND
       OR actual_type IS DISTINCT FROM spec.expected_type
       OR actual_nullable IS DISTINCT FROM 'YES' THEN
      RAISE EXCEPTION 'Incompatible structure for public.%.%',
        spec.table_name, spec.column_name;
    END IF;

    IF spec.uses_now_default THEN
      IF actual_default IS NOT NULL
         AND actual_default NOT IN ('now()', 'CURRENT_TIMESTAMP') THEN
        RAISE EXCEPTION 'Unexpected default for public.%.%: %',
          spec.table_name, spec.column_name, actual_default;
      END IF;
    ELSIF actual_default IS NOT NULL THEN
      RAISE EXCEPTION 'Unexpected default for public.%.%: %',
        spec.table_name, spec.column_name, actual_default;
    END IF;
  END LOOP;
END
$$;

ALTER TABLE public.audit_events
  ALTER COLUMN occurred_at SET DEFAULT now();
ALTER TABLE public.user_login_events
  ALTER COLUMN occurred_at SET DEFAULT now();

CREATE OR REPLACE FUNCTION public.reject_audit_history_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Historical journal % is append-only', TG_TABLE_NAME
    USING ERRCODE = '55000';
  RETURN NULL;
END;
$$;

DO $$
DECLARE
  journal_table text;
BEGIN
  FOREACH journal_table IN ARRAY ARRAY[
    'audit_events', 'user_login_events', 'grade_history'
  ]
  LOOP
    IF to_regclass(format('public.%I', journal_table)) IS NOT NULL THEN
      EXECUTE format(
        'DROP TRIGGER IF EXISTS %I ON public.%I',
        journal_table || '_append_only_row', journal_table
      );
      EXECUTE format(
        'CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON public.%I
         FOR EACH ROW EXECUTE FUNCTION public.reject_audit_history_mutation()',
        journal_table || '_append_only_row', journal_table
      );
      EXECUTE format(
        'DROP TRIGGER IF EXISTS %I ON public.%I',
        journal_table || '_append_only_truncate', journal_table
      );
      EXECUTE format(
        'CREATE TRIGGER %I BEFORE TRUNCATE ON public.%I
         FOR EACH STATEMENT EXECUTE FUNCTION public.reject_audit_history_mutation()',
        journal_table || '_append_only_truncate', journal_table
      );
      EXECUTE format(
        'ALTER TABLE public.%I ENABLE ALWAYS TRIGGER %I',
        journal_table, journal_table || '_append_only_row'
      );
      EXECUTE format(
        'ALTER TABLE public.%I ENABLE ALWAYS TRIGGER %I',
        journal_table, journal_table || '_append_only_truncate'
      );
    END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger t
    WHERE t.tgrelid = 'public.teacher_control_audit_events'::regclass
      AND t.tgname = 'teacher_control_audit_events_append_only'
      AND t.tgfoid = 'public.prevent_teacher_control_history_mutation()'::regprocedure
      AND t.tgtype = 27
      AND NOT t.tgisinternal
  ) THEN
    RAISE EXCEPTION 'Expected Teacher Control UPDATE/DELETE trigger is missing or differs';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_trigger t
    WHERE t.tgrelid = 'public.teacher_control_audit_events'::regclass
      AND t.tgname = 'teacher_control_audit_events_no_truncate'
      AND (
        t.tgfoid <> 'public.prevent_teacher_control_history_mutation()'::regprocedure
        OR t.tgtype <> 34
        OR t.tgisinternal
      )
  ) THEN
    RAISE EXCEPTION 'Teacher Control TRUNCATE trigger exists with an unexpected definition';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger t
    WHERE t.tgrelid = 'public.teacher_control_audit_events'::regclass
      AND t.tgname = 'teacher_control_audit_events_no_truncate'
  ) THEN
    CREATE TRIGGER teacher_control_audit_events_no_truncate
      BEFORE TRUNCATE ON public.teacher_control_audit_events
      FOR EACH STATEMENT
      EXECUTE FUNCTION public.prevent_teacher_control_history_mutation();
  END IF;

  ALTER TABLE public.teacher_control_audit_events
    ENABLE ALWAYS TRIGGER teacher_control_audit_events_append_only;
  ALTER TABLE public.teacher_control_audit_events
    ENABLE ALWAYS TRIGGER teacher_control_audit_events_no_truncate;
END
$$;

-- Final structural assertions run before COMMIT.
DO $$
DECLARE
  spec record;
  actual_type text;
  actual_nullable text;
  actual_default text;
  journal_table text;
BEGIN
  FOR spec IN
    SELECT * FROM (VALUES
      ('audit_events', 'active_function_id', 'text', false),
      ('audit_events', 'active_function_name', 'text', false),
      ('audit_events', 'school_name_snapshot', 'text', false),
      ('audit_events', 'occurred_at', 'timestamp with time zone', true),
      ('audit_events', 'module', 'text', false),
      ('audit_events', 'result', 'text', false),
      ('audit_events', 'source', 'text', false),
      ('audit_events', 'before_values', 'jsonb', false),
      ('audit_events', 'after_values', 'jsonb', false),
      ('audit_events', 'ip_address', 'text', false),
      ('audit_events', 'user_agent', 'text', false),
      ('audit_events', 'correlation_id', 'text', false),
      ('audit_events', 'reason', 'text', false),
      ('user_login_events', 'actor_name_snapshot', 'text', false),
      ('user_login_events', 'actor_email_snapshot', 'text', false),
      ('user_login_events', 'school_name_snapshot', 'text', false),
      ('user_login_events', 'active_function_id', 'text', false),
      ('user_login_events', 'active_function_name', 'text', false),
      ('user_login_events', 'occurred_at', 'timestamp with time zone', true),
      ('user_login_events', 'result', 'text', false),
      ('user_login_events', 'source', 'text', false),
      ('user_login_events', 'ip_address', 'text', false),
      ('user_login_events', 'user_agent', 'text', false),
      ('user_login_events', 'correlation_id', 'text', false)
    ) AS expected(table_name, column_name, expected_type, uses_now_default)
  LOOP
    SELECT actual.data_type, actual.is_nullable, actual.column_default
      INTO actual_type, actual_nullable, actual_default
    FROM information_schema.columns actual
    WHERE actual.table_schema = 'public'
      AND actual.table_name = spec.table_name
      AND actual.column_name = spec.column_name;

    IF NOT FOUND
       OR actual_type IS DISTINCT FROM spec.expected_type
       OR actual_nullable IS DISTINCT FROM 'YES'
       OR (
         spec.uses_now_default
         AND actual_default IS DISTINCT FROM 'now()'
       )
       OR (
         NOT spec.uses_now_default
         AND actual_default IS NOT NULL
       ) THEN
      RAISE EXCEPTION 'Final column validation failed for public.%.%',
        spec.table_name, spec.column_name;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM pg_constraint con
    JOIN pg_class child ON child.oid = con.conrelid
    JOIN pg_namespace child_ns ON child_ns.oid = child.relnamespace
    JOIN pg_class parent ON parent.oid = con.confrelid
    JOIN pg_namespace parent_ns ON parent_ns.oid = parent.relnamespace
    JOIN pg_attribute child_col
      ON child_col.attrelid = con.conrelid
     AND child_col.attnum = con.conkey[1]
    JOIN pg_attribute parent_col
      ON parent_col.attrelid = con.confrelid
     AND parent_col.attnum = con.confkey[1]
    WHERE con.contype = 'f'
      AND array_length(con.conkey, 1) = 1
      AND array_length(con.confkey, 1) = 1
      AND child_ns.nspname = 'public'
      AND parent_ns.nspname = 'public'
      AND (
        (child.relname = 'audit_events' AND child_col.attname = 'actor_user_id'
          AND parent.relname = 'users' AND parent_col.attname = 'id')
        OR
        (child.relname = 'audit_events' AND child_col.attname = 'school_id'
          AND parent.relname = 'schools' AND parent_col.attname = 'id')
        OR
        (child.relname = 'user_login_events' AND child_col.attname = 'user_id'
          AND parent.relname = 'users' AND parent_col.attname = 'id')
        OR
        (child.relname = 'user_login_events' AND child_col.attname = 'school_id'
          AND parent.relname = 'schools' AND parent_col.attname = 'id')
        OR
        (child.relname = 'grade_history' AND child_col.attname = 'grade_id'
          AND parent.relname = 'grades' AND parent_col.attname = 'id')
        OR
        (child.relname = 'grade_history' AND child_col.attname = 'changed_by'
          AND parent.relname = 'users' AND parent_col.attname = 'id')
      )
  ) THEN
    RAISE EXCEPTION 'A targeted destructive journal FK remains';
  END IF;

  FOREACH journal_table IN ARRAY ARRAY[
    'audit_events', 'user_login_events', 'grade_history'
  ]
  LOOP
    IF to_regclass(format('public.%I', journal_table)) IS NOT NULL THEN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_trigger t
        WHERE t.tgrelid = to_regclass(format('public.%I', journal_table))
          AND t.tgname = journal_table || '_append_only_row'
          AND t.tgfoid = 'public.reject_audit_history_mutation()'::regprocedure
          AND t.tgtype = 27
          AND t.tgenabled = 'A'
          AND NOT t.tgisinternal
      ) OR NOT EXISTS (
        SELECT 1
        FROM pg_trigger t
        WHERE t.tgrelid = to_regclass(format('public.%I', journal_table))
          AND t.tgname = journal_table || '_append_only_truncate'
          AND t.tgfoid = 'public.reject_audit_history_mutation()'::regprocedure
          AND t.tgtype = 34
          AND t.tgenabled = 'A'
          AND NOT t.tgisinternal
      ) THEN
        RAISE EXCEPTION 'Append-only triggers are missing or disabled on %',
          journal_table;
      END IF;
    END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger t
    WHERE t.tgrelid = 'public.teacher_control_audit_events'::regclass
      AND t.tgname = 'teacher_control_audit_events_append_only'
      AND t.tgfoid = 'public.prevent_teacher_control_history_mutation()'::regprocedure
      AND t.tgtype = 27
      AND t.tgenabled = 'A'
      AND NOT t.tgisinternal
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_trigger t
    WHERE t.tgrelid = 'public.teacher_control_audit_events'::regclass
      AND t.tgname = 'teacher_control_audit_events_no_truncate'
      AND t.tgfoid = 'public.prevent_teacher_control_history_mutation()'::regprocedure
      AND t.tgtype = 34
      AND t.tgenabled = 'A'
      AND NOT t.tgisinternal
  ) THEN
    RAISE EXCEPTION 'Teacher Control append-only protection is incomplete';
  END IF;
END
$$;

COMMIT;
