import { Client } from "pg";
const client = new Client({ host: '127.0.0.1', port: 5432, user: 'ecole_admin', password: 'EcoleTrack2026!', database: 'ecoletrack' });
try {
  await client.connect();
  const res = await client.query(`select id, class_id, teacher_id, subject, title, date, created_at from evaluations order by id desc limit 100`);
  console.log(JSON.stringify(res.rows, null, 2));
} catch (err) {
  console.error(err);
  process.exit(1);
} finally {
  await client.end();
}
