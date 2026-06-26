import { db } from '../src/db/index.ts';
import { sql } from 'drizzle-orm';

async function main() {
  try {
    console.log('Attempting to run UPDATE students SET parent_id = NULL WHERE parent_id IS NOT NULL;');
    await db.execute(sql`BEGIN;`);
    const r = await db.execute(sql`UPDATE students SET parent_id = NULL WHERE parent_id IS NOT NULL;`);
    console.log('Update result:', r);
    await db.execute(sql`ROLLBACK;`);
  } catch (err: any) {
    console.error('Update failed with error:', err);
  } finally {
    process.exit(0);
  }
}

main();
