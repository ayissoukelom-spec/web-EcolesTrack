import { db } from './src/db/index.ts';
import { users, localAuths } from './src/db/schema.ts';
import { eq } from 'drizzle-orm';

async function main() {
  const result = await db
    .select({
      email: users.email,
      role: users.role,
      authId: localAuths.id
    })
    .from(users)
    .leftJoin(localAuths, eq(users.id, localAuths.userId));

  console.table(result);
}

main();