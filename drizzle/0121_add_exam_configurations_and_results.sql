CREATE TABLE IF NOT EXISTS class_exam_configurations (
  id SERIAL PRIMARY KEY,
  class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  school_id INTEGER REFERENCES schools(id) ON DELETE CASCADE,
  academic_year_id INTEGER NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
  exam_type TEXT NOT NULL CHECK (exam_type IN ('CEPD', 'BEPC', 'BAC_I', 'BAC_II')),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now()
);

ALTER TABLE class_exam_configurations
  ALTER COLUMN school_id DROP NOT NULL;

ALTER TABLE class_exam_configurations
  DROP CONSTRAINT IF EXISTS class_exam_configurations_context_unique;

CREATE UNIQUE INDEX IF NOT EXISTS class_exam_configurations_school_context_unique
  ON class_exam_configurations (class_id, school_id, academic_year_id, exam_type)
  WHERE school_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS class_exam_configurations_global_context_unique
  ON class_exam_configurations (class_id, academic_year_id, exam_type)
  WHERE school_id IS NULL;

CREATE INDEX IF NOT EXISTS class_exam_configurations_school_year_idx
  ON class_exam_configurations (school_id, academic_year_id);

CREATE TABLE IF NOT EXISTS exam_results (
  id SERIAL PRIMARY KEY,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  academic_year_id INTEGER NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
  exam_type TEXT NOT NULL CHECK (exam_type IN ('CEPD', 'BEPC', 'BAC_I', 'BAC_II')),
  result_status TEXT NOT NULL CHECK (result_status IN ('ADMITTED', 'NOT_ADMITTED', 'ABSENT')),
  exam_session TEXT,
  recorded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now(),
  CONSTRAINT exam_results_student_year_type_unique UNIQUE (student_id, academic_year_id, exam_type)
);

CREATE INDEX IF NOT EXISTS exam_results_year_type_idx
  ON exam_results (academic_year_id, exam_type);
