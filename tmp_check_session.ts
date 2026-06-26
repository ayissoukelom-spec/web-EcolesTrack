import * as dotenv from 'dotenv';
dotenv.config();

const headers = {
  'x-simulated-role': 'super_admin',
  'x-simulated-uid': 'sim_superadmin_test',
  'x-simulated-email': 'superadmin_test@example.com',
  'x-simulated-name': 'Super Admin Test',
};

async function fetchJson(path: string, opts: RequestInit = {}) {
  const res = await fetch(`http://localhost:3000${path}`, { headers, ...opts });
  const text = await res.text();
  try {
    return { status: res.status, json: JSON.parse(text) };
  } catch (err) {
    return { status: res.status, body: text };
  }
}

(async () => {
  console.log('CALL /api/auth/register-or-login');
  const login = await fetchJson('/api/auth/register-or-login', { method: 'POST' });
  console.log(login);

  for (const path of ['/api/schools', '/api/teachers', '/api/parents', '/api/simulation/users']) {
    const result = await fetchJson(path);
    console.log('===', path, 'status', result.status);
    if ('json' in result) {
      console.log('count', Array.isArray(result.json) ? result.json.length : 'N/A');
      console.dir(result.json, { depth: 1, maxArrayLength: 10 });
    } else {
      console.log(result.body);
    }
  }
})();