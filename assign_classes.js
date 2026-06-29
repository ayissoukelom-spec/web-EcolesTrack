import pkg from 'pg';
const { Client } = pkg;

const client = new Client({
  host: '127.0.0.1',
  port: '5432',
  database: 'ecoletrack',
  user: 'ecole_admin',
  password: 'Bafo1234'
});

async function assignTeacherToClass() {
  try {
    await client.connect();
    
    console.log('\n========== ASSIGNING TEACHER TO CLASS ==========\n');

    // Assign teacher 92 to class 181
    const insertRes = await client.query(`
      INSERT INTO class_teachers (teacher_id, class_id)
      VALUES (92, 181)
      ON CONFLICT DO NOTHING
      RETURNING teacher_id, class_id
    `);
    
    if (insertRes.rows.length > 0) {
      console.log('✅ Assignment created:');
      console.log(`   Teacher ID: 92 → Class ID: 181`);
    } else {
      console.log('⚠️ Assignment already exists or conflicted');
    }

    // Verify
    const verifyRes = await client.query(`
      SELECT t.id, u.name, ct.class_id
      FROM teachers t
      JOIN users u ON t.user_id = u.id
      LEFT JOIN class_teachers ct ON t.id = ct.teacher_id
      WHERE t.id = 92
    `);

    console.log('\n✅ Verification - Teacher 92 assignments:');
    verifyRes.rows.forEach(row => {
      console.log(`   ${row.name}: classId = ${row.class_id}`);
    });

    // Also assign other teachers to test
    const otherAssignments = [
      [93, 181],  // Nicolas → SIXIEME
      [94, 181],  // STUIO → SIXIEME
    ];

    console.log('\n✅ Adding more assignments:');
    for (const [teacherId, classId] of otherAssignments) {
      const res = await client.query(`
        INSERT INTO class_teachers (teacher_id, class_id)
        VALUES ($1, $2)
        ON CONFLICT DO NOTHING
        RETURNING teacher_id, class_id
      `, [teacherId, classId]);
      if (res.rows.length > 0) {
        console.log(`   Teacher ${teacherId} → Class ${classId} ✅`);
      }
    }

    console.log('\n========== END ==========\n');
    await client.end();
  } catch (e) {
    console.error('Error:', e);
    await client.end();
  }
}

assignTeacherToClass();
