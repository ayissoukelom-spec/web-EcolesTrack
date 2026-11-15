import { db } from './index.ts';
import {
  schools,
  academicYears,
  schoolTerms,
  users,
  teachers,
  parents,
  classes,
  students,
  evaluations,
  grades,
  absences,
  notifications,
  subjects,
  schoolSubjects,
  cycles,
  levels,
  schoolCycles,
  cyclePeriodTemplates,
} from './schema.ts';
import { and, eq, sql } from 'drizzle-orm';

export async function ensureEducationStructureSchema() {
  await db.execute(sql`CREATE TABLE IF NOT EXISTS cycles (
    id SERIAL PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT now()
  )`);
  await db.execute(sql`CREATE TABLE IF NOT EXISTS levels (
    id SERIAL PRIMARY KEY,
    cycle_id INTEGER NOT NULL REFERENCES cycles(id) ON DELETE RESTRICT,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    order_index INTEGER NOT NULL DEFAULT 1,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT now()
  )`);
  await db.execute(sql`CREATE TABLE IF NOT EXISTS school_cycles (
    id SERIAL PRIMARY KEY,
    school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    cycle_id INTEGER NOT NULL REFERENCES cycles(id) ON DELETE CASCADE,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP DEFAULT now(),
    UNIQUE (school_id, cycle_id)
  )`);
  await db.execute(sql`CREATE TABLE IF NOT EXISTS cycle_period_templates (
    id SERIAL PRIMARY KEY,
    cycle_id INTEGER NOT NULL REFERENCES cycles(id) ON DELETE CASCADE,
    period_type TEXT NOT NULL,
    name TEXT NOT NULL,
    order_index INTEGER NOT NULL DEFAULT 1,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP DEFAULT now(),
    UNIQUE (cycle_id, order_index)
  )`);
  await db.execute(sql`ALTER TABLE classes ADD COLUMN IF NOT EXISTS level_id INTEGER REFERENCES levels(id) ON DELETE SET NULL`);
  await db.execute(sql`ALTER TABLE school_terms ADD COLUMN IF NOT EXISTS cycle_id INTEGER REFERENCES cycles(id) ON DELETE SET NULL`);
  await db.execute(sql`ALTER TABLE school_terms ADD COLUMN IF NOT EXISTS template_id INTEGER REFERENCES cycle_period_templates(id) ON DELETE SET NULL`);
  await db.execute(sql`ALTER TABLE school_terms ADD COLUMN IF NOT EXISTS period_type TEXT`);

  await db.insert(cycles).values([
    { code: 'college', name: 'Collège' },
    { code: 'primaire', name: 'Primaire' },
    { code: 'lycee', name: 'Lycée' },
  ]).onConflictDoNothing({ target: cycles.code });

  const cycleRows = await db.select().from(cycles);
  const cycleByCode = new Map(cycleRows.map((cycle) => [cycle.code, cycle.id]));
  const levelDefaults = [
    ['college', '6e', '6ème', 1], ['college', '5e', '5ème', 2],
    ['college', '4e', '4ème', 3], ['college', '3e', '3ème', 4],
    ['primaire', 'maternelle1', 'Maternelle 1', 5], ['primaire', 'maternelle2', 'Maternelle 2', 6],
    ['primaire', 'cp1', 'CP1', 7], ['primaire', 'cp2', 'CP2', 8],
    ['primaire', 'ce1', 'CE1', 9], ['primaire', 'ce2', 'CE2', 10],
    ['primaire', 'cm1', 'CM1', 11], ['primaire', 'cm2', 'CM2', 12],
    ['lycee', '2nde', '2nde', 13], ['lycee', '1ere', '1ère', 14], ['lycee', 'tle', 'Tle', 15],
  ] as const;
  for (const [cycleCode, code, name, orderIndex] of levelDefaults) {
    const cycleId = cycleByCode.get(cycleCode);
    if (cycleId == null) continue;
    await db.insert(levels).values({ cycleId, code, name, orderIndex }).onConflictDoNothing({ target: levels.code });
  }

  const templateDefaults = [
    ['college', 'trimester', 'Trimestre 1', 1], ['college', 'trimester', 'Trimestre 2', 2], ['college', 'trimester', 'Trimestre 3', 3],
    ['primaire', 'trimester', 'Trimestre 1', 1], ['primaire', 'trimester', 'Trimestre 2', 2], ['primaire', 'trimester', 'Trimestre 3', 3],
    ['lycee', 'semester', 'Semestre 1', 1], ['lycee', 'semester', 'Semestre 2', 2],
  ] as const;
  for (const [cycleCode, periodType, name, orderIndex] of templateDefaults) {
    const cycleId = cycleByCode.get(cycleCode);
    if (cycleId == null) continue;
    await db.insert(cyclePeriodTemplates).values({ cycleId, periodType, name, orderIndex }).onConflictDoNothing();
  }

  await db.execute(sql`UPDATE school_terms SET period_type = CASE
    WHEN name ILIKE 'Semestre%' THEN 'semester'
    WHEN name ILIKE 'Trimestre%' THEN 'trimester'
    ELSE period_type END WHERE period_type IS NULL`);
  await db.execute(sql`UPDATE classes AS cls SET level_id = lvl.id FROM levels AS lvl
    WHERE cls.level_id IS NULL AND (
      (lvl.code = '6e' AND lower(cls.name) ~ '^(6e|6eme|6ème)([[:space:]]|$)') OR
      (lvl.code = '5e' AND lower(cls.name) ~ '^(5e|5eme|5ème)([[:space:]]|$)') OR
      (lvl.code = '4e' AND lower(cls.name) ~ '^(4e|4eme|4ème)([[:space:]]|$)') OR
      (lvl.code = '3e' AND lower(cls.name) ~ '^(3e|3eme|3ème)([[:space:]]|$)') OR
      (lvl.code = 'maternelle1' AND lower(cls.name) ~ '^(maternelle[[:space:]]*1|m[[:space:]]*1)([[:space:]]|$)') OR
      (lvl.code = 'maternelle2' AND lower(cls.name) ~ '^(maternelle[[:space:]]*2|m[[:space:]]*2)([[:space:]]|$)') OR
      (lvl.code = 'cp1' AND lower(cls.name) ~ '^(cp[[:space:]]*1)([[:space:]]|$)') OR
      (lvl.code = 'cp2' AND lower(cls.name) ~ '^(cp[[:space:]]*2)([[:space:]]|$)') OR
      (lvl.code = 'ce1' AND lower(cls.name) ~ '^(ce[[:space:]]*1)([[:space:]]|$)') OR
      (lvl.code = 'ce2' AND lower(cls.name) ~ '^(ce[[:space:]]*2)([[:space:]]|$)') OR
      (lvl.code = 'cm1' AND lower(cls.name) ~ '^(cm[[:space:]]*1)([[:space:]]|$)') OR
      (lvl.code = 'cm2' AND lower(cls.name) ~ '^(cm[[:space:]]*2)([[:space:]]|$)') OR
      (lvl.code = '2nde' AND lower(cls.name) ~ '^(2de|2nde)([[:space:]]|$)') OR
      (lvl.code = '1ere' AND lower(cls.name) ~ '^(1ere|1ère)([[:space:]]|$)') OR
      (lvl.code = 'tle' AND lower(cls.name) ~ '^(tle|terminale)([[:space:]]|$)')
    )`);
}

async function insertTemplateTerms(academicYearId: number, schoolId: number | null | undefined) {
  const templates = await db.select().from(cyclePeriodTemplates).where(eq(cyclePeriodTemplates.isActive, true)).orderBy(cyclePeriodTemplates.cycleId, cyclePeriodTemplates.orderIndex);
  if (templates.length === 0) return false;

  for (const template of templates) {
    const [existing] = await db.select({ id: schoolTerms.id }).from(schoolTerms).where(and(
      eq(schoolTerms.academicYearId, academicYearId),
      eq(schoolTerms.cycleId, template.cycleId),
      eq(schoolTerms.orderIndex, template.orderIndex),
    )).limit(1);
    if (existing) continue;

    await db.insert(schoolTerms).values({
      schoolId: schoolId ?? undefined,
      academicYearId,
      cycleId: template.cycleId,
      templateId: template.id,
      periodType: template.periodType,
      name: template.name,
      orderIndex: template.orderIndex,
      isActive: true,
    });
  }
  return true;
}

export async function ensureParentsTableSchema() {
  try {
    await db.execute(sql`ALTER TABLE parents ADD COLUMN IF NOT EXISTS student_id INTEGER;`);
    await db.execute(sql`ALTER TABLE parents ADD COLUMN IF NOT EXISTS school_id INTEGER;`);
  } catch (err: any) {
    console.error('Failed to ensure parents table schema exists:', err?.message || err);
    throw err;
  }
}

export async function ensureStudentsTableSchema() {
  try {
    await db.execute(sql`ALTER TABLE students ADD COLUMN IF NOT EXISTS gender TEXT;`);
  } catch (err: any) {
    console.error('Failed to ensure students table schema exists:', err?.message || err);
    throw err;
  }
}

export async function ensureClassTeachersTableExists() {
  try {
    await db.execute(sql`CREATE TABLE IF NOT EXISTS class_teachers (
      id SERIAL PRIMARY KEY,
      class_id INTEGER NOT NULL REFERENCES classes(id),
      teacher_id INTEGER NOT NULL REFERENCES teachers(id)
    );`);
  } catch (err: any) {
    console.error('Failed to ensure class_teachers table exists:', err?.message || err);
    throw err;
  }
}

export async function ensureSchoolClassesTableExists() {
  try {
    await db.execute(sql`CREATE TABLE IF NOT EXISTS school_classes (
      id SERIAL PRIMARY KEY,
      school_id INTEGER NOT NULL REFERENCES schools(id),
      class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TIMESTAMP DEFAULT now(),
      updated_at TIMESTAMP DEFAULT now()
    );`);
    await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS school_classes_school_id_class_id_idx ON school_classes (school_id, class_id);`);
  } catch (err: any) {
    console.error('Failed to ensure school_classes table exists:', err?.message || err);
    throw err;
  }
}

export async function ensureClassHomeroomAssignmentsTableExists() {
  try {
    await db.execute(sql`CREATE TABLE IF NOT EXISTS class_homeroom_assignments (
      id SERIAL PRIMARY KEY,
      school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
      class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
      teacher_id INTEGER NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
      created_at TIMESTAMP DEFAULT now() NOT NULL,
      updated_at TIMESTAMP DEFAULT now() NOT NULL
    );`);
    await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS class_homeroom_assignments_school_class_idx ON class_homeroom_assignments (school_id, class_id);`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS class_homeroom_assignments_school_teacher_idx ON class_homeroom_assignments (school_id, teacher_id);`);
    await db.execute(sql`
      INSERT INTO class_homeroom_assignments (school_id, class_id, teacher_id, created_at, updated_at)
      SELECT class_row.school_id, class_row.id, class_row.teacher_id, now(), now()
      FROM classes AS class_row
      INNER JOIN teachers AS teacher_row ON teacher_row.id = class_row.teacher_id
      WHERE class_row.school_id IS NOT NULL
        AND class_row.teacher_id IS NOT NULL
        AND (
          teacher_row.school_id = class_row.school_id
          OR EXISTS (
            SELECT 1
            FROM user_schools AS membership
            WHERE membership.user_id = teacher_row.user_id
              AND membership.school_id = class_row.school_id
              AND membership.role = 'teacher'
          )
        )
      ON CONFLICT (school_id, class_id) DO NOTHING;
    `);
  } catch (err: any) {
    console.error('Failed to ensure class_homeroom_assignments table exists:', err?.message || err);
    throw err;
  }
}

export async function ensureUsersTableSchema() {
  try {
    await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS academic_year_id INTEGER REFERENCES academic_years(id);`);
    await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS gender TEXT;`);
    await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMP;`);
  } catch (err: any) {
    console.error('Failed to ensure users table schema exists:', err?.message || err);
    throw err;
  }
}

export async function ensureSchoolsTableSchema() {
  try {
    await db.execute(sql`ALTER TABLE schools ADD COLUMN IF NOT EXISTS students_creation_locked BOOLEAN NOT NULL DEFAULT false;`);
    await db.execute(sql`ALTER TABLE schools ADD COLUMN IF NOT EXISTS logo_path TEXT;`);
    await db.execute(sql`ALTER TABLE schools ADD COLUMN IF NOT EXISTS principal_name TEXT;`);
    await db.execute(sql`ALTER TABLE schools ADD COLUMN IF NOT EXISTS promotion_threshold NUMERIC(5,2) NOT NULL DEFAULT 10.00;`);
    await db.execute(sql`ALTER TABLE classes ADD COLUMN IF NOT EXISTS progression_code TEXT;`);
    await db.execute(sql`CREATE TABLE IF NOT EXISTS class_successions (
      id SERIAL PRIMARY KEY,
      school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
      academic_year_id INTEGER NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
      source_class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
      target_class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
      created_at TIMESTAMP NOT NULL DEFAULT now(),
      updated_at TIMESTAMP NOT NULL DEFAULT now(),
      CONSTRAINT class_successions_source_target_different CHECK (source_class_id <> target_class_id),
      CONSTRAINT class_successions_school_year_source_unique UNIQUE (school_id, academic_year_id, source_class_id)
    );`);
    await db.execute(sql`CREATE TABLE IF NOT EXISTS class_progressions (
      id SERIAL PRIMARY KEY,
      source_code TEXT NOT NULL,
      target_code TEXT NOT NULL,
      cycle_id INTEGER REFERENCES cycles(id) ON DELETE SET NULL,
      is_active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMP NOT NULL DEFAULT now(),
      updated_at TIMESTAMP NOT NULL DEFAULT now(),
      CONSTRAINT class_progressions_source_cycle_unique UNIQUE (source_code, cycle_id)
    );`);
    await db.execute(sql`CREATE TABLE IF NOT EXISTS class_exam_configurations (
      id SERIAL PRIMARY KEY,
      class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
      school_id INTEGER REFERENCES schools(id) ON DELETE CASCADE,
      academic_year_id INTEGER NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
      exam_type TEXT NOT NULL CHECK (exam_type IN ('CEPD', 'BEPC', 'BAC_I', 'BAC_II')),
      is_active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMP NOT NULL DEFAULT now(),
      updated_at TIMESTAMP NOT NULL DEFAULT now()
    );`);
    await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS class_exam_configurations_school_context_unique
      ON class_exam_configurations (class_id, school_id, academic_year_id, exam_type)
      WHERE school_id IS NOT NULL;`);
    await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS class_exam_configurations_global_context_unique
      ON class_exam_configurations (class_id, academic_year_id, exam_type)
      WHERE school_id IS NULL;`);
    await db.execute(sql`CREATE TABLE IF NOT EXISTS exam_results (
      id SERIAL PRIMARY KEY,
      student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      academic_year_id INTEGER NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
      exam_type TEXT NOT NULL CHECK (exam_type IN ('CEPD', 'BEPC', 'BAC_I', 'BAC_II')),
      result_status TEXT NOT NULL CHECK (result_status IN ('ADMITTED', 'NOT_ADMITTED', 'ABSENT')),
      mention TEXT,
      exam_session TEXT,
      recorded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMP NOT NULL DEFAULT now(),
      updated_at TIMESTAMP NOT NULL DEFAULT now(),
      CONSTRAINT exam_results_student_year_type_unique UNIQUE (student_id, academic_year_id, exam_type)
    );`);
    await db.execute(sql`ALTER TABLE exam_results ADD COLUMN IF NOT EXISTS mention TEXT;`);
  } catch (err: any) {
    console.error('Failed to ensure schools table schema (students_creation_locked) exists:', err?.message || err);
    throw err;
  }
}

export async function ensureStudentMatriculesSchema() {
  try {
    await db.execute(sql`CREATE SEQUENCE IF NOT EXISTS student_matricule_seq START WITH 1 INCREMENT BY 1 NO CYCLE;`);
    await db.execute(sql`ALTER TABLE students ADD COLUMN IF NOT EXISTS matricule TEXT;`);
    await db.execute(sql`
      CREATE OR REPLACE FUNCTION assign_student_matricule()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.matricule IS NULL OR btrim(NEW.matricule) = '' THEN
          NEW.matricule := lpad(nextval('student_matricule_seq')::text, 5, '0')
            || COALESCE(NULLIF(upper(right(btrim(NEW.last_name), 1)), ''), 'X');
        END IF;
        RETURN NEW;
      END;
      $$;
    `);
    await db.execute(sql`DROP TRIGGER IF EXISTS assign_student_matricule_before_insert ON students;`);
    await db.execute(sql`
      CREATE TRIGGER assign_student_matricule_before_insert
      BEFORE INSERT ON students
      FOR EACH ROW EXECUTE FUNCTION assign_student_matricule();
    `);
    await db.execute(sql`
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
    `);
    await db.execute(sql`
      UPDATE students
      SET matricule = lpad(nextval('student_matricule_seq')::text, 5, '0')
        || COALESCE(NULLIF(upper(right(btrim(last_name), 1)), ''), 'X')
      WHERE matricule IS NULL OR btrim(matricule) = '';
    `);
    await db.execute(sql`ALTER TABLE students ALTER COLUMN matricule SET NOT NULL;`);
    await db.execute(sql`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'students_matricule_unique') THEN
          ALTER TABLE students ADD CONSTRAINT students_matricule_unique UNIQUE (matricule);
        END IF;
      END;
      $$;
    `);
  } catch (err: any) {
    console.error('Failed to ensure students.matricule schema exists:', err?.message || err);
    throw err;
  }
}

export async function ensureStudentAcademicYearStatusesTableExists() {
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS student_academic_year_statuses (
        id SERIAL PRIMARY KEY,
        student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
        academic_year_id INTEGER NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
        status TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT now(),
        updated_at TIMESTAMP NOT NULL DEFAULT now()
      );
    `);

    await db.execute(sql`ALTER TABLE student_academic_year_statuses ADD COLUMN IF NOT EXISTS status TEXT;`);
    await db.execute(sql`ALTER TABLE student_academic_year_statuses ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT now();`);
    await db.execute(sql`ALTER TABLE student_academic_year_statuses ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT now();`);

    await db.execute(sql`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conname = 'student_academic_year_statuses_student_year_unique'
        ) THEN
          ALTER TABLE student_academic_year_statuses
            ADD CONSTRAINT student_academic_year_statuses_student_year_unique UNIQUE (student_id, academic_year_id);
        END IF;
      END $$;
    `);

    await db.execute(sql`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conname = 'student_academic_year_statuses_status_check'
        ) THEN
          ALTER TABLE student_academic_year_statuses
            ADD CONSTRAINT student_academic_year_statuses_status_check CHECK (
              status IS NULL OR status IN ('Nouveau', 'Doublant', 'Triplant', 'Quadruplant', 'Quintuplant', 'Sextuplant')
            );
        END IF;
      END $$;
    `);
  } catch (err: any) {
    console.error('Failed to ensure student_academic_year_statuses table exists:', err?.message || err);
    throw err;
  }
}

export async function ensureUserSchoolsTableExists() {
  try {
    await db.execute(sql`CREATE TABLE IF NOT EXISTS user_schools (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
      role TEXT,
      is_active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMP DEFAULT now()
    );`);
    await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS user_schools_user_id_school_id_role_idx ON user_schools (user_id, school_id, role);`);
    // Ensure columns exist for older DBs that may have been created without them
    await db.execute(sql`ALTER TABLE user_schools ADD COLUMN IF NOT EXISTS role TEXT;`);
    await db.execute(sql`ALTER TABLE user_schools ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;`);
    await db.execute(sql`ALTER TABLE user_schools ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT now();`);
    // Ensure roles are backfilled from business tables before making the column NOT NULL.
    await db.execute(sql`
      UPDATE user_schools
      SET role = 'teacher'
      FROM teachers
      WHERE user_schools.role IS NULL
        AND user_schools.user_id = teachers.user_id
        AND user_schools.school_id = teachers.school_id;
    `);
    await db.execute(sql`
      UPDATE user_schools
      SET role = 'parent'
      FROM parents
      WHERE user_schools.role IS NULL
        AND user_schools.user_id = parents.user_id
        AND user_schools.school_id = parents.school_id;
    `);
    await db.execute(sql`
      UPDATE user_schools
      SET role = users.role
      FROM users
      WHERE user_schools.role IS NULL
        AND user_schools.user_id = users.id
        AND users.role IN ('teacher', 'parent', 'school_admin', 'student');
    `);
    await db.execute(sql`ALTER TABLE user_schools ALTER COLUMN role SET NOT NULL;`);
  } catch (err: any) {
    console.error('Failed to ensure user_schools table exists:', err?.message || err);
    throw err;
  }
}

export async function ensureTokenBlacklistTableExists() {
  try {
    await db.execute(sql`CREATE TABLE IF NOT EXISTS token_blacklist (
      id SERIAL PRIMARY KEY,
      token TEXT NOT NULL UNIQUE,
      token_jti TEXT,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      blacklisted_at TIMESTAMP NOT NULL DEFAULT now(),
      expires_at TIMESTAMP NOT NULL
    );`);
    await db.execute(sql`ALTER TABLE token_blacklist ADD COLUMN IF NOT EXISTS token_jti TEXT;`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS token_blacklist_token_jti_idx ON token_blacklist(token_jti);`);
  } catch (err: any) {
    console.error('Failed to ensure token_blacklist table exists:', err?.message || err);
    throw err;
  }
}

export async function ensureSchoolTermsTableExists() {
  try {
    await db.execute(sql`CREATE TABLE IF NOT EXISTS school_terms (
      id SERIAL PRIMARY KEY,
      school_id INTEGER REFERENCES schools(id),
      academic_year_id INTEGER NOT NULL REFERENCES academic_years(id),
      name TEXT NOT NULL,
      start_date TEXT,
      end_date TEXT,
      order_index INTEGER NOT NULL DEFAULT 1,
      is_active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMP DEFAULT now()
    );`);
    await db.execute(sql`ALTER TABLE school_terms ADD COLUMN IF NOT EXISTS school_id INTEGER REFERENCES schools(id);`);
    await db.execute(sql`ALTER TABLE school_terms ADD COLUMN IF NOT EXISTS academic_year_id INTEGER REFERENCES academic_years(id);`);
    await db.execute(sql`ALTER TABLE school_terms ADD COLUMN IF NOT EXISTS name TEXT;`);
    await db.execute(sql`ALTER TABLE school_terms ADD COLUMN IF NOT EXISTS start_date TEXT;`);
    await db.execute(sql`ALTER TABLE school_terms ADD COLUMN IF NOT EXISTS end_date TEXT;`);
    await db.execute(sql`ALTER TABLE school_terms ADD COLUMN IF NOT EXISTS order_index INTEGER NOT NULL DEFAULT 1;`);
    await db.execute(sql`ALTER TABLE school_terms ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;`);
    await db.execute(sql`ALTER TABLE school_terms ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT now();`);
  } catch (err: any) {
    console.error('Failed to ensure school_terms table exists:', err?.message || err);
    throw err;
  }
}

export async function ensureEvaluationsBulletinColumns() {
  try {
    await db.execute(sql`ALTER TABLE evaluations ADD COLUMN IF NOT EXISTS term_id INTEGER REFERENCES school_terms(id);`);
    await db.execute(sql`ALTER TABLE evaluations ADD COLUMN IF NOT EXISTS count_in_bulletin BOOLEAN NOT NULL DEFAULT true;`);
  } catch (err: any) {
    console.error('Failed to ensure evaluations bulletin columns exist:', err?.message || err);
    throw err;
  }
}

export async function ensureGradesTableSchema() {
  try {
    await db.execute(sql`ALTER TABLE grades ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT now();`);
    await db.execute(sql`ALTER TABLE grades ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT now();`);
    await db.execute(sql`UPDATE grades SET updated_at = COALESCE(updated_at, created_at, now()) WHERE updated_at IS NULL;`);
  } catch (err: any) {
    console.error('Failed to ensure grades table schema exists:', err?.message || err);
    throw err;
  }
}

export async function ensureBulletinSnapshotTablesExist() {
  try {
    await db.execute(sql`CREATE TABLE IF NOT EXISTS bulletins (
      id SERIAL PRIMARY KEY,
      student_id INTEGER NOT NULL REFERENCES students(id),
      class_id INTEGER NOT NULL REFERENCES classes(id),
      school_year_id INTEGER NOT NULL REFERENCES academic_years(id),
      term_id INTEGER NOT NULL REFERENCES school_terms(id),
      average TEXT,
      total_points TEXT NOT NULL,
      total_coefficients TEXT NOT NULL,
      rank INTEGER,
      mention TEXT,
      appreciation TEXT,
      generated_at TIMESTAMP NOT NULL DEFAULT now(),
      created_at TIMESTAMP NOT NULL DEFAULT now(),
      updated_at TIMESTAMP NOT NULL DEFAULT now()
    );`);

    await db.execute(sql`CREATE TABLE IF NOT EXISTS bulletin_lines (
      id SERIAL PRIMARY KEY,
      bulletin_id INTEGER NOT NULL REFERENCES bulletins(id) ON DELETE CASCADE,
      subject_id INTEGER,
      subject_name TEXT NOT NULL,
      coefficient INTEGER NOT NULL,
      average TEXT,
      teacher_comment TEXT,
      rank INTEGER,
      created_at TIMESTAMP NOT NULL DEFAULT now()
    );`);
  } catch (err: any) {
    console.error('Failed to ensure bulletin snapshot tables exist:', err?.message || err);
    throw err;
  }
}

export async function ensureDefaultSchoolTermsExist() {
  try {
    const existingTerms = await db.select({ count: sql<number>`count(*)::integer` }).from(schoolTerms);
    if ((existingTerms[0]?.count || 0) > 0) return;

    const years = await db.select().from(academicYears);
    for (const year of years) {
      const insertedFromTemplates = await insertTemplateTerms(year.id, year.schoolId);
      if (!insertedFromTemplates) {
        for (const term of [
          { name: 'Trimestre 1', orderIndex: 1 },
          { name: 'Trimestre 2', orderIndex: 2 },
          { name: 'Trimestre 3', orderIndex: 3 },
        ]) {
          await db.insert(schoolTerms).values({ schoolId: year.schoolId ?? undefined, academicYearId: year.id, name: term.name, orderIndex: term.orderIndex, isActive: true });
        }
      }
    }
  } catch (err: any) {
    console.error('Failed to ensure default school terms exist:', err?.message || err);
    throw err;
  }
}

/**
 * Seeding method to initialize the database with demo data if it's empty.
 */
export async function seedDatabaseIfEmpty() {
  console.log('Database initialization: automatic demo seed disabled.');
  console.log('The application can run with zero schools.');
}

export async function ensureAbsenceDeclarationsSchema() {
  try {
    await db.execute(sql`CREATE TABLE IF NOT EXISTS absence_declarations (
      id SERIAL PRIMARY KEY,
      student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      parent_id INTEGER NOT NULL REFERENCES parents(id) ON DELETE CASCADE,
      date TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      reason TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'RECEIVED',
      rejection_reason TEXT,
      reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      reviewed_at TIMESTAMP,
      created_at TIMESTAMP NOT NULL DEFAULT now(),
      updated_at TIMESTAMP NOT NULL DEFAULT now()
    )`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS absence_declarations_parent_date_idx ON absence_declarations(parent_id, date)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS absence_declarations_student_date_status_idx ON absence_declarations(student_id, date, status)`);
    await db.execute(sql`ALTER TABLE absences ADD COLUMN IF NOT EXISTS declaration_id INTEGER REFERENCES absence_declarations(id) ON DELETE SET NULL`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS absences_declaration_id_idx ON absences(declaration_id)`);
    await db.execute(sql`UPDATE absence_declarations SET status = CASE status
      WHEN 'PENDING' THEN 'RECEIVED'
      WHEN 'APPROVED' THEN 'ACCEPTED'
      WHEN 'REJECTED' THEN 'REFUSED'
      ELSE status
    END WHERE status IN ('PENDING', 'APPROVED', 'REJECTED')`);
    await db.execute(sql`UPDATE absences SET is_justified = false, justification_reason = NULL,
      justification_status = NULL, rejection_reason = NULL, reviewed_by = NULL, reviewed_at = NULL
      WHERE declaration_id IS NOT NULL AND justification_status = 'APPROVED'`);
  } catch (error: any) {
    console.error('Failed to ensure absence declarations schema exists:', error?.message || error);
    throw error;
  }
}

export async function ensureAbsenceTeachingAssignmentsSchema() {
  try {
    await db.execute(sql`CREATE TABLE IF NOT EXISTS teacher_class_subjects (
      id SERIAL PRIMARY KEY,
      teacher_id INTEGER NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
      school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
      class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
      subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
      is_active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMP NOT NULL DEFAULT now(),
      updated_at TIMESTAMP NOT NULL DEFAULT now(),
      CONSTRAINT teacher_class_subjects_teacher_school_class_subject_unique
        UNIQUE (teacher_id, school_id, class_id, subject_id)
    )`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS teacher_class_subjects_school_teacher_active_idx
      ON teacher_class_subjects (school_id, teacher_id, is_active)`);
    await db.execute(sql`ALTER TABLE absences
      ADD COLUMN IF NOT EXISTS teaching_assignment_id INTEGER
      REFERENCES teacher_class_subjects(id) ON DELETE SET NULL`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS absences_teaching_assignment_id_idx
      ON absences (teaching_assignment_id)`);
  } catch (error: any) {
    console.error('Failed to ensure absence teaching assignments schema exists:', error?.message || error);
    throw error;
  }
}

export async function verifyRestrictedRuntimeSchema() {
  const { rows } = await db.execute(sql`
    WITH required_tables(table_name) AS (
      VALUES
        ('cycles'), ('levels'), ('school_cycles'), ('cycle_period_templates'),
        ('school_terms'), ('classes'), ('parents'), ('students'), ('users'),
        ('schools'), ('class_successions'), ('class_progressions'),
        ('class_exam_configurations'), ('exam_results'),
        ('student_academic_year_statuses'), ('school_classes'),
        ('class_homeroom_assignments'), ('user_schools'),
        ('absence_declarations'), ('absences'), ('teacher_class_subjects'),
        ('teachers'), ('academic_years'), ('subjects'),
        ('audit_events'), ('user_login_events'), ('teacher_control_audit_events')
    ),
    required_columns(table_name, column_name) AS (
      VALUES
        ('cycles', 'id'), ('cycles', 'code'), ('cycles', 'name'),
        ('cycles', 'is_active'), ('cycles', 'created_at'),
        ('levels', 'id'), ('levels', 'cycle_id'), ('levels', 'code'),
        ('levels', 'name'), ('levels', 'order_index'), ('levels', 'is_active'),
        ('levels', 'created_at'),
        ('school_cycles', 'id'), ('school_cycles', 'school_id'),
        ('school_cycles', 'cycle_id'), ('school_cycles', 'is_active'),
        ('school_cycles', 'created_at'),
        ('cycle_period_templates', 'id'), ('cycle_period_templates', 'cycle_id'),
        ('cycle_period_templates', 'period_type'), ('cycle_period_templates', 'name'),
        ('cycle_period_templates', 'order_index'), ('cycle_period_templates', 'is_active'),
        ('cycle_period_templates', 'created_at'),
        ('school_terms', 'school_id'), ('school_terms', 'academic_year_id'),
        ('school_terms', 'name'), ('school_terms', 'start_date'),
        ('school_terms', 'end_date'), ('school_terms', 'order_index'),
        ('school_terms', 'is_active'), ('school_terms', 'created_at'),
        ('school_terms', 'cycle_id'), ('school_terms', 'template_id'),
        ('school_terms', 'period_type'),
        ('classes', 'id'), ('classes', 'name'), ('classes', 'school_id'),
        ('classes', 'teacher_id'), ('classes', 'level_id'),
        ('classes', 'progression_code'),
        ('parents', 'student_id'), ('parents', 'school_id'),
        ('students', 'id'), ('students', 'last_name'), ('students', 'gender'),
        ('students', 'matricule'),
        ('users', 'academic_year_id'), ('users', 'gender'), ('users', 'last_login_at'),
        ('schools', 'students_creation_locked'), ('schools', 'logo_path'),
        ('schools', 'principal_name'), ('schools', 'promotion_threshold'),
        ('class_successions', 'school_id'), ('class_successions', 'academic_year_id'),
        ('class_successions', 'source_class_id'), ('class_successions', 'target_class_id'),
        ('class_progressions', 'source_code'), ('class_progressions', 'target_code'),
        ('class_progressions', 'cycle_id'), ('class_progressions', 'is_active'),
        ('class_exam_configurations', 'class_id'), ('class_exam_configurations', 'school_id'),
        ('class_exam_configurations', 'academic_year_id'), ('class_exam_configurations', 'exam_type'),
        ('class_exam_configurations', 'is_active'),
        ('exam_results', 'student_id'), ('exam_results', 'academic_year_id'),
        ('exam_results', 'exam_type'), ('exam_results', 'result_status'),
        ('exam_results', 'mention'), ('exam_results', 'exam_session'),
        ('exam_results', 'recorded_by'),
        ('student_academic_year_statuses', 'student_id'),
        ('student_academic_year_statuses', 'academic_year_id'),
        ('student_academic_year_statuses', 'status'),
        ('school_classes', 'school_id'), ('school_classes', 'class_id'),
        ('school_classes', 'status'),
        ('class_homeroom_assignments', 'school_id'),
        ('class_homeroom_assignments', 'class_id'),
        ('class_homeroom_assignments', 'teacher_id'),
        ('user_schools', 'user_id'), ('user_schools', 'school_id'),
        ('user_schools', 'role'), ('user_schools', 'is_active'),
        ('user_schools', 'created_at'),
        ('absence_declarations', 'student_id'), ('absence_declarations', 'parent_id'),
        ('absence_declarations', 'date'), ('absence_declarations', 'status'),
        ('absences', 'declaration_id'), ('absences', 'teaching_assignment_id'),
        ('teacher_class_subjects', 'teacher_id'), ('teacher_class_subjects', 'school_id'),
        ('teacher_class_subjects', 'class_id'), ('teacher_class_subjects', 'subject_id'),
        ('teacher_class_subjects', 'is_active'),
        ('audit_events', 'id'), ('audit_events', 'actor_user_id'),
        ('audit_events', 'action'), ('audit_events', 'resource_type'),
        ('audit_events', 'resource_id'), ('audit_events', 'school_id'),
        ('audit_events', 'active_function_id'), ('audit_events', 'active_function_name'),
        ('audit_events', 'school_name_snapshot'), ('audit_events', 'occurred_at'),
        ('audit_events', 'module'), ('audit_events', 'result'), ('audit_events', 'source'),
        ('audit_events', 'before_values'), ('audit_events', 'after_values'),
        ('audit_events', 'ip_address'), ('audit_events', 'user_agent'),
        ('audit_events', 'correlation_id'), ('audit_events', 'reason'),
        ('audit_events', 'description'), ('audit_events', 'created_at'),
        ('user_login_events', 'id'), ('user_login_events', 'user_id'),
        ('user_login_events', 'role'), ('user_login_events', 'school_id'),
        ('user_login_events', 'login_at'), ('user_login_events', 'client_type'),
        ('user_login_events', 'actor_name_snapshot'), ('user_login_events', 'actor_email_snapshot'),
        ('user_login_events', 'school_name_snapshot'), ('user_login_events', 'active_function_id'),
        ('user_login_events', 'active_function_name'), ('user_login_events', 'occurred_at'),
        ('user_login_events', 'result'), ('user_login_events', 'source'),
        ('user_login_events', 'ip_address'), ('user_login_events', 'user_agent'),
        ('user_login_events', 'correlation_id'),
        ('teacher_control_audit_events', 'id'),
        ('teacher_control_audit_events', 'school_id'),
        ('teacher_control_audit_events', 'school_name_snapshot'),
        ('teacher_control_audit_events', 'actor_user_id'),
        ('teacher_control_audit_events', 'actor_role'),
        ('teacher_control_audit_events', 'actor_email_snapshot'),
        ('teacher_control_audit_events', 'actor_name_snapshot'),
        ('teacher_control_audit_events', 'action'),
        ('teacher_control_audit_events', 'resource_type'),
        ('teacher_control_audit_events', 'resource_id'),
        ('teacher_control_audit_events', 'before_values'),
        ('teacher_control_audit_events', 'after_values'),
        ('teacher_control_audit_events', 'reason'),
        ('teacher_control_audit_events', 'created_at')
    ),
    required_column_shapes(table_name, column_name, data_type, is_nullable) AS (
      VALUES
        ('audit_events', 'active_function_id', 'text', 'YES'),
        ('audit_events', 'active_function_name', 'text', 'YES'),
        ('audit_events', 'school_name_snapshot', 'text', 'YES'),
        ('audit_events', 'occurred_at', 'timestamp with time zone', 'YES'),
        ('audit_events', 'module', 'text', 'YES'),
        ('audit_events', 'result', 'text', 'YES'),
        ('audit_events', 'source', 'text', 'YES'),
        ('audit_events', 'before_values', 'jsonb', 'YES'),
        ('audit_events', 'after_values', 'jsonb', 'YES'),
        ('audit_events', 'ip_address', 'text', 'YES'),
        ('audit_events', 'user_agent', 'text', 'YES'),
        ('audit_events', 'correlation_id', 'text', 'YES'),
        ('audit_events', 'reason', 'text', 'YES'),
        ('user_login_events', 'actor_name_snapshot', 'text', 'YES'),
        ('user_login_events', 'actor_email_snapshot', 'text', 'YES'),
        ('user_login_events', 'school_name_snapshot', 'text', 'YES'),
        ('user_login_events', 'active_function_id', 'text', 'YES'),
        ('user_login_events', 'active_function_name', 'text', 'YES'),
        ('user_login_events', 'occurred_at', 'timestamp with time zone', 'YES'),
        ('user_login_events', 'result', 'text', 'YES'),
        ('user_login_events', 'source', 'text', 'YES'),
        ('user_login_events', 'ip_address', 'text', 'YES'),
        ('user_login_events', 'user_agent', 'text', 'YES'),
        ('user_login_events', 'correlation_id', 'text', 'YES'),
        ('teacher_control_audit_events', 'school_id', 'integer', 'NO'),
        ('teacher_control_audit_events', 'school_name_snapshot', 'text', 'NO'),
        ('teacher_control_audit_events', 'actor_user_id', 'integer', 'YES'),
        ('teacher_control_audit_events', 'actor_role', 'text', 'NO'),
        ('teacher_control_audit_events', 'actor_name_snapshot', 'text', 'NO'),
        ('teacher_control_audit_events', 'action', 'text', 'NO'),
        ('teacher_control_audit_events', 'resource_type', 'text', 'NO'),
        ('teacher_control_audit_events', 'resource_id', 'integer', 'YES'),
        ('teacher_control_audit_events', 'before_values', 'jsonb', 'YES'),
        ('teacher_control_audit_events', 'after_values', 'jsonb', 'YES'),
        ('teacher_control_audit_events', 'reason', 'text', 'YES'),
        ('teacher_control_audit_events', 'created_at', 'timestamp with time zone', 'NO'),
        ('cycles', 'code', 'text', 'NO'),
        ('cycles', 'name', 'text', 'NO'),
        ('cycles', 'is_active', 'boolean', 'NO'),
        ('levels', 'cycle_id', 'integer', 'NO'),
        ('levels', 'code', 'text', 'NO'),
        ('levels', 'name', 'text', 'NO'),
        ('levels', 'order_index', 'integer', 'NO'),
        ('school_cycles', 'school_id', 'integer', 'NO'),
        ('school_cycles', 'cycle_id', 'integer', 'NO'),
        ('cycle_period_templates', 'cycle_id', 'integer', 'NO'),
        ('cycle_period_templates', 'period_type', 'text', 'NO'),
        ('cycle_period_templates', 'order_index', 'integer', 'NO'),
        ('school_terms', 'academic_year_id', 'integer', 'NO'),
        ('school_terms', 'name', 'text', 'NO'),
        ('school_terms', 'start_date', 'text', 'YES'),
        ('school_terms', 'end_date', 'text', 'YES'),
        ('school_terms', 'order_index', 'integer', 'NO'),
        ('school_terms', 'is_active', 'boolean', 'NO'),
        ('school_terms', 'cycle_id', 'integer', 'YES'),
        ('school_terms', 'template_id', 'integer', 'YES'),
        ('school_terms', 'period_type', 'text', 'YES'),
        ('classes', 'level_id', 'integer', 'YES'),
        ('classes', 'progression_code', 'text', 'YES'),
        ('users', 'academic_year_id', 'integer', 'YES'),
        ('users', 'gender', 'text', 'YES'),
        ('users', 'last_login_at', 'timestamp without time zone', 'YES'),
        ('schools', 'students_creation_locked', 'boolean', 'NO'),
        ('schools', 'logo_path', 'text', 'YES'),
        ('schools', 'principal_name', 'text', 'YES'),
        ('schools', 'promotion_threshold', 'numeric', 'NO'),
        ('students', 'matricule', 'text', 'NO'),
        ('class_successions', 'school_id', 'integer', 'NO'),
        ('class_successions', 'academic_year_id', 'integer', 'NO'),
        ('class_successions', 'source_class_id', 'integer', 'NO'),
        ('class_successions', 'target_class_id', 'integer', 'NO'),
        ('class_progressions', 'source_code', 'text', 'NO'),
        ('class_progressions', 'target_code', 'text', 'NO'),
        ('class_progressions', 'cycle_id', 'integer', 'YES'),
        ('class_exam_configurations', 'class_id', 'integer', 'NO'),
        ('class_exam_configurations', 'school_id', 'integer', 'YES'),
        ('class_exam_configurations', 'academic_year_id', 'integer', 'NO'),
        ('class_exam_configurations', 'exam_type', 'text', 'NO'),
        ('exam_results', 'student_id', 'integer', 'NO'),
        ('exam_results', 'academic_year_id', 'integer', 'NO'),
        ('exam_results', 'exam_type', 'text', 'NO'),
        ('student_academic_year_statuses', 'student_id', 'integer', 'NO'),
        ('student_academic_year_statuses', 'academic_year_id', 'integer', 'NO'),
        ('student_academic_year_statuses', 'status', 'text', 'YES'),
        ('school_classes', 'school_id', 'integer', 'NO'),
        ('school_classes', 'class_id', 'integer', 'NO'),
        ('school_classes', 'status', 'text', 'NO'),
        ('class_homeroom_assignments', 'school_id', 'integer', 'NO'),
        ('class_homeroom_assignments', 'class_id', 'integer', 'NO'),
        ('class_homeroom_assignments', 'teacher_id', 'integer', 'NO'),
        ('user_schools', 'user_id', 'integer', 'NO'),
        ('user_schools', 'school_id', 'integer', 'NO'),
        ('user_schools', 'role', 'text', 'NO'),
        ('absence_declarations', 'student_id', 'integer', 'NO'),
        ('absence_declarations', 'parent_id', 'integer', 'NO'),
        ('absence_declarations', 'date', 'text', 'NO'),
        ('absence_declarations', 'status', 'text', 'NO'),
        ('absences', 'declaration_id', 'integer', 'YES'),
        ('absences', 'teaching_assignment_id', 'integer', 'YES'),
        ('teacher_class_subjects', 'teacher_id', 'integer', 'NO'),
        ('teacher_class_subjects', 'school_id', 'integer', 'NO'),
        ('teacher_class_subjects', 'class_id', 'integer', 'NO'),
        ('teacher_class_subjects', 'subject_id', 'integer', 'NO'),
        ('teacher_class_subjects', 'is_active', 'boolean', 'NO')
    ),
    required_defaults(table_name, column_name, expected_default) AS (
      VALUES
        ('audit_events', 'occurred_at', 'now()'),
        ('user_login_events', 'occurred_at', 'now()'),
        ('teacher_control_audit_events', 'created_at', 'now()'),
        ('schools', 'students_creation_locked', 'false'),
        ('schools', 'promotion_threshold', '10.00'),
        ('school_terms', 'order_index', '1'),
        ('school_terms', 'is_active', 'true'),
        ('cycles', 'is_active', 'true'),
        ('school_classes', 'status', '''pending'''),
        ('user_schools', 'is_active', 'true'),
        ('absence_declarations', 'status', '''RECEIVED'''),
        ('teacher_class_subjects', 'is_active', 'true')
    ),
    required_append_only_triggers(table_name, trigger_name, trigger_type) AS (
      VALUES
        ('audit_events', 'audit_events_append_only_row', 27),
        ('audit_events', 'audit_events_append_only_truncate', 34),
        ('user_login_events', 'user_login_events_append_only_row', 27),
        ('user_login_events', 'user_login_events_append_only_truncate', 34),
        ('grade_history', 'grade_history_append_only_row', 27),
        ('grade_history', 'grade_history_append_only_truncate', 34)
    ),
    required_indexes(table_name, index_name, is_unique) AS (
      VALUES
        ('school_classes', 'school_classes_school_id_class_id_idx', true),
        ('class_homeroom_assignments', 'class_homeroom_assignments_school_class_idx', true),
        ('class_homeroom_assignments', 'class_homeroom_assignments_school_teacher_idx', false),
        ('class_exam_configurations', 'class_exam_configurations_school_context_unique', true),
        ('class_exam_configurations', 'class_exam_configurations_global_context_unique', true),
        ('user_schools', 'user_schools_user_id_school_id_role_idx', true),
        ('absence_declarations', 'absence_declarations_parent_date_idx', false),
        ('absence_declarations', 'absence_declarations_student_date_status_idx', false),
        ('absences', 'absences_declaration_id_idx', false),
        ('teacher_class_subjects', 'teacher_class_subjects_school_teacher_active_idx', false),
        ('absences', 'absences_teaching_assignment_id_idx', false)
    ),
    required_unique_indexes(table_name, index_name, key_columns, predicate) AS (
      VALUES
        ('school_classes', 'school_classes_school_id_class_id_idx', ARRAY['school_id', 'class_id']::text[], NULL::text),
        ('class_homeroom_assignments', 'class_homeroom_assignments_school_class_idx', ARRAY['school_id', 'class_id']::text[], NULL::text),
        ('class_exam_configurations', 'class_exam_configurations_school_context_unique', ARRAY['class_id', 'school_id', 'academic_year_id', 'exam_type']::text[], 'school_id IS NOT NULL'),
        ('class_exam_configurations', 'class_exam_configurations_global_context_unique', ARRAY['class_id', 'academic_year_id', 'exam_type']::text[], 'school_id IS NULL'),
        ('user_schools', 'user_schools_user_id_school_id_role_idx', ARRAY['user_id', 'school_id', 'role']::text[], NULL::text)
    ),
    required_constraints(table_name, constraint_name) AS (
      VALUES
        ('students', 'students_matricule_unique'),
        ('student_academic_year_statuses', 'student_academic_year_statuses_student_year_unique'),
        ('student_academic_year_statuses', 'student_academic_year_statuses_status_check')
    ),
    required_unique_constraints(table_name, constraint_name, key_columns) AS (
      VALUES
        ('students', 'students_matricule_unique', ARRAY['matricule']::text[]),
        ('student_academic_year_statuses', 'student_academic_year_statuses_student_year_unique', ARRAY['student_id', 'academic_year_id']::text[])
    ),
    catalog_tables AS (
      SELECT relation.relname AS table_name
      FROM pg_catalog.pg_class relation
      JOIN pg_catalog.pg_namespace relation_schema
        ON relation_schema.oid = relation.relnamespace
      WHERE relation_schema.nspname = 'public'
        AND relation.relkind IN ('r', 'p')
    ),
    catalog_columns AS (
      SELECT
        relation.relname AS table_name,
        attribute.attname AS column_name,
        CASE column_type.typname
          WHEN 'bool' THEN 'boolean'
          WHEN 'int2' THEN 'smallint'
          WHEN 'int4' THEN 'integer'
          WHEN 'int8' THEN 'bigint'
          WHEN 'timestamp' THEN 'timestamp without time zone'
          WHEN 'timestamptz' THEN 'timestamp with time zone'
          ELSE pg_catalog.format_type(attribute.atttypid, NULL)
        END AS data_type,
        CASE WHEN attribute.attnotnull THEN 'NO' ELSE 'YES' END AS is_nullable,
        pg_catalog.pg_get_expr(column_default.adbin, column_default.adrelid) AS column_default
      FROM pg_catalog.pg_attribute attribute
      JOIN pg_catalog.pg_class relation
        ON relation.oid = attribute.attrelid
      JOIN pg_catalog.pg_namespace relation_schema
        ON relation_schema.oid = relation.relnamespace
      JOIN pg_catalog.pg_type column_type
        ON column_type.oid = attribute.atttypid
      LEFT JOIN pg_catalog.pg_attrdef column_default
        ON column_default.adrelid = relation.oid
       AND column_default.adnum = attribute.attnum
      WHERE relation_schema.nspname = 'public'
        AND relation.relkind IN ('r', 'p')
        AND attribute.attnum > 0
        AND NOT attribute.attisdropped
    ),
    missing AS (
      SELECT 'table public.' || expected.table_name AS item
      FROM required_tables expected
      LEFT JOIN catalog_tables actual
        ON actual.table_name = expected.table_name
      WHERE actual.table_name IS NULL

      UNION ALL

      SELECT 'column public.' || expected.table_name || '.' || expected.column_name
      FROM required_columns expected
      LEFT JOIN catalog_columns actual
        ON actual.table_name = expected.table_name
       AND actual.column_name = expected.column_name
      WHERE actual.column_name IS NULL

      UNION ALL

      SELECT 'column type/nullability public.' || expected.table_name || '.' || expected.column_name
      FROM required_column_shapes expected
      LEFT JOIN catalog_columns actual
        ON actual.table_name = expected.table_name
       AND actual.column_name = expected.column_name
      WHERE actual.column_name IS NULL
         OR actual.data_type IS DISTINCT FROM expected.data_type
         OR actual.is_nullable IS DISTINCT FROM expected.is_nullable

      UNION ALL

      SELECT 'column default public.' || expected.table_name || '.' || expected.column_name
      FROM required_defaults expected
      LEFT JOIN catalog_columns actual
        ON actual.table_name = expected.table_name
       AND actual.column_name = expected.column_name
      WHERE replace(actual.column_default, '::text', '') IS DISTINCT FROM expected.expected_default

      UNION ALL

      SELECT 'function public.reject_audit_history_mutation()' AS item
      WHERE NOT EXISTS (
        SELECT 1
        FROM pg_proc protected_function
        JOIN pg_language function_language ON function_language.oid = protected_function.prolang
        WHERE protected_function.oid = to_regprocedure('public.reject_audit_history_mutation()')
          AND function_language.lanname = 'plpgsql'
          AND NOT protected_function.prosecdef
          AND protected_function.prosrc ILIKE '%RAISE EXCEPTION%'
          AND protected_function.prosrc ILIKE '%append-only%'
      )

      UNION ALL

      SELECT 'append-only trigger public.' || expected.table_name || '.' || expected.trigger_name
      FROM required_append_only_triggers expected
      WHERE (expected.table_name <> 'grade_history'
             OR to_regclass('public.grade_history') IS NOT NULL)
        AND NOT EXISTS (
          SELECT 1
          FROM pg_trigger trigger_object
          WHERE trigger_object.tgrelid = to_regclass('public.' || expected.table_name)
            AND trigger_object.tgname = expected.trigger_name
            AND trigger_object.tgtype = expected.trigger_type
            AND trigger_object.tgenabled = 'A'
            AND trigger_object.tgfoid = to_regprocedure('public.reject_audit_history_mutation()')
            AND NOT trigger_object.tgisinternal
        )

      UNION ALL

      SELECT 'Teacher Control trigger public.' || expected.trigger_name
      FROM (VALUES
        ('teacher_control_audit_events_append_only', 27),
        ('teacher_control_audit_events_no_truncate', 34)
      ) AS expected(trigger_name, trigger_type)
      WHERE NOT EXISTS (
        SELECT 1
        FROM pg_trigger trigger_object
        WHERE trigger_object.tgrelid = to_regclass('public.teacher_control_audit_events')
          AND trigger_object.tgname = expected.trigger_name
          AND trigger_object.tgtype = expected.trigger_type
          AND trigger_object.tgenabled = 'A'
          AND trigger_object.tgfoid = to_regprocedure('public.prevent_teacher_control_history_mutation()')
          AND NOT trigger_object.tgisinternal
      )

      UNION ALL

      SELECT 'function public.prevent_teacher_control_history_mutation()'
      WHERE NOT EXISTS (
        SELECT 1
        FROM pg_proc protected_function
        JOIN pg_language function_language ON function_language.oid = protected_function.prolang
        WHERE protected_function.oid = to_regprocedure('public.prevent_teacher_control_history_mutation()')
          AND function_language.lanname = 'plpgsql'
          AND NOT protected_function.prosecdef
          AND protected_function.prosrc ILIKE '%RAISE EXCEPTION%'
          AND protected_function.prosrc ILIKE '%append-only%'
      )

      UNION ALL

      SELECT 'targeted destructive journal foreign keys'
      WHERE EXISTS (
        SELECT 1
        FROM pg_constraint constraint_object
        JOIN pg_class child ON child.oid = constraint_object.conrelid
        JOIN pg_namespace child_schema ON child_schema.oid = child.relnamespace
        JOIN pg_class parent ON parent.oid = constraint_object.confrelid
        JOIN pg_namespace parent_schema ON parent_schema.oid = parent.relnamespace
        JOIN pg_attribute child_column
          ON child_column.attrelid = constraint_object.conrelid
         AND child_column.attnum = constraint_object.conkey[1]
        JOIN pg_attribute parent_column
          ON parent_column.attrelid = constraint_object.confrelid
         AND parent_column.attnum = constraint_object.confkey[1]
        WHERE constraint_object.contype = 'f'
          AND array_length(constraint_object.conkey, 1) = 1
          AND array_length(constraint_object.confkey, 1) = 1
          AND child_schema.nspname = 'public'
          AND parent_schema.nspname = 'public'
          AND (
            (child.relname = 'audit_events' AND child_column.attname = 'actor_user_id'
              AND parent.relname = 'users' AND parent_column.attname = 'id')
            OR (child.relname = 'audit_events' AND child_column.attname = 'school_id'
              AND parent.relname = 'schools' AND parent_column.attname = 'id')
            OR (child.relname = 'user_login_events' AND child_column.attname = 'user_id'
              AND parent.relname = 'users' AND parent_column.attname = 'id')
            OR (child.relname = 'user_login_events' AND child_column.attname = 'school_id'
              AND parent.relname = 'schools' AND parent_column.attname = 'id')
            OR (child.relname = 'grade_history' AND child_column.attname = 'grade_id'
              AND parent.relname = 'grades' AND parent_column.attname = 'id')
            OR (child.relname = 'grade_history' AND child_column.attname = 'changed_by'
              AND parent.relname = 'users' AND parent_column.attname = 'id')
          )
      )

      UNION ALL

      SELECT 'runtime role must not have CREATE on public'
      WHERE has_schema_privilege(current_user, 'public', 'CREATE')

      UNION ALL

      SELECT 'runtime role lacks USAGE on public'
      WHERE NOT has_schema_privilege(current_user, 'public', 'USAGE')

      UNION ALL

      SELECT 'runtime role has administrative attributes'
      WHERE EXISTS (
        SELECT 1
        FROM pg_roles elevated_role
        WHERE (elevated_role.rolsuper OR elevated_role.rolcreatedb OR elevated_role.rolcreaterole)
          AND pg_has_role(current_user, elevated_role.oid, 'MEMBER')
      )

      UNION ALL

      SELECT 'runtime role owns or inherits ownership of public objects'
      WHERE EXISTS (
        SELECT 1
        FROM pg_class owned_object
        JOIN pg_namespace object_schema ON object_schema.oid = owned_object.relnamespace
        WHERE object_schema.nspname = 'public'
          AND owned_object.relkind IN ('r', 'p', 'S', 'v', 'm')
          AND pg_has_role(current_user, owned_object.relowner, 'MEMBER')
      )

      UNION ALL

      SELECT 'runtime role can mutate append-only journal public.' || expected.table_name
      FROM (VALUES
        ('audit_events'),
        ('user_login_events'),
        ('teacher_control_audit_events'),
        ('grade_history')
      ) AS expected(table_name)
      WHERE (expected.table_name <> 'grade_history'
             OR to_regclass('public.grade_history') IS NOT NULL)
        AND (
          has_table_privilege(current_user, 'public.' || expected.table_name, 'UPDATE')
          OR has_any_column_privilege(current_user, 'public.' || expected.table_name, 'UPDATE')
          OR has_table_privilege(current_user, 'public.' || expected.table_name, 'DELETE')
          OR has_table_privilege(current_user, 'public.' || expected.table_name, 'TRUNCATE')
        )

      UNION ALL

      SELECT 'index public.' || expected.index_name
      FROM required_indexes expected
      WHERE NOT EXISTS (
        SELECT 1
        FROM pg_class index_object
        JOIN pg_namespace index_schema ON index_schema.oid = index_object.relnamespace
        JOIN pg_index index_definition ON index_definition.indexrelid = index_object.oid
        JOIN pg_class indexed_table ON indexed_table.oid = index_definition.indrelid
        JOIN pg_namespace table_schema ON table_schema.oid = indexed_table.relnamespace
        WHERE index_schema.nspname = 'public'
          AND index_object.relname = expected.index_name
          AND index_object.relkind = 'i'
          AND table_schema.nspname = 'public'
          AND indexed_table.relname = expected.table_name
          AND index_definition.indisvalid
          AND index_definition.indisready
          AND index_definition.indisunique = expected.is_unique
      )

      UNION ALL

      SELECT 'constraint public.' || expected.table_name || '.' || expected.constraint_name
      FROM required_constraints expected
      LEFT JOIN pg_constraint actual
        ON actual.conrelid = to_regclass('public.' || expected.table_name)
       AND actual.conname = expected.constraint_name
      WHERE actual.oid IS NULL

      UNION ALL

      SELECT 'unique constraint definition public.' || expected.table_name || '.' || expected.constraint_name
      FROM required_unique_constraints expected
      WHERE NOT EXISTS (
        SELECT 1
        FROM pg_constraint constraint_object
        WHERE constraint_object.conrelid = to_regclass('public.' || expected.table_name)
          AND constraint_object.conname = expected.constraint_name
          AND constraint_object.contype = 'u'
          AND constraint_object.convalidated
          AND ARRAY(
            SELECT attribute.attname::text
            FROM unnest(constraint_object.conkey) WITH ORDINALITY AS key_column(attnum, ordinal)
            JOIN pg_attribute attribute
              ON attribute.attrelid = constraint_object.conrelid
             AND attribute.attnum = key_column.attnum
            ORDER BY key_column.ordinal
          ) = expected.key_columns
      )

      UNION ALL

      SELECT 'unique index definition public.' || expected.index_name
      FROM required_unique_indexes expected
      WHERE NOT EXISTS (
        SELECT 1
        FROM pg_class index_object
        JOIN pg_namespace index_schema ON index_schema.oid = index_object.relnamespace
        JOIN pg_index index_definition ON index_definition.indexrelid = index_object.oid
        JOIN pg_class indexed_table ON indexed_table.oid = index_definition.indrelid
        WHERE index_schema.nspname = 'public'
          AND index_object.relname = expected.index_name
          AND indexed_table.relnamespace = index_schema.oid
          AND indexed_table.relname = expected.table_name
          AND index_definition.indisunique
          AND index_definition.indisvalid
          AND index_definition.indisready
          AND ARRAY(
            SELECT attribute.attname::text
            FROM unnest(index_definition.indkey) WITH ORDINALITY AS key_column(attnum, ordinal)
            JOIN pg_attribute attribute
              ON attribute.attrelid = index_definition.indrelid
             AND attribute.attnum = key_column.attnum
            WHERE key_column.ordinal <= index_definition.indnkeyatts
            ORDER BY key_column.ordinal
          ) = expected.key_columns
          AND (
            (expected.predicate IS NULL AND index_definition.indpred IS NULL)
            OR (
              expected.predicate IS NOT NULL
              AND btrim(regexp_replace(pg_get_expr(index_definition.indpred, index_definition.indrelid), '[[:space:]]+', ' ', 'g'), '()')
                = expected.predicate
            )
          )
      )

      UNION ALL

      SELECT 'sequence public.student_matricule_seq'
      WHERE NOT EXISTS (
        SELECT 1
        FROM pg_class sequence_object
        JOIN pg_namespace sequence_schema ON sequence_schema.oid = sequence_object.relnamespace
        WHERE sequence_schema.nspname = 'public'
          AND sequence_object.relname = 'student_matricule_seq'
          AND sequence_object.relkind = 'S'
      )

      UNION ALL

      SELECT 'function public.assign_student_matricule()'
      WHERE NOT EXISTS (
        SELECT 1
        FROM pg_proc assignment_function
        JOIN pg_language function_language ON function_language.oid = assignment_function.prolang
        WHERE assignment_function.oid = to_regprocedure('public.assign_student_matricule()')
          AND function_language.lanname = 'plpgsql'
          AND NOT assignment_function.prosecdef
          AND assignment_function.prosrc ILIKE '%nextval%'
          AND assignment_function.prosrc ILIKE '%matricule%'
      )

      UNION ALL

      SELECT 'trigger public.students.assign_student_matricule_before_insert'
      WHERE NOT EXISTS (
        SELECT 1
        FROM pg_trigger trigger_object
        WHERE trigger_object.tgrelid = to_regclass('public.students')
          AND trigger_object.tgname = 'assign_student_matricule_before_insert'
          AND trigger_object.tgfoid = to_regprocedure('public.assign_student_matricule()')
          AND trigger_object.tgtype = 7
          AND trigger_object.tgenabled IN ('O', 'A')
          AND NOT trigger_object.tgisinternal
      )

      UNION ALL

      SELECT 'NOT NULL public.students.matricule'
      WHERE NOT EXISTS (
        SELECT 1
        FROM catalog_columns actual
        WHERE actual.table_name = 'students'
          AND actual.column_name = 'matricule'
          AND actual.is_nullable = 'NO'
      )

      UNION ALL

      SELECT 'NOT NULL public.user_schools.role'
      WHERE NOT EXISTS (
        SELECT 1
        FROM catalog_columns actual
        WHERE actual.table_name = 'user_schools'
          AND actual.column_name = 'role'
          AND actual.is_nullable = 'NO'
      )
    )
    SELECT item FROM missing ORDER BY item
  `);

  if (rows.length > 0) {
    const missingItems = rows.map((row: { item: string }) => row.item);
    throw new Error(
      `Restricted database runtime cannot start; required schema is missing or incompatible: ${missingItems.join(', ')}`,
    );
  }
}
