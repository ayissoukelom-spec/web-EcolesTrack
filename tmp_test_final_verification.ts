import { db } from './src/db/index.ts';
import { bulletins, bulletinLines, students, classes, schools, academicYears, schoolTerms } from './src/db/schema.ts';
import { eq, and, leftJoin, innerJoin } from 'drizzle-orm';

const test = async () => {
  const bulletinId = 11;
  const actor = { role: 'school_admin', schoolId: 54 };

  console.log('=== COMPARING GET vs PDF ENDPOINTS ===\n');

  // GET endpoint query (bulletinReadApi.ts)
  const conditions1 = [eq(students.schoolId, actor.schoolId)];
  conditions1.push(eq(bulletins.id, bulletinId));
  const whereClause1 = and(...conditions1);

  const [getResult] = await db
    .select({
      id: bulletins.id,
      studentId: bulletins.studentId,
      className: classes.name,
      schoolYearName: academicYears.name,
      termName: schoolTerms.name,
      average: bulletins.average,
      mention: bulletins.mention,
    })
    .from(bulletins)
    .innerJoin(students, eq(bulletins.studentId, students.id))
    .innerJoin(classes, eq(bulletins.classId, classes.id))
    .innerJoin(academicYears, eq(bulletins.schoolYearId, academicYears.id))
    .innerJoin(schoolTerms, eq(bulletins.termId, schoolTerms.id))
    .where(whereClause1);

  console.log('GET /api/bulletins/:id');
  console.log(getResult ? '✅ SUCCESS' : '❌ FAILED');
  if (getResult) {
    console.log(`  ↳ Bulletin ID ${getResult.id}: ${getResult.mention}`);
  }

  // PDF endpoint query (bulletinPdfApi.ts) - WITH LEFTJOIN FIX
  const conditions2 = [eq(students.schoolId, actor.schoolId)];
  conditions2.push(eq(bulletins.id, bulletinId));
  const whereClause2 = and(...conditions2);

  const [pdfResult] = await db
    .select({
      id: bulletins.id,
      studentId: bulletins.studentId,
      className: classes.name,
      schoolName: schools.name,  // Now allows NULL with leftJoin
      schoolYearName: academicYears.name,
      termName: schoolTerms.name,
      average: bulletins.average,
      mention: bulletins.mention,
    })
    .from(bulletins)
    .innerJoin(students, eq(bulletins.studentId, students.id))
    .innerJoin(classes, eq(bulletins.classId, classes.id))
    .leftJoin(schools, eq(classes.schoolId, schools.id))  // ← LEFTJOIN (was innerJoin)
    .innerJoin(academicYears, eq(bulletins.schoolYearId, academicYears.id))
    .innerJoin(schoolTerms, eq(bulletins.termId, schoolTerms.id))
    .where(whereClause2);

  console.log('\nGET /api/bulletins/:id/pdf');
  console.log(pdfResult ? '✅ SUCCESS' : '❌ FAILED');
  if (pdfResult) {
    console.log(`  ↳ Bulletin ID ${pdfResult.id}: ${pdfResult.mention}`);
    console.log(`  ↳ School: ${pdfResult.schoolName}`);
  }

  console.log('\n=== RESULT ===');
  if (getResult && pdfResult) {
    console.log('✅ BOTH ENDPOINTS NOW WORK TOGETHER');
    console.log('   - PDF endpoint can handle missing schools via leftJoin');
    console.log('   - Consistent data sources (both use bulletins table)');
  } else {
    console.log('❌ DIVERGENCE DETECTED');
    if (!getResult) console.log('   - GET endpoint fails');
    if (!pdfResult) console.log('   - PDF endpoint fails');
  }
};

test().catch((e) => {
  console.error(e);
  process.exit(1);
});
