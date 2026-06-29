import { db } from '../src/db/index.ts';
import { sql } from 'drizzle-orm';

interface Args {
  schoolId: number;
  dryRun: boolean;
}

function parseArgs(): Args {
  const rawSchoolId = process.argv.find((arg) => arg.startsWith('--schoolId='));
  const dryRunArg = process.argv.includes('--dryRun') || process.argv.includes('--dry-run');
  const schoolIdValue = rawSchoolId ? rawSchoolId.split('=')[1] : process.env.SCHOOL_ID;

  if (!schoolIdValue) {
    throw new Error('Missing required argument --schoolId=<id> or environment variable SCHOOL_ID');
  }

  const schoolId = Number(schoolIdValue);
  if (Number.isNaN(schoolId) || !Number.isFinite(schoolId) || schoolId <= 0) {
    throw new Error(`Invalid schoolId: ${schoolIdValue}`);
  }

  return { schoolId, dryRun: dryRunArg };
}

async function run() {
  const { schoolId, dryRun } = parseArgs();
  console.log('Ensure global classes approved for school', schoolId, { dryRun });

  const globalClasses = await db.execute(sql`
    select id, school_id, academic_year_id, name
    from classes
    where school_id is null
    order by id
  `);

  const classesToApprove: Array<{ id: number; name: string; academic_year_id: number | null }> = [];
  for (const row of globalClasses.rows) {
    const classId = Number((row as any).id);
    const approval = await db.execute(sql`
      select id
      from school_classes
      where school_id = ${schoolId}
        and class_id = ${classId}
        and status = 'approved'
      limit 1
    `);
    if (!approval.rowCount || approval.rowCount === 0) {
      classesToApprove.push({
        id: classId,
        name: (row as any).name as string,
        academic_year_id: (row as any).academic_year_id ?? null,
      });
    }
  }

  console.log(`Found ${globalClasses.rowCount} global classes and ${classesToApprove.length} missing approved entries for school ${schoolId}.`);

  if (classesToApprove.length === 0) {
    console.log('Nothing to do. All global classes are already approved for this school.');
    process.exit(0);
  }

  for (const cls of classesToApprove) {
    console.log('Missing approval:', cls);
  }

  if (dryRun) {
    console.log('Dry run enabled. No database changes were made.');
    process.exit(0);
  }

  for (const cls of classesToApprove) {
    await db.execute(sql`
      insert into school_classes (school_id, class_id, status, created_at, updated_at)
      values (${schoolId}, ${cls.id}, 'approved', now(), now())
      on conflict (school_id, class_id)
      do update set status = 'approved', updated_at = now();
    `);
    console.log('Inserted/updated approved school_class for class_id', cls.id);
  }

  console.log('Completed approval sync for global classes.');
  process.exit(0);
}

run().catch((error) => {
  console.error('Failed to ensure global class approvals:', error);
  process.exit(1);
});
