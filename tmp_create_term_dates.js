(async () => {
  try {
    const payload = {
      name: 'T1 Test Dates',
      academicYearId: 2,
      startDate: '2026-09-15',
      endDate: '2026-12-20'
    };
    const res = await fetch('http://localhost:3000/api/school-terms', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-simulated-role': 'super_admin',
        'x-simulated-email': 'ay@gmail.com'
      },
      body: JSON.stringify(payload)
    });
    const text = await res.text();
    console.log('STATUS', res.status);
    console.log(text);
  } catch (e) {
    console.error('ERROR', e);
  }
})();
