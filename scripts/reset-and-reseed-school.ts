import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { db } from '../src/db/index.ts';
import { sql } from 'drizzle-orm';
import {
  academicYears,
  bulletinLines,
  bulletins,
  classTeachers,
  classes,
  evaluations,
  gradeHistory,
  grades,
  localAuths,
  notifications,
  parents,
  schoolClasses,
  schoolSubjects,
  students,
  subjects,
  teachers,
  users,
  absences,
  schoolTerms,
} from '../src/db/schema.ts';

interface Args {
  schoolId: number;
  apply: boolean;
}

interface ResetStep {
  table: string;
  description: string;
  countSql: (schoolId: number) => ReturnType<typeof sql>;
  deleteSql: (schoolId: number) => ReturnType<typeof sql>;
}

const resetSteps: ResetStep[] = [
  {
    table: 'bulletin_lines',
    description: 'Bulletin lines',
    countSql: (schoolId) => sql`
      select count(*)::int as cnt
      from bulletin_lines bl
      where exists (
        select 1
        from bulletins b
        where b.id = bl.bulletin_id
          and (
            b.school_id = ${schoolId}
            or b.class_id in (select id from classes where school_id = ${schoolId})
            or b.student_id in (select id from students where school_id = ${schoolId})
          )
      )
    `,
    deleteSql: (schoolId) => sql`
      delete from bulletin_lines bl
      where exists (
        select 1
        from bulletins b
        where b.id = bl.bulletin_id
          and (
            b.school_id = ${schoolId}
            or b.class_id in (select id from classes where school_id = ${schoolId})
            or b.student_id in (select id from students where school_id = ${schoolId})
          )
      )
    `,
  },
  {
    table: 'grade_history',
    description: 'Grade history',
    countSql: (schoolId) => sql`
      select count(*)::int as cnt
      from grade_history gh
      where exists (
        select 1
        from grades g
        join evaluations e on e.id = g.evaluation_id
        join classes c on c.id = e.class_id
        where g.id = gh.grade_id
          and c.school_id = ${schoolId}
      )
    `,
    deleteSql: (schoolId) => sql`
      delete from grade_history gh
      where exists (
        select 1
        from grades g
        join evaluations e on e.id = g.evaluation_id
        join classes c on c.id = e.class_id
        where g.id = gh.grade_id
          and c.school_id = ${schoolId}
      )
    `,
  },
  {
    table: 'grades',
    description: 'Grades',
    countSql: (schoolId) => sql`
      select count(*)::int as cnt
      from grades g
      where exists (
        select 1
        from evaluations e
        join classes c on c.id = e.class_id
        where g.evaluation_id = e.id
          and c.school_id = ${schoolId}
      )
    `,
    deleteSql: (schoolId) => sql`
      delete from grades g
      where exists (
        select 1
        from evaluations e
        join classes c on c.id = e.class_id
        where g.evaluation_id = e.id
          and c.school_id = ${schoolId}
      )
    `,
  },
  {
    table: 'evaluations',
    description: 'Evaluations',
    countSql: (schoolId) => sql`
      select count(*)::int as cnt
      from evaluations e
      join classes c on c.id = e.class_id
      where c.school_id = ${schoolId}
    `,
    deleteSql: (schoolId) => sql`
      delete from evaluations e
      using classes c
      where e.class_id = c.id
        and c.school_id = ${schoolId}
    `,
  },
  {
    table: 'absences',
    description: 'Absences',
    countSql: (schoolId) => sql`
      select count(*)::int as cnt
      from absences a
      join classes c on c.id = a.class_id
      where c.school_id = ${schoolId}
    `,
    deleteSql: (schoolId) => sql`
      delete from absences a
      using classes c
      where a.class_id = c.id
        and c.school_id = ${schoolId}
    `,
  },
  {
    table: 'class_teachers',
    description: 'Class teacher assignments',
    countSql: (schoolId) => sql`
      select count(*)::int as cnt
      from class_teachers ct
      join classes c on c.id = ct.class_id
      where c.school_id = ${schoolId}
    `,
    deleteSql: (schoolId) => sql`
      delete from class_teachers ct
      using classes c
      where ct.class_id = c.id
        and c.school_id = ${schoolId}
    `,
  },
  {
    table: 'school_classes',
    description: 'School class approvals',
    countSql: (schoolId) => sql`
      select count(*)::int as cnt
      from school_classes
      where school_id = ${schoolId}
    `,
    deleteSql: (schoolId) => sql`
      delete from school_classes
      where school_id = ${schoolId}
    `,
  },
  {
    table: 'school_subjects',
    description: 'School subject approvals',
    countSql: (schoolId) => sql`
      select count(*)::int as cnt
      from school_subjects
      where school_id = ${schoolId}
    `,
    deleteSql: (schoolId) => sql`
      delete from school_subjects
      where school_id = ${schoolId}
    `,
  },
  {
    table: 'bulletins',
    description: 'Bulletins',
    countSql: (schoolId) => sql`
      select count(*)::int as cnt
      from bulletins b
      where b.school_id = ${schoolId}
         or b.class_id in (select id from classes where school_id = ${schoolId})
         or b.student_id in (select id from students where school_id = ${schoolId})
    `,
    deleteSql: (schoolId) => sql`
      delete from bulletins b
      where b.school_id = ${schoolId}
         or b.class_id in (select id from classes where school_id = ${schoolId})
         or b.student_id in (select id from students where school_id = ${schoolId})
    `,
  },
  {
    table: 'notifications',
    description: 'Notifications',
    countSql: (schoolId) => sql`
      select count(*)::int as cnt
      from notifications n
      where n.user_id in (
        select id
        from users
        where school_id = ${schoolId}
          and role != 'super_admin'
      )
    `,
    deleteSql: (schoolId) => sql`
      delete from notifications n
      where n.user_id in (
        select id
        from users
        where school_id = ${schoolId}
          and role != 'super_admin'
      )
    `,
  },
  {
    table: 'local_auths',
    description: 'Local auth records',
    countSql: (schoolId) => sql`
      select count(*)::int as cnt
      from local_auths la
      where la.user_id in (
        select id
        from users
        where school_id = ${schoolId}
          and role != 'super_admin'
      )
    `,
    deleteSql: (schoolId) => sql`
      delete from local_auths la
      where la.user_id in (
        select id
        from users
        where school_id = ${schoolId}
          and role != 'super_admin'
      )
    `,
  },
  {
    table: 'students',
    description: 'Students',
    countSql: (schoolId) => sql`
      select count(*)::int as cnt
      from students
      where school_id = ${schoolId}
    `,
    deleteSql: (schoolId) => sql`
      delete from students
      where school_id = ${schoolId}
    `,
  },
  {
    table: 'parents',
    description: 'Parents',
    countSql: (schoolId) => sql`
      select count(*)::int as cnt
      from parents
      where school_id = ${schoolId}
    `,
    deleteSql: (schoolId) => sql`
      delete from parents
      where school_id = ${schoolId}
    `,
  },
  {
    table: 'teachers',
    description: 'Teachers',
    countSql: (schoolId) => sql`
      select count(*)::int as cnt
      from teachers
      where school_id = ${schoolId}
    `,
    deleteSql: (schoolId) => sql`
      delete from teachers
      where school_id = ${schoolId}
    `,
  },
  {
    table: 'users',
    description: 'Business users',
    countSql: (schoolId) => sql`
      select count(*)::int as cnt
      from users
      where school_id = ${schoolId}
        and role != 'super_admin'
    `,
    deleteSql: (schoolId) => sql`
      delete from users
      where school_id = ${schoolId}
        and role != 'super_admin'
    `,
  },
  {
    table: 'classes',
    description: 'Classes',
    countSql: (schoolId) => sql`
      select count(*)::int as cnt
      from classes
      where school_id = ${schoolId}
    `,
    deleteSql: (schoolId) => sql`
      delete from classes
      where school_id = ${schoolId}
    `,
  },
  {
    table: 'subjects',
    description: 'School-scoped subjects',
    countSql: (schoolId) => sql`
      select count(*)::int as cnt
      from subjects
      where school_id = ${schoolId}
    `,
    deleteSql: (schoolId) => sql`
      delete from subjects
      where school_id = ${schoolId}
    `,
  },
];

const baseSubjectDefinitions = [
  { name: 'Mathématiques', code: 'MATH' },
  { name: 'Français', code: 'FRAN' },
  { name: 'Sciences', code: 'SCIE' },
  { name: 'Histoire-Géographie', code: 'HIST' },
  { name: 'Anglais', code: 'ANG' },
];

const baseClassNames = ['CP', 'CE1', 'CE2', 'CM1', 'CM2'];
const defaultTermNames = ['Trimestre 1', 'Trimestre 2', 'Trimestre 3'];

function parseArgs(): Args {
  const schoolIdArg = process.argv.find((item) => item.startsWith('--schoolId='));
  if (!schoolIdArg) {
    throw new Error('Missing required argument --schoolId=<id>');
  }

  const schoolId = Number(schoolIdArg.split('=')[1]);
  if (!Number.isInteger(schoolId) || schoolId <= 0) {
    throw new Error(`Invalid schoolId: ${schoolIdArg.split('=')[1]}`);
  }

  const applyArg = process.argv.find((item) => item.startsWith('--apply='));
  const dryRunArg = process.argv.find((item) => item.startsWith('--dryRun='));
  const apply = applyArg ? applyArg.split('=')[1].toLowerCase() === 'true' : false;
  const dryRun = dryRunArg ? dryRunArg.split('=')[1].toLowerCase() === 'true' : false;

  if (!apply && !dryRun) {
    return { schoolId, apply: false };
  }

  return { schoolId, apply };
}

async function tableExists(table: string): Promise<boolean> {
  const result = await db.execute(sql`
    select exists(
      select 1
      from information_schema.tables
      where table_schema = 'public'
        and table_name = ${table}
    ) as exists
  `);
  return Boolean(result.rows[0]?.exists);
}

async function columnExists(table: string, column: string): Promise<boolean> {
  const result = await db.execute(sql`
    select exists(
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = ${table}
        and column_name = ${column}
    ) as exists
  `);
  return Boolean(result.rows[0]?.exists);
}

async function executeCount(countQuery: ReturnType<typeof sql>): Promise<number> {
  const result = await db.execute(countQuery);
  return Number(result.rows[0]?.cnt ?? 0);
}

async function executeDelete(tx: typeof db, deleteQuery: ReturnType<typeof sql>): Promise<number> {
  const result = await tx.execute(deleteQuery);
  return typeof result.rowCount === 'number' ? result.rowCount : 0;
}

async function confirmApply(schoolId: number): Promise<void> {
  if (!stdout.isTTY || !stdin.isTTY) {
    throw new Error('Interactive terminal required for apply mode.');
  }

  const rl = readline.createInterface({ input: stdin, output: stdout });
  try {
    const answer = await rl.question(`Type RESET_RESEED ${schoolId} to confirm: `);
    if (answer.trim() !== `RESET_RESEED ${schoolId}`) {
      throw new Error('Confirmation failed. Aborting without changes.');
    }
  } finally {
    rl.close();
  }
}

function formatCount(value: number): string {
  return value.toString().padStart(5, ' ');
}

async function getSchool(schoolId: number): Promise<{ id: number; name: string } | null> {
  const result = await db.execute(sql`
    select id, name
    from schools
    where id = ${schoolId}
    limit 1
  `);
  return result.rows[0] ?? null;
}

async function getOrCreateAcademicYear(tx: typeof db, schoolId: number): Promise<{ id: number; name: string; created: boolean }> {
  const existing = await tx.execute(sql`
    select id, name
    from academic_years
    where school_id = ${schoolId}
    order by is_active desc nulls last, name desc
    limit 1
  `);

  if (existing.rows.length > 0) {
    return { ...existing.rows[0], created: false };
  }

  const now = new Date();
  const currentYear = now.getFullYear();
  const nextYear = currentYear + 1;
  const defaultName = `${currentYear}-${nextYear}`;

  const inserted = await tx.insert(academicYears).values({
    schoolId,
    name: defaultName,
    isActive: true,
  }).returning({ id: academicYears.id, name: academicYears.name });

  if (inserted.length === 0) {
    throw new Error('Failed to create default academic year');
  }
  return { ...inserted[0], created: true };
}

async function ensureTerms(tx: typeof db, schoolId: number, academicYearId: number): Promise<number> {
  const existingTerms = await tx.execute(sql`
    select count(*)::int as cnt
    from school_terms
    where school_id = ${schoolId}
      and academic_year_id = ${academicYearId}
  `);

  const count = Number(existingTerms.rows[0]?.cnt ?? 0);
  if (count > 0) {
    return 0;
  }

  const inserted = await tx.insert(schoolTerms).values(
    defaultTermNames.map((name, index) => ({
      schoolId,
      academicYearId,
      name,
      orderIndex: index + 1,
      isActive: true,
    }))
  ).returning({ id: schoolTerms.id });

  return inserted.length;
}

async function ensureGlobalSubjects(tx: typeof db): Promise<Array<{ id: number; name: string }>> {
  const createdSubjects: Array<{ id: number; name: string }> = [];

  for (const subject of baseSubjectDefinitions) {
    const existing = await tx.execute(sql`
      select id, name
      from subjects
      where school_id is null
        and lower(name) = lower(${subject.name})
      limit 1
    `);

    if (existing.rows.length > 0) {
      createdSubjects.push(existing.rows[0]);
      continue;
    }

    const inserted = await tx.insert(subjects).values({
      schoolId: null,
      name: subject.name,
      code: subject.code,
    }).returning({ id: subjects.id, name: subjects.name });

    if (inserted.length > 0) {
      createdSubjects.push(inserted[0]);
    }
  }

  return createdSubjects;
}

async function ensureApprovedSchoolSubjects(tx: typeof db, schoolId: number, subjectIds: number[]): Promise<{ inserted: number; updated: number; activated: number }> {
  if (subjectIds.length === 0) {
    return { inserted: 0, updated: 0, activated: 0 };
  }

  const hasIsActive = await columnExists('school_subjects', 'is_active');
  const subjectIdPlaceholders = sql.join(subjectIds.map((id) => sql`${id}`), sql`, `);
  const existing = await tx.execute(sql`
    select id, subject_id, status${hasIsActive ? sql`, is_active` : sql``}
    from school_subjects
    where school_id = ${schoolId}
      and subject_id in (${subjectIdPlaceholders})
  `);

  const existingIds = new Set<number>(existing.rows.map((row: any) => row.subject_id));
  const missingSubjectIds = subjectIds.filter((id) => !existingIds.has(id));

  let insertedCount = 0;
  if (missingSubjectIds.length > 0) {
    const inserted = await tx.insert(schoolSubjects).values(
      missingSubjectIds.map((subjectId) => ({
        schoolId,
        subjectId,
        status: 'approved',
      }))
    ).returning({ id: schoolSubjects.id });
    insertedCount = inserted.length;
  }

  let updatedCount = 0;
  let activatedCount = 0;

  if (existing.rows.length > 0) {
    const mismatchedIds = existing.rows
      .filter((row: any) => row.status !== 'approved' || row.status == null)
      .map((row: any) => row.subject_id);

    if (mismatchedIds.length > 0) {
      await tx.execute(sql`
        update school_subjects
        set status = 'approved'
        where school_id = ${schoolId}
          and subject_id in (${sql.join(mismatchedIds.map((id) => sql`${id}`), sql`, `)})
      `);
      updatedCount = mismatchedIds.length;
    }

    if (hasIsActive) {
      const inactiveIds = existing.rows
        .filter((row: any) => row.is_active === false || row.is_active == null)
        .map((row: any) => row.subject_id);

      if (inactiveIds.length > 0) {
        await tx.execute(sql`
          update school_subjects
          set is_active = true
          where school_id = ${schoolId}
            and subject_id in (${sql.join(inactiveIds.map((id) => sql`${id}`), sql`, `)})
        `);
        activatedCount = inactiveIds.length;
      }
    }
  }

  return { inserted: insertedCount, updated: updatedCount, activated: activatedCount };
}

async function ensureBaseClasses(tx: typeof db, schoolId: number, academicYearId: number): Promise<{ rows: Array<{ id: number; name: string }>; insertedCount: number }> {
  const existing = await tx.execute(sql`
    select id, name
    from classes
    where school_id = ${schoolId}
      and academic_year_id = ${academicYearId}
      and name in (${sql.join(baseClassNames.map((name) => sql`${name}`), sql`, `)})
  `);

  const existingNames = new Set<string>(existing.rows.map((row: any) => row.name));
  const createdClasses: Array<{ id: number; name: string }> = [...existing.rows];
  let insertedCount = 0;

  for (const className of baseClassNames) {
    if (existingNames.has(className)) {
      continue;
    }
    const inserted = await tx.insert(classes).values({
      schoolId,
      academicYearId,
      name: className,
    }).returning({ id: classes.id, name: classes.name });

    if (inserted.length > 0) {
      createdClasses.push(inserted[0]);
      insertedCount += 1;
    }
  }

  return { rows: createdClasses, insertedCount };
}

async function ensureActiveSchoolClasses(tx: typeof db, schoolId: number, classIds: number[]): Promise<{ inserted: number; updated: number }> {
  if (classIds.length === 0) {
    return { inserted: 0, updated: 0 };
  }

  const existing = await tx.execute(sql`
    select id, class_id, status
    from school_classes
    where school_id = ${schoolId}
      and class_id in (${sql.join(classIds.map((id) => sql`${id}`), sql`, `)})
  `);

  const existingIds = new Set<number>(existing.rows.map((row: any) => row.class_id));
  const missingClassIds = classIds.filter((id) => !existingIds.has(id));

  let insertedCount = 0;
  if (missingClassIds.length > 0) {
    const inserted = await tx.insert(schoolClasses).values(
      missingClassIds.map((classId) => ({
        schoolId,
        classId,
        status: 'active',
      }))
    ).returning({ id: schoolClasses.id });
    insertedCount = inserted.length;
  }

  let updatedCount = 0;
  const mismatchedIds = existing.rows
    .filter((row: any) => row.status !== 'active' || row.status == null)
    .map((row: any) => row.class_id);

  if (mismatchedIds.length > 0) {
    await tx.execute(sql`
      update school_classes
      set status = 'active'
      where school_id = ${schoolId}
        and class_id in (${sql.join(mismatchedIds.map((id) => sql`${id}`), sql`, `)})
    `);
    updatedCount = mismatchedIds.length;
  }

  return { inserted: insertedCount, updated: updatedCount };
}

async function validateFinalState(tx: typeof db, schoolId: number, academicYearId: number): Promise<void> {
  const subjectCountResult = await tx.execute(sql`
    select count(*)::int as cnt
    from subjects
    where school_id is null
      and lower(name) in (${sql.join(baseSubjectDefinitions.map((subject) => sql`${subject.name.toLowerCase()}`), sql`, `)})
  `);
  const subjectCount = Number(subjectCountResult.rows[0]?.cnt ?? 0);

  const approvedSchoolSubjectsResult = await tx.execute(sql`
    select count(*)::int as cnt
    from school_subjects ss
    join subjects s on s.id = ss.subject_id
    where ss.school_id = ${schoolId}
      and ss.status = 'approved'
      and lower(s.name) in (${sql.join(baseSubjectDefinitions.map((subject) => sql`${subject.name.toLowerCase()}`), sql`, `)})
  `);
  const approvedSchoolSubjectsCount = Number(approvedSchoolSubjectsResult.rows[0]?.cnt ?? 0);

  const classCountResult = await tx.execute(sql`
    select count(*)::int as cnt
    from classes
    where school_id = ${schoolId}
      and academic_year_id = ${academicYearId}
      and lower(name) in (${sql.join(baseClassNames.map((name) => sql`${name.toLowerCase()}`), sql`, `)})
  `);
  const classCount = Number(classCountResult.rows[0]?.cnt ?? 0);

  const schoolClassesCountResult = await tx.execute(sql`
    select count(*)::int as cnt
    from school_classes sc
    join classes c on c.id = sc.class_id
    where sc.school_id = ${schoolId}
      and sc.status = 'active'
      and c.academic_year_id = ${academicYearId}
      and lower(c.name) in (${sql.join(baseClassNames.map((name) => sql`${name.toLowerCase()}`), sql`, `)})
  `);
  const schoolClassesCount = Number(schoolClassesCountResult.rows[0]?.cnt ?? 0);

  if (subjectCount === 0 || approvedSchoolSubjectsCount === 0 || classCount === 0 || schoolClassesCount === 0) {
    throw new Error(
      `Validation failed: subjects=${subjectCount}, approvedSchoolSubjects=${approvedSchoolSubjectsCount}, classes=${classCount}, schoolClasses=${schoolClassesCount}`
    );
  }
}

async function getExistingAcademicYearId(schoolId: number): Promise<number | null> {
  const result = await db.execute(sql`
    select id
    from academic_years
    where school_id = ${schoolId}
    order by is_active desc nulls last, name desc
    limit 1
  `);
  return result.rows.length > 0 ? Number(result.rows[0].id) : null;
}

async function isSchoolReady(schoolId: number, academicYearId: number): Promise<boolean> {
  const subjectCountResult = await db.execute(sql`
    select count(*)::int as cnt
    from subjects
    where school_id is null
      and lower(name) in (${sql.join(baseSubjectDefinitions.map((subject) => sql`${subject.name.toLowerCase()}`), sql`, `)})
  `);
  const subjectCount = Number(subjectCountResult.rows[0]?.cnt ?? 0);

  const approvedSchoolSubjectsCountResult = await db.execute(sql`
    select count(*)::int as cnt
    from school_subjects ss
    join subjects s on s.id = ss.subject_id
    where ss.school_id = ${schoolId}
      and ss.status = 'approved'
      and lower(s.name) in (${sql.join(baseSubjectDefinitions.map((subject) => sql`${subject.name.toLowerCase()}`), sql`, `)})
  `);
  const approvedSchoolSubjectsCount = Number(approvedSchoolSubjectsCountResult.rows[0]?.cnt ?? 0);

  const classCountResult = await db.execute(sql`
    select count(*)::int as cnt
    from classes
    where school_id = ${schoolId}
      and academic_year_id = ${academicYearId}
      and lower(name) in (${sql.join(baseClassNames.map((name) => sql`${name.toLowerCase()}`), sql`, `)})
  `);
  const classCount = Number(classCountResult.rows[0]?.cnt ?? 0);

  const schoolClassesCountResult = await db.execute(sql`
    select count(*)::int as cnt
    from school_classes sc
    join classes c on c.id = sc.class_id
    where sc.school_id = ${schoolId}
      and sc.status = 'active'
      and c.academic_year_id = ${academicYearId}
      and lower(c.name) in (${sql.join(baseClassNames.map((name) => sql`${name.toLowerCase()}`), sql`, `)})
  `);
  const schoolClassesCount = Number(schoolClassesCountResult.rows[0]?.cnt ?? 0);

  return subjectCount > 0 && approvedSchoolSubjectsCount > 0 && classCount > 0 && schoolClassesCount > 0;
}

async function run() {
  const args = parseArgs();
  const mode = args.apply ? 'apply' : 'dryRun';

  console.log('RESET AND RESEED SCHOOL');
  console.log(`Target school_id: ${args.schoolId}`);
  console.log(`Mode: ${mode}`);
  console.log('This script deletes only school-scoped business data and reseeds baseline school data.');

  const school = await getSchool(args.schoolId);
  if (!school) {
    throw new Error(`School not found for school_id=${args.schoolId}`);
  }

  const availableSteps: ResetStep[] = [];
  const skippedTables: string[] = [];

  for (const step of resetSteps) {
    if (await tableExists(step.table)) {
      availableSteps.push(step);
    } else {
      skippedTables.push(step.table);
    }
  }

  const resetSummary: Array<{ table: string; description: string; count: number }> = [];
  let resetTotal = 0;

  for (const step of availableSteps) {
    const count = await executeCount(step.countSql(args.schoolId));
    resetSummary.push({ table: step.table, description: step.description, count });
    resetTotal += count;
  }

  const existingGlobalSubjects: Array<{ id: number; name: string }> = [];
  for (const subject of baseSubjectDefinitions) {
    const existing = await db.execute(sql`
      select id, name
      from subjects
      where school_id is null
        and lower(name) = lower(${subject.name})
      limit 1
    `);
    if (existing.rows.length > 0) {
      existingGlobalSubjects.push(existing.rows[0]);
    }
  }

  const missingGlobalSubjectCount = baseSubjectDefinitions.length - existingGlobalSubjects.length;

  const missingSchoolSubjectLinks = await db.execute(sql`
    select count(*)::int as cnt
    from school_subjects ss
    join subjects s on s.id = ss.subject_id
    where ss.school_id = ${args.schoolId}
      and ss.status = 'approved'
      and s.school_id is null
      and lower(s.name) in (${sql.join(baseSubjectDefinitions.map((subject) => sql`${subject.name.toLowerCase()}`), sql`, `)})
  `);
  const currentApprovedSchoolSubjectCount = Number(missingSchoolSubjectLinks.rows[0]?.cnt ?? 0);
  const neededSchoolSubjectLinks = baseSubjectDefinitions.length - currentApprovedSchoolSubjectCount;

  const classCreationCount = baseClassNames.length;

  console.log('\nRESET PHASE SUMMARY:');
  for (const row of resetSummary) {
    console.log(`- ${row.table.padEnd(15)} ${formatCount(row.count)} rows (${row.description})`);
  }
  console.log(`Total rows targeted for deletion: ${resetTotal}`);
  if (skippedTables.length > 0) {
    console.log('\nSkipped tables (missing):');
    for (const table of skippedTables) {
      console.log(`- ${table}`);
    }
  }

  console.log('\nRESEED PHASE SUMMARY:');
  console.log(`- missing global subjects to create: ${missingGlobalSubjectCount}`);
  console.log(`- missing approved school subject links: ${neededSchoolSubjectLinks}`);
  console.log(`- baseline classes to create: ${classCreationCount}`);

  if (!args.apply) {
    console.log('\nDry run complete. No changes were made.');
    console.log(`School ready = false`);
    process.exit(0);
  }

  const existingYearId = await getExistingAcademicYearId(args.schoolId);
  if (resetTotal === 0 && existingYearId !== null) {
    const isReady = await isSchoolReady(args.schoolId, existingYearId);
    if (isReady) {
      console.log('\nSKIP: school already ready and no reset targets found.');
      console.log('FINAL STATUS = READY');
      process.exit(0);
    }
  }

  await confirmApply(args.schoolId);

  const phaseResults = {
    deleted: [] as Array<{ table: string; rows: number }>,
    created: [] as Array<{ entity: string; rows: number }>,
    ready: false,
  };

  await db.transaction(async (tx) => {
    for (const step of availableSteps) {
      const deleted = await executeDelete(tx, step.deleteSql(args.schoolId));
      phaseResults.deleted.push({ table: step.table, rows: deleted });
      console.log(`Deleted ${deleted} rows from ${step.table}`);
    }

    const year = await getOrCreateAcademicYear(tx, args.schoolId);
    phaseResults.created.push({ entity: 'academic_year', rows: year.created ? 1 : 0 });
    const createdTerms = await ensureTerms(tx, args.schoolId, year.id);
    phaseResults.created.push({ entity: 'school_terms', rows: createdTerms });

    const globalSubjects = await ensureGlobalSubjects(tx);
    const createdGlobalSubjects = globalSubjects.filter((subject) =>
      !existingGlobalSubjects.some((existing) => existing.id === subject.id)
    ).length;
    phaseResults.created.push({ entity: 'global_subjects', rows: createdGlobalSubjects });

    const globalSubjectIds = globalSubjects.map((subject) => subject.id);
    const approvedSchoolSubjects = await ensureApprovedSchoolSubjects(tx, args.schoolId, globalSubjectIds);
    phaseResults.created.push({ entity: 'school_subjects_inserted', rows: approvedSchoolSubjects.inserted });
    phaseResults.created.push({ entity: 'school_subjects_updated', rows: approvedSchoolSubjects.updated });
    phaseResults.created.push({ entity: 'school_subjects_activated', rows: approvedSchoolSubjects.activated });

    const classCreationResult = await ensureBaseClasses(tx, args.schoolId, year.id);
    phaseResults.created.push({ entity: 'classes', rows: classCreationResult.insertedCount });

    const classIds = classCreationResult.rows.map((row) => row.id);
    const createdSchoolClasses = await ensureActiveSchoolClasses(tx, args.schoolId, classIds);
    phaseResults.created.push({ entity: 'school_classes_inserted', rows: createdSchoolClasses.inserted });
    phaseResults.created.push({ entity: 'school_classes_updated', rows: createdSchoolClasses.updated });

    await validateFinalState(tx, args.schoolId, year.id);
    phaseResults.created.push({ entity: 'validation_passed', rows: 1 });
    phaseResults.ready = true;
  });

  console.log('\nRESET PHASE RESULTS:');
  for (const item of phaseResults.deleted) {
    console.log(`- ${item.table.padEnd(15)} deleted ${item.rows} rows`);
  }

  console.log('\nRESEED PHASE RESULTS:');
  for (const item of phaseResults.created) {
    console.log(`- ${item.entity.padEnd(15)} created ${item.rows} rows`);
  }

  console.log(`\nFINAL STATUS = ${phaseResults.ready ? 'READY' : 'FAILED'}`);
  process.exit(0);
}

run().catch((error) => {
  console.error('Error in reset-and-reseed-school:', error?.message ?? error);
  process.exit(1);
});
