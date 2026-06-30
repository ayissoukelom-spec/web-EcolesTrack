import { db } from './src/db/index.ts';
import { sql } from 'drizzle-orm';

const inspect = async () => {
  const rows = await db.execute(sql`SELECT table_name, column_name FROM information_schema.columns WHERE table_schema='public' AND table_name IN ('evaluations','grades','students','bulletins','bulletin_lines');`);
  console.log('schema cols', rows);
  const counts = await db.execute(sql`SELECT (SELECT count(*) FROM evaluations) AS eval_count, (SELECT count(*) FROM grades) AS grade_count, (SELECT count(*) FROM students) AS student_count;`);
  console.log('counts', counts);
  const evs = await db.execute(sql`SELECT id, class_id, teacher_id, term_id, subject, title, coefficient, max_score, count_in_bulletin, date, created_at FROM evaluations LIMIT 10;`);
  console.log('eval rows', evs);
  const gs = await db.execute(sql`SELECT id, evaluation_id, student_id, score, remarks FROM grades LIMIT 10;`);
  console.log('grade rows', gs);
  const bulletins = await db.execute(sql`SELECT id, student_id, class_id, school_year_id, term_id, average, total_points, total_coefficients, rank FROM bulletins ORDER BY id DESC LIMIT 5;`);
  console.log('bulletins', bulletins);
};

inspect().catch((e) => {
  console.error(e);
  process.exit(1);
});
