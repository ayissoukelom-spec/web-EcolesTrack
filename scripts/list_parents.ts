import { db } from '../src/db/index.ts';
import { users, parents } from '../src/db/schema.ts';
import { sql } from 'drizzle-orm';

async function main() {
  try {
    const parentUsers = await db.select({ id: users.id, uid: users.uid, email: users.email, name: users.name, isDeleted: users.isDeleted }).from(users).where(sql`${users.role} = 'parent'`).limit(500);
    const parentProfiles = await db.select({ id: parents.id, userId: parents.userId, studentId: parents.studentId, schoolId: parents.schoolId }).from(parents).limit(500);

    console.log('Parent user rows found:', parentUsers.length);
    console.table(parentUsers.slice(0, 200));
    console.log('Parent profile rows found:', parentProfiles.length);
    console.table(parentProfiles.slice(0, 200));
  } catch (err:any) {
    console.error('Error listing parents:', err?.message || err);
  } finally {
    process.exit(0);
  }
}

main();
