import { db } from './src/db/index.ts';
import { sql } from 'drizzle-orm';

const inspect = async () => {
  const termInfo = await db.execute(sql`SELECT id, name, academic_year_id FROM school_terms ORDER BY id LIMIT 20;`);
  console.log('terms', termInfo.rows);
  const evalTerm = await db.execute(sql`SELECT term_id, count(*) as cnt FROM evaluations GROUP BY term_id ORDER BY term_id NULLS FIRST;`);
  console.log('evaluation term groups', evalTerm.rows);
  const classTerm = await db.execute(sql`SELECT class_id, term_id, count(*) as cnt FROM evaluations WHERE term_id IS NOT NULL GROUP BY class_id, term_id ORDER BY class_id, term_id;`);
  console.log('class term eval groups', classTerm.rows);
  const noTermEvals = await db.execute(sql`SELECT id, class_id, subject, title, coefficient, max_score FROM evaluations WHERE term_id IS NULL LIMIT 20;`);
  console.log('null-term evaluations sample', noTermEvals.rows);
};

inspect().catch((e) => {
  console.error(e);
  process.exit(1);
});
