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
    
    // Get teachers 92-96 details
    const res = await client.query(`
      SELECT t.id, u.name, u.email, t.school_id, 
             COUNT(ct.class_id) as class_count
      FROM teachers t
      JOIN users u ON t.user_id = u.id
      LEFT JOIN class_teachers ct ON t.id = ct.teacher_id
      WHERE t.id BETWEEN 92 AND 96
      GROUP BY t.id, u.name, u.email, t.school_id
      ORDER BY t.id
    `);
    
    console.log('Teachers 92-96:');
    res.rows.forEach(row => {
      console.log(`  ID ${row.id}: ${row.name} (schoolId: ${row.school_id}, assignments: ${row.class_count})`);
    });

    // Check if there are ANY teachers in schoolId 56 with assignments
    const school56 = await client.query(`
      SELECT t.id, u.name, COUNT(ct.class_id) as class_count
      FROM teachers t
      JOIN users u ON t.user_id = u.id
      LEFT JOIN class_teachers ct ON t.id = ct.teacher_id
      WHERE t.school_id = 56
      GROUP BY t.id, u.name
      HAVING COUNT(ct.class_id) > 0
    `);
    
    console.log(`\nTeachers in schoolId 56 WITH assignments: ${school56.rows.length}`);
    school56.rows.forEach(row => {
      console.log(`  ${row.name}: ${row.class_count} assignments`);
    });

    // Check classes in schoolId 56
    const classes = await client.query(`
      SELECT id, name, school_id FROM classes WHERE school_id = 56
    `);
    
    console.log(`\nClasses in schoolId 56: ${classes.rows.length}`);
    classes.rows.forEach(row => {
      console.log(`  ${row.name} (ID: ${row.id})`);
    });

    await client.end();
  } catch (e) { console.error(e); }
}

check();
