ALTER TABLE schools
  ADD COLUMN IF NOT EXISTS promotion_threshold NUMERIC(5,2) NOT NULL DEFAULT 10.00;

CREATE TABLE IF NOT EXISTS class_successions (
  id SERIAL PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  academic_year_id INTEGER NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
  source_class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  target_class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now(),
  CONSTRAINT class_successions_source_target_different CHECK (source_class_id <> target_class_id),
  CONSTRAINT class_successions_school_year_source_unique UNIQUE (school_id, academic_year_id, source_class_id)
);
