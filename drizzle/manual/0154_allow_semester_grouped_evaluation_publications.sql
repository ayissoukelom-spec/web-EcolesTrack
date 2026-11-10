BEGIN;

DO $migration$
DECLARE
  constraint_definition text;
  normalized_definition text;
  constraint_is_validated boolean;
BEGIN
  IF to_regclass('public.evaluation_publications') IS NULL THEN
    RAISE EXCEPTION
      'Expected table public.evaluation_publications does not exist; migration 0154 was not applied';
  END IF;

  EXECUTE 'LOCK TABLE public.evaluation_publications IN ACCESS EXCLUSIVE MODE';

  SELECT
    pg_get_constraintdef(constraint_row.oid),
    constraint_row.convalidated
  INTO constraint_definition, constraint_is_validated
  FROM pg_constraint AS constraint_row
  WHERE constraint_row.conrelid = 'public.evaluation_publications'::regclass
    AND constraint_row.conname = 'evaluation_publications_period_check'
    AND constraint_row.contype = 'c';

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'Expected CHECK constraint evaluation_publications_period_check is missing; migration 0154 was not applied';
  END IF;

  IF NOT constraint_is_validated THEN
    RAISE EXCEPTION
      'Constraint evaluation_publications_period_check is not validated; migration 0154 was not applied';
  END IF;

  normalized_definition := regexp_replace(
    lower(constraint_definition),
    '[[:space:]()"]',
    '',
    'g'
  );

  IF normalized_definition = 'checkperiod_type=''trimester''::textandperiod_order_index>0' THEN
    ALTER TABLE public.evaluation_publications
      DROP CONSTRAINT evaluation_publications_period_check,
      ADD CONSTRAINT evaluation_publications_period_check
        CHECK (
          period_type IN ('trimester', 'semester')
          AND period_order_index > 0
        );
    RAISE NOTICE
      'Constraint evaluation_publications_period_check now accepts trimester and semester';
  ELSIF normalized_definition IN (
    'checkperiod_type=anyarray[''trimester''::text,''semester''::text]andperiod_order_index>0',
    'checkperiod_typein''trimester''::text,''semester''::textandperiod_order_index>0'
  ) THEN
    RAISE NOTICE
      'Constraint evaluation_publications_period_check already accepts trimester and semester; no change made';
  ELSE
    RAISE EXCEPTION
      'Unexpected definition for evaluation_publications_period_check: %. Migration 0154 was not applied',
      constraint_definition;
  END IF;
END;
$migration$;

COMMIT;
