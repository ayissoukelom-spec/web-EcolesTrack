import { db } from '../src/db/index.ts';
import { teachers, classes, classTeachers, evaluations, grades, users, notifications, localAuths } from '../src/db/schema.ts';
import { sql } from 'drizzle-orm';

async function main() {
  const confirm = process.env.CONFIRM_DELETE_TEACHERS === 'true';

  try {
    const teacherCountRes = await db.select({ count: sql<number>`count(*)::integer` }).from(teachers);
    const teacherCount = Number(teacherCountRes[0]?.count ?? 0);
    const userCountRes = await db.select({ count: sql<number>`count(*)::integer` }).from(users).where(sql`${users.role} = 'teacher'`);
    const userCount = Number(userCountRes[0]?.count ?? 0);

    console.log(`Teacher profiles: ${teacherCount}`);
    console.log(`User accounts with role=teacher: ${userCount}`);

    if (!confirm) {
      console.log('Dry run. To actually delete run with CONFIRM_DELETE_TEACHERS=true');
      process.exit(0);
    }

    console.log('Starting deletion of teacher-related data...');
    await db.execute(sql`BEGIN;`);

    // 1) Nullify classes principal teacher references
    await db.execute(sql`UPDATE classes SET teacher_id = NULL WHERE teacher_id IN (SELECT id FROM teachers);`);

    // 2) Remove class_teachers assignments
    await db.execute(sql`DELETE FROM class_teachers WHERE teacher_id IN (SELECT id FROM teachers);`);

    // 3) Delete grades linked to evaluations owned by these teachers
    await db.execute(sql`DELETE FROM grades WHERE evaluation_id IN (SELECT id FROM evaluations WHERE teacher_id IN (SELECT id FROM teachers));`);

    // 4) Delete evaluations created by these teachers
    await db.execute(sql`DELETE FROM evaluations WHERE teacher_id IN (SELECT id FROM teachers);`);

    // 5) Delete notifications and local_auths for teacher user accounts
    await db.execute(sql`DELETE FROM notifications WHERE user_id IN (SELECT id FROM users WHERE role = 'teacher');`);
    await db.execute(sql`DELETE FROM local_auths WHERE user_id IN (SELECT id FROM users WHERE role = 'teacher');`);

    // 6) Delete teacher profiles
    await db.execute(sql`DELETE FROM teachers WHERE user_id IN (SELECT id FROM users WHERE role = 'teacher');`);

    // 7) Delete user accounts with role teacher
    await db.execute(sql`DELETE FROM users WHERE role = 'teacher';`);

    await db.execute(sql`COMMIT;`);
    console.log('Deletion of teachers completed successfully.');
  } catch (err: any) {
    await db.execute(sql`ROLLBACK;`);
    console.error('Error during deletion of teachers, rolled back:', err?.message || err);
    process.exit(1);
  } finally {
    process.exit(0);
  }
}

main().catch((err) => { console.error('Unhandled error:', err); process.exit(1); });
