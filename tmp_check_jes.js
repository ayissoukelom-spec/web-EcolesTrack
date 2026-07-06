(async () => {
  try {
    const res = await fetch('http://localhost:3000/api/auth/local-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'jes@gmail.com', password: '123456' }),
    });
    const data = await res.json();
    console.log(JSON.stringify(data, null, 2));
  } catch (e) {
    console.error('ERROR', e);
  }
})();
