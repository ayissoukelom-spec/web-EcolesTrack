const http = require('http');
const { Pool } = require('pg');
const crypto = require('crypto');

function postJson(path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const options = {
      hostname: 'localhost',
      port: 3000,
      path,
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }, headers),
    };
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(body); } catch (e) { parsed = body; }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on('error', (e) => reject(e));
    req.write(data);
    req.end();
  });
}

(async () => {
  const pool = new Pool({ host: '127.0.0.1', port: 5432, user: 'ecole_admin', password: 'EcoleTrack2026!', database: 'ecoletrack' });
  try {
    const testEmail = `e2e+${Date.now()}@local.test`;
    console.log('Creating user', testEmail);
    const createRes = await postJson('/api/admin/users', { email: testEmail, name: 'E2E Test', role: 'super_admin' }, { 'x-simulated-role': 'super_admin', 'x-simulated-email': 'superadmin@ecoletrack.fr' });
    console.log('create status', createRes.status);
    if (createRes.status !== 201) {
      console.error('Create failed', createRes.body);
      process.exit(2);
    }
    const created = createRes.body;

    // Try login with default password
    console.log('Attempting login with default password');
    let loginRes = await postJson('/api/auth/local-login', { email: testEmail, password: '123456' });
    console.log('login1', loginRes.status, loginRes.body);

    if (loginRes.status === 401 && typeof loginRes.body === 'object' && /Aucun mot de passe|Email ou mot de passe invalide/i.test(JSON.stringify(loginRes.body))) {
      console.log('No local_auth found, inserting default local_auth in DB');
      const salt = crypto.randomBytes(16).toString('hex');
      const hash = crypto.pbkdf2Sync('123456', salt, 310000, 64, 'sha512').toString('hex');
      // Upsert
      const exists = await pool.query('SELECT id FROM local_auths WHERE user_id=$1', [created.id]);
      if (exists.rowCount > 0) {
        await pool.query('UPDATE local_auths SET password_hash=$1, salt=$2, must_reset=true WHERE user_id=$3', [hash, salt, created.id]);
      } else {
        await pool.query('INSERT INTO local_auths (user_id, password_hash, salt, must_reset) VALUES ($1,$2,$3,true)', [created.id, hash, salt]);
      }

      // Retry login
      loginRes = await postJson('/api/auth/local-login', { email: testEmail, password: '123456' });
      console.log('login2', loginRes.status, loginRes.body);
    }

    if (loginRes.status !== 200) {
      console.error('Login failed after insertion', loginRes);
      process.exit(3);
    }

    if (!loginRes.body.mustReset) {
      console.error('mustReset not true as expected', loginRes.body);
      process.exit(4);
    }

    // Change password using change-password endpoint
    console.log('Changing password via /api/auth/change-password');
    const changeRes = await postJson('/api/auth/change-password', { email: testEmail, currentPassword: '123456', newPassword: 'N3wPass!234' });
    console.log('change status', changeRes.status, changeRes.body);
    if (changeRes.status !== 200) {
      console.error('Change password failed', changeRes.body);
      process.exit(5);
    }

    // Login with new password
    const finalLogin = await postJson('/api/auth/local-login', { email: testEmail, password: 'N3wPass!234' });
    console.log('final login', finalLogin.status, finalLogin.body);
    if (finalLogin.status !== 200) {
      console.error('Final login failed', finalLogin.body);
      process.exit(6);
    }
    if (finalLogin.body.mustReset) {
      console.error('mustReset still true after change');
      process.exit(7);
    }

    console.log('E2E test succeeded for', testEmail);
    process.exit(0);
  } catch (e) {
    console.error('E2E script error', e);
    process.exit(1);
  } finally {
    try { await pool.end(); } catch {};
  }
})();
