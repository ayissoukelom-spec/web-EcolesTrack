const { Pool } = require('pg');

const pool = new Pool({
  host: '127.0.0.1',
  port: 5432,
  user: 'ecole_admin',
  password: 'EcoleTrack2026!',
  database: 'ecoletrack',
});

async function main() {
  const byStudent = await pool.query(`
    select
      st.id as student_id,
      st.first_name,
      st.last_name,
      count(g.id)::int as grades_count,
      count(*) filter (where trim(g.score) ~ '^[0-9]+([\\.,][0-9]+)?$')::int as numeric_grades_count,
      min(g.score) as sample_min_score,
      max(g.score) as sample_max_score
    from students st
    join classes c on c.id = st.class_id
    join schools s on s.id = c.school_id
    left join grades g on g.student_id = st.id
      and g.evaluation_id in (
        select e.id from evaluations e
        where e.class_id = c.id
          and e.count_in_bulletin = true
      )
    where lower(s.name) like '%jourdain%'
      and c.id = 124
    group by st.id, st.first_name, st.last_name
    order by st.id
  `);

  console.log('STUDENT_GRADES_NUMERICITY');
  console.table(byStudent.rows);

  const sample = await pool.query(`
    select
      g.student_id,
      e.id as evaluation_id,
      e.subject,
      e.max_score,
      g.score
    from grades g
    join evaluations e on e.id = g.evaluation_id
    where e.class_id = 124
      and e.count_in_bulletin = true
    order by g.student_id, e.id
    limit 200
  `);

  console.log('GRADE_SAMPLES_CLASS_124');
  console.table(sample.rows);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
