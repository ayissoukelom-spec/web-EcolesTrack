-- Add an auditable approval workflow without changing historical accounting rows.
BEGIN;

DO $preflight$
DECLARE
  v_owner oid;
  v_runtime_role_count integer;
BEGIN
  IF to_regclass('public.schools') IS NULL
     OR to_regclass('public.financial_payments') IS NULL
     OR to_regclass('public.financial_adjustments') IS NULL
     OR to_regclass('technical_audit.db_change_events') IS NULL THEN
    RAISE EXCEPTION 'A required accounting or technical-audit table is missing';
  END IF;

  SELECT oid INTO v_owner
  FROM pg_catalog.pg_roles
  WHERE rolname = 'ecoletrack_history_owner'
    AND NOT rolcanlogin
    AND NOT rolsuper;
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'Required non-login owner role ecoletrack_history_owner is missing';
  END IF;

  SELECT count(*)::integer INTO v_runtime_role_count
  FROM pg_catalog.pg_roles
  WHERE rolname IN ('ecoletrack_web_runtime', 'ecoletrack_mobile_runtime');
  IF v_runtime_role_count NOT IN (0, 2) THEN
    RAISE EXCEPTION 'Expected both runtime roles or neither; found %', v_runtime_role_count;
  END IF;
  IF v_runtime_role_count = 2 THEN
    IF pg_catalog.pg_has_role(
      'ecoletrack_mobile_runtime', 'ecoletrack_web_runtime', 'MEMBER'
    ) THEN
      RAISE EXCEPTION 'The mobile runtime role must not inherit web runtime privileges';
    END IF;
  END IF;
  IF v_runtime_role_count = 0 AND NOT EXISTS (
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
        OR pg_catalog.pg_has_role(app_role.oid, v_owner, 'MEMBER')
      )
  ) THEN
    RAISE EXCEPTION 'An application role is a superuser or a member of ecoletrack_history_owner';
  END IF;
END
$preflight$;

CREATE TABLE public.financial_adjustment_requests (
  id serial PRIMARY KEY,
  school_id integer NOT NULL REFERENCES public.schools(id) ON DELETE RESTRICT,
  payment_id integer NOT NULL REFERENCES public.financial_payments(id) ON DELETE RESTRICT,
  kind text NOT NULL,
  amount integer,
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  requested_by_user_id integer NOT NULL,
  requested_by_role text NOT NULL,
  requested_by_name text,
  requested_by_email text,
  requested_at timestamp with time zone NOT NULL DEFAULT now(),
  decided_by_user_id integer,
  decided_by_role text,
  decided_by_name text,
  decided_by_email text,
  decided_at timestamp with time zone,
  decision_reason text,
  idempotency_key text NOT NULL,
  resulting_adjustment_id integer REFERENCES public.financial_adjustments(id) ON DELETE RESTRICT,
  refund_confirmed_by_user_id integer,
  refund_confirmed_by_role text,
  refund_confirmed_by_name text,
  refund_confirmed_by_email text,
  refund_confirmed_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT financial_adjustment_requests_kind_check
    CHECK (kind IN ('cancellation', 'refund')),
  CONSTRAINT financial_adjustment_requests_amount_check
    CHECK (
      (kind = 'cancellation' AND amount IS NULL)
      OR (kind = 'refund' AND amount IS NOT NULL AND amount > 0)
    ),
  CONSTRAINT financial_adjustment_requests_status_check
    CHECK (status IN ('pending', 'approved', 'rejected')),
  CONSTRAINT financial_adjustment_requests_requester_check
    CHECK (requested_by_role = 'school_accountant'),
  CONSTRAINT financial_adjustment_requests_reason_check
    CHECK (
      length(btrim(reason)) BETWEEN 1 AND 500
      AND length(btrim(idempotency_key)) BETWEEN 1 AND 120
    ),
  CONSTRAINT financial_adjustment_requests_no_self_approval_check
    CHECK (decided_by_user_id IS NULL OR decided_by_user_id <> requested_by_user_id),
  CONSTRAINT financial_adjustment_requests_decision_check
    CHECK (
      (
        status = 'pending'
        AND decided_by_user_id IS NULL
        AND decided_by_role IS NULL
        AND decided_by_name IS NULL
        AND decided_by_email IS NULL
        AND decided_at IS NULL
        AND decision_reason IS NULL
        AND resulting_adjustment_id IS NULL
        AND refund_confirmed_by_user_id IS NULL
        AND refund_confirmed_by_role IS NULL
        AND refund_confirmed_by_name IS NULL
        AND refund_confirmed_by_email IS NULL
        AND refund_confirmed_at IS NULL
      )
      OR
      (
        status = 'rejected'
        AND decided_by_user_id IS NOT NULL
        AND decided_by_user_id <> requested_by_user_id
        AND decided_by_role IS NOT NULL
        AND decided_by_role = 'school_admin'
        AND decided_at IS NOT NULL
        AND decision_reason IS NOT NULL
        AND length(btrim(decision_reason)) BETWEEN 1 AND 500
        AND resulting_adjustment_id IS NULL
        AND refund_confirmed_by_user_id IS NULL
        AND refund_confirmed_by_role IS NULL
        AND refund_confirmed_by_name IS NULL
        AND refund_confirmed_by_email IS NULL
        AND refund_confirmed_at IS NULL
      )
      OR
      (
        status = 'approved'
        AND decided_by_user_id IS NOT NULL
        AND decided_by_user_id <> requested_by_user_id
        AND decided_by_role IS NOT NULL
        AND decided_by_role = 'school_admin'
        AND decided_at IS NOT NULL
        AND decision_reason IS NOT NULL
        AND length(btrim(decision_reason)) BETWEEN 1 AND 500
        AND (
          (
            kind = 'cancellation'
            AND resulting_adjustment_id IS NOT NULL
            AND refund_confirmed_by_user_id IS NULL
            AND refund_confirmed_by_role IS NULL
            AND refund_confirmed_by_name IS NULL
            AND refund_confirmed_by_email IS NULL
            AND refund_confirmed_at IS NULL
          )
          OR
          (
            kind = 'refund'
            AND (
              (
                resulting_adjustment_id IS NULL
                AND refund_confirmed_by_user_id IS NULL
                AND refund_confirmed_by_role IS NULL
                AND refund_confirmed_by_name IS NULL
                AND refund_confirmed_by_email IS NULL
                AND refund_confirmed_at IS NULL
              )
              OR
              (
                resulting_adjustment_id IS NOT NULL
                AND refund_confirmed_by_user_id IS NOT NULL
                AND refund_confirmed_by_role IS NOT NULL
                AND refund_confirmed_by_role = 'school_accountant'
                AND refund_confirmed_at IS NOT NULL
              )
            )
          )
        )
      )
    )
);

COMMENT ON COLUMN public.financial_adjustment_requests.requested_by_user_id IS
  'Immutable actor id snapshot; intentionally has no users FK so account deletion cannot erase history.';
COMMENT ON COLUMN public.financial_adjustment_requests.decided_by_user_id IS
  'Immutable actor id snapshot; intentionally has no users FK so account deletion cannot erase history.';
COMMENT ON COLUMN public.financial_adjustment_requests.refund_confirmed_by_user_id IS
  'Immutable actor id snapshot; intentionally has no users FK so account deletion cannot erase history.';

CREATE UNIQUE INDEX financial_adjustment_requests_school_idempotency_idx
  ON public.financial_adjustment_requests (school_id, idempotency_key);
CREATE INDEX financial_adjustment_requests_school_created_idx
  ON public.financial_adjustment_requests (school_id, created_at DESC);
CREATE INDEX financial_adjustment_requests_payment_created_idx
  ON public.financial_adjustment_requests (payment_id, created_at DESC);
CREATE UNIQUE INDEX financial_adjustment_requests_resulting_adjustment_idx
  ON public.financial_adjustment_requests (resulting_adjustment_id)
  WHERE resulting_adjustment_id IS NOT NULL;
CREATE UNIQUE INDEX financial_adjustment_requests_active_payment_idx
  ON public.financial_adjustment_requests (payment_id)
  WHERE status = 'pending'
     OR (status = 'approved' AND kind = 'refund' AND refund_confirmed_at IS NULL);

CREATE FUNCTION public.validate_financial_adjustment_request_school()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $validate_scope$
DECLARE
  v_payment_school_id integer;
BEGIN
  SELECT school_id
    INTO v_payment_school_id
  FROM public.financial_payments
  WHERE id = NEW.payment_id;

  IF v_payment_school_id IS NULL OR v_payment_school_id <> NEW.school_id THEN
    RAISE EXCEPTION 'Adjustment request payment is outside its school scope'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$validate_scope$;

CREATE TRIGGER financial_adjustment_requests_school_scope
  BEFORE INSERT OR UPDATE OF school_id, payment_id
  ON public.financial_adjustment_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_financial_adjustment_request_school();
ALTER TABLE public.financial_adjustment_requests
  ENABLE ALWAYS TRIGGER financial_adjustment_requests_school_scope;

CREATE FUNCTION public.validate_financial_adjustment_request_result()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $validate_result$
DECLARE
  v_adjustment_payment_id integer;
  v_adjustment_kind text;
  v_adjustment_amount bigint;
  v_payment_school_id integer;
  v_payment_status text;
  v_allocation_count bigint;
  v_matching_allocation_count bigint;
  v_allocated_amount bigint;
  v_remaining_amount bigint;
BEGIN
  IF NEW.resulting_adjustment_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT adjustment.payment_id, adjustment.kind, adjustment.amount, payment.school_id, payment.status
    INTO v_adjustment_payment_id, v_adjustment_kind, v_adjustment_amount, v_payment_school_id, v_payment_status
  FROM public.financial_adjustments adjustment
  JOIN public.financial_payments payment
    ON payment.id = adjustment.payment_id
  WHERE adjustment.id = NEW.resulting_adjustment_id;

  IF NOT FOUND
     OR v_adjustment_payment_id <> NEW.payment_id
     OR v_payment_school_id <> NEW.school_id
     OR v_adjustment_kind <> NEW.kind THEN
    RAISE EXCEPTION 'Resulting adjustment does not match the request payment, school, or kind'
      USING ERRCODE = '23514';
  END IF;

  SELECT count(*)::bigint,
         count(*) FILTER (WHERE payment_allocation.payment_id = NEW.payment_id)::bigint,
         COALESCE(sum(adjustment_allocation.amount), 0)::bigint
    INTO v_allocation_count, v_matching_allocation_count, v_allocated_amount
  FROM public.financial_adjustment_allocations adjustment_allocation
  JOIN public.financial_payment_allocations payment_allocation
    ON payment_allocation.id = adjustment_allocation.payment_allocation_id
  WHERE adjustment_allocation.adjustment_id = NEW.resulting_adjustment_id;

  IF v_allocation_count = 0
     OR v_matching_allocation_count <> v_allocation_count
     OR v_allocated_amount <> v_adjustment_amount THEN
    RAISE EXCEPTION 'Resulting adjustment allocations do not match the request payment and amount'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.kind = 'refund' THEN
    IF NEW.amount IS NULL
       OR v_adjustment_amount <> NEW.amount
       OR v_payment_status <> 'posted' THEN
      RAISE EXCEPTION 'Resulting refund does not match the approved amount or payment status'
        USING ERRCODE = '23514';
    END IF;
  ELSE
    SELECT COALESCE(sum(
      payment_allocation.amount - COALESCE((
        SELECT sum(prior_allocation.amount)
        FROM public.financial_adjustment_allocations prior_allocation
        JOIN public.financial_adjustments prior_adjustment
          ON prior_adjustment.id = prior_allocation.adjustment_id
        WHERE prior_allocation.payment_allocation_id = payment_allocation.id
          AND prior_adjustment.id <> NEW.resulting_adjustment_id
      ), 0)
    ), 0)::bigint
      INTO v_remaining_amount
    FROM public.financial_payment_allocations payment_allocation
    WHERE payment_allocation.payment_id = NEW.payment_id;

    IF v_adjustment_amount <> v_remaining_amount
       OR v_payment_status <> 'cancelled' THEN
      RAISE EXCEPTION 'Resulting cancellation does not match the remaining payment amount or status'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END
$validate_result$;

CREATE TRIGGER financial_adjustment_requests_result_guard
  BEFORE INSERT OR UPDATE OF resulting_adjustment_id
  ON public.financial_adjustment_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_financial_adjustment_request_result();
ALTER TABLE public.financial_adjustment_requests
  ENABLE ALWAYS TRIGGER financial_adjustment_requests_result_guard;

CREATE FUNCTION public.protect_financial_adjustment_request_history()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $protect_history$
DECLARE
  v_immutable_before jsonb;
  v_immutable_after jsonb;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status IS DISTINCT FROM 'pending'
       OR NEW.decided_by_user_id IS NOT NULL
       OR NEW.decided_by_role IS NOT NULL
       OR NEW.decided_by_name IS NOT NULL
       OR NEW.decided_by_email IS NOT NULL
       OR NEW.decided_at IS NOT NULL
       OR NEW.decision_reason IS NOT NULL
       OR NEW.resulting_adjustment_id IS NOT NULL
       OR NEW.refund_confirmed_by_user_id IS NOT NULL
       OR NEW.refund_confirmed_by_role IS NOT NULL
       OR NEW.refund_confirmed_by_name IS NOT NULL
       OR NEW.refund_confirmed_by_email IS NOT NULL
       OR NEW.refund_confirmed_at IS NOT NULL THEN
      RAISE EXCEPTION 'Financial adjustment requests must be created pending'
        USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Financial adjustment request history is append-only'
      USING ERRCODE = '55000';
  END IF;

  v_immutable_before := pg_catalog.to_jsonb(OLD) - ARRAY[
    'status', 'decided_by_user_id', 'decided_by_role', 'decided_by_name',
    'decided_by_email', 'decided_at', 'decision_reason', 'resulting_adjustment_id',
    'refund_confirmed_by_user_id', 'refund_confirmed_by_role',
    'refund_confirmed_by_name', 'refund_confirmed_by_email', 'refund_confirmed_at',
    'updated_at'
  ];
  v_immutable_after := pg_catalog.to_jsonb(NEW) - ARRAY[
    'status', 'decided_by_user_id', 'decided_by_role', 'decided_by_name',
    'decided_by_email', 'decided_at', 'decision_reason', 'resulting_adjustment_id',
    'refund_confirmed_by_user_id', 'refund_confirmed_by_role',
    'refund_confirmed_by_name', 'refund_confirmed_by_email', 'refund_confirmed_at',
    'updated_at'
  ];
  IF v_immutable_before IS DISTINCT FROM v_immutable_after THEN
    RAISE EXCEPTION 'Financial adjustment request identity and terms are immutable'
      USING ERRCODE = '55000';
  END IF;

  IF OLD.status = 'pending' THEN
    IF NEW.status NOT IN ('approved', 'rejected')
       OR NEW.refund_confirmed_by_user_id IS NOT NULL
       OR NEW.refund_confirmed_by_role IS NOT NULL
       OR NEW.refund_confirmed_by_name IS NOT NULL
       OR NEW.refund_confirmed_by_email IS NOT NULL
       OR NEW.refund_confirmed_at IS NOT NULL THEN
      RAISE EXCEPTION 'Invalid financial adjustment request decision transition'
        USING ERRCODE = '55000';
    END IF;
  ELSIF OLD.status = 'approved'
        AND OLD.kind = 'refund'
        AND OLD.resulting_adjustment_id IS NULL THEN
    IF NEW.status <> 'approved'
       OR NEW.decided_by_user_id IS DISTINCT FROM OLD.decided_by_user_id
       OR NEW.decided_by_role IS DISTINCT FROM OLD.decided_by_role
       OR NEW.decided_by_name IS DISTINCT FROM OLD.decided_by_name
       OR NEW.decided_by_email IS DISTINCT FROM OLD.decided_by_email
       OR NEW.decided_at IS DISTINCT FROM OLD.decided_at
       OR NEW.decision_reason IS DISTINCT FROM OLD.decision_reason
       OR NEW.resulting_adjustment_id IS NULL
       OR NEW.refund_confirmed_by_user_id IS NULL
       OR NEW.refund_confirmed_by_role IS DISTINCT FROM 'school_accountant'
       OR NEW.refund_confirmed_at IS NULL THEN
      RAISE EXCEPTION 'Invalid financial adjustment request refund confirmation transition'
        USING ERRCODE = '55000';
    END IF;
  ELSE
    RAISE EXCEPTION 'Financial adjustment request is already final'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END
$protect_history$;

CREATE TRIGGER financial_adjustment_requests_history_guard
  BEFORE INSERT OR UPDATE OR DELETE
  ON public.financial_adjustment_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_financial_adjustment_request_history();
ALTER TABLE public.financial_adjustment_requests
  ENABLE ALWAYS TRIGGER financial_adjustment_requests_history_guard;

CREATE FUNCTION public.reject_financial_adjustment_requests_truncate()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $reject_truncate$
BEGIN
  RAISE EXCEPTION 'TRUNCATE is prohibited for financial adjustment request history'
    USING ERRCODE = '55000';
END
$reject_truncate$;

CREATE TRIGGER financial_adjustment_requests_no_truncate
  BEFORE TRUNCATE
  ON public.financial_adjustment_requests
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.reject_financial_adjustment_requests_truncate();
ALTER TABLE public.financial_adjustment_requests
  ENABLE ALWAYS TRIGGER financial_adjustment_requests_no_truncate;

CREATE FUNCTION technical_audit.capture_financial_adjustment_requests_row()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, technical_audit
AS $capture_row$
DECLARE
  v_resource_id bigint;
  v_school_id bigint;
  v_before_values jsonb;
  v_after_values jsonb;
  v_changed_fields text[];
  v_allowed_columns text[] := ARRAY[
    'id', 'school_id', 'payment_id', 'kind', 'amount', 'status',
    'requested_by_user_id', 'requested_by_role', 'requested_at',
    'decided_by_user_id', 'decided_by_role', 'decided_at',
    'resulting_adjustment_id', 'refund_confirmed_by_user_id',
    'refund_confirmed_by_role', 'refund_confirmed_at', 'created_at', 'updated_at'
  ];
  v_redacted_columns text[] := ARRAY[
    'reason', 'decision_reason', 'idempotency_key',
    'requested_by_name', 'requested_by_email',
    'decided_by_name', 'decided_by_email',
    'refund_confirmed_by_name', 'refund_confirmed_by_email'
  ];
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_resource_id := NEW.id;
    v_school_id := NEW.school_id;
    v_after_values := pg_catalog.jsonb_build_object(
      'id', NEW.id, 'school_id', NEW.school_id, 'payment_id', NEW.payment_id,
      'kind', NEW.kind, 'amount', NEW.amount, 'status', NEW.status,
      'requested_by_user_id', NEW.requested_by_user_id,
      'requested_by_role', NEW.requested_by_role, 'requested_at', NEW.requested_at,
      'decided_by_user_id', NEW.decided_by_user_id, 'decided_by_role', NEW.decided_by_role,
      'decided_at', NEW.decided_at, 'resulting_adjustment_id', NEW.resulting_adjustment_id,
      'refund_confirmed_by_user_id', NEW.refund_confirmed_by_user_id,
      'refund_confirmed_by_role', NEW.refund_confirmed_by_role,
      'refund_confirmed_at', NEW.refund_confirmed_at,
      'created_at', NEW.created_at, 'updated_at', NEW.updated_at
    );
    v_changed_fields := v_allowed_columns || v_redacted_columns;
  ELSIF TG_OP = 'UPDATE' THEN
    v_resource_id := NEW.id;
    v_school_id := NEW.school_id;
    v_before_values := pg_catalog.jsonb_build_object(
      'id', OLD.id, 'school_id', OLD.school_id, 'payment_id', OLD.payment_id,
      'kind', OLD.kind, 'amount', OLD.amount, 'status', OLD.status,
      'requested_by_user_id', OLD.requested_by_user_id,
      'requested_by_role', OLD.requested_by_role, 'requested_at', OLD.requested_at,
      'decided_by_user_id', OLD.decided_by_user_id, 'decided_by_role', OLD.decided_by_role,
      'decided_at', OLD.decided_at, 'resulting_adjustment_id', OLD.resulting_adjustment_id,
      'refund_confirmed_by_user_id', OLD.refund_confirmed_by_user_id,
      'refund_confirmed_by_role', OLD.refund_confirmed_by_role,
      'refund_confirmed_at', OLD.refund_confirmed_at,
      'created_at', OLD.created_at, 'updated_at', OLD.updated_at
    );
    v_after_values := pg_catalog.jsonb_build_object(
      'id', NEW.id, 'school_id', NEW.school_id, 'payment_id', NEW.payment_id,
      'kind', NEW.kind, 'amount', NEW.amount, 'status', NEW.status,
      'requested_by_user_id', NEW.requested_by_user_id,
      'requested_by_role', NEW.requested_by_role, 'requested_at', NEW.requested_at,
      'decided_by_user_id', NEW.decided_by_user_id, 'decided_by_role', NEW.decided_by_role,
      'decided_at', NEW.decided_at, 'resulting_adjustment_id', NEW.resulting_adjustment_id,
      'refund_confirmed_by_user_id', NEW.refund_confirmed_by_user_id,
      'refund_confirmed_by_role', NEW.refund_confirmed_by_role,
      'refund_confirmed_at', NEW.refund_confirmed_at,
      'created_at', NEW.created_at, 'updated_at', NEW.updated_at
    );
    SELECT COALESCE(pg_catalog.array_agg(column_name ORDER BY column_name), ARRAY[]::text[])
      INTO v_changed_fields
    FROM pg_catalog.unnest(v_allowed_columns || v_redacted_columns) AS columns(column_name)
    WHERE pg_catalog.to_jsonb(OLD) -> column_name
      IS DISTINCT FROM pg_catalog.to_jsonb(NEW) -> column_name;
  ELSIF TG_OP = 'DELETE' THEN
    v_resource_id := OLD.id;
    v_school_id := OLD.school_id;
    v_before_values := pg_catalog.jsonb_build_object(
      'id', OLD.id, 'school_id', OLD.school_id, 'payment_id', OLD.payment_id,
      'kind', OLD.kind, 'amount', OLD.amount, 'status', OLD.status,
      'requested_by_user_id', OLD.requested_by_user_id,
      'requested_by_role', OLD.requested_by_role, 'requested_at', OLD.requested_at,
      'decided_by_user_id', OLD.decided_by_user_id, 'decided_by_role', OLD.decided_by_role,
      'decided_at', OLD.decided_at, 'resulting_adjustment_id', OLD.resulting_adjustment_id,
      'refund_confirmed_by_user_id', OLD.refund_confirmed_by_user_id,
      'refund_confirmed_by_role', OLD.refund_confirmed_by_role,
      'refund_confirmed_at', OLD.refund_confirmed_at,
      'created_at', OLD.created_at, 'updated_at', OLD.updated_at
    );
    v_changed_fields := v_allowed_columns || v_redacted_columns;
  ELSE
    RAISE EXCEPTION 'Unexpected operation for financial adjustment request audit';
  END IF;

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

CREATE FUNCTION technical_audit.capture_financial_adjustment_requests_truncate()
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

ALTER FUNCTION technical_audit.capture_financial_adjustment_requests_row()
  OWNER TO ecoletrack_history_owner;
ALTER FUNCTION technical_audit.capture_financial_adjustment_requests_truncate()
  OWNER TO ecoletrack_history_owner;
REVOKE ALL ON FUNCTION technical_audit.capture_financial_adjustment_requests_row() FROM PUBLIC;
REVOKE ALL ON FUNCTION technical_audit.capture_financial_adjustment_requests_truncate() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.validate_financial_adjustment_request_school() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.validate_financial_adjustment_request_result() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.protect_financial_adjustment_request_history() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reject_financial_adjustment_requests_truncate() FROM PUBLIC;

CREATE TRIGGER db_audit_row_financial_adjustment_requests
  AFTER INSERT OR UPDATE OR DELETE
  ON public.financial_adjustment_requests
  FOR EACH ROW
  EXECUTE FUNCTION technical_audit.capture_financial_adjustment_requests_row();
ALTER TABLE public.financial_adjustment_requests
  ENABLE ALWAYS TRIGGER db_audit_row_financial_adjustment_requests;
CREATE TRIGGER db_audit_truncate_financial_adjustment_requests
  AFTER TRUNCATE
  ON public.financial_adjustment_requests
  FOR EACH STATEMENT
  EXECUTE FUNCTION technical_audit.capture_financial_adjustment_requests_truncate();
ALTER TABLE public.financial_adjustment_requests
  ENABLE ALWAYS TRIGGER db_audit_truncate_financial_adjustment_requests;

-- Transfer the table and sequence together, then verify that the serial dependency remains intact.
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

  ALTER FUNCTION public.validate_financial_adjustment_request_school()
    OWNER TO ecoletrack_history_owner;
  ALTER FUNCTION public.validate_financial_adjustment_request_result()
    OWNER TO ecoletrack_history_owner;
  ALTER FUNCTION public.protect_financial_adjustment_request_history()
    OWNER TO ecoletrack_history_owner;
  ALTER FUNCTION public.reject_financial_adjustment_requests_truncate()
    OWNER TO ecoletrack_history_owner;
  ALTER TABLE public.financial_adjustment_requests OWNER TO ecoletrack_history_owner;
  ALTER SEQUENCE public.financial_adjustment_requests_id_seq OWNER TO ecoletrack_history_owner;

  IF v_temporary_create THEN
    EXECUTE 'REVOKE CREATE ON SCHEMA public FROM ecoletrack_history_owner';
  END IF;
END
$protected_ownership$;
DO $sequence_owner$
DECLARE
  v_table_owner oid;
  v_sequence_owner oid;
  v_history_owner oid;
BEGIN
  SELECT oid INTO v_history_owner
  FROM pg_catalog.pg_roles
  WHERE rolname = 'ecoletrack_history_owner';
  SELECT relowner INTO v_table_owner
  FROM pg_catalog.pg_class
  WHERE oid = 'public.financial_adjustment_requests'::regclass;
  SELECT relowner INTO v_sequence_owner
  FROM pg_catalog.pg_class
  WHERE oid = 'public.financial_adjustment_requests_id_seq'::regclass
    AND relkind = 'S';
  IF v_table_owner IS DISTINCT FROM v_history_owner
     OR v_sequence_owner IS DISTINCT FROM v_history_owner
     OR NOT EXISTS (
       SELECT 1
       FROM pg_catalog.pg_depend dependency
       WHERE dependency.classid = 'pg_catalog.pg_class'::regclass
         AND dependency.objid = 'public.financial_adjustment_requests_id_seq'::regclass
         AND dependency.refclassid = 'pg_catalog.pg_class'::regclass
         AND dependency.refobjid = 'public.financial_adjustment_requests'::regclass
         AND dependency.deptype = 'a'
     ) THEN
    RAISE EXCEPTION 'The request table and its owned serial sequence must belong to ecoletrack_history_owner';
  END IF;
END
$sequence_owner$;

REVOKE ALL ON TABLE public.financial_adjustment_requests FROM PUBLIC;
REVOKE ALL ON SEQUENCE public.financial_adjustment_requests_id_seq FROM PUBLIC;
DO $runtime_privileges$
DECLARE
  v_role text;
  v_insert_columns text[] := ARRAY[
    'school_id', 'payment_id', 'kind', 'amount', 'reason',
    'requested_by_user_id', 'requested_by_role', 'requested_by_name',
    'requested_by_email', 'idempotency_key'
  ];
  v_update_columns text[] := ARRAY[
    'status', 'decided_by_user_id', 'decided_by_role', 'decided_by_name',
    'decided_by_email', 'decided_at', 'decision_reason', 'resulting_adjustment_id',
    'refund_confirmed_by_user_id', 'refund_confirmed_by_role',
    'refund_confirmed_by_name', 'refund_confirmed_by_email',
    'refund_confirmed_at', 'updated_at'
  ];
BEGIN
  FOREACH v_role IN ARRAY ARRAY[
    'ecole_admin', 'ecoletrack_web_runtime', 'ecoletrack_mobile_runtime'
  ]
  LOOP
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = v_role) THEN
      EXECUTE pg_catalog.format(
        'REVOKE ALL PRIVILEGES ON TABLE public.financial_adjustment_requests FROM %I',
        v_role
      );
      EXECUTE pg_catalog.format(
        'REVOKE ALL PRIVILEGES ON SEQUENCE public.financial_adjustment_requests_id_seq FROM %I',
        v_role
      );
      EXECUTE pg_catalog.format(
        'REVOKE ALL PRIVILEGES ON FUNCTION public.validate_financial_adjustment_request_school() FROM %I',
        v_role
      );
      EXECUTE pg_catalog.format(
        'REVOKE ALL PRIVILEGES ON FUNCTION public.validate_financial_adjustment_request_result() FROM %I',
        v_role
      );
      EXECUTE pg_catalog.format(
        'REVOKE ALL PRIVILEGES ON FUNCTION public.protect_financial_adjustment_request_history() FROM %I',
        v_role
      );
      EXECUTE pg_catalog.format(
        'REVOKE ALL PRIVILEGES ON FUNCTION public.reject_financial_adjustment_requests_truncate() FROM %I',
        v_role
      );
      EXECUTE pg_catalog.format(
        'REVOKE ALL PRIVILEGES ON FUNCTION technical_audit.capture_financial_adjustment_requests_row() FROM %I',
        v_role
      );
      EXECUTE pg_catalog.format(
        'REVOKE ALL PRIVILEGES ON FUNCTION technical_audit.capture_financial_adjustment_requests_truncate() FROM %I',
        v_role
      );
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'ecoletrack_web_runtime'
  ) THEN
    GRANT SELECT ON TABLE public.financial_adjustment_requests TO ecoletrack_web_runtime;
    GRANT INSERT (
      school_id, payment_id, kind, amount, reason,
      requested_by_user_id, requested_by_role, requested_by_name, requested_by_email,
      idempotency_key
    ) ON TABLE public.financial_adjustment_requests TO ecoletrack_web_runtime;
    GRANT UPDATE (
      status, decided_by_user_id, decided_by_role, decided_by_name, decided_by_email,
      decided_at, decision_reason, resulting_adjustment_id,
      refund_confirmed_by_user_id, refund_confirmed_by_role,
      refund_confirmed_by_name, refund_confirmed_by_email, refund_confirmed_at, updated_at
    ) ON TABLE public.financial_adjustment_requests TO ecoletrack_web_runtime;
    GRANT USAGE ON SEQUENCE public.financial_adjustment_requests_id_seq TO ecoletrack_web_runtime;
  ELSE
    GRANT SELECT ON TABLE public.financial_adjustment_requests TO ecole_admin;
    GRANT INSERT (
      school_id, payment_id, kind, amount, reason,
      requested_by_user_id, requested_by_role, requested_by_name, requested_by_email,
      idempotency_key
    ) ON TABLE public.financial_adjustment_requests TO ecole_admin;
    GRANT UPDATE (
      status, decided_by_user_id, decided_by_role, decided_by_name, decided_by_email,
      decided_at, decision_reason, resulting_adjustment_id,
      refund_confirmed_by_user_id, refund_confirmed_by_role,
      refund_confirmed_by_name, refund_confirmed_by_email, refund_confirmed_at, updated_at
    ) ON TABLE public.financial_adjustment_requests TO ecole_admin;
    GRANT USAGE ON SEQUENCE public.financial_adjustment_requests_id_seq TO ecole_admin;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'ecoletrack_mobile_runtime'
  ) THEN
    REVOKE ALL ON TABLE public.financial_adjustment_requests FROM ecoletrack_mobile_runtime;
    REVOKE ALL ON SEQUENCE public.financial_adjustment_requests_id_seq FROM ecoletrack_mobile_runtime;
  END IF;

  FOREACH v_role IN ARRAY ARRAY[
    'ecole_admin', 'ecoletrack_web_runtime', 'ecoletrack_mobile_runtime'
  ]
  LOOP
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = v_role) THEN
      IF pg_catalog.has_table_privilege(v_role, 'public.financial_adjustment_requests', 'DELETE')
         OR pg_catalog.has_table_privilege(v_role, 'public.financial_adjustment_requests', 'TRUNCATE')
         OR pg_catalog.has_table_privilege(v_role, 'public.financial_adjustment_requests', 'TRIGGER')
         OR pg_catalog.has_table_privilege(v_role, 'public.financial_adjustment_requests', 'INSERT')
         OR pg_catalog.has_table_privilege(v_role, 'public.financial_adjustment_requests', 'UPDATE')
         OR pg_catalog.pg_has_role(v_role, 'ecoletrack_history_owner', 'MEMBER') THEN
        RAISE EXCEPTION 'Application role % has forbidden request-history privileges', v_role;
      END IF;

      IF v_role <> 'ecoletrack_mobile_runtime' AND EXISTS (
        SELECT 1
        FROM pg_catalog.pg_attribute column_definition
        WHERE column_definition.attrelid = 'public.financial_adjustment_requests'::regclass
          AND column_definition.attnum > 0
          AND NOT column_definition.attisdropped
          AND (
            (
              pg_catalog.has_column_privilege(
                v_role, 'public.financial_adjustment_requests',
                column_definition.attname, 'INSERT'
              )
              AND NOT (column_definition.attname::text = ANY(v_insert_columns))
            )
            OR
            (
              pg_catalog.has_column_privilege(
                v_role, 'public.financial_adjustment_requests',
                column_definition.attname, 'UPDATE'
              )
              AND NOT (column_definition.attname::text = ANY(v_update_columns))
            )
          )
      ) THEN
        RAISE EXCEPTION 'Application role % has excessive column privileges on request history', v_role;
      END IF;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'ecoletrack_web_runtime'
  ) THEN
    IF NOT pg_catalog.has_table_privilege(
      'ecoletrack_web_runtime', 'public.financial_adjustment_requests', 'SELECT'
    )
    OR NOT pg_catalog.has_column_privilege(
      'ecoletrack_web_runtime', 'public.financial_adjustment_requests', 'school_id', 'INSERT'
    )
    OR NOT pg_catalog.has_column_privilege(
      'ecoletrack_web_runtime', 'public.financial_adjustment_requests', 'status', 'UPDATE'
    )
    OR NOT pg_catalog.has_sequence_privilege(
      'ecoletrack_web_runtime', 'public.financial_adjustment_requests_id_seq', 'USAGE'
    ) THEN
      RAISE EXCEPTION 'Web runtime lacks required adjustment-request privileges';
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'ecoletrack_mobile_runtime'
  ) THEN
    IF pg_catalog.has_table_privilege(
      'ecoletrack_mobile_runtime', 'public.financial_adjustment_requests', 'SELECT'
    )
    OR pg_catalog.has_table_privilege(
      'ecoletrack_mobile_runtime', 'public.financial_adjustment_requests', 'INSERT'
    )
    OR pg_catalog.has_table_privilege(
      'ecoletrack_mobile_runtime', 'public.financial_adjustment_requests', 'UPDATE'
    )
    OR pg_catalog.has_table_privilege(
      'ecoletrack_mobile_runtime', 'public.financial_adjustment_requests', 'DELETE'
    )
    OR pg_catalog.has_table_privilege(
      'ecoletrack_mobile_runtime', 'public.financial_adjustment_requests', 'TRUNCATE'
    )
    OR pg_catalog.has_table_privilege(
      'ecoletrack_mobile_runtime', 'public.financial_adjustment_requests', 'TRIGGER'
    )
    OR pg_catalog.has_any_column_privilege(
      'ecoletrack_mobile_runtime', 'public.financial_adjustment_requests', 'SELECT'
    )
    OR pg_catalog.has_any_column_privilege(
      'ecoletrack_mobile_runtime', 'public.financial_adjustment_requests', 'INSERT'
    )
    OR pg_catalog.has_any_column_privilege(
      'ecoletrack_mobile_runtime', 'public.financial_adjustment_requests', 'UPDATE'
    )
    OR pg_catalog.has_sequence_privilege(
      'ecoletrack_mobile_runtime', 'public.financial_adjustment_requests_id_seq', 'USAGE'
    )
    OR pg_catalog.has_sequence_privilege(
      'ecoletrack_mobile_runtime', 'public.financial_adjustment_requests_id_seq', 'SELECT'
    )
    OR pg_catalog.has_sequence_privilege(
      'ecoletrack_mobile_runtime', 'public.financial_adjustment_requests_id_seq', 'UPDATE'
    ) THEN
      RAISE EXCEPTION 'Mobile runtime has privileges on web-only adjustment requests';
    END IF;
  END IF;
END
$runtime_privileges$;

COMMIT;
