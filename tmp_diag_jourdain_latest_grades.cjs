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
    with ranked as (
      select
        g.id as grade_id,
        g.student_id,
        g.evaluation_id,
        g.score,
        row_number() over (partition by g.student_id, g.evaluation_id order by g.id desc) as rn,
        count(*) over (partition by g.student_id, g.evaluation_id) as versions
      from grades g
      join evaluations e on e.id = g.evaluation_id
      where e.class_id = 124
        and e.count_in_bulletin = true
    )
    select
      r.student_id,
      r.evaluation_id,
      r.grade_id,
      r.versions,
      r.score as latest_score,
      case when trim(r.score) ~ '^[0-9]+([\\.,][0-9]+)?$' then true else false end as latest_score_is_numeric
    from ranked r
    where r.rn = 1
    order by r.student_id, r.evaluation_id
  `);

  console.log('LATEST_GRADE_PER_EVAL_STUDENT_CLASS_124');
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
