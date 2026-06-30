import { db } from './src/db/index.ts';
import { evaluations, grades, students, classes, schoolTerms } from './src/db/schema.ts';
import { eq, and, or, inArray, isNull } from 'drizzle-orm';
import { calculateStudentTermAverage } from './src/lib/bulletinService.ts';

const test = async () => {
  const studentId = 76;
  const termId = 16;
  const classId = 179;

  // 1. Get term
  const term = await db.select().from(schoolTerms).where(eq(schoolTerms.id, termId));
  console.log('Term:', term[0]);

  // 2. Get student
  const student = await db.select().from(students).where(eq(students.id, studentId));
  console.log('Student:', student[0]);

  // 3. Get class
  const klass = await db.select().from(classes).where(eq(classes.id, classId));
  console.log('Class:', klass[0]);

  // 4. Get evaluations (like bulletinSnapshotService does)
  const termEvaluations = await db.select({
    id: evaluations.id,
    classId: evaluations.classId,
    termId: evaluations.termId,
    subject: evaluations.subject,
    title: evaluations.title,
    coefficient: evaluations.coefficient,
    maxScore: evaluations.maxScore,
    countInBulletin: evaluations.countInBulletin,
  }).from(evaluations).where(
    and(
      eq(evaluations.classId, classId),
      or(eq(evaluations.termId, termId), isNull(evaluations.termId)),
    ),
  );
  console.log('Evaluations found:', termEvaluations.length);
  console.log('First 3 evals:', termEvaluations.slice(0, 3));

  // 5. Get grades for this student and these evaluations
  const evaluationIds = termEvaluations.map(e => e.id);
  const studentGrades = await db.select().from(grades)
    .where(
      and(
        eq(grades.studentId, studentId),
        // @ts-ignore
        evaluationIds.length > 0 ? inArray(grades.evaluationId, evaluationIds) : null,
      ),
    );
  console.log('Grades found for student:', studentGrades.length);
  console.log('First 3 grades:', studentGrades.slice(0, 3));

  // 6. Calculate average
  const result = calculateStudentTermAverage({
    term: { id: term[0]!.id },
    student: student[0]!,
    evaluations: termEvaluations,
    grades: studentGrades,
  });
  
  console.log('Calculation result:');
  console.log('  average:', result.average);
  console.log('  totalPoints:', result.totalPoints);
  console.log('  totalCoefficients:', result.totalCoefficients);
  console.log('  snapshots count:', result.snapshots.length);
  if (result.snapshots.length > 0) {
    console.log('  first snapshot:', result.snapshots[0]);
  }
};

test().catch((e) => {
  console.error('ERROR:', e);
  process.exit(1);
});
