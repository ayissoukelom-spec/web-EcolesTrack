import pkg from 'pg';
const { Client } = pkg;

async function run() {
  const client = new Client({
    host: process.env.PGHOST || '127.0.0.1',
    port: Number(process.env.PGPORT || 5432),
    database: process.env.PGDATABASE || 'ecoletrack',
    user: process.env.PGUSER || 'ecole_admin',
    password: process.env.PGPASSWORD || undefined,
  });

  await client.connect();
  try {
    console.log('Running audit queries (read-only)');

    const q1 = `SELECT MIN(created_at) AS first_approved FROM school_classes WHERE status = 'approved'`;
    const r1 = await client.query(q1);
    console.log('\n-- first_approved');
    console.log(r1.rows[0]);

    const firstApprovedDt = r1.rows[0]?.first_approved;

    const q2 = `WITH first_approved AS (SELECT MIN(created_at) AS dt FROM school_classes WHERE status = 'approved')
SELECT
  CASE WHEN u.created_at < fa.dt THEN 'before' ELSE 'after' END AS era,
  COUNT(*) AS teacher_count,
  SUM(CASE WHEN u.school_id IS NULL THEN 1 ELSE 0 END) AS users_school_null,
  SUM(CASE WHEN t.school_id IS NULL THEN 1 ELSE 0 END) AS teachers_school_null,
  SUM(COALESCE(ct.count,0)) AS total_class_teacher_links
FROM teachers t
LEFT JOIN users u ON u.id = t.user_id
LEFT JOIN (SELECT teacher_id, COUNT(*) AS count FROM class_teachers GROUP BY teacher_id) ct ON ct.teacher_id = t.id
CROSS JOIN first_approved fa
GROUP BY era
ORDER BY era;`;
    const r2 = await client.query(q2);
    console.log('\n-- teachers before/after summary');
    console.table(r2.rows);

    const q3 = `SELECT t.id,t.user_id,u.created_at AS created_at,u.school_id AS users_school_id,t.school_id AS teachers_school_id,COALESCE(ct.count,0) AS assigned_classes
  FROM teachers t
  LEFT JOIN users u ON u.id = t.user_id
  LEFT JOIN (SELECT teacher_id, COUNT(*) AS count FROM class_teachers GROUP BY teacher_id) ct ON ct.teacher_id = t.id
  WHERE u.created_at >= (SELECT MIN(created_at) FROM school_classes WHERE status='approved')
  ORDER BY u.created_at DESC
  LIMIT 50;`;
    const r3 = await client.query(q3);
    console.log('\n-- sample new teachers (limit 50)');
    console.table(r3.rows);

    const q4 = `SELECT u.id AS user_id,u.email,t.id AS teacher_id,t.school_id AS teachers_school_id, COALESCE(ct.count,0) AS assigned_count
FROM users u
JOIN teachers t ON t.user_id = u.id
LEFT JOIN (SELECT teacher_id, COUNT(*) AS count FROM class_teachers GROUP BY teacher_id) ct ON ct.teacher_id = t.id
WHERE u.school_id IS NULL AND t.school_id IS NOT NULL
ORDER BY t.id
LIMIT 200;`;
    const r4 = await client.query(q4);
    console.log('\n-- users with NULL users.school_id but teachers.school_id NOT NULL (limit 200)');
    console.table(r4.rows);

    const q5 = `SELECT t.id AS teacher_id,t.user_id,t.school_id FROM teachers t LEFT JOIN users u ON u.id = t.user_id WHERE u.id IS NULL LIMIT 200;`;
    const r5 = await client.query(q5);
    console.log('\n-- teachers without user (orphans) (limit 200)');
    console.table(r5.rows);

    const q6 = `SELECT c.id,c.name,c.school_id,COUNT(ct.*) AS assigned_count
FROM classes c
JOIN class_teachers ct ON ct.class_id = c.id
WHERE c.school_id IS NULL
GROUP BY c.id,c.name,c.school_id
HAVING COUNT(ct.*) > 0
LIMIT 200;`;
    const r6 = await client.query(q6);
    console.log('\n-- classes with school_id NULL but assigned (limit 200)');
    console.table(r6.rows);

    const q7 = `SELECT sc.id AS school_class_id, sc.class_id, sc.school_id AS sc_school_id, c.school_id AS class_school_id, sc.status
FROM school_classes sc
LEFT JOIN classes c ON c.id = sc.class_id
WHERE sc.status = 'approved' AND (c.school_id IS NULL OR c.school_id <> sc.school_id)
ORDER BY sc.class_id, sc.school_id
LIMIT 500;`;
    const r7 = await client.query(q7);
    console.log('\n-- approved school_classes that mismatch classes.school_id (limit 500)');
    console.table(r7.rows);

    const q8a = `SELECT COUNT(*) AS total_school_classes FROM school_classes;`;
    const r8a = await client.query(q8a);
    const q8b = `SELECT status, COUNT(*) FROM school_classes GROUP BY status;`;
    const r8b = await client.query(q8b);
    console.log('\n-- school_classes counts');
    console.table(r8a.rows);
    console.table(r8b.rows);

    const q9a = `SELECT COUNT(*) AS total_class_teachers FROM class_teachers;`;
    const r9a = await client.query(q9a);
    const q9b = `SELECT teacher_id, COUNT(*) AS assigned_count FROM class_teachers GROUP BY teacher_id ORDER BY assigned_count DESC LIMIT 20;`;
    const r9b = await client.query(q9b);
    console.log('\n-- class_teachers counts');
    console.table(r9a.rows);
    console.table(r9b.rows);

    console.log('\nAudit complete.');
  } catch (e) {
    console.error('Audit error', e);
    process.exit(2);
  } finally {
    await client.end();
  }
}

run();
