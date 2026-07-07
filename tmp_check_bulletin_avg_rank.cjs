const { Pool } = require('pg');

const pool = new Pool({
  host: '127.0.0.1',
  port: 5432,
  user: 'ecole_admin',
  password: 'EcoleTrack2026!',
  database: 'ecoletrack',
});

async function main() {
  const result = await pool.query(`
    select
      b.id,
      b.student_id,
      b.class_id,
      b.term_id,
      b.average,
      b.rank,
      (
        select count(*)::int
        from bulletin_lines bl
        where bl.bulletin_id = b.id
      ) as lines_count
    from bulletins b
    order by b.id desc
    limit 30
  `);

  console.table(result.rows);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
