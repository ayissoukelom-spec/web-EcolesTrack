import { db } from './src/db/index.ts';
import { bulletins, bulletinLines, students, classes, schools, academicYears, schoolTerms } from './src/db/schema.ts';
import { eq, and, leftJoin, innerJoin } from 'drizzle-orm';

const testPdfQuery = async () => {
  const bulletinId = 11;
  const schoolId = 54;
  
  console.log('=== Testing PDF query with leftJoin on schools ===');
  
  // Build conditions like PDF endpoint does
  const conditions = [
    eq(students.schoolId, schoolId)
  ];
  conditions.push(eq(bulletins.id, bulletinId));
  const whereClause = and(...conditions);

  // Query with LEFTJOIN on schools (new fix)
  const [header] = await db
    .select({
      id: bulletins.id,
      studentId: bulletins.studentId,
      studentFirstName: students.firstName,
      studentLastName: students.lastName,
      classId: bulletins.classId,
      className: classes.name,
      schoolName: schools.name,  // Can be NULL now with leftJoin
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
    .leftJoin(schools, eq(classes.schoolId, schools.id))  // LEFTJOIN instead of INNERJOIN
    .innerJoin(academicYears, eq(bulletins.schoolYearId, academicYears.id))
    .innerJoin(schoolTerms, eq(bulletins.termId, schoolTerms.id))
    .where(whereClause);

  if (header) {
    console.log('✅ PDF query SUCCESS with leftJoin:');
    console.log('  id:', header.id);
    console.log('  studentName:', `${header.studentFirstName} ${header.studentLastName}`);
    console.log('  schoolName:', header.schoolName);
    console.log('  mention:', header.mention);
  } else {
    console.log('❌ PDF query FAILED');
  }
};

testPdfQuery().catch((e) => {
  console.error(e);
  process.exit(1);
});
