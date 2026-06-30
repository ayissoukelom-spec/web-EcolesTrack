import { db } from './src/db/index.ts';
import { bulletins, bulletinLines, students, classes, schools, academicYears, schoolTerms } from './src/db/schema.ts';
import { eq, and } from 'drizzle-orm';

const test = async () => {
  const bulletinId = 11;
  const schoolId = 54;  // From bulletin data above
  
  // Simulate PDF endpoint getById logic
  console.log('=== Simulating PDF endpoint getById ===');
  
  // Build conditions like PDF endpoint does
  const conditions = [
    eq(students.schoolId, schoolId)  // Non-super_admin condition
  ];
  conditions.push(eq(bulletins.id, bulletinId));
  const whereClause = and(...conditions);

  // Query exactly like PDF endpoint does
  const [header] = await db
    .select({
      id: bulletins.id,
      studentId: bulletins.studentId,
      studentFirstName: students.firstName,
      studentLastName: students.lastName,
      classId: bulletins.classId,
      className: classes.name,
      schoolName: schools.name,
      schoolYearId: bulletins.schoolYearId,
      schoolYearName: academicYears.name,
      termId: bulletins.termId,
      termName: schoolTerms.name,
      average: bulletins.average,
      totalPoints: bulletins.totalPoints,
      totalCoefficients: bulletins.totalCoefficients,
      rank: bulletins.rank,
      mention: bulletins.mention,
      appreciation: bulletins.appreciation,
      generatedAt: bulletins.generatedAt,
    })
    .from(bulletins)
    .innerJoin(students, eq(bulletins.studentId, students.id))
    .innerJoin(classes, eq(bulletins.classId, classes.id))
    .innerJoin(schools, eq(classes.schoolId, schools.id))
    .innerJoin(academicYears, eq(bulletins.schoolYearId, academicYears.id))
    .innerJoin(schoolTerms, eq(bulletins.termId, schoolTerms.id))
    .where(whereClause);

  console.log('Header result:', header);
  
  if (!header) {
    console.log('❌ PDF getById would return null - BULLETIN NOT FOUND');
  } else {
    console.log('✅ PDF getById would find bulletin');
    
    // Now get lines
    const lines = await db
      .select({
        id: bulletinLines.id,
        bulletinId: bulletinLines.bulletinId,
        subjectId: bulletinLines.subjectId,
        subjectName: bulletinLines.subjectName,
        coefficient: bulletinLines.coefficient,
        average: bulletinLines.average,
        teacherComment: bulletinLines.teacherComment,
        rank: bulletinLines.rank,
      })
      .from(bulletinLines)
      .where(eq(bulletinLines.bulletinId, bulletinId));
    
    console.log('Lines found:', lines.length);
  }
};

test().catch((e) => {
  console.error(e);
  process.exit(1);
});
