import { Client } from 'pg';

const client = new Client({
  host: process.env.PGHOST || '127.0.0.1',
  port: Number(process.env.PGPORT || 5432),
  database: process.env.PGDATABASE || 'ecoletrack',
  user: process.env.PGUSER || 'ecole_admin',
  password: process.env.PGPASSWORD || 'Bafo1234',
});

(async () => {
  await client.connect();
  console.log('Connected to PG for class ID checks');

  const missingInClasses = await client.query(`
    SELECT ct.class_id FROM class_teachers ct
    LEFT JOIN classes c ON ct.class_id = c.id
    WHERE c.id IS NULL
    LIMIT 200;
  `);
  console.log('\n1) class_teachers.class_id not present in classes (orphaned):', missingInClasses.rowCount);
  console.table(missingInClasses.rows);

  const missingInSchoolClasses = await client.query(`
    SELECT sc.class_id FROM school_classes sc
    LEFT JOIN classes c ON sc.class_id = c.id
    WHERE c.id IS NULL
    LIMIT 200;
  `);
  console.log('\n2) school_classes.class_id not present in classes (orphaned):', missingInSchoolClasses.rowCount);
  console.table(missingInSchoolClasses.rows);

  const distinctCt = await client.query(`SELECT DISTINCT class_id FROM class_teachers ORDER BY class_id LIMIT 500;`);
  const distinctClasses = await client.query(`SELECT id FROM classes ORDER BY id LIMIT 500;`);
  console.log('\n3) sample distinct class_ids in class_teachers (first 500):', distinctCt.rowCount);
  console.log(distinctCt.rows.map(r=>r.class_id).slice(0,50));
  console.log('\n4) sample class ids in classes (first 500):', distinctClasses.rowCount);
  console.log(distinctClasses.rows.map(r=>r.id).slice(0,50));

  const duplicateCt = await client.query(`SELECT class_id, COUNT(*) AS cnt FROM class_teachers GROUP BY class_id HAVING COUNT(*) > 1 ORDER BY cnt DESC LIMIT 50;`);
  console.log('\n5) class_teachers duplicates (same class assigned multiple times):', duplicateCt.rowCount);
  console.table(duplicateCt.rows);

  const globalApproved = await client.query(`
    SELECT c.id, c.name, c.school_id, sc.school_id AS approved_for_school, sc.status
    FROM classes c
    JOIN school_classes sc ON c.id = sc.class_id
    WHERE c.school_id IS NULL
    ORDER BY c.id DESC
    LIMIT 200;
  `);
  console.log('\n6) Sample global (school_id NULL) classes with school_classes entries (approved/etc):', globalApproved.rowCount);
  console.table(globalApproved.rows);

  const ctNotApproved = await client.query(`
    SELECT ct.* FROM class_teachers ct
    LEFT JOIN classes c ON ct.class_id = c.id
    LEFT JOIN school_classes sc ON sc.class_id = ct.class_id
    WHERE c.school_id IS NULL AND (sc.status IS NULL OR sc.status != 'approved')
    LIMIT 200;
  `);
  console.log('\n7) class_teachers pointing to global classes without approved school_classes row (potentially blocked):', ctNotApproved.rowCount);
  console.table(ctNotApproved.rows);

  await client.end();
  console.log('\nDone.');
})().catch((err)=>{ console.error('Error during checks:', err); process.exit(1); });
