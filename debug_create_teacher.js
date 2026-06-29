const fetch = globalThis.fetch || require('node-fetch');
import { writeFileSync } from 'node:fs';

(async () => {
  try {
    const payload = {
      name: 'Debug Teacher Test',
      email: `debug-teacher-${Date.now()}@test.local`,
      phone: '+22812345678',
      specialization: 'Mathématiques',
      schoolId: 56,
      classIds: [181],
      gender: 'male',
    };
    const res = await fetch('http://localhost:3000/api/teachers', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-simulated-role': 'school_admin',
        'x-simulated-uid': 'school_admin_1782666288352',
      },
      body: JSON.stringify(payload),
    });

    const text = await res.text();
    console.log('STATUS', res.status);
    console.log('BODY', text);
  } catch (e) {
    console.error(e);
  }
})();
