// Quick test to verify /api/auth/local-login endpoint
const email = 'admin.gestion@ecoletrack.test';
const password = 'SuperSecret123!';

try {
  const response = await fetch('http://localhost:3000/api/auth/local-login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });

  console.log('Status:', response.status);
  const data = await response.json();
  console.log('Response:', data);
} catch (err: any) {
  console.error('Error:', err.message);
}
