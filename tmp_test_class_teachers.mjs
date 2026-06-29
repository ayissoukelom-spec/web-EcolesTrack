import pkg from 'pg';
const { Pool } = pkg;
const pool = new Pool({
  host: '127.0.0.1',
  port: 5432,
  database: 'ecoletrack',
  user: 'ecole_admin',
  password: 'EcoleTrack2026!'
});

(async () => {
  try {
    const classRes = await pool.query("SELECT id, name FROM classes WHERE name = '2nde D'");
    if (classRes.rows.length === 0) {
      console.log('No class 2nde D found');
      process.exit(0);
    }
    const classId = classRes.rows[0].id;
    console.log('Class 2nde D ID:', classId);

    const assignRes = await pool.query(`
      SELECT ct.teacher_id, t.name 
      FROM class_teachers ct 
      JOIN teachers t ON ct.teacher_id = t.id 
      WHERE ct.class_id = $1
    `, [classId]);

    console.log('Teachers in class_teachers for 2nde D:', assignRes.rows.length);
    assignRes.rows.forEach(row => {
      console.log('  - Teacher ID:', row.teacher_id, 'Name:', row.name);
    });

    const classRes2 = await pool.query(`
      SELECT teacher_id, name FROM classes WHERE id = $1
    `, [classId]);
    console.log('Principal teacher (classes.teacher_id):', classRes2.rows[0].teacher_id);

    process.exit(0);
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
})();
