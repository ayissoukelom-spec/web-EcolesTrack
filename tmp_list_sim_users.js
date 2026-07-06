(async () => {
  const r = await fetch('http://localhost:3000/api/simulation/users');
  console.log('STATUS', r.status);
  console.log(await r.text());
})();
