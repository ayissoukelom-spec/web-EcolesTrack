import { Client } from "pg";
import {
  getEligibleStudentsForEvaluation,
  getEligibleStudentsForEvaluationWithGrades,
  getEligibleGradesForEvaluation,
  isLegacyEvaluation,
  isEvaluationFullyGraded,
} from './src/lib/evaluationUtils.ts';

const client = new Client({ host: '127.0.0.1', port: 5432, user: 'ecole_admin', password: 'EcoleTrack2026!', database: 'ecoletrack' });

try {
  await client.connect();
  const evals = (await client.query('select id, class_id, teacher_id, subject, title, date, created_at from evaluations order by id')).rows;
  const students = (await client.query('select id, class_id, enrolled_at from students')).rows;
  const grades = (await client.query('select id, evaluation_id, student_id, score, remarks from grades')).rows;
  const candidates = [];
  for (const ev of evals) {
    const classStudents = students.filter((st) => st.class_id === ev.class_id).map((st) => ({ ...st, classId: st.class_id, enrolledAt: st.enrolled_at }));
    const eligibleStudents = getEligibleStudentsForEvaluation(ev, classStudents);
    const eligibleStudentsWithHistory = getEligibleStudentsForEvaluationWithGrades(ev, classStudents, grades);
    const eligibleGrades = getEligibleGradesForEvaluation(ev, classStudents, grades);
    const gradeCount = grades.filter((g) => g.evaluation_id === ev.id).length;
    const allEligibleCount = eligibleStudents.length;
    const historyEligibleCount = eligibleStudentsWithHistory.length;
    const isLegacy = isLegacyEvaluation(ev);
    const eligibleGradesCount = eligibleGrades.length;
    if (gradeCount > 0 && (allEligibleCount === 0 || eligibleGradesCount === 0) ) {
      candidates.push({
        id: ev.id,
        title: ev.title,
        createdAt: ev.created_at,
        date: ev.date,
        gradeCount,
        allEligibleCount,
        historyEligibleCount,
        eligibleGradesCount,
        isLegacy,
        isFullyGraded: isEvaluationFullyGraded(ev, classStudents, grades),
      });
    }
  }
  console.log(JSON.stringify(candidates, null, 2));
} catch (err) {
  console.error(err);
  process.exit(1);
} finally {
  await client.end();
}
