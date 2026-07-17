import { db } from './src/db/index.ts';
import { users, localAuths } from './src/db/schema.ts';

async function main() {
  const allUsers = await db.select().from(users);
  const allAuths = await db.select().from(localAuths);

  console.log("USERS:");
  console.log(allUsers);

  console.log("LOCAL_AUTHS:");
  console.log(allAuths);

  process.exit(0);
}

main();