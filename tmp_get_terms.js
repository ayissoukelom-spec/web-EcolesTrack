(async () => {
  try {
    const res = await fetch('http://localhost:3000/api/school-terms', {
      method: 'GET',
      headers: {
        'x-simulated-role': 'super_admin',
        'x-simulated-email': 'sa@test.local'
      }
    });
    console.log('STATUS', res.status);
    const data = await res.json();
    console.log(JSON.stringify(data, null, 2));
  } catch (e) {
    console.error('ERROR', e);
  }
})();
