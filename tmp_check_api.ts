import { readFileSync } from 'fs';
import * as dotenv from 'dotenv';
dotenv.config();

const headers = {
  'x-simulated-role': 'super_admin',
  'x-simulated-uid': 'sim_superadmin_test',
  'x-simulated-email': 'superadmin_test@example.com',
  'x-simulated-name': 'Super Admin Test',
};

async function fetchJson(path: string) {
  const res = await fetch(`http://localhost:3000${path}`, { headers });
  const text = await res.text();
  try { return { status: res.status, json: JSON.parse(text) }; }
  catch (e) { return { status: res.status, body: text }; }
}

(async () => {
  const endpoints = ['/api/schools', '/api/teachers', '/api/parents', '/api/simulation/users'];
  for (const path of endpoints) {
    const result = await fetchJson(path);
    console.log('===', path, 'status', result.status);
    if ('json' in result) {
      console.log('count', Array.isArray(result.json) ? result.json.length : 'N/A');
      console.dir(result.json, { depth: 2, maxArrayLength: 10 });
    } else {
      console.log(result.body);
    }
  }
})();
