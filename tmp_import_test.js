(async () => {
  try {
    const res = await fetch('http://localhost:3000/api/students/batch', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-simulated-role': 'super_admin',
        'x-simulated-uid': 'sim_superadmin_123',
        'x-simulated-email': 'superadmin@ecoletrack.fr',
        'x-simulated-name': 'M. Jean-Marc Super-Admin',
      },
      body: JSON.stringify([
        { firstName: 'ImportTest', lastName: 'Student', birthDate: '2012-05-06', schoolId: 36, classId: 34, parentId: 34 }
      ]),
    });
    const text = await res.text();
    console.log('Status:', res.status);
    console.log(text);
  } catch (e) {
    console.error('Request failed:', e);
  }
})();
