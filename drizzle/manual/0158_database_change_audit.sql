-- Technical audit of direct database changes.
-- Review and apply only through the approved manual migration process.
-- No business-table data is changed by this migration.
-- APPLICATION_ROLE identifies a known PostgreSQL login only; it does not prove
-- that an operation originated from EcoleTrack. All other logins are MAINTENANCE_ROLE.
-- application_name and active_role_setting are context only, never identity evidence.
-- Existing audit-history tables retain only identifiers/school scope as values;
-- their other modified columns are represented by field names.
-- Capture triggers use ENABLE ALWAYS. A future logical replication setup may
-- therefore generate additional audit rows on subscribers and must be designed accordingly.
BEGIN;

DO $preflight$
DECLARE
  v_owner record;
  v_render_role_count integer;
  v_table_count integer := 0;
  v_policy record;
  v_column text;
  v_relation oid;
BEGIN
  SELECT oid, rolcanlogin, rolsuper
    INTO v_owner
  FROM pg_catalog.pg_roles
  WHERE rolname = 'ecoletrack_history_owner';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Required owner role ecoletrack_history_owner is missing';
  END IF;
  IF v_owner.rolcanlogin OR v_owner.rolsuper THEN
    RAISE EXCEPTION 'ecoletrack_history_owner must be a non-login, non-superuser role';
  END IF;

  SELECT count(*)::integer
    INTO v_render_role_count
  FROM pg_catalog.pg_roles
  WHERE rolname IN ('ecoletrack_web_runtime', 'ecoletrack_mobile_runtime');

  IF v_render_role_count NOT IN (0, 2) THEN
    RAISE EXCEPTION 'Expected both Render runtime roles or neither; found %', v_render_role_count;
  END IF;

  IF v_render_role_count = 0 THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'ecole_admin'
    ) THEN
      RAISE EXCEPTION 'Local application login ecole_admin is missing';
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_roles app_role
    WHERE app_role.rolname IN (
      'ecole_admin', 'ecoletrack_web_runtime', 'ecoletrack_mobile_runtime'
    )
      AND app_role.rolsuper
  ) THEN
    RAISE EXCEPTION 'An application login is a superuser; technical auditing cannot protect the journal from it';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_roles app_role
    WHERE app_role.rolname IN (
      'ecole_admin', 'ecoletrack_web_runtime', 'ecoletrack_mobile_runtime'
    )
      AND pg_catalog.pg_has_role(app_role.oid, v_owner.oid, 'MEMBER')
  ) THEN
    RAISE EXCEPTION 'An application login is a member of ecoletrack_history_owner';
  END IF;

  FOR v_policy IN
    SELECT *
    FROM (VALUES
      ('grades', NULL::text,
        ARRAY['id','evaluation_id','student_id','score','edit_count','created_at','updated_at']::text[],
        ARRAY['remarks']::text[]),
      ('evaluations', 'school_id',
        ARRAY['id','school_id','class_id','publication_id','teacher_id','term_id','subject_id','subject','title','type','sequence_number','generated_name','coefficient','max_score','count_in_bulletin','date','created_at','is_archived']::text[],
        ARRAY[]::text[]),
      ('exam_results', NULL::text,
        ARRAY['id','student_id','academic_year_id','exam_type','result_status','mention','exam_session','recorded_by','created_at','updated_at']::text[],
        ARRAY[]::text[]),
      ('bulletin_generations', NULL::text,
        ARRAY['id','class_id','school_year_id','term_id','generation_type','expected_count','completed_count','status','created_at','completed_at']::text[],
        ARRAY[]::text[]),
      ('bulletins', NULL::text,
        ARRAY['id','student_id','class_id','school_year_id','term_id','term_start_date_snapshot','term_end_date_snapshot','unjustified_absences_count','unjustified_late_arrival_minutes','generation_id','school_scope_version','average','class_highest_average','class_lowest_average','class_average','total_points','total_coefficients','rank','mention','generated_at','created_at','updated_at']::text[],
        ARRAY['appreciation']::text[]),
      ('bulletin_lines', NULL::text,
        ARRAY['id','bulletin_id','subject_id','subject_name','coefficient','average','rank','created_at']::text[],
        ARRAY['teacher_comment']::text[]),
      ('accounting_categories', 'school_id',
        ARRAY['id','school_id','code','label','is_enabled','created_at','updated_at']::text[],
        ARRAY[]::text[]),
      ('accounting_tariffs', 'school_id',
        ARRAY['id','school_id','academic_year_id','class_id','class_from_id','class_to_id','category_id','label','amount','currency','is_enabled','created_by','created_at','updated_at']::text[],
        ARRAY[]::text[]),
      ('accounting_schedule_templates', 'school_id',
        ARRAY['id','school_id','academic_year_id','class_id','category_id','period_type','created_by','created_at','updated_at']::text[],
        ARRAY['installments']::text[]),
      ('accounting_fee_definitions', 'school_id',
        ARRAY['id','school_id','academic_year_id','student_id','category_id','class_id','label','amount','currency','is_mandatory','due_date','status','proposed_by','validated_by','validated_at','created_at','updated_at']::text[],
        ARRAY['description']::text[]),
      ('financial_obligations', 'school_id',
        ARRAY['id','school_id','student_id','academic_year_id','class_id','category_id','tariff_id','fee_definition_id','label','amount','currency','class_name_snapshot','enrollment_kind','status','created_by','created_at']::text[],
        ARRAY['source_key']::text[]),
      ('financial_installments', NULL::text,
        ARRAY['id','obligation_id','label','order_index','amount','due_date','created_at']::text[],
        ARRAY[]::text[]),
      ('financial_payments', 'school_id',
        ARRAY['id','school_id','student_id','academic_year_id','amount','currency','method','paid_at','status','recorded_by','created_at']::text[],
        ARRAY['reference','request_fingerprint','idempotency_key']::text[]),
      ('financial_payment_allocations', NULL::text,
        ARRAY['id','payment_id','obligation_id','installment_id','amount','created_at']::text[],
        ARRAY[]::text[]),
      ('financial_adjustments', NULL::text,
        ARRAY['id','payment_id','kind','amount','recorded_by','created_at']::text[],
        ARRAY['reason','source_key']::text[]),
      ('financial_adjustment_allocations', NULL::text,
        ARRAY['id','adjustment_id','payment_allocation_id','amount','created_at']::text[],
        ARRAY[]::text[]),
      ('financial_receipts', 'school_id',
        ARRAY['id','school_id','payment_id','receipt_number','issued_at']::text[],
        ARRAY['snapshot']::text[]),
      ('users', 'school_id',
        ARRAY['id','role','school_id','academic_year_id','is_deleted','deactivation_generation_aware','access_session_generation','created_at']::text[],
        ARRAY['uid','email','name','last_name','first_name','phone','gender','last_login_at','last_mobile_visit_at']::text[]),
      ('user_schools', 'school_id',
        ARRAY['id','user_id','school_id','role','is_active','created_at']::text[],
        ARRAY[]::text[]),
      ('local_auths', NULL::text,
        ARRAY['id','user_id','must_reset','created_at']::text[],
        ARRAY['password_hash','salt']::text[]),
      ('students', 'school_id',
        ARRAY['id','school_id','class_id','is_active','parent_id','school_admin_id','withdrawn_at','enrolled_at']::text[],
        ARRAY['first_name','last_name','matricule','birth_date','gender','photo_data','photo_mime_type','photo_updated_at']::text[]),
      ('student_academic_year_statuses', NULL::text,
        ARRAY['id','student_id','academic_year_id','status','created_at','updated_at']::text[],
        ARRAY[]::text[]),
      ('classes', 'school_id',
        ARRAY['id','school_id','academic_year_id','level_id','progression_code','name','teacher_id']::text[],
        ARRAY[]::text[]),
      ('class_teachers', 'school_id',
        ARRAY['id','class_id','teacher_id','school_id']::text[],
        ARRAY[]::text[]),
      ('teacher_subjects', 'school_id',
        ARRAY['id','teacher_id','school_id','subject_id','created_at']::text[],
        ARRAY[]::text[]),
      ('teacher_class_subjects', 'school_id',
        ARRAY['id','teacher_id','school_id','class_id','subject_id','is_active','created_at','updated_at']::text[],
        ARRAY[]::text[]),
      ('class_homeroom_assignments', 'school_id',
        ARRAY['id','school_id','class_id','teacher_id','created_at','updated_at']::text[],
        ARRAY[]::text[]),
      ('absences', NULL::text,
        ARRAY['id','student_id','class_id','teaching_assignment_id','date','period','subject_id','start_time','end_time','is_justified','justification_status','reviewed_by','reviewed_at','declaration_id','created_at']::text[],
        ARRAY['justification_reason','rejection_reason']::text[]),
      ('absence_declarations', NULL::text,
        ARRAY['id','student_id','parent_id','date','start_time','end_time','status','reviewed_by','reviewed_at','created_at','updated_at']::text[],
        ARRAY['reason','rejection_reason']::text[]),
      ('absence_justifications', NULL::text,
        ARRAY['id','absence_id','uploaded_by','uploaded_at','created_at','mime_type','file_size']::text[],
        ARRAY['file_name','file_path']::text[]),
      ('late_arrivals', NULL::text,
        ARRAY['id','student_id','class_id','teaching_assignment_id','date','period','expected_start_time','arrival_time','late_minutes','created_by','created_at','updated_at']::text[],
        ARRAY['reason']::text[]),
      ('late_arrival_justifications', NULL::text,
        ARRAY['id','late_arrival_id','submitted_by','status','reviewed_by','reviewed_at','revision','created_at','updated_at']::text[],
        ARRAY['justification_reason','rejection_reason']::text[]),
      ('late_arrival_justification_files', NULL::text,
        ARRAY['id','justification_id','uploaded_by','uploaded_at','mime_type','file_size']::text[],
        ARRAY['file_name','file_path']::text[]),
      ('teacher_control_sessions', 'school_id',
        ARRAY['id','school_id','teacher_id','teacher_user_id','teaching_assignment_id','class_teacher_association_id','teacher_subject_association_id','class_id','subject_id','regularization_request_id','start_source','regularization_origin','status','started_at','start_distance_meters','start_accuracy_meters','start_geofence_radius_meters','validated_ended_at','end_source','end_distance_meters','end_accuracy_meters','end_geofence_radius_meters','closed_at','closed_by_user_id','hourly_rate_xof_snapshot','created_at','updated_at']::text[],
        ARRAY['school_name_snapshot','teacher_name_snapshot','class_name_snapshot','subject_name_snapshot','closed_by_name_snapshot','close_reason']::text[]),
      ('teacher_control_regularization_requests', 'school_id',
        ARRAY['id','session_id','school_id','teacher_id','request_type','class_id','subject_id','reference_started_at','declared_started_at','proposed_ended_at','incident_type','status','submitted_by_user_id','created_at','updated_at']::text[],
        ARRAY['school_name_snapshot','teacher_name_snapshot','class_name_snapshot','subject_name_snapshot','submitted_by_name_snapshot','reason','description','technical_details','gps_latitude','gps_longitude','gps_accuracy_meters']::text[]),
      ('teacher_control_regularization_decisions', 'school_id',
        ARRAY['id','request_id','session_id','school_id','decision','previous_proposed_ended_at','previous_proposed_started_at','decided_started_at','decided_ended_at','actor_user_id','actor_role','created_at']::text[],
        ARRAY['school_name_snapshot','reason','actor_name_snapshot']::text[]),
      ('teacher_control_hourly_rates', 'school_id',
        ARRAY['id','school_id','teacher_id','hourly_rate_xof','updated_by_user_id','created_at','updated_at']::text[],
        ARRAY['school_name_snapshot','teacher_name_snapshot','updated_by_name_snapshot']::text[]),
      ('teacher_control_gps_settings', 'school_id',
        ARRAY['id','school_id','is_enabled','geofence_radius_meters','max_gps_accuracy_meters','updated_by_user_id','created_at','updated_at']::text[],
        ARRAY['school_name_snapshot','latitude','longitude','updated_by_name_snapshot']::text[]),
      ('audit_events', 'school_id',
        ARRAY['id','school_id']::text[],
        ARRAY['actor_user_id','actor_role','actor_email','actor_name','action','resource_type','resource_id','active_function_id','active_function_name','school_name_snapshot','occurred_at','module','result','source','before_values','after_values','ip_address','user_agent','correlation_id','reason','description','created_at']::text[]),
      ('user_login_events', 'school_id',
        ARRAY['id','school_id']::text[],
        ARRAY['user_id','role','login_at','client_type','actor_name_snapshot','actor_email_snapshot','school_name_snapshot','active_function_id','active_function_name','occurred_at','result','source','ip_address','user_agent','correlation_id']::text[]),
      ('grade_history', NULL::text,
        ARRAY['id','grade_id']::text[],
        ARRAY['old_value','new_value','changed_by','changed_at']::text[]),
      ('teacher_control_audit_events', 'school_id',
        ARRAY['id','school_id']::text[],
        ARRAY['actor_user_id','actor_role','actor_email_snapshot','actor_name_snapshot','action','resource_type','resource_id','before_values','after_values','reason','created_at']::text[]),
      ('late_arrival_justification_events', NULL::text,
        ARRAY['id','justification_id']::text[],
        ARRAY['revision','action','from_status','to_status','reason','actor_user_id','actor_role','actor_email','actor_name','occurred_at']::text[])
    ) AS policies(table_name, school_column, value_columns, redacted_columns)
  LOOP
    v_relation := pg_catalog.to_regclass(pg_catalog.format('public.%I', v_policy.table_name));

    IF v_relation IS NULL AND v_policy.table_name = 'grade_history' THEN
      CONTINUE;
    END IF;
    IF v_relation IS NULL THEN
      RAISE EXCEPTION 'Required table public.% is missing', v_policy.table_name;
    END IF;

    v_table_count := v_table_count + 1;
    IF NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_class c
      WHERE c.oid = v_relation
        AND c.relkind IN ('r', 'p')
    ) THEN
      RAISE EXCEPTION 'Expected public.% to be a table or partitioned table', v_policy.table_name;
    END IF;

    FOREACH v_column IN ARRAY (
      v_policy.value_columns
      || v_policy.redacted_columns
      || CASE
        WHEN v_policy.school_column IS NULL THEN ARRAY[]::text[]
        ELSE ARRAY[v_policy.school_column]::text[]
      END
    )
    LOOP
      IF v_policy.table_name = 'evaluations'
         AND v_column = 'is_archived'
         AND NOT EXISTS (
           SELECT 1
           FROM pg_catalog.pg_attribute a
           WHERE a.attrelid = v_relation
             AND a.attname = v_column
             AND a.attnum > 0
             AND NOT a.attisdropped
         ) THEN
        CONTINUE;
      END IF;

      IF NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_attribute a
        WHERE a.attrelid = v_relation
          AND a.attname = v_column
          AND a.attnum > 0
          AND NOT a.attisdropped
      ) THEN
        RAISE EXCEPTION 'Required column public.%.% is missing', v_policy.table_name, v_column;
      END IF;
    END LOOP;

    IF v_policy.school_column IS NOT NULL AND NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_attribute a
      WHERE a.attrelid = v_relation
        AND a.attname = v_policy.school_column
        AND a.atttypid = 'integer'::regtype
        AND a.attnum > 0
        AND NOT a.attisdropped
    ) THEN
      RAISE EXCEPTION 'Expected public.%.% to be an integer column',
        v_policy.table_name, v_policy.school_column;
    END IF;
  END LOOP;

  IF v_table_count NOT IN (42, 43) THEN
    RAISE EXCEPTION 'Expected 42 or 43 audited tables (grade_history is optional); found %', v_table_count;
  END IF;
END
$preflight$;

CREATE SCHEMA IF NOT EXISTS technical_audit AUTHORIZATION ecoletrack_history_owner;

DO $schema_owner$
DECLARE
  v_expected_owner oid;
  v_actual_owner oid;
BEGIN
  SELECT oid INTO v_expected_owner
  FROM pg_catalog.pg_roles
  WHERE rolname = 'ecoletrack_history_owner';

  SELECT nspowner INTO v_actual_owner
  FROM pg_catalog.pg_namespace
  WHERE nspname = 'technical_audit';

  IF v_actual_owner IS DISTINCT FROM v_expected_owner THEN
    RAISE EXCEPTION 'Schema technical_audit must be owned by ecoletrack_history_owner';
  END IF;
END
$schema_owner$;

CREATE TABLE IF NOT EXISTS technical_audit.db_change_events (
  event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  occurred_at timestamp with time zone NOT NULL,
  session_user_name name NOT NULL,
  account_classification text NOT NULL CHECK (
    account_classification IN ('APPLICATION_ROLE', 'MAINTENANCE_ROLE')
  ),
  active_role_setting text,
  database_name name NOT NULL,
  table_schema name NOT NULL,
  table_name name NOT NULL,
  operation text NOT NULL CHECK (operation IN ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')),
  resource_id bigint,
  school_id bigint,
  before_values jsonb,
  after_values jsonb,
  changed_fields text[] NOT NULL,
  client_address inet,
  application_name text,
  backend_pid integer NOT NULL,
  transaction_id bigint NOT NULL
);

DO $journal_shape$
DECLARE
  v_expected_count integer := 18;
  v_actual_count integer;
  v_expected_column record;
  v_actual_type text;
  v_actual_not_null boolean;
  v_actual_identity "char";
BEGIN
  SELECT count(*)::integer
    INTO v_actual_count
  FROM pg_catalog.pg_attribute a
  WHERE a.attrelid = 'technical_audit.db_change_events'::regclass
    AND a.attnum > 0
    AND NOT a.attisdropped;

  IF v_actual_count <> v_expected_count THEN
    RAISE EXCEPTION 'technical_audit.db_change_events has % columns; expected %',
      v_actual_count, v_expected_count;
  END IF;

  FOR v_expected_column IN
    SELECT *
    FROM (VALUES
      ('event_id', 'bigint', true),
      ('occurred_at', 'timestamp with time zone', true),
      ('session_user_name', 'name', true),
      ('account_classification', 'text', true),
      ('active_role_setting', 'text', false),
      ('database_name', 'name', true),
      ('table_schema', 'name', true),
      ('table_name', 'name', true),
      ('operation', 'text', true),
      ('resource_id', 'bigint', false),
      ('school_id', 'bigint', false),
      ('before_values', 'jsonb', false),
      ('after_values', 'jsonb', false),
      ('changed_fields', 'text[]', true),
      ('client_address', 'inet', false),
      ('application_name', 'text', false),
      ('backend_pid', 'integer', true),
      ('transaction_id', 'bigint', true)
    ) AS expected(column_name, data_type, not_null)
  LOOP
    SELECT pg_catalog.format_type(a.atttypid, a.atttypmod), a.attnotnull, a.attidentity
      INTO v_actual_type, v_actual_not_null, v_actual_identity
    FROM pg_catalog.pg_attribute a
    WHERE a.attrelid = 'technical_audit.db_change_events'::regclass
      AND a.attname = v_expected_column.column_name
      AND a.attnum > 0
      AND NOT a.attisdropped;

    IF v_actual_type IS DISTINCT FROM v_expected_column.data_type
       OR v_actual_not_null IS DISTINCT FROM v_expected_column.not_null THEN
      RAISE EXCEPTION 'Unexpected type or nullability for technical_audit.db_change_events.%: % NOT NULL=%',
        v_expected_column.column_name, v_actual_type, v_actual_not_null;
    END IF;
  END LOOP;

  SELECT a.attidentity
    INTO v_actual_identity
  FROM pg_catalog.pg_attribute a
  WHERE a.attrelid = 'technical_audit.db_change_events'::regclass
    AND a.attname = 'event_id'
    AND a.attnum > 0
    AND NOT a.attisdropped;

  IF v_actual_identity <> 'a' THEN
    RAISE EXCEPTION 'technical_audit.db_change_events.event_id must be GENERATED ALWAYS AS IDENTITY';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint c
    WHERE c.conrelid = 'technical_audit.db_change_events'::regclass
      AND c.contype = 'p'
  ) THEN
    RAISE EXCEPTION 'technical_audit.db_change_events must have a primary key';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint c
    WHERE c.conrelid = 'technical_audit.db_change_events'::regclass
      AND c.conname = 'db_change_events_operation_check'
      AND c.contype = 'c'
  ) THEN
    RAISE EXCEPTION 'technical_audit.db_change_events operation check is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint c
    WHERE c.conrelid = 'technical_audit.db_change_events'::regclass
    AND c.conname = 'db_change_events_account_classification_check'
    AND c.contype = 'c'
  ) THEN
    RAISE EXCEPTION 'technical_audit.db_change_events account classification check is missing';
  END IF;
END
$journal_shape$;

CREATE INDEX IF NOT EXISTS db_change_events_occurred_at_idx
  ON technical_audit.db_change_events (occurred_at DESC);
CREATE INDEX IF NOT EXISTS db_change_events_resource_idx
  ON technical_audit.db_change_events (table_schema, table_name, resource_id, occurred_at DESC);

CREATE OR REPLACE FUNCTION technical_audit.reject_journal_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, technical_audit
AS $reject$
BEGIN
  RAISE EXCEPTION 'Technical database journal is append-only'
    USING ERRCODE = '55000';
END
$reject$;

DO $journal_guard$
DECLARE
  v_trigger record;
BEGIN
  FOR v_trigger IN
    SELECT tgname, tgfoid, tgtype
    FROM pg_catalog.pg_trigger
    WHERE tgrelid = 'technical_audit.db_change_events'::regclass
      AND NOT tgisinternal
      AND tgname IN ('db_change_events_append_only_row', 'db_change_events_no_truncate')
  LOOP
    IF v_trigger.tgname = 'db_change_events_append_only_row'
       AND (v_trigger.tgfoid <> 'technical_audit.reject_journal_mutation()'::regprocedure
         OR v_trigger.tgtype <> 27) THEN
      RAISE EXCEPTION 'Unexpected definition for technical journal row guard';
    END IF;
    IF v_trigger.tgname = 'db_change_events_no_truncate'
       AND (v_trigger.tgfoid <> 'technical_audit.reject_journal_mutation()'::regprocedure
         OR v_trigger.tgtype <> 34) THEN
      RAISE EXCEPTION 'Unexpected definition for technical journal TRUNCATE guard';
    END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger
    WHERE tgrelid = 'technical_audit.db_change_events'::regclass
      AND tgname = 'db_change_events_append_only_row'
      AND NOT tgisinternal
  ) THEN
    CREATE TRIGGER db_change_events_append_only_row
      BEFORE UPDATE OR DELETE ON technical_audit.db_change_events
      FOR EACH ROW EXECUTE FUNCTION technical_audit.reject_journal_mutation();
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger
    WHERE tgrelid = 'technical_audit.db_change_events'::regclass
      AND tgname = 'db_change_events_no_truncate'
      AND NOT tgisinternal
  ) THEN
    CREATE TRIGGER db_change_events_no_truncate
      BEFORE TRUNCATE ON technical_audit.db_change_events
      FOR EACH STATEMENT EXECUTE FUNCTION technical_audit.reject_journal_mutation();
  END IF;

  ALTER TABLE technical_audit.db_change_events
    ENABLE ALWAYS TRIGGER db_change_events_append_only_row;
  ALTER TABLE technical_audit.db_change_events
    ENABLE ALWAYS TRIGGER db_change_events_no_truncate;
END
$journal_guard$;

ALTER FUNCTION technical_audit.reject_journal_mutation() OWNER TO ecoletrack_history_owner;
REVOKE ALL ON FUNCTION technical_audit.reject_journal_mutation() FROM PUBLIC;

CREATE OR REPLACE FUNCTION technical_audit.capture_truncate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, technical_audit
AS $capture_truncate$
BEGIN
  INSERT INTO technical_audit.db_change_events (
    occurred_at, session_user_name, account_classification, active_role_setting, database_name,
    table_schema, table_name, operation, resource_id, school_id,
    before_values, after_values, changed_fields, client_address,
    application_name, backend_pid, transaction_id
  )
  VALUES (
    pg_catalog.clock_timestamp(),
    session_user,
    CASE
      WHEN session_user IN (
        'ecole_admin', 'ecoletrack_web_runtime', 'ecoletrack_mobile_runtime'
      ) THEN 'APPLICATION_ROLE'
      ELSE 'MAINTENANCE_ROLE'
    END,
    NULLIF(NULLIF(pg_catalog.current_setting('role', true), 'none'), ''),
    pg_catalog.current_database(),
    TG_TABLE_SCHEMA,
    TG_TABLE_NAME,
    'TRUNCATE',
    NULL,
    NULL,
    NULL,
    NULL,
    ARRAY[]::text[],
    pg_catalog.inet_client_addr(),
    pg_catalog.current_setting('application_name', true),
    pg_catalog.pg_backend_pid(),
    pg_catalog.txid_current()
  );
  RETURN NULL;
END
$capture_truncate$;

DO $create_capture_triggers$
DECLARE
  v_policy record;
  v_relation oid;
  v_function_name text;
  v_old_pairs text;
  v_new_pairs text;
  v_redacted_update_cases text;
  v_redacted_insert_cases text;
  v_redacted_delete_cases text;
  v_old_json text;
  v_new_json text;
  v_value_columns text[];
  v_school_old text;
  v_school_new text;
  v_capture_source text;
  v_trigger record;
  v_row_trigger_name text;
  v_truncate_trigger_name text;
BEGIN
  FOR v_policy IN
    SELECT *
    FROM (VALUES
      ('grades', NULL::text,
        ARRAY['id','evaluation_id','student_id','score','edit_count','created_at','updated_at']::text[],
        ARRAY['remarks']::text[]),
      ('evaluations', 'school_id',
        ARRAY['id','school_id','class_id','publication_id','teacher_id','term_id','subject_id','subject','title','type','sequence_number','generated_name','coefficient','max_score','count_in_bulletin','date','created_at','is_archived']::text[],
        ARRAY[]::text[]),
      ('exam_results', NULL::text,
        ARRAY['id','student_id','academic_year_id','exam_type','result_status','mention','exam_session','recorded_by','created_at','updated_at']::text[],
        ARRAY[]::text[]),
      ('bulletin_generations', NULL::text,
        ARRAY['id','class_id','school_year_id','term_id','generation_type','expected_count','completed_count','status','created_at','completed_at']::text[],
        ARRAY[]::text[]),
      ('bulletins', NULL::text,
        ARRAY['id','student_id','class_id','school_year_id','term_id','term_start_date_snapshot','term_end_date_snapshot','unjustified_absences_count','unjustified_late_arrival_minutes','generation_id','school_scope_version','average','class_highest_average','class_lowest_average','class_average','total_points','total_coefficients','rank','mention','generated_at','created_at','updated_at']::text[],
        ARRAY['appreciation']::text[]),
      ('bulletin_lines', NULL::text,
        ARRAY['id','bulletin_id','subject_id','subject_name','coefficient','average','rank','created_at']::text[],
        ARRAY['teacher_comment']::text[]),
      ('accounting_categories', 'school_id',
        ARRAY['id','school_id','code','label','is_enabled','created_at','updated_at']::text[],
        ARRAY[]::text[]),
      ('accounting_tariffs', 'school_id',
        ARRAY['id','school_id','academic_year_id','class_id','class_from_id','class_to_id','category_id','label','amount','currency','is_enabled','created_by','created_at','updated_at']::text[],
        ARRAY[]::text[]),
      ('accounting_schedule_templates', 'school_id',
        ARRAY['id','school_id','academic_year_id','class_id','category_id','period_type','created_by','created_at','updated_at']::text[],
        ARRAY['installments']::text[]),
      ('accounting_fee_definitions', 'school_id',
        ARRAY['id','school_id','academic_year_id','student_id','category_id','class_id','label','amount','currency','is_mandatory','due_date','status','proposed_by','validated_by','validated_at','created_at','updated_at']::text[],
        ARRAY['description']::text[]),
      ('financial_obligations', 'school_id',
        ARRAY['id','school_id','student_id','academic_year_id','class_id','category_id','tariff_id','fee_definition_id','label','amount','currency','class_name_snapshot','enrollment_kind','status','created_by','created_at']::text[],
        ARRAY['source_key']::text[]),
      ('financial_installments', NULL::text,
        ARRAY['id','obligation_id','label','order_index','amount','due_date','created_at']::text[],
        ARRAY[]::text[]),
      ('financial_payments', 'school_id',
        ARRAY['id','school_id','student_id','academic_year_id','amount','currency','method','paid_at','status','recorded_by','created_at']::text[],
        ARRAY['reference','request_fingerprint','idempotency_key']::text[]),
      ('financial_payment_allocations', NULL::text,
        ARRAY['id','payment_id','obligation_id','installment_id','amount','created_at']::text[],
        ARRAY[]::text[]),
      ('financial_adjustments', NULL::text,
        ARRAY['id','payment_id','kind','amount','recorded_by','created_at']::text[],
        ARRAY['reason','source_key']::text[]),
      ('financial_adjustment_allocations', NULL::text,
        ARRAY['id','adjustment_id','payment_allocation_id','amount','created_at']::text[],
        ARRAY[]::text[]),
      ('financial_receipts', 'school_id',
        ARRAY['id','school_id','payment_id','receipt_number','issued_at']::text[],
        ARRAY['snapshot']::text[]),
      ('users', 'school_id',
        ARRAY['id','role','school_id','academic_year_id','is_deleted','deactivation_generation_aware','access_session_generation','created_at']::text[],
        ARRAY['uid','email','name','last_name','first_name','phone','gender','last_login_at','last_mobile_visit_at']::text[]),
      ('user_schools', 'school_id',
        ARRAY['id','user_id','school_id','role','is_active','created_at']::text[],
        ARRAY[]::text[]),
      ('local_auths', NULL::text,
        ARRAY['id','user_id','must_reset','created_at']::text[],
        ARRAY['password_hash','salt']::text[]),
      ('students', 'school_id',
        ARRAY['id','school_id','class_id','is_active','parent_id','school_admin_id','withdrawn_at','enrolled_at']::text[],
        ARRAY['first_name','last_name','matricule','birth_date','gender','photo_data','photo_mime_type','photo_updated_at']::text[]),
      ('student_academic_year_statuses', NULL::text,
        ARRAY['id','student_id','academic_year_id','status','created_at','updated_at']::text[],
        ARRAY[]::text[]),
      ('classes', 'school_id',
        ARRAY['id','school_id','academic_year_id','level_id','progression_code','name','teacher_id']::text[],
        ARRAY[]::text[]),
      ('class_teachers', 'school_id',
        ARRAY['id','class_id','teacher_id','school_id']::text[],
        ARRAY[]::text[]),
      ('teacher_subjects', 'school_id',
        ARRAY['id','teacher_id','school_id','subject_id','created_at']::text[],
        ARRAY[]::text[]),
      ('teacher_class_subjects', 'school_id',
        ARRAY['id','teacher_id','school_id','class_id','subject_id','is_active','created_at','updated_at']::text[],
        ARRAY[]::text[]),
      ('class_homeroom_assignments', 'school_id',
        ARRAY['id','school_id','class_id','teacher_id','created_at','updated_at']::text[],
        ARRAY[]::text[]),
      ('absences', NULL::text,
        ARRAY['id','student_id','class_id','teaching_assignment_id','date','period','subject_id','start_time','end_time','is_justified','justification_status','reviewed_by','reviewed_at','declaration_id','created_at']::text[],
        ARRAY['justification_reason','rejection_reason']::text[]),
      ('absence_declarations', NULL::text,
        ARRAY['id','student_id','parent_id','date','start_time','end_time','status','reviewed_by','reviewed_at','created_at','updated_at']::text[],
        ARRAY['reason','rejection_reason']::text[]),
      ('absence_justifications', NULL::text,
        ARRAY['id','absence_id','uploaded_by','uploaded_at','created_at','mime_type','file_size']::text[],
        ARRAY['file_name','file_path']::text[]),
      ('late_arrivals', NULL::text,
        ARRAY['id','student_id','class_id','teaching_assignment_id','date','period','expected_start_time','arrival_time','late_minutes','created_by','created_at','updated_at']::text[],
        ARRAY['reason']::text[]),
      ('late_arrival_justifications', NULL::text,
        ARRAY['id','late_arrival_id','submitted_by','status','reviewed_by','reviewed_at','revision','created_at','updated_at']::text[],
        ARRAY['justification_reason','rejection_reason']::text[]),
      ('late_arrival_justification_files', NULL::text,
        ARRAY['id','justification_id','uploaded_by','uploaded_at','mime_type','file_size']::text[],
        ARRAY['file_name','file_path']::text[]),
      ('teacher_control_sessions', 'school_id',
        ARRAY['id','school_id','teacher_id','teacher_user_id','teaching_assignment_id','class_teacher_association_id','teacher_subject_association_id','class_id','subject_id','regularization_request_id','start_source','regularization_origin','status','started_at','start_distance_meters','start_accuracy_meters','start_geofence_radius_meters','validated_ended_at','end_source','end_distance_meters','end_accuracy_meters','end_geofence_radius_meters','closed_at','closed_by_user_id','hourly_rate_xof_snapshot','created_at','updated_at']::text[],
        ARRAY['school_name_snapshot','teacher_name_snapshot','class_name_snapshot','subject_name_snapshot','closed_by_name_snapshot','close_reason']::text[]),
      ('teacher_control_regularization_requests', 'school_id',
        ARRAY['id','session_id','school_id','teacher_id','request_type','class_id','subject_id','reference_started_at','declared_started_at','proposed_ended_at','incident_type','status','submitted_by_user_id','created_at','updated_at']::text[],
        ARRAY['school_name_snapshot','teacher_name_snapshot','class_name_snapshot','subject_name_snapshot','submitted_by_name_snapshot','reason','description','technical_details','gps_latitude','gps_longitude','gps_accuracy_meters']::text[]),
      ('teacher_control_regularization_decisions', 'school_id',
        ARRAY['id','request_id','session_id','school_id','decision','previous_proposed_ended_at','previous_proposed_started_at','decided_started_at','decided_ended_at','actor_user_id','actor_role','created_at']::text[],
        ARRAY['school_name_snapshot','reason','actor_name_snapshot']::text[]),
      ('teacher_control_hourly_rates', 'school_id',
        ARRAY['id','school_id','teacher_id','hourly_rate_xof','updated_by_user_id','created_at','updated_at']::text[],
        ARRAY['school_name_snapshot','teacher_name_snapshot','updated_by_name_snapshot']::text[]),
      ('teacher_control_gps_settings', 'school_id',
        ARRAY['id','school_id','is_enabled','geofence_radius_meters','max_gps_accuracy_meters','updated_by_user_id','created_at','updated_at']::text[],
        ARRAY['school_name_snapshot','latitude','longitude','updated_by_name_snapshot']::text[]),
      ('audit_events', 'school_id',
        ARRAY['id','school_id']::text[],
        ARRAY['actor_user_id','actor_role','actor_email','actor_name','action','resource_type','resource_id','active_function_id','active_function_name','school_name_snapshot','occurred_at','module','result','source','before_values','after_values','ip_address','user_agent','correlation_id','reason','description','created_at']::text[]),
      ('user_login_events', 'school_id',
        ARRAY['id','school_id']::text[],
        ARRAY['user_id','role','login_at','client_type','actor_name_snapshot','actor_email_snapshot','school_name_snapshot','active_function_id','active_function_name','occurred_at','result','source','ip_address','user_agent','correlation_id']::text[]),
      ('grade_history', NULL::text,
        ARRAY['id','grade_id']::text[],
        ARRAY['old_value','new_value','changed_by','changed_at']::text[]),
      ('teacher_control_audit_events', 'school_id',
        ARRAY['id','school_id']::text[],
        ARRAY['actor_user_id','actor_role','actor_email_snapshot','actor_name_snapshot','action','resource_type','resource_id','before_values','after_values','reason','created_at']::text[]),
      ('late_arrival_justification_events', NULL::text,
        ARRAY['id','justification_id']::text[],
        ARRAY['revision','action','from_status','to_status','reason','actor_user_id','actor_role','actor_email','actor_name','occurred_at']::text[])
    ) AS policies(table_name, school_column, value_columns, redacted_columns)
  LOOP
    v_relation := pg_catalog.to_regclass(pg_catalog.format('public.%I', v_policy.table_name));
    IF v_relation IS NULL AND v_policy.table_name = 'grade_history' THEN
      CONTINUE;
    END IF;

    v_function_name := 'capture_' || v_policy.table_name || '_row';
    v_row_trigger_name := 'db_audit_row_' || v_policy.table_name;
    v_truncate_trigger_name := 'db_audit_truncate_' || v_policy.table_name;
    v_value_columns := v_policy.value_columns;

    IF v_policy.table_name = 'evaluations'
       AND NOT EXISTS (
         SELECT 1
         FROM pg_catalog.pg_attribute a
         WHERE a.attrelid = v_relation
           AND a.attname = 'is_archived'
           AND a.attnum > 0
           AND NOT a.attisdropped
       ) THEN
      v_value_columns := pg_catalog.array_remove(v_value_columns, 'is_archived');
    END IF;

    SELECT pg_catalog.string_agg(
      pg_catalog.format('%L, OLD.%I', column_name, column_name),
      ', ' ORDER BY ordinal_position
    )
      INTO v_old_pairs
    FROM pg_catalog.unnest(v_value_columns) WITH ORDINALITY AS c(column_name, ordinal_position);

    SELECT pg_catalog.string_agg(
      pg_catalog.format('%L, NEW.%I', column_name, column_name),
      ', ' ORDER BY ordinal_position
    )
      INTO v_new_pairs
    FROM pg_catalog.unnest(v_value_columns) WITH ORDINALITY AS c(column_name, ordinal_position);

    SELECT pg_catalog.string_agg(
      pg_catalog.format(
        'CASE WHEN OLD.%I IS DISTINCT FROM NEW.%I THEN %L::text END',
        column_name, column_name, column_name
      ),
      ', ' ORDER BY ordinal_position
    )
      INTO v_redacted_update_cases
    FROM pg_catalog.unnest(v_policy.redacted_columns) WITH ORDINALITY AS c(column_name, ordinal_position);

    SELECT pg_catalog.string_agg(
      pg_catalog.format('CASE WHEN NEW.%I IS NOT NULL THEN %L::text END', column_name, column_name),
      ', ' ORDER BY ordinal_position
    )
      INTO v_redacted_insert_cases
    FROM pg_catalog.unnest(v_policy.redacted_columns) WITH ORDINALITY AS c(column_name, ordinal_position);

    SELECT pg_catalog.string_agg(
      pg_catalog.format('CASE WHEN OLD.%I IS NOT NULL THEN %L::text END', column_name, column_name),
      ', ' ORDER BY ordinal_position
    )
      INTO v_redacted_delete_cases
    FROM pg_catalog.unnest(v_policy.redacted_columns) WITH ORDINALITY AS c(column_name, ordinal_position);

    v_old_json := CASE
      WHEN v_old_pairs IS NULL THEN 'pg_catalog.jsonb_build_object()'
      ELSE 'pg_catalog.jsonb_build_object(' || v_old_pairs || ')'
    END;
    v_new_json := CASE
      WHEN v_new_pairs IS NULL THEN 'pg_catalog.jsonb_build_object()'
      ELSE 'pg_catalog.jsonb_build_object(' || v_new_pairs || ')'
    END;
    v_redacted_update_cases := CASE
      WHEN v_redacted_update_cases IS NULL THEN 'ARRAY[]::text[]'
      ELSE 'pg_catalog.array_remove(ARRAY[' || v_redacted_update_cases || '], NULL::text)'
    END;
    v_redacted_insert_cases := CASE
      WHEN v_redacted_insert_cases IS NULL THEN 'ARRAY[]::text[]'
      ELSE 'pg_catalog.array_remove(ARRAY[' || v_redacted_insert_cases || '], NULL::text)'
    END;
    v_redacted_delete_cases := CASE
      WHEN v_redacted_delete_cases IS NULL THEN 'ARRAY[]::text[]'
      ELSE 'pg_catalog.array_remove(ARRAY[' || v_redacted_delete_cases || '], NULL::text)'
    END;
    v_school_old := CASE
      WHEN v_policy.school_column IS NULL THEN 'NULL::bigint'
      ELSE 'OLD.' || pg_catalog.quote_ident(v_policy.school_column) || '::bigint'
    END;
    v_school_new := CASE
      WHEN v_policy.school_column IS NULL THEN 'NULL::bigint'
      ELSE 'NEW.' || pg_catalog.quote_ident(v_policy.school_column) || '::bigint'
    END;

    v_capture_source := pg_catalog.format($function$
      CREATE OR REPLACE FUNCTION technical_audit.%I()
      RETURNS trigger
      LANGUAGE plpgsql
      SECURITY DEFINER
      SET search_path = pg_catalog, technical_audit
      AS $capture$
      DECLARE
        v_resource_id bigint;
        v_school_id bigint;
        v_before_all jsonb := '{}'::jsonb;
        v_after_all jsonb := '{}'::jsonb;
        v_before_values jsonb;
        v_after_values jsonb;
        v_changed_fields text[] := ARRAY[]::text[];
      BEGIN
        IF TG_OP = 'INSERT' THEN
          v_resource_id := NEW.id::bigint;
          v_school_id := %s;
          v_after_all := %s;
          SELECT COALESCE(pg_catalog.array_agg(field_name ORDER BY field_name), ARRAY[]::text[])
            INTO v_changed_fields
          FROM pg_catalog.jsonb_object_keys(v_after_all) AS keys(field_name);
          v_changed_fields := v_changed_fields || %s;
          v_after_values := v_after_all;

          INSERT INTO technical_audit.db_change_events (
            occurred_at, session_user_name, account_classification, active_role_setting, database_name,
            table_schema, table_name, operation, resource_id, school_id,
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
            v_resource_id, v_school_id, NULL, v_after_values, v_changed_fields,
            pg_catalog.inet_client_addr(),
            pg_catalog.current_setting('application_name', true),
            pg_catalog.pg_backend_pid(), pg_catalog.txid_current()
          );
          RETURN NEW;

        ELSIF TG_OP = 'UPDATE' THEN
          v_resource_id := NEW.id::bigint;
          v_school_id := %s;
          v_before_all := %s;
          v_after_all := %s;

          SELECT COALESCE(pg_catalog.array_agg(old_value.key ORDER BY old_value.key), ARRAY[]::text[])
            INTO v_changed_fields
          FROM pg_catalog.jsonb_each(v_before_all) AS old_value(key, value)
          JOIN pg_catalog.jsonb_each(v_after_all) AS new_value(key, value)
            USING (key)
          WHERE old_value.value IS DISTINCT FROM new_value.value;
          v_changed_fields := v_changed_fields || %s;

          IF pg_catalog.cardinality(v_changed_fields) = 0 THEN
            RETURN NEW;
          END IF;

          SELECT COALESCE(pg_catalog.jsonb_object_agg(entry.key, entry.value), '{}'::jsonb)
            INTO v_before_values
          FROM pg_catalog.jsonb_each(v_before_all) AS entry(key, value)
          WHERE entry.key = ANY(v_changed_fields);
          SELECT COALESCE(pg_catalog.jsonb_object_agg(entry.key, entry.value), '{}'::jsonb)
            INTO v_after_values
          FROM pg_catalog.jsonb_each(v_after_all) AS entry(key, value)
          WHERE entry.key = ANY(v_changed_fields);

          INSERT INTO technical_audit.db_change_events (
            occurred_at, session_user_name, account_classification, active_role_setting, database_name,
            table_schema, table_name, operation, resource_id, school_id,
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
            v_resource_id, v_school_id,
            NULLIF(v_before_values, '{}'::jsonb),
            NULLIF(v_after_values, '{}'::jsonb),
            v_changed_fields, pg_catalog.inet_client_addr(),
            pg_catalog.current_setting('application_name', true),
            pg_catalog.pg_backend_pid(), pg_catalog.txid_current()
          );
          RETURN NEW;

        ELSIF TG_OP = 'DELETE' THEN
          v_resource_id := OLD.id::bigint;
          v_school_id := %s;
          v_before_all := %s;
          SELECT COALESCE(pg_catalog.array_agg(field_name ORDER BY field_name), ARRAY[]::text[])
            INTO v_changed_fields
          FROM pg_catalog.jsonb_object_keys(v_before_all) AS keys(field_name);
          v_changed_fields := v_changed_fields || %s;
          v_before_values := v_before_all;

          INSERT INTO technical_audit.db_change_events (
            occurred_at, session_user_name, account_classification, active_role_setting, database_name,
            table_schema, table_name, operation, resource_id, school_id,
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
            v_resource_id, v_school_id, v_before_values, NULL, v_changed_fields,
            pg_catalog.inet_client_addr(),
            pg_catalog.current_setting('application_name', true),
            pg_catalog.pg_backend_pid(), pg_catalog.txid_current()
          );
          RETURN OLD;
        END IF;

        RAISE EXCEPTION 'Unexpected operation %% for technical row audit', TG_OP;
      END
      $capture$;
      $function$,
      v_function_name,
      v_school_new,
      v_new_json,
      v_redacted_insert_cases,
      v_school_new,
      v_old_json,
      v_new_json,
      v_redacted_update_cases,
      v_school_old,
      v_old_json,
      v_redacted_delete_cases
    );

    EXECUTE v_capture_source;

    SELECT tgname, tgfoid, tgtype
      INTO v_trigger
    FROM pg_catalog.pg_trigger
    WHERE tgrelid = v_relation
      AND tgname = v_row_trigger_name
      AND NOT tgisinternal;

    IF FOUND THEN
      IF v_trigger.tgfoid <> pg_catalog.to_regprocedure(
        pg_catalog.format('technical_audit.%I()', v_function_name)
      ) OR v_trigger.tgtype <> 29 THEN
        RAISE EXCEPTION 'Unexpected definition for trigger % on public.%', v_row_trigger_name, v_policy.table_name;
      END IF;
      EXECUTE pg_catalog.format(
        'ALTER TABLE public.%I ENABLE ALWAYS TRIGGER %I',
        v_policy.table_name, v_row_trigger_name
      );
    ELSE
      EXECUTE pg_catalog.format(
        'CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON public.%I
         FOR EACH ROW EXECUTE FUNCTION technical_audit.%I()',
        v_row_trigger_name, v_policy.table_name, v_function_name
      );
      EXECUTE pg_catalog.format(
        'ALTER TABLE public.%I ENABLE ALWAYS TRIGGER %I',
        v_policy.table_name, v_row_trigger_name
      );
    END IF;

    SELECT tgname, tgfoid, tgtype
      INTO v_trigger
    FROM pg_catalog.pg_trigger
    WHERE tgrelid = v_relation
      AND tgname = v_truncate_trigger_name
      AND NOT tgisinternal;

    IF FOUND THEN
      IF v_trigger.tgfoid <> 'technical_audit.capture_truncate()'::regprocedure
         OR v_trigger.tgtype <> 32 THEN
        RAISE EXCEPTION 'Unexpected TRUNCATE trigger % on public.%', v_truncate_trigger_name, v_policy.table_name;
      END IF;
      EXECUTE pg_catalog.format(
        'ALTER TABLE public.%I ENABLE ALWAYS TRIGGER %I',
        v_policy.table_name, v_truncate_trigger_name
      );
    ELSE
      EXECUTE pg_catalog.format(
        'CREATE TRIGGER %I AFTER TRUNCATE ON public.%I
         FOR EACH STATEMENT EXECUTE FUNCTION technical_audit.capture_truncate()',
        v_truncate_trigger_name, v_policy.table_name
      );
      EXECUTE pg_catalog.format(
        'ALTER TABLE public.%I ENABLE ALWAYS TRIGGER %I',
        v_policy.table_name, v_truncate_trigger_name
      );
    END IF;

    EXECUTE pg_catalog.format(
      'ALTER FUNCTION technical_audit.%I() OWNER TO ecoletrack_history_owner',
      v_function_name
    );
    EXECUTE pg_catalog.format(
      'REVOKE ALL ON FUNCTION technical_audit.%I() FROM PUBLIC',
      v_function_name
    );
  END LOOP;
END
$create_capture_triggers$;

ALTER FUNCTION technical_audit.capture_truncate() OWNER TO ecoletrack_history_owner;
REVOKE ALL ON FUNCTION technical_audit.capture_truncate() FROM PUBLIC;

CREATE OR REPLACE FUNCTION technical_audit.reject_protected_truncate()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, technical_audit
AS $reject_truncate$
BEGIN
  RAISE EXCEPTION 'TRUNCATE is prohibited for protected teacher-control history'
    USING ERRCODE = '55000';
END
$reject_truncate$;

DO $preserve_teacher_history$
DECLARE
  v_table text;
  v_trigger_name text;
  v_relation oid;
  v_trigger record;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'teacher_control_sessions',
    'teacher_control_regularization_requests',
    'teacher_control_regularization_decisions'
  ]
  LOOP
    v_relation := pg_catalog.to_regclass(pg_catalog.format('public.%I', v_table));
    v_trigger_name := 'no_truncate_' || v_table;

    SELECT tgname, tgfoid, tgtype
      INTO v_trigger
    FROM pg_catalog.pg_trigger
    WHERE tgrelid = v_relation
      AND tgname = v_trigger_name
      AND NOT tgisinternal;

    IF FOUND THEN
      IF v_trigger.tgfoid <> 'technical_audit.reject_protected_truncate()'::regprocedure
         OR v_trigger.tgtype <> 34 THEN
        RAISE EXCEPTION 'Unexpected protected TRUNCATE trigger % on public.%', v_trigger_name, v_table;
      END IF;
    ELSE
      EXECUTE pg_catalog.format(
        'CREATE TRIGGER %I BEFORE TRUNCATE ON public.%I
         FOR EACH STATEMENT EXECUTE FUNCTION technical_audit.reject_protected_truncate()',
        v_trigger_name, v_table
      );
    END IF;

    EXECUTE pg_catalog.format(
      'ALTER TABLE public.%I ENABLE ALWAYS TRIGGER %I',
      v_table, v_trigger_name
    );
  END LOOP;
END
$preserve_teacher_history$;

ALTER FUNCTION technical_audit.reject_protected_truncate() OWNER TO ecoletrack_history_owner;
REVOKE ALL ON FUNCTION technical_audit.reject_protected_truncate() FROM PUBLIC;

ALTER TABLE technical_audit.db_change_events OWNER TO ecoletrack_history_owner;
REVOKE ALL ON SCHEMA technical_audit FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA technical_audit FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA technical_audit FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA technical_audit FROM PUBLIC;

DO $revoke_application_access$
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
      EXECUTE pg_catalog.format('REVOKE ALL ON SCHEMA technical_audit FROM %I', v_role);
      EXECUTE pg_catalog.format(
        'REVOKE ALL ON ALL TABLES IN SCHEMA technical_audit FROM %I',
        v_role
      );
      EXECUTE pg_catalog.format(
        'REVOKE ALL ON ALL SEQUENCES IN SCHEMA technical_audit FROM %I',
        v_role
      );
      EXECUTE pg_catalog.format(
        'REVOKE ALL ON ALL FUNCTIONS IN SCHEMA technical_audit FROM %I',
        v_role
      );
    END IF;
  END LOOP;
END
$revoke_application_access$;

DO $verify_private_acl$
DECLARE
  v_owner oid;
BEGIN
  SELECT oid INTO v_owner
  FROM pg_catalog.pg_roles
  WHERE rolname = 'ecoletrack_history_owner';

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_namespace n,
         LATERAL pg_catalog.aclexplode(
           COALESCE(n.nspacl, pg_catalog.acldefault('n', n.nspowner))
         ) AS privilege
    WHERE n.nspname = 'technical_audit'
      AND privilege.grantee <> v_owner
  ) THEN
    RAISE EXCEPTION 'technical_audit schema has privileges for roles other than its owner';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace,
         LATERAL pg_catalog.aclexplode(
           COALESCE(c.relacl, pg_catalog.acldefault(
             CASE
               WHEN c.relkind = 'S' THEN 's'::"char"
               ELSE 'r'::"char"
             END,
             c.relowner
           ))
         ) AS privilege
    WHERE n.nspname = 'technical_audit'
      AND privilege.grantee <> v_owner
  ) THEN
    RAISE EXCEPTION 'technical_audit relations have privileges for roles other than their owner';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace,
         LATERAL pg_catalog.aclexplode(
           COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))
         ) AS privilege
    WHERE n.nspname = 'technical_audit'
      AND privilege.grantee <> v_owner
  ) THEN
    RAISE EXCEPTION 'technical_audit functions have privileges for roles other than their owner';
  END IF;
END
$verify_private_acl$;

COMMIT;

-- Manual verification queries (do not execute as part of this migration):
-- SELECT event_id, occurred_at, session_user_name, account_classification, active_role_setting,
--        table_schema, table_name, operation, resource_id, school_id,
--        changed_fields, transaction_id
-- FROM technical_audit.db_change_events
-- ORDER BY event_id DESC
-- LIMIT 20;
--
-- SELECT n.nspname, c.relname, t.tgname, t.tgenabled,
--        p.proname, pg_catalog.pg_get_triggerdef(t.oid)
-- FROM pg_catalog.pg_trigger t
-- JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
-- JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
-- JOIN pg_catalog.pg_proc p ON p.oid = t.tgfoid
-- WHERE n.nspname = 'public'
--   AND t.tgname LIKE 'db_audit_%'
-- ORDER BY c.relname, t.tgname;
--
-- SELECT n.nspname, c.relname, t.tgname, t.tgenabled,
--        pg_catalog.pg_get_triggerdef(t.oid)
-- FROM pg_catalog.pg_trigger t
-- JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
-- JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
-- WHERE n.nspname = 'public'
--   AND t.tgname IN (
--     'audit_events_append_only_row',
--     'audit_events_append_only_truncate',
--     'user_login_events_append_only_row',
--     'user_login_events_append_only_truncate',
--     'teacher_control_audit_events_append_only',
--     'teacher_control_audit_events_no_truncate',
--     'late_arrival_justification_events_append_only',
--     'late_arrival_justification_events_no_truncate'
--   )
-- ORDER BY c.relname, t.tgname;
--
-- SELECT r.rolname, pg_catalog.has_schema_privilege(r.oid, 'technical_audit', 'USAGE') AS has_usage,
--        pg_catalog.has_table_privilege(r.oid, 'technical_audit.db_change_events', 'SELECT') AS can_select,
--        pg_catalog.has_table_privilege(r.oid, 'technical_audit.db_change_events', 'INSERT') AS can_insert,
--        pg_catalog.has_table_privilege(r.oid, 'technical_audit.db_change_events', 'UPDATE') AS can_update,
--        pg_catalog.has_table_privilege(r.oid, 'technical_audit.db_change_events', 'DELETE') AS can_delete,
--        pg_catalog.has_table_privilege(r.oid, 'technical_audit.db_change_events', 'TRUNCATE') AS can_truncate
-- FROM pg_catalog.pg_roles r
-- WHERE r.rolname IN ('ecole_admin', 'ecoletrack_web_runtime', 'ecoletrack_mobile_runtime');
