import { db } from '../src/db/index.ts';
import { users, parents, students, notifications, localAuths } from '../src/db/schema.ts';
import { sql } from 'drizzle-orm';

async function main() {
  const confirm = process.env.CONFIRM_DELETE_PARENTS === 'true';

  const parentCountRes = await db.select({ count: sql<number>`count(*)::integer` }).from(parents);
  const parentCount = Number(parentCountRes[0]?.count ?? 0);
  const userCountRes = await db.select({ count: sql<number>`count(*)::integer` }).from(users).where(sql`${users.role} = 'parent'`);
  const userCount = Number(userCountRes[0]?.count ?? 0);

  console.log(`Parents profiles: ${parentCount}`);
  console.log(`User accounts with role=parent: ${userCount}`);

  if (!confirm) {
    console.log('Dry run. To actually delete run with CONFIRM_DELETE_PARENTS=true');
    process.exit(0);
  }

  try {
    console.log('Starting deletion of parent-related data...');
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
        throw new Error('Apply the journal-preservation SQL before deleting parent accounts.');
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
          concat('Permanent account deletion by delete_all_parents; role=', u.role)
        from users u
        left join schools s on s.id = u.school_id
        where u.role = 'parent'
      `);

      await tx.execute(sql`ALTER TABLE students ALTER COLUMN parent_id DROP NOT NULL;`);
      await tx.execute(sql`UPDATE students SET parent_id = NULL WHERE parent_id IS NOT NULL;`);
      await tx.execute(sql`DELETE FROM notifications WHERE user_id IN (SELECT id FROM users WHERE role = 'parent');`);
      await tx.execute(sql`DELETE FROM local_auths WHERE user_id IN (SELECT id FROM users WHERE role = 'parent');`);
      await tx.execute(sql`DELETE FROM parents WHERE user_id IN (SELECT id FROM users WHERE role = 'parent');`);
      await tx.execute(sql`DELETE FROM users WHERE role = 'parent';`);
    });
    console.log('Deletion completed successfully.');
  } catch (err: any) {
    console.error('Error during deletion, rolled back:', err?.message || err);
    process.exit(1);
  } finally {
    process.exit(0);
  }
}

main().catch((err) => { console.error('Unhandled error:', err); process.exit(1); });
