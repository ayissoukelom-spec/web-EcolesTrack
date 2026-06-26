const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
(async () => {
  try {
    const response = await fetch('http://localhost:3000/api/auth/local-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'testteacher_localauth@example.com', password: 'Secret123!' }),
    });
    const text = await response.text();
    console.log('status', response.status);
    console.log('body', text);
  } catch (err) {
    console.error(err);
  }
})();
