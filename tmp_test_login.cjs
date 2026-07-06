const http = require('http');
const data = JSON.stringify({ email: 'test.super@local.test', password: '123456' });
const options = {
  hostname: 'localhost',
  port: 3000,
  path: '/api/auth/local-login',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(data),
  },
};
const req = http.request(options, (res) => {
  let body = '';
  res.on('data', (chunk) => (body += chunk));
  res.on('end', () => {
    console.log('STATUS', res.statusCode);
    try { console.log(JSON.parse(body)); } catch(e) { console.log(body); }
  });
});
req.on('error', (e) => console.error('REQ ERR', e));
req.write(data);
req.end();
