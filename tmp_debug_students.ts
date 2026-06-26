import { Client } from 'pg';
import { isStudentEligibleForEvaluation } from './src/lib/evaluationUtils.ts';

const client = new Client({
  host: '127.0.0.1',
  port: 5432,
  user: 'ecole_admin',
  password: 'EcoleTrack2026!',
  database: 'ecoletrack',
});

try {
  await client.connect();
  const evRes = await client.query(
    'select id, class_id, teacher_id, subject, title, coefficient, max_score, date, created_at from evaluations where id = $1',
    [34],
  );
  const ev = evRes.rows[0];
  if (!ev) {
    console.error('Evaluation 34 not found');
    process.exit(1);
  }

  const patterns = ['%jean%', '%apelété%', '%samue%', '%bella%'];
  const studentRes = await client.query(
    `select id, first_name, last_name, enrolled_at, class_id
     from students
     where lower(first_name) like any($1) or lower(last_name) like any($1)
     order by id`,
    [patterns],
  );

  console.log('evaluation:', JSON.stringify(ev, null, 2));
  console.log('student rows found:', studentRes.rows.length);

  for (const st of studentRes.rows) {
    const student = {
      id: st.id,
      firstName: st.first_name,
      lastName: st.last_name,
      enrolledAt: st.enrolled_at,
      classId: st.class_id,
    };
    const eligible = isStudentEligibleForEvaluation(student as any, {
      id: ev.id,
      classId: ev.class_id,
      teacherId: ev.teacher_id,
      subject: ev.subject,
      title: ev.title,
      coefficient: ev.coefficient ?? 1,
      maxScore: ev.max_score ?? 20,
      date: ev.date,
      createdAt: ev.created_at,
    });
    console.log(JSON.stringify({
      student: student.firstName + ' ' + student.lastName,
      enrolledAt: student.enrolledAt,
      evaluationDate: ev.date,
      evaluationCreatedAt: ev.created_at,
      comparisonDate: ev.created_at ?? ev.date,
      eligible,
    }, null, 2));
  }
} catch (err) {
  console.error(err);
  process.exit(1);
} finally {
  await client.end();
}
