const { Pool } = require('pg');

(async () => {
  const pool = new Pool({
    host: '127.0.0.1',
    port: 5432,
    user: 'ecole_admin',
    password: 'EcoleTrack2026!',
    database: 'ecoletrack',
  });

  try {
    const res = await pool.query(
      'SELECT u.id, u.email, u.role, u.school_id, la.id AS local_auth_id, la.password_hash IS NOT NULL AS has_hash FROM users u LEFT JOIN local_auths la ON la.user_id = u.id WHERE u.email = $1',
      ['testteacher_localauth@example.com']
    );
    console.log('rows', res.rowCount);
    console.table(res.rows);
  } catch (err) {
    console.error(err);
  } finally {
    await pool.end();
  }
})();
