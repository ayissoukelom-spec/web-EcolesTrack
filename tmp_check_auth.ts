import { db } from './src/db/index.ts';
import { localAuths } from './src/db/schema.ts';

async function main() {
  const rows = await db.select().from(localAuths);
  console.log("LOCAL AUTHS:");
  console.log(rows);
}

main();