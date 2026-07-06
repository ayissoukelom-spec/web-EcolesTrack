(async () => {
  try {
    const payload = {
      name: 'T Invalid Year',
      academicYearId: 999999,
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
    const body = await res.text();
    console.log('STATUS', res.status);
    console.log(body);
  } catch (e) {
    console.error(e);
  }
})();
