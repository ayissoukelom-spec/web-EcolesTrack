CREATE TABLE IF NOT EXISTS cycles (
  id SERIAL PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP DEFAULT now()
);

CREATE TABLE IF NOT EXISTS levels (
  id SERIAL PRIMARY KEY,
  cycle_id INTEGER NOT NULL REFERENCES cycles(id) ON DELETE RESTRICT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  order_index INTEGER NOT NULL DEFAULT 1,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP DEFAULT now()
);

CREATE TABLE IF NOT EXISTS school_cycles (
  id SERIAL PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  cycle_id INTEGER NOT NULL REFERENCES cycles(id) ON DELETE CASCADE,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP DEFAULT now(),
  CONSTRAINT school_cycles_school_id_cycle_id_unique UNIQUE (school_id, cycle_id)
);

CREATE TABLE IF NOT EXISTS cycle_period_templates (
  id SERIAL PRIMARY KEY,
  cycle_id INTEGER NOT NULL REFERENCES cycles(id) ON DELETE CASCADE,
  period_type TEXT NOT NULL CHECK (period_type IN ('trimester', 'semester')),
  name TEXT NOT NULL,
  order_index INTEGER NOT NULL DEFAULT 1,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP DEFAULT now(),
  CONSTRAINT cycle_period_templates_cycle_order_unique UNIQUE (cycle_id, order_index)
);

ALTER TABLE classes ADD COLUMN IF NOT EXISTS level_id INTEGER REFERENCES levels(id) ON DELETE SET NULL;
ALTER TABLE school_terms ADD COLUMN IF NOT EXISTS cycle_id INTEGER REFERENCES cycles(id) ON DELETE SET NULL;
ALTER TABLE school_terms ADD COLUMN IF NOT EXISTS template_id INTEGER REFERENCES cycle_period_templates(id) ON DELETE SET NULL;
ALTER TABLE school_terms ADD COLUMN IF NOT EXISTS period_type TEXT;

INSERT INTO cycles (code, name) VALUES
  ('college', 'Collège'),
  ('lycee', 'Lycée')
ON CONFLICT (code) DO NOTHING;

INSERT INTO levels (cycle_id, code, name, order_index)
SELECT c.id, v.code, v.name, v.order_index
FROM cycles c
JOIN (VALUES
  ('college', '6e', '6ème', 1),
  ('college', '5e', '5ème', 2),
  ('college', '4e', '4ème', 3),
  ('college', '3e', '3ème', 4),
  ('lycee', '2nde', '2nde', 5),
  ('lycee', '1ere', '1ère', 6),
  ('lycee', 'tle', 'Tle', 7)
) AS v(cycle_code, code, name, order_index) ON v.cycle_code = c.code
ON CONFLICT (code) DO NOTHING;

INSERT INTO cycle_period_templates (cycle_id, period_type, name, order_index)
SELECT c.id, v.period_type, v.name, v.order_index
FROM cycles c
JOIN (VALUES
  ('college', 'trimester', 'Trimestre 1', 1),
  ('college', 'trimester', 'Trimestre 2', 2),
  ('college', 'trimester', 'Trimestre 3', 3),
  ('lycee', 'semester', 'Semestre 1', 1),
  ('lycee', 'semester', 'Semestre 2', 2)
) AS v(cycle_code, period_type, name, order_index) ON v.cycle_code = c.code
ON CONFLICT (cycle_id, order_index) DO NOTHING;

UPDATE classes AS cls
SET level_id = lvl.id
FROM levels AS lvl
WHERE cls.level_id IS NULL
  AND (
    (lvl.code = '6e' AND lower(cls.name) ~ '^(6e|6eme|6ème)([[:space:]]|$)') OR
    (lvl.code = '5e' AND lower(cls.name) ~ '^(5e|5eme|5ème)([[:space:]]|$)') OR
    (lvl.code = '4e' AND lower(cls.name) ~ '^(4e|4eme|4ème)([[:space:]]|$)') OR
    (lvl.code = '3e' AND lower(cls.name) ~ '^(3e|3eme|3ème)([[:space:]]|$)') OR
    (lvl.code = '2nde' AND lower(cls.name) ~ '^(2de|2nde)([[:space:]]|$)') OR
    (lvl.code = '1ere' AND lower(cls.name) ~ '^(1ere|1ère)([[:space:]]|$)') OR
    (lvl.code = 'tle' AND lower(cls.name) ~ '^(tle|terminale)([[:space:]]|$)')
  );

INSERT INTO school_cycles (school_id, cycle_id)
SELECT DISTINCT sc.school_id, lvl.cycle_id
FROM school_classes sc
JOIN classes cls ON cls.id = sc.class_id
JOIN levels lvl ON lvl.id = cls.level_id
ON CONFLICT (school_id, cycle_id) DO NOTHING;

UPDATE school_terms
SET period_type = CASE
  WHEN name ILIKE 'Semestre%' THEN 'semester'
  WHEN name ILIKE 'Trimestre%' THEN 'trimester'
  ELSE period_type
END
WHERE period_type IS NULL;