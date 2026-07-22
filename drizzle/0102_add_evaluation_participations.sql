CREATE TABLE IF NOT EXISTS evaluation_participations (
  id SERIAL PRIMARY KEY,
  evaluation_id INTEGER NOT NULL REFERENCES evaluations(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS evaluation_participations_evaluation_id_student_id_idx
  ON evaluation_participations (evaluation_id, student_id);

CREATE INDEX IF NOT EXISTS evaluation_participations_evaluation_id_status_idx
  ON evaluation_participations (evaluation_id, status);
