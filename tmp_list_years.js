(async () => {
  try {
    const res = await fetch('http://localhost:3000/api/academic-years', {
      headers: {
        'x-simulated-role': 'super_admin',
        'x-simulated-email': 'superadmin@ecoletrack.test'
      }
    });
    const data = await res.json();
    console.log('STATUS', res.status);
    console.log(JSON.stringify(data, null, 2));
  } catch (e) {
    console.error(e);
  }
})();
