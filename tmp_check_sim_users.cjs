const url = 'http://localhost:3000/api/simulation/users';
(async () => {
  try {
    const res = await globalThis.fetch(url, {
      method: 'GET',
      headers: {
        'x-simulated-role': 'super_admin',
        'x-simulated-uid': 'sim_superadmin_test',
        'x-simulated-email': 'superadmin@example.com',
        'x-simulated-name': 'Super Admin Test',
        'x-simulated-school-id': '47',
      },
    });
    console.log('status', res.status);
    const body = await res.text();
    console.log('body', body);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
})();
