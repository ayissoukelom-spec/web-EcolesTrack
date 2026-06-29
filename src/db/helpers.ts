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
} from './schema.ts';
import { sql } from 'drizzle-orm';

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
  } catch (err: any) {
    console.error('Failed to ensure users table schema exists:', err?.message || err);
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
      const defaultTerms = [
        { name: 'Trimestre 1', orderIndex: 1 },
        { name: 'Trimestre 2', orderIndex: 2 },
        { name: 'Trimestre 3', orderIndex: 3 },
      ];

      for (const term of defaultTerms) {
        await db.insert(schoolTerms).values({
          schoolId: year.schoolId ?? undefined,
          academicYearId: year.id,
          name: term.name,
          orderIndex: term.orderIndex,
          isActive: true,
        });
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
  try {
    // Check if schools table is empty
    const schoolCountResult = await db.select({ count: sql<number>`count(*)::integer` }).from(schools);
    const count = schoolCountResult[0]?.count || 0;

    if (count > 0) {
      console.log('Database already seeded or has schools. Skipping seed.');
      return;
    }

    console.log('Database is empty. Initializing seed data for EcoleTrack...');

    // 1. Insert School
    const schoolInsert = await db.insert(schools).values({
      name: 'C.S LE SAVOIR',
      address: '25 Avenue de la République, 75011 Paris',
      phone: '+228 90000000',
    }).returning();
    const mainSchool = schoolInsert[0];

    // 2. Insert Academic Year
    const yearInsert = await db.insert(academicYears).values({
      schoolId: mainSchool.id,
      name: '2025-2026',
      isActive: true,
    }).returning();
    const activeYear = yearInsert[0];

    // 2b. Insert default terms for the active academic year
    const defaultTerms = [
      { name: 'Trimestre 1', orderIndex: 1 },
      { name: 'Trimestre 2', orderIndex: 2 },
      { name: 'Trimestre 3', orderIndex: 3 },
    ];

    for (const term of defaultTerms) {
      await db.insert(schoolTerms).values({
        schoolId: mainSchool.id,
        academicYearId: activeYear.id,
        name: term.name,
        orderIndex: term.orderIndex,
        isActive: true,
      });
    }

    // 3. Insert Simulated Users
    // Super Admin
    const superAdminUser = await db.insert(users).values({
      uid: 'sim_superadmin_123',
      email: 'superadmin@ecoletrack.fr',
      name: 'M. Jean-Marc Super-Admin',
      role: 'super_admin',
    }).returning();

    // School Admin
    const schoolAdminUser = await db.insert(users).values({
      uid: 'sim_schooladmin_123',
      email: 'valerie.admin@ecoletrack.fr',
      name: 'Directrice Valérie Bertrand',
      role: 'school_admin',
      schoolId: mainSchool.id,
    }).returning();

    // Teacher
    const teacherUser = await db.insert(users).values({
      uid: 'sim_teacher_123',
      email: 'f.martin.prof@ecoletrack.fr',
      name: 'M. François Martin',
      role: 'teacher',
      schoolId: mainSchool.id,
    }).returning();

    // Parent
    const parentUser = await db.insert(users).values({
      uid: 'sim_parent_123',
      email: 'marianne.dubois@gmail.com',
      name: 'Mme. Marianne Dubois',
      role: 'parent',
      schoolId: mainSchool.id,
    }).returning();

    // 4. Create Teacher Profile
    const teacherProfileInsert = await db.insert(teachers).values({
      userId: teacherUser[0].id,
      schoolId: mainSchool.id,
      phone: '+228 90000000',
      specialization: 'Mathématiques & Sciences Physiques',
    }).returning();
    const mathTeacher = teacherProfileInsert[0];

    // 5. Create Parent Profile
    const parentProfileInsert = await db.insert(parents).values({
      userId: parentUser[0].id,
      phone: '+228 90000000',
      address: '14 Rue des Lilas, 75011 Paris',
    }).returning();
    const mamanDubois = parentProfileInsert[0];

    // 6. Create Classes (prédéfinies) — ordre: 4ème, 3ème, 2nde (A4 then CD), 1ère A4, 1ère D, 1ère, Tle A4, Tle D, Tle
    const classNames = [
      // 4ème
      '4ème A', '4ème B', '4ème C', '4ème D', '4ème E', '4ème F',

      // 3ème
      '3ème', '3ème A', '3ème B', '3ème C', '3ème D', '3ème E', '3ème F',

      // 2nde A4 then 2nde CD variants
      '2nde A4 1', '2nde A4 2', '2nde A4 3',
      '2nde CD', '2nde CD 1', '2nde CD 2', '2nde CD 3',
      '2nde 1', '2nde 2', '2nde 3', '2nde 4', '2nde 5', '2nde 6',

      // 1ère A4 variants, then 1ère D then other 1ère
      '1ère A4', '1ère A4 1', '1ère A4 2', '1ère A4 3',
      '1ère D', '1ère D 1',
      '1ère 1', '1ère 2', '1ère 3', '1ère 4', '1ère 5', '1ère 6',

      // Terminale: A4 variants, then D variants, then other Tle
      'Tle A4', 'Tle A4 1', 'Tle A4 2', 'Tle A4 3',
      'Tle D', 'Tle D 1', 'Tle D2', 'Tle D3',
      'Tle 1', 'Tle 2', 'Tle 3', 'Tle 4', 'Tle 5', 'Tle 6',
    ];

    const createdClasses = [];
    for (const className of classNames) {
      const classInsert = await db.insert(classes).values({
        schoolId: mainSchool.id,
        academicYearId: activeYear.id,
        name: className,
      }).returning();
      createdClasses.push(classInsert[0]);
    }

    // Use Tle A4 1 for test students
    const terminaleS1 = createdClasses.find(c => c.name === 'Tle A4 1') || createdClasses[0];

    // 7. Create Students
    const student1 = await db.insert(students).values({
      schoolId: mainSchool.id,
      classId: terminaleS1.id,
      firstName: 'Lucas',
      lastName: 'Dubois',
      birthDate: '2008-04-12',
      parentId: mamanDubois.id,
      schoolAdminId: schoolAdminUser[0].id,
    }).returning();

    const student2 = await db.insert(students).values({
      schoolId: mainSchool.id,
      classId: terminaleS1.id,
      firstName: 'Chloé',
      lastName: 'Dubois', // Chloe is lucas' sister
      birthDate: '2010-09-25',
      parentId: mamanDubois.id,
      schoolAdminId: schoolAdminUser[0].id,
    }).returning();

    // Add extra parent for random testing students
    const parentUserExtra = await db.insert(users).values({
      uid: 'sim_parent_extra',
      email: 'robert.thomas@gmail.com',
      name: 'M. Robert Thomas',
      role: 'parent',
      schoolId: mainSchool.id,
    }).returning();
    const papaThomasProf = await db.insert(parents).values({
      userId: parentUserExtra[0].id,
      phone: '+228 90000000',
      address: '29 Boulevard Voltaire, Paris',
    }).returning();

    const student3 = await db.insert(students).values({
      schoolId: mainSchool.id,
      classId: terminaleS1.id,
      firstName: 'Thomas',
      lastName: 'Robert',
      birthDate: '2008-11-30',
      parentId: papaThomasProf[0].id,
      schoolAdminId: schoolAdminUser[0].id,
    }).returning();

    const student4 = await db.insert(students).values({
      schoolId: mainSchool.id,
      classId: terminaleS1.id,
      firstName: 'Inès',
      lastName: 'Robert',
      birthDate: '2008-01-14',
      parentId: papaThomasProf[0].id,
      schoolAdminId: schoolAdminUser[0].id,
    }).returning();

    // 8. Create Evaluations
    const evalMath1 = await db.insert(evaluations).values({
      classId: terminaleS1.id,
      teacherId: mathTeacher.id,
      subject: 'Mathématiques',
      title: 'Algèbre - Fonctions et Limites',
      coefficient: 2,
      maxScore: 20,
      date: '2026-06-10',
    }).returning();

    const evalMath2 = await db.insert(evaluations).values({
      classId: terminaleS1.id,
      teacherId: mathTeacher.id,
      subject: 'Mathématiques',
      title: 'Géométrie analytique - Vecteurs de l\'espace',
      coefficient: 1,
      maxScore: 20,
      date: '2026-06-15',
    }).returning();

    // 9. Assign Grades
    // Lucas Grades
    await db.insert(grades).values([
      { evaluationId: evalMath1[0].id, studentId: student1[0].id, score: '14.5', remarks: 'Bon travail, continuez ainsi.' },
      { evaluationId: evalMath2[0].id, studentId: student1[0].id, score: '16.0', remarks: 'Excellent devoir, très bonne raisonnement.' },
    ]);

    // Chloé Grades
    await db.insert(grades).values([
      { evaluationId: evalMath1[0].id, studentId: student2[0].id, score: '18.0', remarks: 'Parfait ! Excellente maîtrise.' },
      { evaluationId: evalMath2[0].id, studentId: student2[0].id, score: '15.0', remarks: 'Très bon travail.' },
    ]);

    // Thomas grades
    await db.insert(grades).values([
      { evaluationId: evalMath1[0].id, studentId: student3[0].id, score: '11.0', remarks: 'Quelques erreurs d\'étourderie.' },
      { evaluationId: evalMath2[0].id, studentId: student3[0].id, score: '12.5', remarks: 'Moyen mais sérieux.' },
    ]);

    // Ines grades
    await db.insert(grades).values([
      { evaluationId: evalMath1[0].id, studentId: student4[0].id, score: '15.0', remarks: 'Très satisfaisant.' },
      { evaluationId: evalMath2[0].id, studentId: student4[0].id, score: '14.0', remarks: 'Bien compris.' },
    ]);

    // 10. Record Absences
    await db.insert(absences).values([
      {
        studentId: student1[0].id,
        classId: terminaleS1.id,
        date: '2026-06-12',
        period: 'morning',
        isJustified: false,
      },
      {
        studentId: student1[0].id,
        classId: terminaleS1.id,
        date: '2026-06-18',
        period: 'afternoon',
        isJustified: true,
        justificationReason: 'Rendez-vous médical chez le dentiste (justificatif fourni).',
      },
      {
        studentId: student3[0].id,
        classId: terminaleS1.id,
        date: '2026-06-19',
        period: 'all_day',
        isJustified: false,
      }
    ]);

    // 11. Record Predefined Notifications for feed panel
    await db.insert(notifications).values([
      {
        userId: parentUser[0].id,
        title: 'Absence enregistrée de Lucas',
        body: 'Lucas Dubois a été marqué absent ce matin (2026-06-12). Veuillez justifier cette absence dans votre espace.',
        type: 'absence',
        isRead: false,
      },
      {
        userId: parentUser[0].id,
        title: 'Nouvelle note disponible',
        body: 'Lucas Dubois a reçu une note de 16.0/20 pour l\'évaluation : Géométrie analytique.',
        type: 'grade',
        isRead: false,
      },
      {
        userId: parentUser[0].id,
        title: 'Information de l\'établissement',
        body: 'Rappel : La réunion parents-professeurs aura lieu vendredi prochain à partir de 17h.',
        type: 'info',
        isRead: true,
      }
    ]);

    console.log('Seeding finished successfully. The database has been pre-populated.');
  } catch (error) {
    console.error('Error seeding database:', error);
  }
}
