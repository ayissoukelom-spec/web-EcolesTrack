import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { db } from '../src/db/index.ts';
import { sql } from 'drizzle-orm';

interface Args {
  dryRun: boolean;
  apply: boolean;
}

interface TableStep {
  table: string;
  description: string;
  deleteSql: string;
}

const steps: TableStep[] = [
  {
    table: 'bulletin_lines',
    description: 'Bulletin detail lines',
    deleteSql: 'delete from bulletin_lines',
  },
  {
    table: 'grades',
    description: 'Grades',
    deleteSql: 'delete from grades',
  },
  {
    table: 'evaluations',
    description: 'Evaluations',
    deleteSql: 'delete from evaluations',
  },
  {
    table: 'absences',
    description: 'Absences',
    deleteSql: 'delete from absences',
  },
  {
    table: 'class_teachers',
    description: 'Class-teacher assignments',
    deleteSql: 'delete from class_teachers',
  },
  {
    table: 'school_classes',
    description: 'School class approvals',
    deleteSql: 'delete from school_classes',
  },
  {
    table: 'school_subjects',
    description: 'School subject approvals',
    deleteSql: 'delete from school_subjects',
  },
  {
    table: 'notifications',
    description: 'Notifications',
    deleteSql: 'delete from notifications',
  },
  {
    table: 'bulletins',
    description: 'Bulletins',
    deleteSql: 'delete from bulletins',
  },
  {
    table: 'students',
    description: 'Students',
    deleteSql: 'delete from students',
  },
  {
    table: 'parents',
    description: 'Parents',
    deleteSql: 'delete from parents',
  },
  {
    table: 'teachers',
    description: 'Teachers',
    deleteSql: 'delete from teachers',
  },
  {
    table: 'local_auths',
    description: 'Local authentication entries for deleted users',
    deleteSql: 'delete from local_auths where user_id in (select id from users where role != \'super_admin\')',
  },
  {
    table: 'users',
    description: 'Business users (all roles except super_admin)',
    deleteSql: "delete from users where role != 'super_admin'",
  },
  {
    table: 'classes',
    description: 'Classes',
    deleteSql: 'delete from classes',
  },
  {
    table: 'subjects',
    description: 'Subjects',
    deleteSql: 'delete from subjects',
  },
  {
    table: 'school_terms',
    description: 'Academic terms',
    deleteSql: 'delete from school_terms',
  },
  {
    table: 'academic_years',
    description: 'Academic years',
    deleteSql: 'delete from academic_years',
  },
  {
    table: 'schools',
    description: 'Schools',
    deleteSql: 'delete from schools',
  },
];

function parseArgs(): Args {
  const dryRunArg = process.argv.find((arg) => arg.startsWith('--dryRun='));
  const applyArg = process.argv.find((arg) => arg.startsWith('--apply='));

  const dryRun = dryRunArg ? dryRunArg.split('=')[1].toLowerCase() === 'true' : false;
  const apply = applyArg ? applyArg.split('=')[1].toLowerCase() === 'true' : false;

  if (!dryRun && !apply) {
    return { dryRun: true, apply: false };
  }

  return { dryRun, apply };
}

async function ensureTableExists(table: string): Promise<boolean> {
  const result = await db.execute(sql`
    select exists(
      select 1
      from information_schema.tables
      where table_schema = 'public'
        and table_name = ${table}
    ) as exists
  `);
  return !!result.rows[0]?.exists;
}

async function countRows(table: string, deleteSql?: string): Promise<number> {
  const result = await db.execute(sql`
    select count(*)::int as cnt
    from ${sql.raw(table)}
  `);
  return Number(result.rows[0]?.cnt ?? 0);
}

async function assertHistoricalConstraintsRemoved(): Promise<void> {
  const result = await db.execute(sql`
    select conname
    from pg_constraint
    where contype = 'f'
      and conrelid in (
        to_regclass('public.audit_events'),
        to_regclass('public.user_login_events'),
        to_regclass('public.grade_history')
      )
  `);
  if (result.rows.length > 0) {
    throw new Error(
      'Cannot reset data while historical journal foreign keys remain. Apply the journal-preservation SQL first.'
    );
  }
}

async function confirmApply(): Promise<void> {
  if (!stdout.isTTY || !stdin.isTTY) {
    throw new Error('Apply mode requires an interactive terminal to confirm the destructive operation.');
  }

  const rl = readline.createInterface({ input: stdin, output: stdout });
  try {
    const answer = await rl.question(
      'APPLY mode selected. This will DELETE business data from the database. Type CONFIRM to proceed: '
    );
    if (answer.trim() !== 'CONFIRM') {
      throw new Error('Confirmation failed. Aborting without changes.');
    }
  } finally {
    rl.close();
  }
}

async function run() {
  const args = parseArgs();
  const mode = args.apply ? 'apply' : 'dryRun';
  console.log(`Running clear-all-data in ${mode} mode.`);
  console.log('This script will delete business data while preserving schema and system tables.');
  console.log('Historical journals, including grade_history when present, are intentionally preserved.');

  const existingSteps: TableStep[] = [];
  for (const step of steps) {
    const exists = await ensureTableExists(step.table);
    if (exists) {
      existingSteps.push(step);
    } else {
      console.log(`Skipping missing table: ${step.table}`);
    }
  }

  const summary: Array<{ table: string; description: string; count: number }> = [];
  let totalCount = 0;

  for (const step of existingSteps) {
    const count = await countRows(step.table, step.deleteSql);
    summary.push({ table: step.table, description: step.description, count });
    totalCount += count;
  }

  console.log('\nCounts before deletion:');
  for (const item of summary) {
    console.log(`- ${item.table} (${item.description}): ${item.count}`);
  }
  console.log(`Total rows to delete: ${totalCount}`);

  if (!args.apply) {
    console.log('\nDry run complete. No changes were made.');
    process.exit(0);
  }

  await assertHistoricalConstraintsRemoved();
  await confirmApply();

  await db.transaction(async (tx) => {
    for (const step of existingSteps) {
      if (step.table === 'users') {
        await tx.execute(sql`
          insert into audit_events (
            actor_user_id, actor_role, actor_name, action,
            resource_type, resource_id, school_id, school_name_snapshot,
            module, result, source, description
          )
          select
            null, 'system', current_user, 'delete',
            'user', u.id, u.school_id, s.name,
            'user_management', 'success', 'sql',
            concat(
              'Permanent account deletion by clear-all-data; user_id=', u.id,
              '; role=', u.role
            )
          from users u
          left join schools s on s.id = u.school_id
          where u.role != 'super_admin'
        `);
      }

      const result = await tx.execute(sql.raw(`${step.deleteSql}`));
      const rowCount = typeof result.rowCount === 'number' ? result.rowCount : 'unknown';
      console.log(`Deleted ${rowCount} rows from ${step.table}`);
    }
  });

  console.log('\nApply complete. All configured business data tables have been cleared.');
}

run().catch((error) => {
  console.error('Error in clear-all-data:', error.message ?? error);
  process.exit(1);
});
