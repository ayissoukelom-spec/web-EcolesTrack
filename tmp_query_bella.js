const dotenv = require('dotenv');
const { Pool } = require('pg');
const path = require('path');

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const pool = new Pool({
  host: process.env.SQL_HOST,
  port: process.env.SQL_PORT ? Number(process.env.SQL_PORT) : 5432,
  user: process.env.SQL_USER,
  password: process.env.SQL_PASSWORD,
  database: process.env.SQL_DB_NAME,
});

(async () => {
  try {
    const studentName = { first: 'Bella', last: 'TOUKADA' };

    const studentRes = await pool.query(
      'SELECT id, class_id, first_name, last_name, enrolled_at, created_at, updated_at FROM students WHERE LOWER(first_name) = LOWER($1) AND LOWER(last_name) = LOWER($2) LIMIT 1',
      [studentName.first, studentName.last]
    );

    if (studentRes.rowCount === 0) {
      console.log('STUDENT_NOT_FOUND');
      process.exit(0);
    }

    const student = studentRes.rows[0];
    console.log('STUDENT');
    console.log(JSON.stringify(student, null, 2));

    const gradesRes = await pool.query(
      'SELECT g.id, g.evaluation_id, g.student_id, g.grade, g.comment, g.created_at, g.updated_at, e.teacher_id, e.subject, e.date AS eval_date FROM grades g JOIN evaluations e ON e.id = g.evaluation_id WHERE g.student_id = $1 ORDER BY e.date ASC, g.created_at ASC',
      [student.id]
    );

    console.log('GRADES_FOR_STUDENT');
    console.log(JSON.stringify(gradesRes.rows, null, 2));

    const evalIds = Array.from(new Set(gradesRes.rows.map((r) => r.evaluation_id)));
    if (evalIds.length > 0) {
      const evalRes = await pool.query(
        'SELECT id, class_id, date, subject, teacher_id, created_at, updated_at FROM evaluations WHERE id = ANY($1::int[]) ORDER BY date ASC',
        [evalIds]
      );
      console.log('EVALUATIONS_FOR_STUDENT_GRADES');
      console.log(JSON.stringify(evalRes.rows, null, 2));
    } else {
      console.log('EVALUATIONS_FOR_STUDENT_GRADES');
      console.log('[]');
    }
  } catch (err) {
    console.error('ERROR', err && err.message ? err.message : err);
    process.exit(1);
  } finally {
    await pool.end();
  }
})();
