import { db } from '../src/db/index.ts';
import { parents, users, students } from '../src/db/schema.ts';
import { eq } from 'drizzle-orm';

(async () => {
  try {
    console.log('Counting parents with student class_id = 159');
    const withClass = await db.select({ id: parents.id, userId: parents.userId, studentId: parents.studentId, schoolId: parents.schoolId, studentClassId: students.classId })
      .from(parents)
      .leftJoin(students, eq(parents.studentId, students.id))
      .where(eq(students.classId, 159));
    console.log('Rows:', withClass.length);
    for (const r of withClass) console.log(r.id, r.userId, r.studentId, r.studentClassId, r.schoolId);

    console.log('\nCount parents where users.school_id = 52');
    const joined = await db.select({ pid: parents.id, uid: users.id, studentId: parents.studentId, pschool: parents.schoolId })
      .from(parents)
      .innerJoin(users, eq(parents.userId, users.id))
      .where(eq(users.schoolId, 52));
    console.log('Rows:', joined.length);
    for (const r of joined) console.log(r.pid, r.uid, r.studentId, r.pschool);

    process.exit(0);
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
})();
