(async () => {
  try {
    const res = await fetch('http://localhost:3000/api/academic-years/999999', {
      method: 'DELETE',
      headers: {
        'x-simulated-role': 'super_admin',
        'x-simulated-email': 'ay@gmail.com'
      }
    });
    console.log('STATUS', res.status);
    console.log(await res.text());
  } catch (e) {
    console.error(e);
  }
})();
