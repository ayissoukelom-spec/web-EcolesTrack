import { db } from './src/db/index.ts';
import { students, classes, schoolTerms } from './src/db/schema.ts';
import { eq } from 'drizzle-orm';

const inspect = async () => {
  const student = await db.select().from(students).where(eq(students.id, 76));
  console.log('student 76:', student);

  if (student.length > 0) {
    const classId = student[0].classId;
    const cls = await db.select().from(classes).where(eq(classes.id, classId));
    console.log('class:', cls);

    const term = await db.select().from(schoolTerms).where(eq(schoolTerms.id, 7));
    console.log('term 7:', term);
  }

  const allTerms = await db.select().from(schoolTerms);
  console.log('all terms:', allTerms.map(t => ({ id: t.id, academicYearId: t.academicYearId })));

  const allClasses = await db.select().from(classes);
  console.log('all classes:', allClasses.map(c => ({ id: c.id, academicYearId: c.academicYearId })));
};

inspect().catch((e) => {
  console.error(e);
  process.exit(1);
});
