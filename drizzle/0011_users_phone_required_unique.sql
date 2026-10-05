DO $phone_preflight$
DECLARE
	null_count bigint;
	blank_count bigint;
	noncanonical_count bigint;
	duplicate_canonical_group_count bigint;
BEGIN
	SELECT
		COUNT(*) FILTER (WHERE phone IS NULL),
		COUNT(*) FILTER (WHERE phone IS NOT NULL AND btrim(phone) = ''),
		COUNT(*) FILTER (
			WHERE phone IS NOT NULL
				AND btrim(phone) <> ''
				AND NOT (
					left(phone, 1) = '+'
					AND length(phone) BETWEEN 3 AND 16
					AND substring(phone FROM 2 FOR 1) BETWEEN '1' AND '9'
					AND substring(phone FROM 2) !~ '[^0-9]'
				)
		)
	INTO null_count, blank_count, noncanonical_count
	FROM users;

	WITH raw_values AS (
		SELECT
			btrim(phone) AS trimmed,
			regexp_replace(btrim(phone), '[^0-9]', '', 'g') AS digits
		FROM users
		WHERE phone IS NOT NULL
	),
	normalized AS (
		SELECT CASE
			WHEN trimmed ~ '^[+][0-9[:space:]()./-]+$' THEN digits
			WHEN trimmed ~ '^00[0-9[:space:]()./-]+$' THEN substring(digits FROM 3)
			WHEN digits ~ '^228[0-9]{8}$' THEN digits
			ELSE NULL
		END AS canonical_digits
		FROM raw_values
	),
	duplicate_groups AS (
		SELECT canonical_digits
		FROM normalized
		WHERE canonical_digits ~ '^[1-9][0-9]{1,14}$'
		GROUP BY canonical_digits
		HAVING COUNT(*) > 1
	)
	SELECT COUNT(*)
	INTO duplicate_canonical_group_count
	FROM duplicate_groups;

	IF null_count > 0
		OR blank_count > 0
		OR noncanonical_count > 0
		OR duplicate_canonical_group_count > 0
	THEN
		RAISE EXCEPTION
			'Cannot enforce users.phone constraints: % NULL, % blank, % non-canonical, % duplicate canonical groups. No rows were changed; resolve the records through reviewed remediation and rerun the migration.',
			null_count,
			blank_count,
			noncanonical_count,
			duplicate_canonical_group_count
			USING ERRCODE = 'check_violation';
	END IF;
END
$phone_preflight$;
--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "phone" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_phone_canonical_check"
	CHECK (left("phone", 1) = '+' AND length("phone") BETWEEN 3 AND 16 AND substring("phone" FROM 2 FOR 1) BETWEEN '1' AND '9' AND substring("phone" FROM 2) !~ '[^0-9]');
--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_phone_unique" UNIQUE ("phone");