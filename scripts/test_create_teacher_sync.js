const fetch = require('node-fetch');
const { Client } = require('pg');

// Usage: node scripts/test_create_teacher_sync.js <adminAuthToken>
(async () => {
  const token = process.argv[2];
  if (!token) {
    console.error('Usage: node scripts/test_create_teacher_sync.js <adminAuthToken>');
    process.exit(1);
  }

  // Create a unique test user
  const email = `diag-teacher-${Date.now()}@example.com`;
  const body = {
    email,
    name: 'Diag Teacher',
    role: 'teacher',
    schoolId: 54,
    phone: '0123456789',
    specialization: null,
    classIds: [],
    password: 'TestPass123!'
  };

  try {
    const resp = await fetch('http://localhost:3000/api/admin/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    const data = await resp.json();
    if (!resp.ok) {
      console.error('Create teacher failed', resp.status, data);
      process.exit(2);
    }
    console.log('Created user:', data);

    const client = new Client({ host: '127.0.0.1', port: 5432, database: 'ecoletrack', user: 'ecole_admin' });
    await client.connect();
    try {
      const q = `SELECT u.id as user_id, u.email, u.school_id as users_school_id, t.id as teacher_id, t.school_id as teachers_school_id
      FROM users u JOIN teachers t ON t.user_id = u.id WHERE u.email = $1`;
      const res = await client.query(q, [email]);
      console.log('DB rows for created teacher:');
      console.table(res.rows);
      if (res.rows.length > 0) {
        const r = res.rows[0];
        if (r.users_school_id === r.teachers_school_id) {
          console.log('PASS: users.school_id equals teachers.school_id');
        } else {
          console.error('FAIL: mismatch detected');
          process.exit(3);
        }
      }
    } finally {
      await client.end();
    }
  } catch (e) {
    console.error('Error creating/verifying teacher:', e);
    process.exit(4);
  }
})();
