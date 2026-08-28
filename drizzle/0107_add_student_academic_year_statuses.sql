CREATE TABLE IF NOT EXISTS student_academic_year_statuses (
  id serial PRIMARY KEY,
  student_id integer NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  academic_year_id integer NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
  status text,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT student_academic_year_statuses_status_check CHECK (
    status IS NULL OR status IN ('Nouveau', 'Doublant', 'Triplant', 'Quadruplant', 'Quintuplant', 'Sextuplant')
  ),
  CONSTRAINT student_academic_year_statuses_student_year_unique UNIQUE (student_id, academic_year_id)
);