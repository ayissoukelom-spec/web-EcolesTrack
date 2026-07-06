const { Pool } = require('pg');
(async () => {
  const pool = new Pool({ host: '127.0.0.1', port: 5432, user: 'ecole_admin', password: 'EcoleTrack2026!', database: 'ecoletrack' });
  try {
    await pool.query("ALTER TABLE local_auths ADD COLUMN IF NOT EXISTS must_reset boolean DEFAULT true NOT NULL");
    console.log('ALTER OK');
  } catch (e) {
    console.error('ALTER ERR', e.message);
  } finally {
    await pool.end();
  }
})();
