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
        throw new Error('Apply the journal-preservation SQL before deleting teacher accounts or grades.');
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
          concat('Permanent account deletion by delete_all_teachers; role=', u.role)
        from users u
        left join schools s on s.id = u.school_id
        where u.role = 'teacher'
      `);

      await tx.execute(sql`UPDATE classes SET teacher_id = NULL WHERE teacher_id IN (SELECT id FROM teachers);`);
      await tx.execute(sql`DELETE FROM class_teachers WHERE teacher_id IN (SELECT id FROM teachers);`);
      await tx.execute(sql`DELETE FROM grades WHERE evaluation_id IN (SELECT id FROM evaluations WHERE teacher_id IN (SELECT id FROM teachers));`);
      await tx.execute(sql`DELETE FROM evaluations WHERE teacher_id IN (SELECT id FROM teachers);`);
      await tx.execute(sql`DELETE FROM notifications WHERE user_id IN (SELECT id FROM users WHERE role = 'teacher');`);
      await tx.execute(sql`DELETE FROM local_auths WHERE user_id IN (SELECT id FROM users WHERE role = 'teacher');`);
      await tx.execute(sql`DELETE FROM teachers WHERE user_id IN (SELECT id FROM users WHERE role = 'teacher');`);
      await tx.execute(sql`DELETE FROM users WHERE role = 'teacher';`);
    });
    console.log('Deletion of teachers completed successfully.');
  } catch (err: any) {
    console.error('Error during deletion of teachers, rolled back:', err?.message || err);
    process.exit(1);
  } finally {
    process.exit(0);
  }
}

main().catch((err) => { console.error('Unhandled error:', err); process.exit(1); });
