import { db } from '../src/db/index.ts';
import { sql } from 'drizzle-orm';

interface ApprovalConfigEntry {
  entityTableName: string;
  approvalTableName: string;
  entityKey: string;
  label: string;
}

const approvalConfig: ApprovalConfigEntry[] = [
  {
    entityTableName: 'classes',
    approvalTableName: 'school_classes',
    entityKey: 'class_id',
    label: 'classes',
  },
  {
    entityTableName: 'subjects',
    approvalTableName: 'school_subjects',
    entityKey: 'subject_id',
    label: 'subjects',
  },
];

interface Args {
  schoolId: number;
  dryRun: boolean;
}

function parseArgs(): Args {
  const schoolIdArg = process.argv.find((arg) => arg.startsWith('--schoolId='));
  const dryRunArg = process.argv.find((arg) => arg.startsWith('--dryRun='));

  if (!schoolIdArg) {
    throw new Error('Missing required argument --schoolId=<id>');
  }

  const schoolId = Number(schoolIdArg.split('=')[1]);
  if (Number.isNaN(schoolId) || schoolId <= 0) {
    throw new Error(`Invalid schoolId: ${schoolIdArg.split('=')[1]}`);
  }

  const dryRunValue = dryRunArg ? dryRunArg.split('=')[1].toLowerCase() : 'true';
  const dryRun = dryRunValue === 'true' || dryRunValue === '1';

  return { schoolId, dryRun };
}

async function run() {
  const { schoolId, dryRun } = parseArgs();
  console.log(`Running ensure-global-approvals for schoolId=${schoolId} dryRun=${dryRun}`);

  let totalMissing = 0;
  let totalInserted = 0;

  for (const config of approvalConfig) {
    console.log(`\n=== Module: ${config.label} ===`);
    const globalEntities = await db.execute(sql`
      select id, school_id, name
      from ${sql.raw(config.entityTableName)}
      where school_id is null
      order by id
    `);

    console.log(`Total global ${config.label}: ${globalEntities.rowCount}`);

    const missing: Array<{ id: number; name: string | null }> = [];

    for (const row of globalEntities.rows) {
      const entityId = Number((row as any).id);
      const entityName = (row as any).name ?? null;
      const approval = await db.execute(sql`
        select id
        from ${sql.raw(config.approvalTableName)}
        where school_id = ${schoolId}
          and ${sql.raw(config.entityKey)} = ${entityId}
          and status = 'approved'
        limit 1
      `);
      if (!approval.rowCount || approval.rowCount === 0) {
        missing.push({ id: entityId, name: entityName });
      }
    }

    console.log(`Missing approved ${config.label}: ${missing.length}`);
    if (missing.length > 0) {
      console.log('Missing details:');
      for (const entity of missing) {
        console.log(`  - id=${entity.id}${entity.name ? ` name="${entity.name}"` : ''}`);
      }
    }

    totalMissing += missing.length;

    if (!dryRun && missing.length > 0) {
      for (const entity of missing) {
        await db.execute(sql`
          insert into ${sql.raw(config.approvalTableName)}
            (school_id, ${sql.raw(config.entityKey)}, status, created_at, updated_at)
          values (${schoolId}, ${entity.id}, 'approved', now(), now())
          on conflict (school_id, ${sql.raw(config.entityKey)})
          do update set status = 'approved', updated_at = now();
        `);
        totalInserted += 1;
      }
      console.log(`Inserted/updated ${missing.length} approval rows for ${config.label}.`);
    }
  }

  console.log('\n=== Summary ===');
  console.log(`Total missing approvals: ${totalMissing}`);
  console.log(`Total inserted/updated approvals: ${dryRun ? 0 : totalInserted}`);
  console.log(`Mode: ${dryRun ? 'dry run' : 'apply'}`);
  if (dryRun && totalMissing > 0) {
    console.log('No changes were made because dry run mode is active.');
  }
  process.exit(0);
}

run().catch((error) => {
  console.error('Error running ensure-global-approvals:', error);
  process.exit(1);
});
