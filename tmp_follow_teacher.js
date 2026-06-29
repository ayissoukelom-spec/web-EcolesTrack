import fetch from 'node-fetch';
import { Client } from 'pg';

(async () => {
  const client = new Client({ host: '127.0.0.1', port: 5432, database: 'ecoletrack', user: 'ecole_admin' });
  await client.connect();
  try {
    // Find the most recent diag-admin teacher user
    const userRes = await client.query("SELECT * FROM users WHERE email LIKE 'diag-admin-teacher-%' ORDER BY id DESC LIMIT 1");
    if (userRes.rows.length === 0) {
      console.error('No diag-admin user found.');
      return process.exit(1);
    }
    const user = userRes.rows[0];
    console.log('Target user:', user);

    const teacherRes = await client.query('SELECT * FROM teachers WHERE user_id=$1 LIMIT 1', [user.id]);
    if (teacherRes.rows.length === 0) {
      console.error('No teacher profile found for user', user.id);
      return process.exit(1);
    }

    const teacher = teacherRes.rows[0];
    const teacherId = teacher.id;
    console.log('\nTeacher profile:', teacher);

    // 1) Before modification: show class_teachers for this teacher
    const before = await client.query('SELECT * FROM class_teachers WHERE teacher_id=$1', [teacherId]);
    console.log('\n1) class_teachers BEFORE modification:');
    console.log(JSON.stringify(before.rows, null, 2));

    // 2) Execute modification via API (PUT /api/admin/users/:id) assigning class 205
    const headers = {
      'Content-Type': 'application/json',
      'x-simulated-role': 'school_admin',
      'x-simulated-uid': 'school_admin_diag',
      'x-simulated-email': 'diag.admin@ecoletrack.fr',
      'x-simulated-school-id': String(user.schoolId ?? '54')
    };

    const putPayload = {
      email: user.email,
      name: user.name,
      role: 'teacher',
      schoolId: user.school_id ?? teacher.school_id ?? null,
      phone: teacher.phone || '',
      specialization: teacher.specialization || null,
      classIds: [205]
    };

    console.log('\n2) Sending PUT /api/admin/users/' + user.id + ' with payload:', putPayload);
    const putRes = await fetch('http://localhost:3000/api/admin/users/' + user.id, { method: 'PUT', headers, body: JSON.stringify(putPayload) });
    console.log('PUT status:', putRes.status);
    const putBody = await putRes.json().catch(() => null);
    console.log('PUT body:', JSON.stringify(putBody, null, 2));

    // 3) Immediately after insertion: query class_teachers
    const after = await client.query('SELECT * FROM class_teachers WHERE teacher_id=$1', [teacherId]);
    console.log('\n3) class_teachers AFTER modification:');
    console.log(JSON.stringify(after.rows, null, 2));

    // 4) SELECT classes row for id=205
    const classRow = await client.query('SELECT id, school_id, name FROM classes WHERE id = $1', [205]);
    console.log('\n4) classes WHERE id=205:');
    console.log(JSON.stringify(classRow.rows, null, 2));

    // 5) SELECT school_classes for class_id=205
    const scRows = await client.query('SELECT * FROM school_classes WHERE class_id = $1', [205]);
    console.log('\n5) school_classes WHERE class_id=205:');
    console.log(JSON.stringify(scRows.rows, null, 2));

    // 6) GET /api/teachers and show only the teacher object
    console.log('\n6) GET /api/teachers -> filtering for teacher userId=' + user.id);
    const tRes = await fetch('http://localhost:3000/api/teachers', { headers });
    const tJson = await tRes.json().catch(() => null);
    console.log('GET /api/teachers returned status', tRes.status);
    console.log('\nFull /api/teachers response:');
    console.log(JSON.stringify(tJson, null, 2));
    let found = null;
    if (Array.isArray(tJson)) {
      found = tJson.find((t) => t.userId === user.id || t.email === user.email || t.teacherId === teacherId);
    }
    console.log('\nTeacher object from /api/teachers (filtered if array):');
    console.log(JSON.stringify(found || null, null, 2));

    process.exit(0);
  } catch (e) {
    console.error('ERROR during inspection:', e);
    process.exit(2);
  } finally {
    try { await client.end(); } catch (e) {}
  }
})();
