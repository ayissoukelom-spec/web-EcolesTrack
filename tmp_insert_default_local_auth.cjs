const { Pool } = require('pg');
const crypto = require('crypto');

(async () => {
  const pool = new Pool({ host: '127.0.0.1', port: 5432, user: 'ecole_admin', password: 'EcoleTrack2026!', database: 'ecoletrack' });
  try {
    const userEmail = 'test.super@local.test';
    const findRes = await pool.query('SELECT id FROM users WHERE email=$1', [userEmail]);
    if (findRes.rowCount === 0) {
      console.error('User not found');
      process.exit(1);
    }
    const userId = findRes.rows[0].id;
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.pbkdf2Sync('123456', salt, 310000, 64, 'sha512').toString('hex');

    // Upsert local_auths
    const exists = await pool.query('SELECT id FROM local_auths WHERE user_id=$1', [userId]);
    if (exists.rowCount > 0) {
      await pool.query('UPDATE local_auths SET password_hash=$1, salt=$2, must_reset=true WHERE user_id=$3', [hash, salt, userId]);
      console.log('Updated local_auth for user', userId);
    } else {
      await pool.query('INSERT INTO local_auths (user_id, password_hash, salt, must_reset) VALUES ($1,$2,$3,true)', [userId, hash, salt]);
      console.log('Inserted local_auth for user', userId);
    }
  } catch (e) {
    console.error('Failed', e);
  } finally {
    await pool.end();
  }
})();
