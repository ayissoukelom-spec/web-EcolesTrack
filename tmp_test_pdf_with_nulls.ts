import { db } from './src/db/index.ts';
import { bulletins, bulletinLines, students, classes, schools, academicYears, schoolTerms } from './src/db/schema.ts';
import { eq } from 'drizzle-orm';
import { createBulletinPdfDocument } from './src/lib/bulletinPdfApi.ts';

const test = async () => {
  const bulletinId = 1;

  // Get bulletin data exactly like the PDF endpoint does
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
    .leftJoin(schools, eq(classes.schoolId, schools.id))
    .innerJoin(academicYears, eq(bulletins.schoolYearId, academicYears.id))
    .innerJoin(schoolTerms, eq(bulletins.termId, schoolTerms.id))
    .where(eq(bulletins.id, bulletinId));

  if (!header) {
    console.log('❌ Bulletin not found');
    process.exit(1);
  }

  console.log('Testing bulletin with null values:');
  console.log(`  mention: ${header.mention ?? '(NULL)'}`);
  console.log(`  appreciation: ${header.appreciation?.substring(0, 40) ?? '(NULL)'}...`);

  // Get lines
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

  console.log(`\nLines found: ${lines.length}`);

  // Build PDF data object
  const pdfData = {
    id: header.id,
    studentId: header.studentId,
    studentName: `${header.studentFirstName} ${header.studentLastName}`.trim(),
    classId: header.classId,
    className: header.className,
    schoolName: header.schoolName,
    schoolYearId: header.schoolYearId,
    schoolYearName: header.schoolYearName,
    termId: header.termId,
    termName: header.termName,
    average: header.average ? Number(header.average) : null,
    totalPoints: Number(header.totalPoints),
    totalCoefficients: Number(header.totalCoefficients),
    rank: header.rank,
    mention: header.mention,
    appreciation: header.appreciation,
    generatedAt: header.generatedAt?.toISOString() || new Date().toISOString(),
    lines: lines.map(line => ({
      ...line,
      average: line.average ? Number(line.average) : null,
    })),
  };

  console.log('\n=== Generating PDF ===');
  try {
    const pdfBytes = await createBulletinPdfDocument(pdfData);
    console.log('✅ PDF GENERATED SUCCESSFULLY');
    console.log(`   Size: ${pdfBytes.length} bytes`);
  } catch (err) {
    console.log('❌ PDF GENERATION FAILED');
    console.error((err as any).message);
    console.error((err as any).stack);
    process.exit(1);
  }
};

test().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
