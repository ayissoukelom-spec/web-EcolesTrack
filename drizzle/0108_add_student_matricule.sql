CREATE SEQUENCE IF NOT EXISTS student_matricule_seq START WITH 1 INCREMENT BY 1 NO CYCLE;

ALTER TABLE students ADD COLUMN IF NOT EXISTS matricule TEXT;

CREATE OR REPLACE FUNCTION assign_student_matricule()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.matricule IS NULL OR btrim(NEW.matricule) = '' THEN
    NEW.matricule := lpad(nextval('student_matricule_seq')::text, 5, '0')
      || COALESCE(NULLIF(upper(right(btrim(NEW.last_name), 1)), ''), 'X');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS assign_student_matricule_before_insert ON students;

CREATE TRIGGER assign_student_matricule_before_insert
BEFORE INSERT ON students
FOR EACH ROW
EXECUTE FUNCTION assign_student_matricule();

SELECT setval(
  'student_matricule_seq',
  GREATEST(
    COALESCE((SELECT MAX(NULLIF(regexp_replace(matricule, '[^0-9].*$', ''), '')::bigint) FROM students WHERE matricule IS NOT NULL), 0),
    CASE WHEN (SELECT is_called FROM student_matricule_seq) THEN (SELECT last_value FROM student_matricule_seq) ELSE 0 END,
    1
  ),
  GREATEST(
    COALESCE((SELECT MAX(NULLIF(regexp_replace(matricule, '[^0-9].*$', ''), '')::bigint) FROM students WHERE matricule IS NOT NULL), 0),
    CASE WHEN (SELECT is_called FROM student_matricule_seq) THEN (SELECT last_value FROM student_matricule_seq) ELSE 0 END
  ) > 0
);

UPDATE students
SET matricule = lpad(nextval('student_matricule_seq')::text, 5, '0')
  || COALESCE(NULLIF(upper(right(btrim(last_name), 1)), ''), 'X')
WHERE matricule IS NULL OR btrim(matricule) = '';

ALTER TABLE students ALTER COLUMN matricule SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'students_matricule_unique') THEN
    ALTER TABLE students ADD CONSTRAINT students_matricule_unique UNIQUE (matricule);
  END IF;
END;
$$;
