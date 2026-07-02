import { Pool } from 'pg';

// Usage:
// Dry run (no DB writes): node scripts/backfill_is_archived.js
// Apply changes: DATABASE_URL="..." node scripts/backfill_is_archived.js --apply

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const parseDateValue = (value) => {
  if (!value) return null;
  const v = (value instanceof Date) ? value : String(value).trim();
  const normalized = String(v).replace(/\s+/g, 'T');
  const d = new Date(normalized);
  if (!Number.isNaN(d.getTime())) return d;
  const isoDateOnlyMatch = String(v).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoDateOnlyMatch) return new Date(`${v}T00:00:00Z`);
  const europeanMatch = String(v).match(/^([0-3]?\d)[\/\-]([0-1]?\d)[\/\-](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (europeanMatch) {
    const day = parseInt(europeanMatch[1], 10);
    const month = parseInt(europeanMatch[2], 10) - 1;
    const year = parseInt(europeanMatch[3], 10);
    const hour = europeanMatch[4] ? parseInt(europeanMatch[4], 10) : 0;
    const minute = europeanMatch[5] ? parseInt(europeanMatch[5], 10) : 0;
    const second = europeanMatch[6] ? parseInt(europeanMatch[6], 10) : 0;
    const parsed = new Date(year, month, day, hour, minute, second);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
};

const isLegacyEvaluation = (evaluation) => {
  if (!evaluation) return true;
  if (!evaluation.createdAt) return true;
  return parseDateValue(evaluation.createdAt) === null;
};

const isStudentEligibleForEvaluation = (student, evaluation) => {
  if (!student.enrolledAt || (!evaluation.createdAt && !evaluation.date)) return true;
  const enrollmentDate = parseDateValue(student.enrolledAt);
  const comparisonDate = evaluation.createdAt || evaluation.date;
  const evaluationTimestamp = parseDateValue(comparisonDate);
  if (!enrollmentDate || !evaluationTimestamp) return true;
  return enrollmentDate.getTime() <= evaluationTimestamp.getTime();
};

const getEligibleStudentsForEvaluationWithGrades = (evaluation, students, grades) => {
  if (!evaluation) return students;
  const currentlyEligible = students.filter((st) => isStudentEligibleForEvaluation(st, evaluation));
  if (!isLegacyEvaluation(evaluation)) return currentlyEligible;

  const gradedStudentIds = new Set(
    grades.filter((g) => g.evaluation_id === evaluation.id).map((g) => g.student_id),
  );
  const gradedStudents = students.filter((st) => gradedStudentIds.has(st.id));

  const map = new Map();
  for (const s of currentlyEligible) map.set(s.id, s);
  for (const s of gradedStudents) map.set(s.id, s);
  return Array.from(map.values());
};

const isEvaluationCompleted = (evaluation, students, grades) => {
  const classStudents = students.filter((st) => st.class_id === evaluation.class_id);
  if (classStudents.length === 0) return false;

  const eligibleStudents = getEligibleStudentsForEvaluationWithGrades(evaluation, classStudents, grades);
  if (eligibleStudents.length === 0) return false;

  const eligibleStudentIds = new Set(eligibleStudents.map((st) => st.id));
  const gradesForEval = grades.filter((g) => g.evaluation_id === evaluation.id && eligibleStudentIds.has(g.student_id));

  return gradesForEval.length === eligibleStudentIds.size;
};

async function main() {
  const apply = process.argv.includes('--apply');
  const client = await pool.connect();
  try {
    console.log('Starting backfill: fetching evaluations, students, grades...');
    const evalRes = await client.query(`SELECT id, class_id, created_at, date, title, is_archived FROM evaluations`);
    const studentsRes = await client.query(`SELECT id, class_id, enrolled_at, first_name, last_name FROM students`);
    const gradesRes = await client.query(`SELECT id, evaluation_id, student_id FROM grades`);

    const evaluations = evalRes.rows;
    const students = studentsRes.rows;
    const grades = gradesRes.rows;

    console.log(`Found ${evaluations.length} evaluations, ${students.length} students, ${grades.length} grades`);

    if (apply) {
      await client.query('BEGIN');
    }

    for (const ev of evaluations) {
      const completed = isEvaluationCompleted(ev, students, grades);
      const desired = completed ? true : false;
      const current = ev.is_archived;
      if (current === desired) {
        console.log(`OK  id=${ev.id} title="${ev.title || ''}" is_archived=${current}`);
        continue;
      }

      console.log(`UPDATE id=${ev.id} title="${ev.title || ''}" from=${current} to=${desired}`);
      if (apply) {
        await client.query('UPDATE evaluations SET is_archived = $1 WHERE id = $2', [desired, ev.id]);
      }
    }

    if (apply) {
      await client.query('COMMIT');
      console.log('Backfill applied and committed.');
    } else {
      console.log('Dry run complete. No changes applied. Re-run with --apply to write updates.');
    }
  } catch (err) {
    console.error('Error during backfill:', err);
    try { await client.query('ROLLBACK'); } catch (e) {}
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
