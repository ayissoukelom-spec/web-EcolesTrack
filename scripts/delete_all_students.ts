import { db } from '../src/db/index.ts';
import { students, grades, absences, users, notifications, localAuths } from '../src/db/schema.ts';
import { sql } from 'drizzle-orm';

async function main() {
  const confirm = process.env.CONFIRM_DELETE_STUDENTS === 'true';

  try {
    const studentCountRes = await db.select({ count: sql<number>`count(*)::integer` }).from(students);
    const studentCount = Number(studentCountRes[0]?.count ?? 0);
    const userCountRes = await db.select({ count: sql<number>`count(*)::integer` }).from(users).where(sql`${users.role} = 'student'`);
    const userCount = Number(userCountRes[0]?.count ?? 0);

    console.log(`Students rows: ${studentCount}`);
    console.log(`User accounts with role=student: ${userCount}`);

    if (!confirm) {
      console.log('Dry run. To actually delete run with CONFIRM_DELETE_STUDENTS=true');
      process.exit(0);
    }

    console.log('Starting deletion of student-related data...');
    await db.execute(sql`BEGIN;`);

    // 1) Delete grades and absences for students
    await db.execute(sql`DELETE FROM grades WHERE student_id IN (SELECT id FROM students);`);
    await db.execute(sql`DELETE FROM absences WHERE student_id IN (SELECT id FROM students);`);

    // 2) Delete notifications and local auth for student user accounts
    await db.execute(sql`DELETE FROM notifications WHERE user_id IN (SELECT id FROM users WHERE role = 'student');`);
    await db.execute(sql`DELETE FROM local_auths WHERE user_id IN (SELECT id FROM users WHERE role = 'student');`);

    // 3) Delete student records
    await db.execute(sql`DELETE FROM students;`);

    // 4) Delete user accounts with role student
    await db.execute(sql`DELETE FROM users WHERE role = 'student';`);

    await db.execute(sql`COMMIT;`);
    console.log('Deletion of students completed successfully.');
  } catch (err: any) {
    await db.execute(sql`ROLLBACK;`);
    console.error('Error during deletion of students, rolled back:', err?.message || err);
    process.exit(1);
  } finally {
    process.exit(0);
  }
}

main().catch((err) => { console.error('Unhandled error:', err); process.exit(1); });
