-- Additive hardening for the existing mobile_parent_sessions table.
-- This file is manual-only; the restricted API runtime must never execute it.
BEGIN;

DO $migration$
DECLARE
  expected RECORD;
  actual_type TEXT;
  actual_not_null BOOLEAN;
  actual_identity TEXT;
  actual_generated TEXT;
  actual_default TEXT;
  id_attribute_number SMALLINT;
  id_default_oid OID;
  id_sequence_name TEXT;
  id_sequence_oid OID;
  id_sequence_kind "char";
BEGIN
  IF pg_catalog.to_regclass('public.mobile_parent_sessions') IS NULL THEN
    RAISE EXCEPTION 'Required existing table public.mobile_parent_sessions is missing; refusing to create a replacement';
  END IF;

  IF (
    SELECT relation.relkind
    FROM pg_catalog.pg_class relation
    WHERE relation.oid = pg_catalog.to_regclass('public.mobile_parent_sessions')
  ) <> 'r' THEN
    RAISE EXCEPTION 'public.mobile_parent_sessions is not an ordinary table';
  END IF;

  FOR expected IN
    SELECT *
    FROM (VALUES
      ('id', 'integer', true),
      ('parent_id', 'text', true),
      ('role', 'text', true),
      ('refresh_token_hash', 'text', true),
      ('created_at', 'timestamp with time zone', true),
      ('expires_at', 'timestamp with time zone', true),
      ('is_active', 'boolean', true),
      ('revoked_at', 'timestamp with time zone', false),
      ('last_used_at', 'timestamp with time zone', false)
    ) AS historical(column_name, data_type, not_null)
  LOOP
    SELECT pg_catalog.format_type(attribute.atttypid, attribute.atttypmod),
           attribute.attnotnull
    INTO actual_type, actual_not_null
    FROM pg_catalog.pg_attribute attribute
    WHERE attribute.attrelid = pg_catalog.to_regclass('public.mobile_parent_sessions')
      AND attribute.attname = expected.column_name
      AND attribute.attnum > 0
      AND NOT attribute.attisdropped;

    IF NOT FOUND
       OR actual_type IS DISTINCT FROM expected.data_type
       OR actual_not_null IS DISTINCT FROM expected.not_null THEN
      RAISE EXCEPTION
        'Historical column public.mobile_parent_sessions.% is missing or incompatible (expected type %, NOT NULL=%)',
        expected.column_name, expected.data_type, expected.not_null;
    END IF;
  END LOOP;

  SELECT attribute.attidentity,
         attribute.attgenerated,
         attribute.attnum,
         column_default.oid,
         pg_catalog.pg_get_expr(column_default.adbin, column_default.adrelid)
  INTO actual_identity, actual_generated, id_attribute_number, id_default_oid, actual_default
  FROM pg_catalog.pg_attribute attribute
  LEFT JOIN pg_catalog.pg_attrdef column_default
    ON column_default.adrelid = attribute.attrelid
   AND column_default.adnum = attribute.attnum
  WHERE attribute.attrelid = pg_catalog.to_regclass('public.mobile_parent_sessions')
    AND attribute.attname = 'id'
    AND attribute.attnum > 0
    AND NOT attribute.attisdropped;

  IF actual_generated IS DISTINCT FROM '' THEN
    RAISE EXCEPTION 'Historical id column must not be a generated expression column';
  END IF;

  id_sequence_name := pg_catalog.pg_get_serial_sequence(
    'public.mobile_parent_sessions',
    'id'
  );
  id_sequence_oid := pg_catalog.to_regclass(id_sequence_name);

  IF id_sequence_oid IS NULL THEN
    RAISE EXCEPTION 'Historical id column must retain its owned sequence or identity sequence';
  END IF;

  SELECT sequence_relation.relkind
  INTO id_sequence_kind
  FROM pg_catalog.pg_class sequence_relation
  WHERE sequence_relation.oid = id_sequence_oid;

  IF id_sequence_kind IS DISTINCT FROM 'S' THEN
    RAISE EXCEPTION 'Historical id generator must reference a PostgreSQL sequence';
  END IF;

  IF actual_identity = 'a' THEN
    IF id_default_oid IS NOT NULL
       OR NOT EXISTS (
         SELECT 1
         FROM pg_catalog.pg_depend sequence_dependency
         WHERE sequence_dependency.classid = 'pg_catalog.pg_class'::regclass
           AND sequence_dependency.objid = id_sequence_oid
           AND sequence_dependency.refclassid = 'pg_catalog.pg_class'::regclass
           AND sequence_dependency.refobjid = pg_catalog.to_regclass('public.mobile_parent_sessions')
           AND sequence_dependency.refobjsubid = id_attribute_number
           AND sequence_dependency.deptype = 'i'
       ) THEN
      RAISE EXCEPTION 'Historical id identity sequence definition or dependency is incompatible';
    END IF;
  ELSIF actual_identity = ''
     AND actual_default LIKE 'nextval(%' THEN
    IF NOT EXISTS (
         SELECT 1
         FROM pg_catalog.pg_depend sequence_dependency
         WHERE sequence_dependency.classid = 'pg_catalog.pg_class'::regclass
           AND sequence_dependency.objid = id_sequence_oid
           AND sequence_dependency.refclassid = 'pg_catalog.pg_class'::regclass
           AND sequence_dependency.refobjid = pg_catalog.to_regclass('public.mobile_parent_sessions')
           AND sequence_dependency.refobjsubid = id_attribute_number
           AND sequence_dependency.deptype = 'a'
       )
       OR NOT EXISTS (
         SELECT 1
         FROM pg_catalog.pg_depend default_dependency
         WHERE default_dependency.classid = 'pg_catalog.pg_attrdef'::regclass
           AND default_dependency.objid = id_default_oid
           AND default_dependency.refclassid = 'pg_catalog.pg_class'::regclass
           AND default_dependency.refobjid = id_sequence_oid
       ) THEN
      RAISE EXCEPTION 'Historical serial id default or owned-sequence dependency is incompatible';
    END IF;
  ELSE
    RAISE EXCEPTION
      'Historical id must retain either GENERATED ALWAYS identity or a serial nextval default';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_index index_definition
    WHERE index_definition.indrelid = pg_catalog.to_regclass('public.mobile_parent_sessions')
      AND index_definition.indisunique
      AND index_definition.indisvalid
      AND index_definition.indisready
      AND index_definition.indpred IS NULL
      AND ARRAY(
        SELECT attribute.attname::text
        FROM unnest(index_definition.indkey) WITH ORDINALITY AS key_column(attnum, ordinal)
        JOIN pg_catalog.pg_attribute attribute
          ON attribute.attrelid = index_definition.indrelid
         AND attribute.attnum = key_column.attnum
        WHERE key_column.ordinal <= index_definition.indnkeyatts
        ORDER BY key_column.ordinal
      ) = ARRAY['id']::text[]
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_index index_definition
    WHERE index_definition.indrelid = pg_catalog.to_regclass('public.mobile_parent_sessions')
      AND index_definition.indisunique
      AND index_definition.indisvalid
      AND index_definition.indisready
      AND index_definition.indpred IS NULL
      AND ARRAY(
        SELECT attribute.attname::text
        FROM unnest(index_definition.indkey) WITH ORDINALITY AS key_column(attnum, ordinal)
        JOIN pg_catalog.pg_attribute attribute
          ON attribute.attrelid = index_definition.indrelid
         AND attribute.attnum = key_column.attnum
        WHERE key_column.ordinal <= index_definition.indnkeyatts
        ORDER BY key_column.ordinal
      ) = ARRAY['refresh_token_hash']::text[]
  ) THEN
    RAISE EXCEPTION 'Historical unique keys on id and refresh_token_hash must remain present';
  END IF;
END
$migration$;

ALTER TABLE public.mobile_parent_sessions
  ADD COLUMN IF NOT EXISTS session_family_id UUID,
  ADD COLUMN IF NOT EXISTS session_started_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS absolute_expires_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS refresh_generation INTEGER,
  ADD COLUMN IF NOT EXISTS rotation_request_id UUID,
  ADD COLUMN IF NOT EXISTS rotated_to_session_id INTEGER,
  ADD COLUMN IF NOT EXISTS rotation_successor_ciphertext BYTEA,
  ADD COLUMN IF NOT EXISTS rotation_recovery_expires_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS family_revoked_at TIMESTAMP WITH TIME ZONE;

DO $migration$
DECLARE
  expected RECORD;
  actual_type TEXT;
  actual_not_null BOOLEAN;
  actual_identity TEXT;
  actual_generated TEXT;
  has_default BOOLEAN;
BEGIN
  FOR expected IN
    SELECT *
    FROM (VALUES
      ('session_family_id', 'uuid'),
      ('session_started_at', 'timestamp with time zone'),
      ('absolute_expires_at', 'timestamp with time zone'),
      ('refresh_generation', 'integer'),
      ('rotation_request_id', 'uuid'),
      ('rotated_to_session_id', 'integer'),
      ('rotation_successor_ciphertext', 'bytea'),
      ('rotation_recovery_expires_at', 'timestamp with time zone'),
      ('family_revoked_at', 'timestamp with time zone')
    ) AS additive(column_name, data_type)
  LOOP
    SELECT pg_catalog.format_type(attribute.atttypid, attribute.atttypmod),
           attribute.attnotnull,
           attribute.attidentity,
           attribute.attgenerated,
           EXISTS (
             SELECT 1
             FROM pg_catalog.pg_attrdef column_default
             WHERE column_default.adrelid = attribute.attrelid
               AND column_default.adnum = attribute.attnum
           )
    INTO actual_type, actual_not_null, actual_identity, actual_generated, has_default
    FROM pg_catalog.pg_attribute attribute
    WHERE attribute.attrelid = pg_catalog.to_regclass('public.mobile_parent_sessions')
      AND attribute.attname = expected.column_name
      AND attribute.attnum > 0
      AND NOT attribute.attisdropped;

    IF NOT FOUND
       OR actual_type IS DISTINCT FROM expected.data_type
       OR actual_not_null
       OR actual_identity <> ''
       OR actual_generated <> ''
       OR has_default THEN
      RAISE EXCEPTION
        'Additive column public.mobile_parent_sessions.% has an incompatible existing definition',
        expected.column_name;
    END IF;
  END LOOP;
END
$migration$;

-- This transaction-local probe supplies PostgreSQL's canonical constraint and
-- index definitions. Existing same-named objects must match exactly to be reused.
CREATE TEMP TABLE mobile_parent_sessions_hardening_probe_0157 (
  id INTEGER,
  parent_id TEXT,
  expires_at TIMESTAMP WITH TIME ZONE,
  is_active BOOLEAN,
  revoked_at TIMESTAMP WITH TIME ZONE,
  session_family_id UUID,
  session_started_at TIMESTAMP WITH TIME ZONE,
  absolute_expires_at TIMESTAMP WITH TIME ZONE,
  refresh_generation INTEGER,
  family_revoked_at TIMESTAMP WITH TIME ZONE,
  rotation_request_id UUID,
  rotated_to_session_id INTEGER,
  rotation_successor_ciphertext BYTEA,
  rotation_recovery_expires_at TIMESTAMP WITH TIME ZONE
) ON COMMIT DROP;

ALTER TABLE pg_temp.mobile_parent_sessions_hardening_probe_0157
  ADD CONSTRAINT mobile_parent_sessions_family_shape_check
    CHECK (
      (
        session_family_id IS NULL
        AND session_started_at IS NULL
        AND absolute_expires_at IS NULL
        AND refresh_generation IS NULL
      )
      OR
      (
        session_family_id IS NOT NULL
        AND session_started_at IS NOT NULL
        AND absolute_expires_at IS NOT NULL
        AND refresh_generation IS NOT NULL
        AND refresh_generation >= 0
        AND expires_at <= absolute_expires_at
      )
    ),
  ADD CONSTRAINT mobile_parent_sessions_absolute_duration_check
    CHECK (
      session_family_id IS NULL
      OR EXTRACT(EPOCH FROM (absolute_expires_at - session_started_at)) = 5184000
    ),
  ADD CONSTRAINT mobile_parent_sessions_active_state_check
    CHECK (NOT is_active OR revoked_at IS NULL),
  ADD CONSTRAINT mobile_parent_sessions_family_revocation_check
    CHECK (
      family_revoked_at IS NULL
      OR (
        NOT is_active
        AND rotation_request_id IS NULL
        AND rotation_successor_ciphertext IS NULL
        AND rotation_recovery_expires_at IS NULL
      )
    ),
  ADD CONSTRAINT mobile_parent_sessions_rotation_recovery_check
    CHECK (
      (
        rotation_request_id IS NULL
        AND rotation_successor_ciphertext IS NULL
        AND rotation_recovery_expires_at IS NULL
      )
      OR
      (
        rotation_request_id IS NOT NULL
        AND rotated_to_session_id IS NOT NULL
        AND rotation_successor_ciphertext IS NOT NULL
        AND rotation_recovery_expires_at IS NOT NULL
        AND revoked_at IS NOT NULL
        AND rotation_recovery_expires_at > revoked_at
        AND rotation_recovery_expires_at <= revoked_at + INTERVAL '24 hours'
        AND (
          absolute_expires_at IS NULL
          OR rotation_recovery_expires_at <= absolute_expires_at
        )
      )
    ),
  ADD CONSTRAINT mobile_parent_sessions_rotation_link_check
    CHECK (
      rotated_to_session_id IS NULL
      OR (
        rotated_to_session_id <> id
        AND NOT is_active
        AND revoked_at IS NOT NULL
      )
    );

DO $migration$
DECLARE
  expected RECORD;
  actual_type "char";
  actual_definition TEXT;
BEGIN
  FOR expected IN
    SELECT constraint_definition.conname,
           constraint_definition.contype,
           pg_catalog.pg_get_constraintdef(constraint_definition.oid) AS definition
    FROM pg_catalog.pg_constraint constraint_definition
    WHERE constraint_definition.conrelid =
      pg_catalog.to_regclass('pg_temp.mobile_parent_sessions_hardening_probe_0157')
  LOOP
    SELECT existing.contype,
           pg_catalog.pg_get_constraintdef(existing.oid)
    INTO actual_type, actual_definition
    FROM pg_catalog.pg_constraint existing
    WHERE existing.conrelid = pg_catalog.to_regclass('public.mobile_parent_sessions')
      AND existing.conname = expected.conname;

    IF NOT FOUND THEN
      EXECUTE format(
        'ALTER TABLE public.mobile_parent_sessions ADD CONSTRAINT %I %s NOT VALID',
        expected.conname,
        expected.definition
      );
    ELSIF actual_type IS DISTINCT FROM expected.contype
       OR actual_definition IS DISTINCT FROM expected.definition THEN
      RAISE EXCEPTION
        'Constraint public.mobile_parent_sessions.% exists with an incompatible definition',
        expected.conname;
    END IF;

    EXECUTE format(
      'ALTER TABLE public.mobile_parent_sessions VALIDATE CONSTRAINT %I',
      expected.conname
    );
  END LOOP;
END
$migration$;

DO $migration$
DECLARE
  sessions_table OID := pg_catalog.to_regclass('public.mobile_parent_sessions');
  source_attribute SMALLINT;
  target_attribute SMALLINT;
  existing_constraint OID;
  constraint_type "char";
  constraint_source SMALLINT[];
  constraint_target_table OID;
  constraint_target SMALLINT[];
  delete_action "char";
  match_type "char";
  update_action "char";
  is_deferrable BOOLEAN;
  is_deferred BOOLEAN;
  is_validated BOOLEAN;
BEGIN
  SELECT attribute.attnum
  INTO source_attribute
  FROM pg_catalog.pg_attribute attribute
  WHERE attribute.attrelid = sessions_table
    AND attribute.attname = 'rotated_to_session_id'
    AND attribute.attnum > 0
    AND NOT attribute.attisdropped;

  SELECT attribute.attnum
  INTO target_attribute
  FROM pg_catalog.pg_attribute attribute
  WHERE attribute.attrelid = sessions_table
    AND attribute.attname = 'id'
    AND attribute.attnum > 0
    AND NOT attribute.attisdropped;

  IF source_attribute IS NULL OR target_attribute IS NULL THEN
    RAISE EXCEPTION 'Required source or target column for mobile session successor FK is missing';
  END IF;

  SELECT constraint_definition.oid,
         constraint_definition.contype,
         constraint_definition.conkey,
         constraint_definition.confrelid,
         constraint_definition.confkey,
         constraint_definition.confdeltype,
         constraint_definition.confmatchtype,
         constraint_definition.confupdtype,
         constraint_definition.condeferrable,
         constraint_definition.condeferred,
         constraint_definition.convalidated
  INTO existing_constraint, constraint_type, constraint_source,
       constraint_target_table, constraint_target, delete_action,
       match_type, update_action, is_deferrable, is_deferred, is_validated
  FROM pg_catalog.pg_constraint constraint_definition
  WHERE constraint_definition.conrelid = sessions_table
    AND constraint_definition.conname = 'mobile_parent_sessions_rotated_session_fk';

  IF NOT FOUND THEN
    ALTER TABLE public.mobile_parent_sessions
      ADD CONSTRAINT mobile_parent_sessions_rotated_session_fk
      FOREIGN KEY (rotated_to_session_id)
      REFERENCES public.mobile_parent_sessions(id)
      ON DELETE RESTRICT
      NOT VALID;
  ELSIF constraint_type IS DISTINCT FROM 'f'
     OR constraint_source IS DISTINCT FROM ARRAY[source_attribute]::SMALLINT[]
     OR constraint_target_table IS DISTINCT FROM sessions_table
     OR constraint_target IS DISTINCT FROM ARRAY[target_attribute]::SMALLINT[]
     OR delete_action IS DISTINCT FROM 'r'
     OR match_type IS DISTINCT FROM 's'
     OR update_action IS DISTINCT FROM 'a'
     OR is_deferrable
     OR is_deferred THEN
    RAISE EXCEPTION
      'Constraint public.mobile_parent_sessions.mobile_parent_sessions_rotated_session_fk exists with an incompatible definition';
  END IF;

  SELECT constraint_definition.oid,
         constraint_definition.convalidated
  INTO existing_constraint, is_validated
  FROM pg_catalog.pg_constraint constraint_definition
  WHERE constraint_definition.conrelid = sessions_table
    AND constraint_definition.conname = 'mobile_parent_sessions_rotated_session_fk';

  IF is_validated IS DISTINCT FROM TRUE THEN
    ALTER TABLE public.mobile_parent_sessions
      VALIDATE CONSTRAINT mobile_parent_sessions_rotated_session_fk;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint constraint_definition
    WHERE constraint_definition.oid = existing_constraint
      AND constraint_definition.conrelid = sessions_table
      AND constraint_definition.contype = 'f'
      AND constraint_definition.conkey = ARRAY[source_attribute]::SMALLINT[]
      AND constraint_definition.confrelid = sessions_table
      AND constraint_definition.confkey = ARRAY[target_attribute]::SMALLINT[]
      AND constraint_definition.confdeltype = 'r'
      AND constraint_definition.convalidated
  ) THEN
    RAISE EXCEPTION
      'Successor FK must be validated from rotated_to_session_id to mobile_parent_sessions.id with ON DELETE RESTRICT';
  END IF;
END
$migration$;

CREATE UNIQUE INDEX IF NOT EXISTS mobile_parent_sessions_active_family_uidx
  ON public.mobile_parent_sessions (session_family_id)
  WHERE session_family_id IS NOT NULL
    AND is_active
    AND family_revoked_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS mobile_parent_sessions_generation_uidx
  ON public.mobile_parent_sessions (session_family_id, refresh_generation)
  WHERE session_family_id IS NOT NULL
    AND refresh_generation IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS mobile_parent_sessions_rotation_request_uidx
  ON public.mobile_parent_sessions (rotation_request_id)
  WHERE rotation_request_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS mobile_parent_sessions_successor_uidx
  ON public.mobile_parent_sessions (rotated_to_session_id)
  WHERE rotated_to_session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS mobile_parent_sessions_recovery_cleanup_idx
  ON public.mobile_parent_sessions (rotation_recovery_expires_at)
  WHERE rotation_successor_ciphertext IS NOT NULL;

CREATE UNIQUE INDEX mobile_parent_sessions_active_family_uidx
  ON pg_temp.mobile_parent_sessions_hardening_probe_0157 (session_family_id)
  WHERE session_family_id IS NOT NULL
    AND is_active
    AND family_revoked_at IS NULL;

CREATE UNIQUE INDEX mobile_parent_sessions_generation_uidx
  ON pg_temp.mobile_parent_sessions_hardening_probe_0157 (session_family_id, refresh_generation)
  WHERE session_family_id IS NOT NULL
    AND refresh_generation IS NOT NULL;

CREATE UNIQUE INDEX mobile_parent_sessions_rotation_request_uidx
  ON pg_temp.mobile_parent_sessions_hardening_probe_0157 (rotation_request_id)
  WHERE rotation_request_id IS NOT NULL;

CREATE UNIQUE INDEX mobile_parent_sessions_successor_uidx
  ON pg_temp.mobile_parent_sessions_hardening_probe_0157 (rotated_to_session_id)
  WHERE rotated_to_session_id IS NOT NULL;

CREATE INDEX mobile_parent_sessions_recovery_cleanup_idx
  ON pg_temp.mobile_parent_sessions_hardening_probe_0157 (rotation_recovery_expires_at)
  WHERE rotation_successor_ciphertext IS NOT NULL;

DO $migration$
DECLARE
  expected RECORD;
BEGIN
  FOR expected IN
    SELECT index_relation.relname AS index_name,
           index_definition.indisunique AS is_unique,
           index_definition.indisvalid AS is_valid,
           index_definition.indisready AS is_ready,
           index_definition.indisprimary AS is_primary,
           index_definition.indisexclusion AS is_exclusion,
           index_definition.indnatts AS attribute_count,
           index_definition.indnkeyatts AS key_count,
           index_definition.indclass AS operator_classes,
           index_definition.indcollation AS collations,
           index_definition.indoption AS options,
           access_method.amname AS access_method,
           pg_catalog.pg_get_expr(index_definition.indpred, index_definition.indrelid) AS predicate,
           ARRAY(
             SELECT attribute.attname::text
             FROM unnest(index_definition.indkey) WITH ORDINALITY AS key_column(attnum, ordinal)
             JOIN pg_catalog.pg_attribute attribute
               ON attribute.attrelid = index_definition.indrelid
              AND attribute.attnum = key_column.attnum
             WHERE key_column.ordinal <= index_definition.indnkeyatts
             ORDER BY key_column.ordinal
           ) AS key_columns
    FROM pg_catalog.pg_index index_definition
    JOIN pg_catalog.pg_class index_relation
      ON index_relation.oid = index_definition.indexrelid
    JOIN pg_catalog.pg_am access_method
      ON access_method.oid = index_relation.relam
    WHERE index_definition.indrelid =
      pg_catalog.to_regclass('pg_temp.mobile_parent_sessions_hardening_probe_0157')
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_index actual
      JOIN pg_catalog.pg_class actual_index
        ON actual_index.oid = actual.indexrelid
      JOIN pg_catalog.pg_am actual_access_method
        ON actual_access_method.oid = actual_index.relam
      WHERE actual.indrelid = pg_catalog.to_regclass('public.mobile_parent_sessions')
        AND actual_index.relname = expected.index_name
        AND actual.indisunique = expected.is_unique
        AND actual.indisvalid
        AND actual.indisready
        AND actual.indisprimary = expected.is_primary
        AND actual.indisexclusion = expected.is_exclusion
        AND actual.indnatts = expected.attribute_count
        AND actual.indnkeyatts = expected.key_count
        AND actual.indclass = expected.operator_classes
        AND actual.indcollation = expected.collations
        AND actual.indoption = expected.options
        AND actual_access_method.amname = expected.access_method
        AND pg_catalog.pg_get_expr(actual.indpred, actual.indrelid)
            IS NOT DISTINCT FROM expected.predicate
        AND ARRAY(
          SELECT attribute.attname::text
          FROM unnest(actual.indkey) WITH ORDINALITY AS key_column(attnum, ordinal)
          JOIN pg_catalog.pg_attribute attribute
            ON attribute.attrelid = actual.indrelid
           AND attribute.attnum = key_column.attnum
          WHERE key_column.ordinal <= actual.indnkeyatts
          ORDER BY key_column.ordinal
        ) = expected.key_columns
    ) THEN
      RAISE EXCEPTION
        'Index public.% is missing or has an incompatible definition',
        expected.index_name;
    END IF;
  END LOOP;
END
$migration$;

COMMIT;
