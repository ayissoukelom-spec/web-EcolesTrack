ALTER TABLE classes
  ADD COLUMN IF NOT EXISTS progression_code TEXT;

CREATE TABLE IF NOT EXISTS class_progressions (
  id SERIAL PRIMARY KEY,
  source_code TEXT NOT NULL,
  target_code TEXT NOT NULL,
  cycle_id INTEGER REFERENCES cycles(id) ON DELETE SET NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now(),
  CONSTRAINT class_progressions_source_cycle_unique UNIQUE (source_code, cycle_id)
);

-- Preserve existing school/year-specific rules during the transition.
-- They remain available through class_successions until they are explicitly migrated.
INSERT INTO class_progressions (source_code, target_code, is_active)
SELECT DISTINCT source_class.progression_code, target_class.progression_code, true
FROM class_successions succession
JOIN classes source_class ON source_class.id = succession.source_class_id
JOIN classes target_class ON target_class.id = succession.target_class_id
WHERE source_class.progression_code IS NOT NULL
  AND target_class.progression_code IS NOT NULL
ON CONFLICT DO NOTHING;
