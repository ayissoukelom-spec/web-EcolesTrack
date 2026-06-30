import { db } from './src/db/index.ts';
import { evaluations, grades, schoolTerms } from './src/db/schema.ts';
import { eq } from 'drizzle-orm';

const check = async () => {
  // Check term 16
  const term = await db.select().from(schoolTerms).where(eq(schoolTerms.id, 16));
  console.log('Term 16:', term);

  // Check evaluations for class 179 with term 16 or null termId
  const evals = await db.select().from(evaluations).where(eq(evaluations.classId, 179));
  console.log('All evaluations for class 179:', evals);

  // Check grades for student 76
  const studentGrades = await db.select().from(grades).where(eq(grades.studentId, 76));
  console.log('All grades for student 76:', studentGrades);
};

check().catch((e) => {
  console.error(e);
  process.exit(1);
});
