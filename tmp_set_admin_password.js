(async () => {
  try {
    // First get the super_admin user
    const getRes = await fetch('http://localhost:3000/api/admin/users', {
      headers: {
        'x-simulated-role': 'super_admin',
        'x-simulated-uid': 'sim_superadmin_123',
        'x-simulated-email': 'superadmin@ecoletrack.fr',
        'x-simulated-name': 'M. Jean-Marc Super-Admin',
      },
    });
    const users = await getRes.json();
    const superAdminUser = users.find(u => u.email === 'superadmin@ecoletrack.fr');
    
    console.log('Found super_admin user:', superAdminUser);
    
    if (!superAdminUser) {
      console.error('Super admin user not found');
      return;
    }

    // Set password
    const setRes = await fetch('http://localhost:3000/api/admin/set-password', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-simulated-role': 'super_admin',
        'x-simulated-uid': 'sim_superadmin_123',
        'x-simulated-email': 'superadmin@ecoletrack.fr',
        'x-simulated-name': 'M. Jean-Marc Super-Admin',
      },
      body: JSON.stringify({
        userId: superAdminUser.id,
        password: 'test1234'
      }),
    });
    const result = await setRes.json();
    console.log('Password set response:', result);
  } catch (e) {
    console.error('Request failed:', e);
  }
})();
