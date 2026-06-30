import { db } from './src/db/index.ts';
import { bulletins } from './src/db/schema.ts';
import { isNull } from 'drizzle-orm';

const test = async () => {
  // Check if there are any bulletins with null termId
  const bulletinsWithNullTerm = await db.select().from(bulletins).where(isNull(bulletins.termId));
  
  console.log('Bulletins with NULL termId:', bulletinsWithNullTerm);
  
  // Also check the schema of termId in the actual database
  const allBulletins = await db.select().from(bulletins);
  console.log('\nAll bulletins in database:', allBulletins);
};

test().catch((e) => {
  console.error(e);
  process.exit(1);
});
