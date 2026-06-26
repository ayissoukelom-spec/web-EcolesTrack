import * as dotenv from 'dotenv';
dotenv.config();

const headers = {
  'x-simulated-role': 'teacher',
  'x-simulated-uid': 'sim_teacher_123',
  'x-simulated-email': 'f.martin.prof@ecoletrack.fr',
  'x-simulated-name': 'M. François Martin',
  'x-simulated-school-id': '47',
};

async function fetchJson(path: string) {
  const res = await fetch(`http://localhost:3000${path}`, { headers });
  const text = await res.text();
  try { return { status: res.status, json: JSON.parse(text) }; }
  catch (e) { return { status: res.status, body: text }; }
}

(async () => {
  const endpoints = ['/api/schools', '/api/academic-years', '/api/classes', '/api/teachers', '/api/students', '/api/parents', '/api/absences', '/api/evaluations', '/api/grades', '/api/notifications', '/api/simulation/users'];
  for (const path of endpoints) {
    const result = await fetchJson(path);
    console.log('===', path, 'status', result.status);
    if ('json' in result) {
      console.log('count', Array.isArray(result.json) ? result.json.length : 'N/A');
    } else {
      console.log(result.body);
    }
  }
})();
