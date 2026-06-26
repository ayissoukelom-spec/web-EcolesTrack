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
    await db.execute(sql`BEGIN;`);

    // 0) Ensure students.parent_id allows NULL so we can clear references
    await db.execute(sql`ALTER TABLE students ALTER COLUMN parent_id DROP NOT NULL;`);

    // 1) Clear student -> parent references to avoid FK issues
    await db.execute(sql`UPDATE students SET parent_id = NULL WHERE parent_id IS NOT NULL;`);

    // 2) Remove notifications, local auths for parent users
    await db.execute(sql`DELETE FROM notifications WHERE user_id IN (SELECT id FROM users WHERE role = 'parent');`);
    await db.execute(sql`DELETE FROM local_auths WHERE user_id IN (SELECT id FROM users WHERE role = 'parent');`);

    // 3) Remove parent profiles
    await db.execute(sql`DELETE FROM parents WHERE user_id IN (SELECT id FROM users WHERE role = 'parent');`);

    // 4) Remove user accounts with role parent
    await db.execute(sql`DELETE FROM users WHERE role = 'parent';`);

    await db.execute(sql`COMMIT;`);
    console.log('Deletion completed successfully.');
  } catch (err: any) {
    await db.execute(sql`ROLLBACK;`);
    console.error('Error during deletion, rolled back:', err?.message || err);
    process.exit(1);
  } finally {
    process.exit(0);
  }
}

main().catch((err) => { console.error('Unhandled error:', err); process.exit(1); });
