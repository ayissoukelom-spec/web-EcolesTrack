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
    await db.transaction(async (tx) => {
      const historyConstraints = await tx.execute(sql`
        select conname
        from pg_constraint
        where contype = 'f'
          and conrelid in (
            to_regclass('public.audit_events'),
            to_regclass('public.user_login_events'),
            to_regclass('public.grade_history')
          )
      `);
      if (historyConstraints.rows.length > 0) {
        throw new Error('Apply the journal-preservation SQL before deleting student accounts or grades.');
      }

      await tx.execute(sql`
        insert into audit_events (
          actor_user_id, actor_role, actor_name, action,
          resource_type, resource_id, school_id, school_name_snapshot,
          module, result, source, description
        )
        select
          null, 'system', current_user, 'delete',
          'user', u.id, u.school_id, s.name,
          'user_management', 'success', 'sql',
          concat('Permanent account deletion by delete_all_students; role=', u.role)
        from users u
        left join schools s on s.id = u.school_id
        where u.role = 'student'
      `);

      await tx.execute(sql`DELETE FROM grades WHERE student_id IN (SELECT id FROM students);`);
      await tx.execute(sql`DELETE FROM absences WHERE student_id IN (SELECT id FROM students);`);
      await tx.execute(sql`DELETE FROM notifications WHERE user_id IN (SELECT id FROM users WHERE role = 'student');`);
      await tx.execute(sql`DELETE FROM local_auths WHERE user_id IN (SELECT id FROM users WHERE role = 'student');`);
      await tx.execute(sql`DELETE FROM students;`);
      await tx.execute(sql`DELETE FROM users WHERE role = 'student';`);
    });
    console.log('Deletion of students completed successfully.');
  } catch (err: any) {
    console.error('Error during deletion of students, rolled back:', err?.message || err);
    process.exit(1);
  } finally {
    process.exit(0);
  }
}

main().catch((err) => { console.error('Unhandled error:', err); process.exit(1); });
