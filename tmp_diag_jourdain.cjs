const { Pool } = require('pg');

const pool = new Pool({
  host: '127.0.0.1',
  port: 5432,
  user: 'ecole_admin',
  password: 'EcoleTrack2026!',
  database: 'ecoletrack',
});

async function main() {
  const schools = await pool.query(
    `select id, name from schools where lower(name) like '%jourdain%' order by id`,
  );
  console.log('SCHOOLS');
  console.table(schools.rows);

  const bulletins = await pool.query(`
    select
      b.id,
      b.student_id,
      b.class_id,
      b.term_id,
      b.average,
      b.rank,
      (
        select count(*)::int from bulletin_lines bl where bl.bulletin_id = b.id
      ) as lines_count
    from bulletins b
    join classes c on c.id = b.class_id
    join schools s on s.id = c.school_id
    where lower(s.name) like '%jourdain%'
    order by b.id desc
    limit 100
  `);

  console.log('BULLETINS_JOURDAIN');
  console.table(bulletins.rows);

  const evalsWithGrades = await pool.query(`
    select
      s.id as school_id,
      s.name as school_name,
      c.id as class_id,
      c.name as class_name,
      e.id as evaluation_id,
      e.term_id,
      e.subject,
      e.date,
      e.count_in_bulletin,
      count(g.id)::int as grades_count
    from schools s
    join classes c on c.school_id = s.id
    join evaluations e on e.class_id = c.id
    left join grades g on g.evaluation_id = e.id
    where lower(s.name) like '%jourdain%'
    group by s.id, s.name, c.id, c.name, e.id, e.term_id, e.subject, e.date, e.count_in_bulletin
    order by c.id, e.id
    limit 200
  `);

  console.log('EVALUATIONS_WITH_GRADES_JOURDAIN');
  console.table(evalsWithGrades.rows);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
