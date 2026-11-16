-- Historical school scope for absences, late arrivals and parent declarations.
-- Apply only through the approved manual migration process.
BEGIN;

DO $preflight$
BEGIN
  IF to_regclass('public.absences') IS NULL
     OR to_regclass('public.late_arrivals') IS NULL
     OR to_regclass('public.absence_declarations') IS NULL
     OR to_regclass('public.schools') IS NULL
     OR to_regclass('technical_audit.db_change_events') IS NULL THEN
    RAISE EXCEPTION 'A required attendance or technical-audit table is missing';
  END IF;

  IF to_regclass('public.teacher_class_subjects') IS NULL THEN
    RAISE EXCEPTION 'Required table public.teacher_class_subjects is missing';
  END IF;
END
$preflight$;

ALTER TABLE public.absences
  ADD COLUMN school_id integer;
ALTER TABLE public.late_arrivals
  ADD COLUMN school_id integer;
ALTER TABLE public.absence_declarations
  ADD COLUMN school_id integer;

ALTER TABLE public.absences
  ADD CONSTRAINT absences_school_id_schools_id_fk
  FOREIGN KEY (school_id) REFERENCES public.schools(id);
ALTER TABLE public.late_arrivals
  ADD CONSTRAINT late_arrivals_school_id_schools_id_fk
  FOREIGN KEY (school_id) REFERENCES public.schools(id);
ALTER TABLE public.absence_declarations
  ADD CONSTRAINT absence_declarations_school_id_schools_id_fk
  FOREIGN KEY (school_id) REFERENCES public.schools(id);

CREATE INDEX absences_school_date_idx ON public.absences (school_id, date);
CREATE INDEX late_arrivals_school_date_idx ON public.late_arrivals (school_id, date);
CREATE INDEX absence_declarations_school_date_idx
  ON public.absence_declarations (school_id, date);

CREATE OR REPLACE FUNCTION public.enforce_historical_attendance_school_id()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $scope_guard$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.school_id IS NULL THEN
    RAISE EXCEPTION 'school_id is required for new attendance events'
      USING ERRCODE = '23502';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD.school_id IS NOT NULL
       AND NEW.school_id IS DISTINCT FROM OLD.school_id THEN
      RAISE EXCEPTION 'historical attendance school_id is immutable'
        USING ERRCODE = '23514';
    END IF;

    IF OLD.school_id IS NULL
       AND NEW.school_id IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
         FROM pg_catalog.pg_roles AS login_role
         WHERE login_role.rolname = session_user
           AND login_role.rolname IN (
             'postgres',
             'ecolestrack_staging_db_user',
             'ecolestrack_user_user'
           )
       ) THEN
      RAISE EXCEPTION 'only an approved database maintenance account may attribute historical school_id'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END
$scope_guard$;
REVOKE ALL ON FUNCTION public.enforce_historical_attendance_school_id() FROM PUBLIC;

CREATE TRIGGER absences_historical_school_id_guard
  BEFORE INSERT OR UPDATE ON public.absences
  FOR EACH ROW EXECUTE FUNCTION public.enforce_historical_attendance_school_id();
CREATE TRIGGER late_arrivals_historical_school_id_guard
  BEFORE INSERT OR UPDATE ON public.late_arrivals
  FOR EACH ROW EXECUTE FUNCTION public.enforce_historical_attendance_school_id();
CREATE TRIGGER absence_declarations_historical_school_id_guard
  BEFORE INSERT OR UPDATE ON public.absence_declarations
  FOR EACH ROW EXECUTE FUNCTION public.enforce_historical_attendance_school_id();

ALTER TABLE public.absences
  ENABLE ALWAYS TRIGGER absences_historical_school_id_guard;
ALTER TABLE public.late_arrivals
  ENABLE ALWAYS TRIGGER late_arrivals_historical_school_id_guard;
ALTER TABLE public.absence_declarations
  ENABLE ALWAYS TRIGGER absence_declarations_historical_school_id_guard;

CREATE OR REPLACE FUNCTION public.enforce_absence_declaration_school_scope()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $declaration_scope_guard$
DECLARE
  v_declaration_school_id integer;
BEGIN
  IF NEW.declaration_id IS NULL THEN
    RETURN NEW;
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(160, NEW.declaration_id);

  SELECT declaration.school_id
    INTO v_declaration_school_id
  FROM public.absence_declarations AS declaration
  WHERE declaration.id = NEW.declaration_id;

  IF NOT FOUND
     OR v_declaration_school_id IS NULL
     OR NEW.school_id IS NULL
     OR NEW.school_id IS DISTINCT FROM v_declaration_school_id THEN
    RAISE EXCEPTION 'absence and declaration must have the same verified school_id'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END
$declaration_scope_guard$;
REVOKE ALL ON FUNCTION public.enforce_absence_declaration_school_scope() FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.enforce_declaration_linked_absence_school_scope()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $linked_absence_scope_guard$
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(160, NEW.id);

  IF EXISTS (
    SELECT 1
    FROM public.absences AS absence
    WHERE absence.declaration_id = NEW.id
      AND absence.school_id IS NOT NULL
      AND absence.school_id IS DISTINCT FROM NEW.school_id
  ) THEN
    RAISE EXCEPTION 'declaration school_id conflicts with a linked absence'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END
$linked_absence_scope_guard$;
REVOKE ALL ON FUNCTION public.enforce_declaration_linked_absence_school_scope() FROM PUBLIC;

CREATE TRIGGER absences_declaration_school_scope_guard
  BEFORE INSERT OR UPDATE OF school_id, declaration_id ON public.absences
  FOR EACH ROW EXECUTE FUNCTION public.enforce_absence_declaration_school_scope();
ALTER TABLE public.absences
  ENABLE ALWAYS TRIGGER absences_declaration_school_scope_guard;

CREATE TRIGGER absence_declarations_linked_absence_scope_guard
  BEFORE UPDATE OF school_id ON public.absence_declarations
  FOR EACH ROW EXECUTE FUNCTION public.enforce_declaration_linked_absence_school_scope();
ALTER TABLE public.absence_declarations
  ENABLE ALWAYS TRIGGER absence_declarations_linked_absence_scope_guard;

DO $declaration_preflight$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.absences AS absence
    JOIN public.absence_declarations AS declaration
      ON declaration.id = absence.declaration_id
    WHERE absence.school_id IS NOT NULL
      AND declaration.school_id IS NOT NULL
      AND absence.school_id IS DISTINCT FROM declaration.school_id
  ) THEN
    RAISE EXCEPTION 'Existing absence/declaration school scopes conflict; resolve manually before migration';
  END IF;
END
$declaration_preflight$;

CREATE OR REPLACE FUNCTION technical_audit.capture_attendance_scope_row()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, technical_audit
AS $capture$
DECLARE
  v_value_columns text[];
  v_redacted_columns text[];
  v_old_all jsonb;
  v_new_all jsonb;
  v_old_values jsonb;
  v_new_values jsonb;
  v_changed_fields text[] := ARRAY[]::text[];
  v_resource_id bigint;
  v_school_id bigint;
BEGIN
  CASE TG_TABLE_NAME
    WHEN 'absences' THEN
      v_value_columns := ARRAY[
        'id', 'school_id', 'student_id', 'class_id', 'teaching_assignment_id',
        'date', 'period', 'subject_id', 'start_time', 'end_time', 'is_justified',
        'justification_status', 'reviewed_by', 'reviewed_at', 'declaration_id', 'created_at'
      ]::text[];
      v_redacted_columns := ARRAY['justification_reason', 'rejection_reason']::text[];
    WHEN 'absence_declarations' THEN
      v_value_columns := ARRAY[
        'id', 'school_id', 'student_id', 'parent_id', 'date', 'start_time',
        'end_time', 'status', 'reviewed_by', 'reviewed_at', 'created_at', 'updated_at'
      ]::text[];
      v_redacted_columns := ARRAY['reason', 'rejection_reason']::text[];
    WHEN 'late_arrivals' THEN
      v_value_columns := ARRAY[
        'id', 'school_id', 'student_id', 'class_id', 'teaching_assignment_id',
        'date', 'period', 'expected_start_time', 'arrival_time', 'late_minutes',
        'created_by', 'created_at', 'updated_at'
      ]::text[];
      v_redacted_columns := ARRAY['reason']::text[];
    ELSE
      RAISE EXCEPTION 'Unsupported attendance audit table %', TG_TABLE_NAME;
  END CASE;

  IF TG_OP = 'INSERT' THEN
    v_resource_id := NEW.id::bigint;
    v_school_id := NEW.school_id::bigint;
    v_new_all := pg_catalog.to_jsonb(NEW);

    SELECT COALESCE(pg_catalog.jsonb_object_agg(entry.key, entry.value), '{}'::jsonb)
      INTO v_new_values
    FROM pg_catalog.jsonb_each(v_new_all) AS entry(key, value)
    WHERE entry.key = ANY(v_value_columns);

    SELECT COALESCE(pg_catalog.array_agg(entry.key ORDER BY entry.key), ARRAY[]::text[])
      INTO v_changed_fields
    FROM pg_catalog.jsonb_each(v_new_values) AS entry(key, value);

    SELECT COALESCE(pg_catalog.array_agg(entry.key ORDER BY entry.key), ARRAY[]::text[])
      INTO v_redacted_columns
    FROM pg_catalog.jsonb_each(v_new_all) AS entry(key, value)
    WHERE entry.key = ANY(v_redacted_columns)
      AND entry.value IS DISTINCT FROM 'null'::jsonb;
    v_changed_fields := v_changed_fields || v_redacted_columns;

    INSERT INTO technical_audit.db_change_events (
      occurred_at, session_user_name, account_classification, active_role_setting,
      database_name, table_schema, table_name, operation, resource_id, school_id,
      before_values, after_values, changed_fields, client_address,
      application_name, backend_pid, transaction_id
    )
    VALUES (
      pg_catalog.clock_timestamp(), session_user,
      CASE
        WHEN session_user IN (
          'ecole_admin', 'ecoletrack_web_runtime', 'ecoletrack_mobile_runtime'
        ) THEN 'APPLICATION_ROLE'
        ELSE 'MAINTENANCE_ROLE'
      END,
      NULLIF(NULLIF(pg_catalog.current_setting('role', true), 'none'), ''),
      pg_catalog.current_database(), TG_TABLE_SCHEMA, TG_TABLE_NAME, TG_OP,
      v_resource_id, v_school_id, NULL, v_new_values, v_changed_fields,
      pg_catalog.inet_client_addr(), pg_catalog.current_setting('application_name', true),
      pg_catalog.pg_backend_pid(), pg_catalog.txid_current()
    );
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    v_resource_id := NEW.id::bigint;
    v_school_id := NEW.school_id::bigint;
    v_old_all := pg_catalog.to_jsonb(OLD);
    v_new_all := pg_catalog.to_jsonb(NEW);

    SELECT COALESCE(pg_catalog.array_agg(old_entry.key ORDER BY old_entry.key), ARRAY[]::text[])
      INTO v_changed_fields
    FROM pg_catalog.jsonb_each(v_old_all) AS old_entry(key, value)
    JOIN pg_catalog.jsonb_each(v_new_all) AS new_entry(key, value) USING (key)
    WHERE old_entry.value IS DISTINCT FROM new_entry.value
      AND (old_entry.key = ANY(v_value_columns) OR old_entry.key = ANY(v_redacted_columns));

    IF pg_catalog.cardinality(v_changed_fields) = 0 THEN
      RETURN NEW;
    END IF;

    SELECT COALESCE(pg_catalog.jsonb_object_agg(entry.key, entry.value), '{}'::jsonb)
      INTO v_old_values
    FROM pg_catalog.jsonb_each(v_old_all) AS entry(key, value)
    WHERE entry.key = ANY(v_changed_fields) AND entry.key = ANY(v_value_columns);
    SELECT COALESCE(pg_catalog.jsonb_object_agg(entry.key, entry.value), '{}'::jsonb)
      INTO v_new_values
    FROM pg_catalog.jsonb_each(v_new_all) AS entry(key, value)
    WHERE entry.key = ANY(v_changed_fields) AND entry.key = ANY(v_value_columns);

    INSERT INTO technical_audit.db_change_events (
      occurred_at, session_user_name, account_classification, active_role_setting,
      database_name, table_schema, table_name, operation, resource_id, school_id,
      before_values, after_values, changed_fields, client_address,
      application_name, backend_pid, transaction_id
    )
    VALUES (
      pg_catalog.clock_timestamp(), session_user,
      CASE
        WHEN session_user IN (
          'ecole_admin', 'ecoletrack_web_runtime', 'ecoletrack_mobile_runtime'
        ) THEN 'APPLICATION_ROLE'
        ELSE 'MAINTENANCE_ROLE'
      END,
      NULLIF(NULLIF(pg_catalog.current_setting('role', true), 'none'), ''),
      pg_catalog.current_database(), TG_TABLE_SCHEMA, TG_TABLE_NAME, TG_OP,
      v_resource_id, v_school_id, NULLIF(v_old_values, '{}'::jsonb),
      NULLIF(v_new_values, '{}'::jsonb), v_changed_fields,
      pg_catalog.inet_client_addr(), pg_catalog.current_setting('application_name', true),
      pg_catalog.pg_backend_pid(), pg_catalog.txid_current()
    );
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    v_resource_id := OLD.id::bigint;
    v_school_id := OLD.school_id::bigint;
    v_old_all := pg_catalog.to_jsonb(OLD);

    SELECT COALESCE(pg_catalog.jsonb_object_agg(entry.key, entry.value), '{}'::jsonb)
      INTO v_old_values
    FROM pg_catalog.jsonb_each(v_old_all) AS entry(key, value)
    WHERE entry.key = ANY(v_value_columns);

    SELECT COALESCE(pg_catalog.array_agg(entry.key ORDER BY entry.key), ARRAY[]::text[])
      INTO v_changed_fields
    FROM pg_catalog.jsonb_each(v_old_values) AS entry(key, value);
    SELECT COALESCE(pg_catalog.array_agg(entry.key ORDER BY entry.key), ARRAY[]::text[])
      INTO v_redacted_columns
    FROM pg_catalog.jsonb_each(v_old_all) AS entry(key, value)
    WHERE entry.key = ANY(v_redacted_columns)
      AND entry.value IS DISTINCT FROM 'null'::jsonb;
    v_changed_fields := v_changed_fields || v_redacted_columns;

    INSERT INTO technical_audit.db_change_events (
      occurred_at, session_user_name, account_classification, active_role_setting,
      database_name, table_schema, table_name, operation, resource_id, school_id,
      before_values, after_values, changed_fields, client_address,
      application_name, backend_pid, transaction_id
    )
    VALUES (
      pg_catalog.clock_timestamp(), session_user,
      CASE
        WHEN session_user IN (
          'ecole_admin', 'ecoletrack_web_runtime', 'ecoletrack_mobile_runtime'
        ) THEN 'APPLICATION_ROLE'
        ELSE 'MAINTENANCE_ROLE'
      END,
      NULLIF(NULLIF(pg_catalog.current_setting('role', true), 'none'), ''),
      pg_catalog.current_database(), TG_TABLE_SCHEMA, TG_TABLE_NAME, TG_OP,
      v_resource_id, v_school_id, v_old_values, NULL, v_changed_fields,
      pg_catalog.inet_client_addr(), pg_catalog.current_setting('application_name', true),
      pg_catalog.pg_backend_pid(), pg_catalog.txid_current()
    );
    RETURN OLD;
  END IF;

  RAISE EXCEPTION 'Unexpected operation % for attendance technical audit', TG_OP;
END
$capture$;

ALTER FUNCTION technical_audit.capture_attendance_scope_row()
  OWNER TO ecoletrack_history_owner;
REVOKE ALL ON FUNCTION technical_audit.capture_attendance_scope_row() FROM PUBLIC;

DROP TRIGGER IF EXISTS db_audit_row_absences ON public.absences;
CREATE TRIGGER db_audit_row_absences
  AFTER INSERT OR UPDATE OR DELETE ON public.absences
  FOR EACH ROW EXECUTE FUNCTION technical_audit.capture_attendance_scope_row();
ALTER TABLE public.absences ENABLE ALWAYS TRIGGER db_audit_row_absences;

DROP TRIGGER IF EXISTS db_audit_row_absence_declarations ON public.absence_declarations;
CREATE TRIGGER db_audit_row_absence_declarations
  AFTER INSERT OR UPDATE OR DELETE ON public.absence_declarations
  FOR EACH ROW EXECUTE FUNCTION technical_audit.capture_attendance_scope_row();
ALTER TABLE public.absence_declarations ENABLE ALWAYS TRIGGER db_audit_row_absence_declarations;

DROP TRIGGER IF EXISTS db_audit_row_late_arrivals ON public.late_arrivals;
CREATE TRIGGER db_audit_row_late_arrivals
  AFTER INSERT OR UPDATE OR DELETE ON public.late_arrivals
  FOR EACH ROW EXECUTE FUNCTION technical_audit.capture_attendance_scope_row();
ALTER TABLE public.late_arrivals ENABLE ALWAYS TRIGGER db_audit_row_late_arrivals;

DO $trigger_checks$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.absences AS absence
    JOIN public.absence_declarations AS declaration
      ON declaration.id = absence.declaration_id
    WHERE absence.school_id IS NOT NULL
      AND declaration.school_id IS NOT NULL
      AND absence.school_id IS DISTINCT FROM declaration.school_id
  ) THEN
    RAISE EXCEPTION 'Existing absence/declaration school scopes conflict';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_trigger trigger_row
    WHERE trigger_row.tgrelid = 'public.absences'::regclass
      AND trigger_row.tgname = 'absences_historical_school_id_guard'
      AND trigger_row.tgfoid = 'public.enforce_historical_attendance_school_id()'::regprocedure
      AND trigger_row.tgenabled = 'A'
      AND NOT trigger_row.tgisinternal
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_trigger trigger_row
    WHERE trigger_row.tgrelid = 'public.absences'::regclass
      AND trigger_row.tgname = 'absences_declaration_school_scope_guard'
      AND trigger_row.tgfoid = 'public.enforce_absence_declaration_school_scope()'::regprocedure
      AND trigger_row.tgenabled = 'A'
      AND NOT trigger_row.tgisinternal
  ) THEN
    RAISE EXCEPTION 'Absence school-scope protection is missing or not ENABLE ALWAYS';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_trigger trigger_row
    WHERE trigger_row.tgrelid = 'public.absence_declarations'::regclass
      AND trigger_row.tgname = 'absence_declarations_linked_absence_scope_guard'
      AND trigger_row.tgfoid = 'public.enforce_declaration_linked_absence_school_scope()'::regprocedure
      AND trigger_row.tgenabled = 'A'
      AND NOT trigger_row.tgisinternal
  ) THEN
    RAISE EXCEPTION 'Declaration-to-absence school-scope protection is missing or not ENABLE ALWAYS';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_trigger trigger_row
    WHERE trigger_row.tgrelid = 'public.late_arrivals'::regclass
      AND trigger_row.tgname = 'late_arrivals_historical_school_id_guard'
      AND trigger_row.tgfoid = 'public.enforce_historical_attendance_school_id()'::regprocedure
      AND trigger_row.tgenabled = 'A'
      AND NOT trigger_row.tgisinternal
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_trigger trigger_row
    WHERE trigger_row.tgrelid = 'public.absence_declarations'::regclass
      AND trigger_row.tgname = 'absence_declarations_historical_school_id_guard'
      AND trigger_row.tgfoid = 'public.enforce_historical_attendance_school_id()'::regprocedure
      AND trigger_row.tgenabled = 'A'
      AND NOT trigger_row.tgisinternal
  ) THEN
    RAISE EXCEPTION 'Attendance school-scope protection is incomplete';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_trigger trigger_row
    WHERE trigger_row.tgrelid = 'public.absences'::regclass
      AND trigger_row.tgname = 'db_audit_row_absences'
      AND trigger_row.tgfoid = 'technical_audit.capture_attendance_scope_row()'::regprocedure
      AND trigger_row.tgenabled = 'A'
      AND NOT trigger_row.tgisinternal
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_trigger trigger_row
    WHERE trigger_row.tgrelid = 'public.absence_declarations'::regclass
      AND trigger_row.tgname = 'db_audit_row_absence_declarations'
      AND trigger_row.tgfoid = 'technical_audit.capture_attendance_scope_row()'::regprocedure
      AND trigger_row.tgenabled = 'A'
      AND NOT trigger_row.tgisinternal
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_trigger trigger_row
    WHERE trigger_row.tgrelid = 'public.late_arrivals'::regclass
      AND trigger_row.tgname = 'db_audit_row_late_arrivals'
      AND trigger_row.tgfoid = 'technical_audit.capture_attendance_scope_row()'::regprocedure
      AND trigger_row.tgenabled = 'A'
      AND NOT trigger_row.tgisinternal
  ) THEN
    RAISE EXCEPTION 'Attendance technical-audit triggers are missing or not ENABLE ALWAYS';
  END IF;
END
$trigger_checks$;

COMMIT;
