import { Client } from 'pg';

const client = new Client({
  host: '127.0.0.1',
  port: 5432,
  database: 'ecoletrack',
  user: 'ecole_admin',
  password: 'Bafo1234',
});

async function main() {
  await client.connect();
  console.log('Connected');

  const classesSchema = await client.query(`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_name='classes'
    ORDER BY ordinal_position;
  `);
  console.log('CLASSES columns:');
  console.table(classesSchema.rows);

  const schoolClassesSchema = await client.query(`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_name='school_classes'
    ORDER BY ordinal_position;
  `);
  console.log('SCHOOL_CLASSES columns:');
  console.table(schoolClassesSchema.rows);

  const sampleGlobalApproved = await client.query(`
    SELECT c.id, c.name, c.school_id, sc.school_id AS allowed_school_id, sc.status
    FROM classes c
    JOIN school_classes sc ON c.id = sc.class_id
    WHERE c.school_id IS NULL AND sc.status = 'approved'
    ORDER BY c.id DESC
    LIMIT 20;
  `);
  console.log('Global approved classes:');
  console.table(sampleGlobalApproved.rows);

  const sampleLocal = await client.query(`
    SELECT c.id, c.name, c.school_id, sc.status
    FROM classes c
    LEFT JOIN school_classes sc ON c.id = sc.class_id
    WHERE c.school_id IS NOT NULL
    ORDER BY c.id DESC
    LIMIT 20;
  `);
  console.log('Local classes sample:');
  console.table(sampleLocal.rows);

  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
