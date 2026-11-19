BEGIN;

DO $preflight$
DECLARE
  v_history_owner oid;
  v_runtime_role_count integer;
BEGIN
  IF to_regclass('public.schools') IS NULL
     OR to_regclass('public.classes') IS NULL
     OR to_regclass('public.subjects') IS NULL
     OR to_regclass('public.school_classes') IS NULL
     OR to_regclass('public.school_subjects') IS NULL
     OR to_regclass('public.users') IS NULL
     OR to_regclass('public.teacher_class_subjects') IS NULL
     OR to_regclass('public.teachers') IS NULL
     OR to_regclass('public.teacher_control_hourly_rates') IS NULL
     OR to_regclass('public.teacher_control_audit_events') IS NULL
     OR to_regclass('technical_audit.db_change_events') IS NULL
     OR to_regprocedure('technical_audit.capture_truncate()') IS NULL THEN
    RAISE EXCEPTION 'A required application or audit dependency is missing';
  END IF;

  SELECT oid
    INTO v_history_owner
  FROM pg_catalog.pg_roles
  WHERE rolname = 'ecoletrack_history_owner'
    AND NOT rolcanlogin
    AND NOT rolsuper;

  IF v_history_owner IS NULL THEN
    RAISE EXCEPTION
      'Required non-login, non-superuser role ecoletrack_history_owner is missing';
  END IF;

  SELECT count(*)::integer
    INTO v_runtime_role_count
  FROM pg_catalog.pg_roles
  WHERE rolname IN ('ecoletrack_web_runtime', 'ecoletrack_mobile_runtime');

  IF v_runtime_role_count NOT IN (0, 2) THEN
    RAISE EXCEPTION
      'Expected both runtime roles or neither; found %', v_runtime_role_count;
  END IF;

  IF v_runtime_role_count = 0
     AND NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'ecole_admin'
     ) THEN
    RAISE EXCEPTION 'Local application login ecole_admin is missing';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_roles app_role
    WHERE app_role.rolname IN (
      'ecole_admin', 'ecoletrack_web_runtime', 'ecoletrack_mobile_runtime'
    )
      AND (
        app_role.rolsuper
        OR pg_catalog.pg_has_role(app_role.oid, v_history_owner, 'MEMBER')
      )
  ) THEN
    RAISE EXCEPTION
      'An application role is a superuser or a member of ecoletrack_history_owner';
  END IF;

  IF NOT EXISTS (
       SELECT 1
       FROM pg_catalog.pg_trigger
       WHERE tgrelid = 'public.teacher_control_hourly_rates'::regclass
         AND tgname = 'db_audit_row_teacher_control_hourly_rates'
         AND NOT tgisinternal
     )
     OR NOT EXISTS (
       SELECT 1
       FROM pg_catalog.pg_trigger
       WHERE tgrelid = 'public.teacher_control_hourly_rates'::regclass
         AND tgname = 'db_audit_truncate_teacher_control_hourly_rates'
         AND NOT tgisinternal
     ) THEN
    RAISE EXCEPTION
      'Expected 0158 technical-audit triggers on the legacy rate table';
  END IF;
END
$preflight$;

CREATE TABLE public.teacher_control_class_subject_rates (
  id serial PRIMARY KEY,
  school_id integer NOT NULL,
  class_id integer NOT NULL,
  subject_id integer NOT NULL,
  hourly_rate_xof integer NOT NULL,
  updated_by_user_id integer,
  updated_by_name_snapshot text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),

  CONSTRAINT teacher_control_class_subject_rates_school_id_schools_id_fk
    FOREIGN KEY (school_id)
    REFERENCES public.schools(id)
    ON DELETE CASCADE,

  CONSTRAINT teacher_control_class_subject_rates_class_id_classes_id_fk
    FOREIGN KEY (class_id)
    REFERENCES public.classes(id)
    ON DELETE RESTRICT,

  CONSTRAINT teacher_control_class_subject_rates_subject_id_subjects_id_fk
    FOREIGN KEY (subject_id)
    REFERENCES public.subjects(id)
    ON DELETE RESTRICT,

  CONSTRAINT teacher_control_class_subject_rates_updated_by_user_id_users_id_fk
    FOREIGN KEY (updated_by_user_id)
    REFERENCES public.users(id)
    ON DELETE SET NULL,

  CONSTRAINT teacher_control_class_subject_rates_amount_check
    CHECK (hourly_rate_xof >= 0)
);

CREATE UNIQUE INDEX teacher_control_class_subject_rates_scope_uidx
  ON public.teacher_control_class_subject_rates
    (school_id, class_id, subject_id);

CREATE FUNCTION public.validate_teacher_control_class_subject_rate_scope()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $scope$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.classes AS class_row
    WHERE class_row.id = NEW.class_id
      AND (
        class_row.school_id = NEW.school_id
        OR EXISTS (
          SELECT 1
          FROM public.school_classes AS school_class
          WHERE school_class.school_id = NEW.school_id
            AND school_class.class_id = class_row.id
            AND school_class.status = 'approved'
        )
      )
  ) THEN
    RAISE EXCEPTION
      'Class is outside the rate school scope'
      USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.subjects AS subject_row
    WHERE subject_row.id = NEW.subject_id
      AND (
        subject_row.school_id = NEW.school_id
        OR EXISTS (
          SELECT 1
          FROM public.school_subjects AS school_subject
          WHERE school_subject.school_id = NEW.school_id
            AND school_subject.subject_id = subject_row.id
            AND school_subject.status = 'approved'
        )
      )
  ) THEN
    RAISE EXCEPTION
      'Subject is outside the rate school scope'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END
$scope$;

CREATE TRIGGER teacher_control_class_subject_rates_school_scope
  BEFORE INSERT OR UPDATE OF school_id, class_id, subject_id
  ON public.teacher_control_class_subject_rates
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_teacher_control_class_subject_rate_scope();

ALTER TABLE public.teacher_control_class_subject_rates
  ENABLE ALWAYS TRIGGER teacher_control_class_subject_rates_school_scope;

CREATE FUNCTION technical_audit.capture_teacher_control_class_subject_rates_row()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, technical_audit
AS $capture_row$
DECLARE
  v_audit_columns text[] := ARRAY[
    'id',
    'school_id',
    'class_id',
    'subject_id',
    'hourly_rate_xof',
    'updated_by_user_id',
    'updated_by_name_snapshot',
    'created_at',
    'updated_at'
  ];
  v_resource_id bigint;
  v_school_id bigint;
  v_before_values jsonb;
  v_after_values jsonb;
  v_changed_fields text[];
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_resource_id := NEW.id;
    v_school_id := NEW.school_id;
    v_after_values := pg_catalog.to_jsonb(NEW) - 'updated_by_name_snapshot';
    v_changed_fields := v_audit_columns;

  ELSIF TG_OP = 'UPDATE' THEN
    v_resource_id := NEW.id;
    v_school_id := NEW.school_id;
    v_before_values := pg_catalog.to_jsonb(OLD) - 'updated_by_name_snapshot';
    v_after_values := pg_catalog.to_jsonb(NEW) - 'updated_by_name_snapshot';

    SELECT COALESCE(
      pg_catalog.array_agg(column_name ORDER BY column_name),
      ARRAY[]::text[]
    )
      INTO v_changed_fields
    FROM pg_catalog.unnest(v_audit_columns) AS columns(column_name)
    WHERE pg_catalog.to_jsonb(OLD) -> column_name
      IS DISTINCT FROM pg_catalog.to_jsonb(NEW) -> column_name;

  ELSIF TG_OP = 'DELETE' THEN
    v_resource_id := OLD.id;
    v_school_id := OLD.school_id;
    v_before_values := pg_catalog.to_jsonb(OLD) - 'updated_by_name_snapshot';
    v_changed_fields := v_audit_columns;

  ELSE
    RAISE EXCEPTION
      'Unexpected operation for teacher-control class/subject rate audit';
  END IF;

  INSERT INTO technical_audit.db_change_events (
    occurred_at,
    session_user_name,
    account_classification,
    active_role_setting,
    database_name,
    table_schema,
    table_name,
    operation,
    resource_id,
    school_id,
    before_values,
    after_values,
    changed_fields,
    client_address,
    application_name,
    backend_pid,
    transaction_id
  )
  VALUES (
    pg_catalog.clock_timestamp(),
    session_user,
    CASE
      WHEN session_user IN (
        'ecole_admin',
        'ecoletrack_web_runtime',
        'ecoletrack_mobile_runtime'
      ) THEN 'APPLICATION_ROLE'
      ELSE 'MAINTENANCE_ROLE'
    END,
    NULLIF(NULLIF(pg_catalog.current_setting('role', true), 'none'), ''),
    pg_catalog.current_database(),
    TG_TABLE_SCHEMA,
    TG_TABLE_NAME,
    TG_OP,
    v_resource_id,
    v_school_id,
    v_before_values,
    v_after_values,
    v_changed_fields,
    pg_catalog.inet_client_addr(),
    pg_catalog.current_setting('application_name', true),
    pg_catalog.pg_backend_pid(),
    pg_catalog.txid_current()
  );

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  RETURN NEW;
END
$capture_row$;

CREATE TRIGGER db_audit_row_teacher_control_class_subject_rates
  AFTER INSERT OR UPDATE OR DELETE
  ON public.teacher_control_class_subject_rates
  FOR EACH ROW
  EXECUTE FUNCTION technical_audit.capture_teacher_control_class_subject_rates_row();

ALTER TABLE public.teacher_control_class_subject_rates
  ENABLE ALWAYS TRIGGER db_audit_row_teacher_control_class_subject_rates;

CREATE TRIGGER db_audit_truncate_teacher_control_class_subject_rates
  AFTER TRUNCATE
  ON public.teacher_control_class_subject_rates
  FOR EACH STATEMENT
  EXECUTE FUNCTION technical_audit.capture_truncate();

ALTER TABLE public.teacher_control_class_subject_rates
  ENABLE ALWAYS TRIGGER db_audit_truncate_teacher_control_class_subject_rates;

REVOKE ALL ON FUNCTION
  public.validate_teacher_control_class_subject_rate_scope()
  FROM PUBLIC;
REVOKE ALL ON FUNCTION
  technical_audit.capture_teacher_control_class_subject_rates_row()
  FROM PUBLIC;

DO $protected_ownership$
DECLARE
  v_temporary_create boolean := false;
BEGIN
  IF NOT pg_catalog.has_schema_privilege(
    'ecoletrack_history_owner', 'public', 'CREATE'
  ) THEN
    EXECUTE 'GRANT CREATE ON SCHEMA public TO ecoletrack_history_owner';
    v_temporary_create := true;
  END IF;

  ALTER FUNCTION public.validate_teacher_control_class_subject_rate_scope()
    OWNER TO ecoletrack_history_owner;
  ALTER TABLE public.teacher_control_class_subject_rates
    OWNER TO ecoletrack_history_owner;
  ALTER SEQUENCE public.teacher_control_class_subject_rates_id_seq
    OWNER TO ecoletrack_history_owner;

  IF v_temporary_create THEN
    EXECUTE 'REVOKE CREATE ON SCHEMA public FROM ecoletrack_history_owner';
  END IF;
END
$protected_ownership$;

ALTER FUNCTION technical_audit.capture_teacher_control_class_subject_rates_row()
  OWNER TO ecoletrack_history_owner;

REVOKE ALL ON TABLE public.teacher_control_class_subject_rates FROM PUBLIC;
REVOKE ALL ON SEQUENCE public.teacher_control_class_subject_rates_id_seq FROM PUBLIC;

DO $runtime_privileges$
DECLARE
  v_role text;
BEGIN
  FOREACH v_role IN ARRAY ARRAY[
    'ecole_admin',
    'ecoletrack_web_runtime',
    'ecoletrack_mobile_runtime'
  ]
  LOOP
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = v_role) THEN
      EXECUTE pg_catalog.format(
        'REVOKE ALL PRIVILEGES ON TABLE public.teacher_control_class_subject_rates FROM %I',
        v_role
      );
      EXECUTE pg_catalog.format(
        'REVOKE ALL PRIVILEGES ON SEQUENCE public.teacher_control_class_subject_rates_id_seq FROM %I',
        v_role
      );
      EXECUTE pg_catalog.format(
        'REVOKE ALL PRIVILEGES ON FUNCTION public.validate_teacher_control_class_subject_rate_scope() FROM %I',
        v_role
      );
      EXECUTE pg_catalog.format(
        'REVOKE ALL PRIVILEGES ON FUNCTION technical_audit.capture_teacher_control_class_subject_rates_row() FROM %I',
        v_role
      );
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'ecole_admin'
  ) THEN
    GRANT SELECT, INSERT, UPDATE, DELETE
      ON TABLE public.teacher_control_class_subject_rates
      TO ecole_admin;
    GRANT USAGE, SELECT
      ON SEQUENCE public.teacher_control_class_subject_rates_id_seq
      TO ecole_admin;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'ecoletrack_web_runtime'
  ) THEN
    GRANT SELECT, INSERT, UPDATE, DELETE
      ON TABLE public.teacher_control_class_subject_rates
      TO ecoletrack_web_runtime;
    GRANT USAGE, SELECT
      ON SEQUENCE public.teacher_control_class_subject_rates_id_seq
      TO ecoletrack_web_runtime;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'ecoletrack_mobile_runtime'
  ) THEN
    REVOKE ALL ON TABLE public.teacher_control_class_subject_rates
      FROM ecoletrack_mobile_runtime;
    REVOKE ALL ON SEQUENCE public.teacher_control_class_subject_rates_id_seq
      FROM ecoletrack_mobile_runtime;
  END IF;
END
$runtime_privileges$;

COMMIT;
