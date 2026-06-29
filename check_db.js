import pkg from 'pg';
const { Client } = pkg;

const client = new Client({
  host: '127.0.0.1',
  port: '5432',
  database: 'ecoletrack',
  user: 'ecole_admin',
  password: 'Bafo1234'
});

async function check() {
  try {
    await client.connect();
    console.log('\n========== DATABASE CHECK ==========\n');

    // Check 1: Count in class_teachers
    const countRes = await client.query('SELECT COUNT(*) FROM class_teachers');
    console.log(`✅ Total rows in class_teachers: ${countRes.rows[0].count}`);

    // Check 2: Show sample data
    const dataRes = await client.query('SELECT teacher_id, class_id FROM class_teachers LIMIT 10');
    console.log(`✅ Sample class_teachers data:`);
    dataRes.rows.forEach(row => {
      console.log(`   teacher_id: ${row.teacher_id}, class_id: ${row.class_id}`);
    });

    // Check 3: List all teachers
    const teachersRes = await client.query('SELECT id, user_id, school_id FROM teachers ORDER BY id');
    console.log(`\n✅ All teachers (count: ${teachersRes.rows.length}):`);
    teachersRes.rows.slice(0, 10).forEach(t => {
      console.log(`   ID: ${t.id}, user_id: ${t.user_id}, school_id: ${t.school_id}`);
    });

    // Check 4: Which teachers have assignments
    const assignedRes = await client.query(`
      SELECT DISTINCT t.id, t.user_id, COUNT(ct.class_id) as assignment_count
      FROM teachers t
      LEFT JOIN class_teachers ct ON t.id = ct.teacher_id
      GROUP BY t.id, t.user_id
      ORDER BY t.id
    `);
    console.log(`\n✅ Teachers with assignment counts:`);
    assignedRes.rows.forEach(row => {
      console.log(`   Teacher ${row.id}: ${row.assignment_count} assignments`);
    });

    console.log('\n========== END CHECK ==========\n');
  } catch (err) {
    console.error('Error:', err);
  } finally {
    await client.end();
  }
}

check();
