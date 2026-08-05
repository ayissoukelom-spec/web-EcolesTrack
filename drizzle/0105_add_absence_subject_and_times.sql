ALTER TABLE absences
  ADD COLUMN IF NOT EXISTS subject_id integer REFERENCES subjects(id) ON DELETE SET NULL;

ALTER TABLE absences
  ADD COLUMN IF NOT EXISTS start_time text;

ALTER TABLE absences
  ADD COLUMN IF NOT EXISTS end_time text;
