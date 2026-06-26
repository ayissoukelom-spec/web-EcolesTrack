(async () => {
  try {
    const base = 'http://localhost:3000';
    const headers = { 'x-simulated-role': 'super_admin', 'x-simulated-uid': 'sim-super-1', 'x-simulated-email': 'super@sim.local', 'x-simulated-name': 'Super Simulé', 'Content-Type': 'application/json' };

    console.log('Registering simulated user...');
    let res = await fetch(base + '/api/auth/register-or-login', { method: 'POST', headers });
    if (!res.ok) throw new Error('Failed to register simulated user: ' + res.status);
    const actor = await res.json();
    console.log('Actor:', actor.id, actor.email, actor.role);

    console.log('Fetching students...');
    res = await fetch(base + '/api/students', { headers });
    if (!res.ok) throw new Error('Failed to fetch students: ' + res.status);
    const students = await res.json();
    if (!Array.isArray(students) || students.length === 0) {
      console.error('No students found to test.');
      process.exit(1);
    }

    const s = students[0];
    console.log('Found student:', s.id, s.firstName, s.lastName);

    const payload = {
      firstName: (s.firstName || 'Test') + '_X',
      lastName: s.lastName || 'Last',
      birthDate: s.birthDate || null,
      schoolId: s.schoolId,
      classId: s.classId,
      parentId: s.parentId,
      schoolAdminId: s.schoolAdminId || undefined
    };

    console.log('Sending PUT to update student id', s.id, 'payload:', payload);
    res = await fetch(base + '/api/students/' + s.id, { method: 'PUT', headers, body: JSON.stringify(payload) });
    const updated = await res.json();
    console.log('PUT response status:', res.status);
    console.log('Updated student:', updated);
  } catch (err) {
    console.error('Test failed:', err);
    process.exit(1);
  }
})();
