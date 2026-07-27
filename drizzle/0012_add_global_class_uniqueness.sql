-- Ensure global classes are unique by name and academic year when school_id is NULL.
-- This protects the intended model where classes are shared globally and school membership lives in school_classes.
CREATE UNIQUE INDEX IF NOT EXISTS classes_global_name_academic_year_idx
ON classes (name, academic_year_id)
WHERE school_id IS NULL;

-- Normalize duplicate class rows that currently exist by keeping one canonical global row per name/year.
-- The script preserves the oldest surviving row per (name, academic_year_id) where school_id is NULL,
-- reassigns school memberships from duplicate rows to the canonical row, and deletes the duplicate rows.
WITH ranked_duplicates AS (
  SELECT
    id,
    name,
    academic_year_id,
    row_number() OVER (
      PARTITION BY name, academic_year_id
      ORDER BY id ASC
    ) AS rn
  FROM classes
  WHERE school_id IS NULL
)
, canonical_classes AS (
  SELECT id, name, academic_year_id
  FROM ranked_duplicates
  WHERE rn = 1
)
UPDATE classes AS c
SET school_id = NULL
FROM canonical_classes AS canonical
WHERE c.name = canonical.name
  AND c.academic_year_id = canonical.academic_year_id
  AND c.id <> canonical.id
  AND c.school_id IS NOT NULL;

WITH ranked_duplicates AS (
  SELECT
    id,
    name,
    academic_year_id,
    row_number() OVER (
      PARTITION BY name, academic_year_id
      ORDER BY id ASC
    ) AS rn
  FROM classes
  WHERE school_id IS NULL
)
, canonical_classes AS (
  SELECT id, name, academic_year_id
  FROM ranked_duplicates
  WHERE rn = 1
)
INSERT INTO school_classes (school_id, class_id, status, created_at, updated_at)
SELECT DISTINCT
  sc.school_id,
  canonical.id AS class_id,
  COALESCE(sc.status, 'approved') AS status,
  NOW(),
  NOW()
FROM school_classes sc
JOIN classes dup ON dup.id = sc.class_id
JOIN canonical_classes canonical
  ON dup.name = canonical.name
 AND dup.academic_year_id = canonical.academic_year_id
WHERE dup.id <> canonical.id
ON CONFLICT (school_id, class_id) DO NOTHING;

WITH ranked_duplicates AS (
  SELECT
    id,
    name,
    academic_year_id,
    row_number() OVER (
      PARTITION BY name, academic_year_id
      ORDER BY id ASC
    ) AS rn
  FROM classes
  WHERE school_id IS NULL
)
, canonical_classes AS (
  SELECT id
  FROM ranked_duplicates
  WHERE rn = 1
)
DELETE FROM classes AS c
USING canonical_classes AS canonical
WHERE c.school_id IS NULL
  AND c.id <> canonical.id
  AND c.name = (SELECT name FROM classes WHERE id = c.id)
  AND c.academic_year_id = (SELECT academic_year_id FROM classes WHERE id = c.id);
