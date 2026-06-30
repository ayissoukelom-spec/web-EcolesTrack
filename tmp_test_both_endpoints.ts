import { db } from './src/db/index.ts';
import { bulletins, bulletinLines, students, classes, schools, academicYears, schoolTerms } from './src/db/schema.ts';
import { eq, and } from 'drizzle-orm';

const simulateGetBulletinDetail = async (actor: any, bulletinId: number) => {
  const conditions = [];

  if (actor.role !== 'super_admin') {
    if (actor.schoolId == null) {
      return null;
    }
    conditions.push(eq(students.schoolId, actor.schoolId));
  }
  conditions.push(eq(bulletins.id, bulletinId));
  const whereClause = and(...conditions);

  const [header] = await db
    .select({
      id: bulletins.id,
      studentId: bulletins.studentId,
      studentFirstName: students.firstName,
      studentLastName: students.lastName,
      classId: bulletins.classId,
      className: classes.name,
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
      createdAt: bulletins.createdAt,
      updatedAt: bulletins.updatedAt,
    })
    .from(bulletins)
    .innerJoin(students, eq(bulletins.studentId, students.id))
    .innerJoin(classes, eq(bulletins.classId, classes.id))
    .innerJoin(academicYears, eq(bulletins.schoolYearId, academicYears.id))
    .innerJoin(schoolTerms, eq(bulletins.termId, schoolTerms.id))
    .where(whereClause);

  if (!header) return null;

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
      createdAt: bulletinLines.createdAt,
    })
    .from(bulletinLines)
    .where(eq(bulletinLines.bulletinId, bulletinId));

  return {
    id: header.id,
    studentId: header.studentId,
    studentName: `${header.studentFirstName} ${header.studentLastName}`.trim(),
    classId: header.classId,
    className: header.className,
    schoolYearId: header.schoolYearId,
    schoolYearName: header.schoolYearName,
    termId: header.termId,
    termName: header.termName,
    average: header.average,
    totalPoints: header.totalPoints,
    totalCoefficients: header.totalCoefficients,
    rank: header.rank,
    mention: header.mention,
    appreciation: header.appreciation,
    generatedAt: header.generatedAt,
    createdAt: header.createdAt,
    updatedAt: header.updatedAt,
    lines,
  };
};

const simulatePdfDataProvider = async (actor: any, bulletinId: number) => {
  const conditions = [];

  if (actor.role !== 'super_admin') {
    if (actor.schoolId == null) {
      return null;
    }
    conditions.push(eq(students.schoolId, actor.schoolId));
  }
  conditions.push(eq(bulletins.id, bulletinId));
  const whereClause = and(...conditions);

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

  if (!header) return null;

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

  return {
    id: header.id,
    studentId: header.studentId,
    studentFirstName: header.studentFirstName,
    studentLastName: header.studentLastName,
    className: header.className,
    schoolName: header.schoolName,
    schoolYearName: header.schoolYearName,
    termName: header.termName,
    average: header.average,
    totalPoints: header.totalPoints,
    totalCoefficients: header.totalCoefficients,
    rank: header.rank,
    mention: header.mention,
    appreciation: header.appreciation,
    generatedAt: header.generatedAt,
    lines,
  };
};

const test = async () => {
  const bulletinId = 11;
  const actor = { role: 'school_admin', schoolId: 54 };

  console.log('Testing both endpoints with same actor and bulletinId...\n');

  // Test GET endpoint
  const getResult = await simulateGetBulletinDetail(actor, bulletinId);
  console.log('GET /api/bulletins/:id result:', getResult ? '✅ Found' : '❌ Not Found');
  
  // Test PDF endpoint
  const pdfResult = await simulatePdfDataProvider(actor, bulletinId);
  console.log('GET /api/bulletins/:id/pdf result:', pdfResult ? '✅ Found' : '❌ Not Found');

  if (getResult && pdfResult) {
    console.log('\n✅ Both endpoints find the bulletin');
  } else {
    console.log('\n❌ ISSUE FOUND:');
    if (!getResult) console.log('  - GET endpoint returns null');
    if (!pdfResult) console.log('  - PDF endpoint returns null');
  }
};

test().catch((e) => {
  console.error(e);
  process.exit(1);
});
