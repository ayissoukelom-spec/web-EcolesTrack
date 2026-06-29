import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { db } from '../src/db/index.ts';
import { sql } from 'drizzle-orm';

interface Args {
  schoolId: number;
  apply: boolean;
}

interface Step {
  name: string;
  description: string;
  countSql: (schoolId: number) => ReturnType<typeof sql>;
  deleteSql: (schoolId: number) => ReturnType<typeof sql>;
  requiredColumns?: string[];
}

const steps: Step[] = [
  {
    name: 'bulletin_lines',
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
    name: 'grade_history',
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
    name: 'grades',
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
    name: 'evaluations',
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
    name: 'absences',
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
    name: 'class_teachers',
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
    name: 'school_classes',
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
    name: 'school_subjects',
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
    name: 'notifications',
    description: 'Notifications for school users',
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
    name: 'local_auths',
    description: 'Local auth records for school users',
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
    name: 'bulletins',
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
    name: 'students',
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
    name: 'parents',
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
    name: 'teachers',
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
    name: 'users',
    description: 'Business users for school',
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
    name: 'classes',
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
    name: 'subjects',
    description: 'Subjects',
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

const optionalDirectTables = [
  { name: 'enrollments', description: 'Enrollments' },
  { name: 'attendance', description: 'Attendance' },
];

function parseArgs(): Args {
  const getBool = (key: string): boolean | null => {
    const arg = process.argv.find((item) => item.startsWith(`--${key}=`));
    if (!arg) return null;
    const value = arg.split('=')[1].toLowerCase();
    return value === 'true' || value === '1';
  };

  const schoolIdArg = process.argv.find((item) => item.startsWith('--schoolId='));
  if (!schoolIdArg) {
    throw new Error('Missing required argument --schoolId=<id>');
  }

  const schoolId = Number(schoolIdArg.split('=')[1]);
  if (Number.isNaN(schoolId) || schoolId <= 0) {
    throw new Error(`Invalid schoolId: ${schoolIdArg.split('=')[1]}`);
  }

  const apply = getBool('apply');
  const dryRun = getBool('dryRun');

  if (apply === null && dryRun === null) {
    return { schoolId, apply: false };
  }

  return { schoolId, apply: Boolean(apply) };
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
    const answer = await rl.question(`Type RESET ${schoolId} to confirm: `);
    if (answer.trim() !== `RESET ${schoolId}`) {
      throw new Error('Confirmation failed. Aborting without changes.');
    }
  } finally {
    rl.close();
  }
}

async function run() {
  const args = parseArgs();
  const mode = args.apply ? 'apply' : 'dryRun';
  console.log(`Reset school data for school_id=${args.schoolId} in ${mode} mode.`);
  console.log('This script will delete only school-specific business data and preserve global system state.');

  const availableSteps: Step[] = [];
  const ignoredTables: string[] = [];

  for (const step of steps) {
    if (await tableExists(step.name)) {
      availableSteps.push(step);
    } else {
      ignoredTables.push(step.name);
    }
  }

  const optionalSteps: Step[] = [];
  for (const candidate of optionalDirectTables) {
    if (!(await tableExists(candidate.name))) {
      ignoredTables.push(candidate.name);
      continue;
    }
    if (!(await columnExists(candidate.name, 'school_id'))) {
      ignoredTables.push(candidate.name);
      continue;
    }
    optionalSteps.push({
      name: candidate.name,
      description: candidate.description,
      countSql: (schoolId) => sql`
        select count(*)::int as cnt
        from ${sql.raw(candidate.name)}
        where school_id = ${schoolId}
      `,
      deleteSql: (schoolId) => sql`
        delete from ${sql.raw(candidate.name)}
        where school_id = ${schoolId}
      `,
    });
  }

  const allSteps = [...optionalSteps, ...availableSteps];
  if (allSteps.length === 0) {
    console.log('No applicable tables found in this database. Nothing to do.');
    process.exit(0);
  }

  const summary: Array<{ name: string; description: string; count: number }> = [];
  let totalCount = 0;

  for (const step of allSteps) {
    const count = await executeCount(step.countSql(args.schoolId));
    summary.push({ name: step.name, description: step.description, count });
    totalCount += count;
  }

  console.log('\nCounts by table:');
  for (const item of summary) {
    console.log(`- ${item.name}: ${item.count} (${item.description})`);
  }
  console.log(`Total rows targeted for deletion: ${totalCount}`);

  if (ignoredTables.length > 0) {
    console.log('\nIgnored tables (missing or not applicable):');
    for (const table of ignoredTables) {
      console.log(`- ${table}`);
    }
  }

  if (!args.apply) {
    console.log('\nDry run complete. No deletions were performed.');
    process.exit(0);
  }

  await confirmApply(args.schoolId);

  await db.transaction(async (tx) => {
    for (const step of allSteps) {
      const deleted = await executeDelete(tx, step.deleteSql(args.schoolId));
      console.log(`Deleted ${deleted} rows from ${step.name} (${step.description})`);
    }
  });

  console.log('\nReset complete. School-specific business data has been removed.');
  process.exit(0);
}

run().catch((error) => {
  console.error('Error during reset-school-data:', error.message ?? error);
  process.exit(1);
});
