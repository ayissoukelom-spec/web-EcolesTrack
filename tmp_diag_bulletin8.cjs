const { Pool } = require('pg');

const pool = new Pool({
  host: '127.0.0.1',
  port: 5432,
  user: 'ecole_admin',
  password: 'EcoleTrack2026!',
  database: 'ecoletrack',
});

async function main() {
  const bulletinId = Number(process.argv[2] || 8);

  const bulletinSql = `
    select
      b.id,
      b.student_id,
      b.class_id,
      b.school_year_id,
      b.term_id,
      b.average,
      b.total_points,
      b.total_coefficients,
      b.generated_at,
      s.first_name,
      s.last_name,
      c.name as class_name,
      t.name as term_name,
      t.start_date,
      t.end_date
    from bulletins b
    join students s on s.id = b.student_id
    join classes c on c.id = b.class_id
    left join school_terms t on t.id = b.term_id
    where b.id = $1
  `;

  const linesSql = `
    select id, subject_name, coefficient, average, teacher_comment
    from bulletin_lines
    where bulletin_id = $1
    order by id
  `;

  const evalGradesSql = `
    select
      e.id,
      e.subject,
      e.title,
      e.date,
      e.term_id,
      e.coefficient,
      e.max_score,
      e.count_in_bulletin,
      g.student_id,
      g.score
    from evaluations e
    left join grades g
      on g.evaluation_id = e.id
      and g.student_id = (select student_id from bulletins where id = $1)
    where e.class_id = (select class_id from bulletins where id = $1)
    order by e.date, e.id
  `;

  const [bulletin, lines, evalGrades] = await Promise.all([
    pool.query(bulletinSql, [bulletinId]),
    pool.query(linesSql, [bulletinId]),
    pool.query(evalGradesSql, [bulletinId]),
  ]);

  console.log('BULLETIN');
  console.table(bulletin.rows);
  console.log('LINES');
  console.table(lines.rows);
  console.log('EVAL_GRADES_FOR_STUDENT');
  console.table(evalGrades.rows);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
