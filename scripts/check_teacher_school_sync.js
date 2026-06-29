const { Client } = require('pg');

(async () => {
  const client = new Client({ host: '127.0.0.1', port: 5432, database: 'ecoletrack', user: 'ecole_admin' });
  await client.connect();
  try {
    const q = `SELECT u.id as user_id, u.email, u.school_id as users_school_id, t.id as teacher_id, t.school_id as teachers_school_id
    FROM users u
    JOIN teachers t ON t.user_id = u.id
    WHERE u.school_id IS NULL AND t.school_id IS NOT NULL`;
    const res = await client.query(q);
    if (res.rows.length === 0) {
      console.log('No mismatches found: all teachers have users.school_id consistent or both null.');
    } else {
      console.log('Mismatched rows (users.school_id IS NULL but teachers.school_id IS NOT NULL):');
      console.table(res.rows);
      console.log('\nSuggested SQL migration to fix these rows (DRY-RUN):');
      console.log("-- Review before running. This will set users.school_id = teachers.school_id where users.school_id is NULL:\n");
      console.log("UPDATE users u SET school_id = t.school_id FROM teachers t WHERE t.user_id = u.id AND u.school_id IS NULL AND t.school_id IS NOT NULL;");
    }
  } catch (e) {
    console.error('Error checking teacher/user school_id consistency:', e);
    process.exit(2);
  } finally {
    await client.end();
  }
})();
