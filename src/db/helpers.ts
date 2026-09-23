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
  gradeHistory,
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
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP DEFAULT now()
  )`);
  await db.execute(sql`CREATE TABLE IF NOT EXISTS levels (
    id SERIAL PRIMARY KEY,
    cycle_id INTEGER NOT NULL REFERENCES cycles(id) ON DELETE RESTRICT,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    order_index INTEGER NOT NULL DEFAULT 1,
    is_active BOOLEAN NOT NULL DEFAULT true,
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
    { code: 'lycee', name: 'Lycée' },
  ]).onConflictDoNothing({ target: cycles.code });

  const cycleRows = await db.select().from(cycles);
  const cycleByCode = new Map(cycleRows.map((cycle) => [cycle.code, cycle.id]));
  const levelDefaults = [
    ['college', '6e', '6ème', 1], ['college', '5e', '5ème', 2],
    ['college', '4e', '4ème', 3], ['college', '3e', '3ème', 4],
    ['lycee', '2nde', '2nde', 5], ['lycee', '1ere', '1ère', 6], ['lycee', 'tle', 'Tle', 7],
  ] as const;
  for (const [cycleCode, code, name, orderIndex] of levelDefaults) {
    const cycleId = cycleByCode.get(cycleCode);
    if (cycleId == null) continue;
    await db.insert(levels).values({ cycleId, code, name, orderIndex }).onConflictDoNothing({ target: levels.code });
  }

  const templateDefaults = [
    ['college', 'trimester', 'Trimestre 1', 1], ['college', 'trimester', 'Trimestre 2', 2], ['college', 'trimester', 'Trimestre 3', 3],
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

/**
 * Ensure the audit_events table exists and contains expected columns.
 */
export async function ensureAuditEventsTableExists() {
  try {
    await db.execute(sql`CREATE TABLE IF NOT EXISTS audit_events (
      id SERIAL PRIMARY KEY,
      actor_user_id INTEGER REFERENCES users(id),
      actor_role TEXT NOT NULL,
      actor_email TEXT,
      actor_name TEXT,
      action TEXT NOT NULL,
      resource_type TEXT NOT NULL,
      resource_id INTEGER,
      school_id INTEGER REFERENCES schools(id),
      description TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT now()
    );`);

    await db.execute(sql`ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS actor_email TEXT;`);
    await db.execute(sql`ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS actor_name TEXT;`);
  } catch (err: any) {
    console.error('Failed to ensure audit_events table exists:', err?.message || err);
    throw err;
  }
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

export async function ensureUsersTableSchema() {
  try {
    await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS academic_year_id INTEGER REFERENCES academic_years(id);`);
    await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS gender TEXT;`);
    await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMP;`);
    await db.execute(sql`ALTER TABLE users DROP CONSTRAINT IF EXISTS users_email_unique;`);

    const duplicateCheck = await db.execute(sql`SELECT 1 AS duplicate
      FROM users
      GROUP BY LOWER(email)
      HAVING COUNT(*) > 1
      LIMIT 1;`);

    if (Array.isArray(duplicateCheck.rows) && duplicateCheck.rows.length > 0) {
      console.warn('Skipping users.email UNIQUE constraint because duplicate emails already exist; new duplicates are blocked by application checks.');
    } else {
      await db.execute(sql`ALTER TABLE users ADD CONSTRAINT users_email_unique UNIQUE (email);`);
    }
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
      exam_session TEXT,
      recorded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMP NOT NULL DEFAULT now(),
      updated_at TIMESTAMP NOT NULL DEFAULT now(),
      CONSTRAINT exam_results_student_year_type_unique UNIQUE (student_id, academic_year_id, exam_type)
    );`);
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
    await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS user_schools_user_id_school_id_idx ON user_schools (user_id, school_id);`);
    // Ensure columns exist for older DBs that may have been created without them
    await db.execute(sql`ALTER TABLE user_schools ADD COLUMN IF NOT EXISTS role TEXT;`);
    await db.execute(sql`ALTER TABLE user_schools ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;`);
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
    await db.execute(sql`UPDATE user_schools SET is_active = true WHERE is_active IS NULL;`);
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
    await db.execute(sql`CREATE TABLE IF NOT EXISTS grade_history (
      id SERIAL PRIMARY KEY,
      grade_id INTEGER NOT NULL REFERENCES grades(id) ON DELETE CASCADE,
      old_value TEXT,
      new_value TEXT,
      changed_by INTEGER REFERENCES users(id),
      changed_at TIMESTAMP NOT NULL DEFAULT now()
    );`);
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
