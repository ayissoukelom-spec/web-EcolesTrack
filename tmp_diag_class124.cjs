const { Pool } = require('pg');

const pool = new Pool({
  host: '127.0.0.1',
  port: 5432,
  user: 'ecole_admin',
  password: 'EcoleTrack2026!',
  database: 'ecoletrack',
});

async function main() {
  const latest = await pool.query(`
    select id, student_id, class_id, term_id, generated_at
    from bulletins
    where class_id = 124 and term_id = 9
    order by id desc
    limit 40
  `);

  const byStudent = await pool.query(`
    select student_id, count(*)::int as bulletins_count, max(id) as latest_id
    from bulletins
    where class_id = 124 and term_id = 9
    group by student_id
    order by student_id
  `);

  console.log('LATEST_BULLETINS_CLASS_124_T9');
  console.table(latest.rows);
  console.log('BULLETINS_COUNT_BY_STUDENT');
  console.table(byStudent.rows);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
