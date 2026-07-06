(async () => {
  try {
    const res = await fetch('http://localhost:3000/api/users/66', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'x-simulated-role': 'parent',
        'x-simulated-uid': 'parent_1783364985706',
        'x-simulated-email': 'jes@gmail.com',
        'x-simulated-name': 'John Jesuis'
      },
      body: JSON.stringify({ firstName: 'jesus', lastName: '', name: 'jesus', phone: '+22898763646' }),
    });
    const data = await res.json();
    console.log('STATUS', res.status);
    console.log(JSON.stringify(data, null, 2));
  } catch (e) {
    console.error('ERROR', e);
  }
})();
