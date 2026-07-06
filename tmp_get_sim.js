(async () => {
  try {
    const res = await fetch('http://localhost:3000/api/debug/sim-profile', {
      method: 'GET',
      headers: {
        'x-simulated-role': 'parent',
        'x-simulated-uid': 'parent_1783364985706',
        'x-simulated-email': 'jes@gmail.com',
        'Content-Type': 'application/json'
      }
    });
    const data = await res.json();
    console.log(JSON.stringify(data, null, 2));
  } catch (e) {
    console.error('ERROR', e);
  }
})();
