(async () => {
  try {
    const res = await fetch('http://localhost:3000/api/evaluations', {
      method: 'POST',
      headers: {
        'x-simulated-role': 'teacher',
        'x-simulated-uid': 'teacher_1782748067403',
        'x-simulated-email': 'be@gmail.com',
        'content-type': 'application/json'
      },
      body: JSON.stringify({ classId: 197, teacherId: 1, subject: 'Mathématiques', title: 'Test', date: '2026-06-29' }),
    });
    console.log('status', res.status);
    const text = await res.text();
    console.log('body', text);
  } catch (e) {
    console.error('ERR', e && e.message ? e.message : e);
    process.exit(1);
  }
})();
