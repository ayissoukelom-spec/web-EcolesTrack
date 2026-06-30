import { db } from './src/db/index.ts';
import { bulletins, bulletinLines } from './src/db/schema.ts';
import { eq } from 'drizzle-orm';

const test = async () => {
  const bulletinId = 11;  // Bulletin créé dans le test précédent

  // 1. Check bulletins table
  const bulletin = await db.select().from(bulletins).where(eq(bulletins.id, bulletinId));
  console.log('Bulletin in bulletins table:', bulletin);

  // 2. Check bulletinLines
  const lines = await db.select().from(bulletinLines).where(eq(bulletinLines.bulletinId, bulletinId));
  console.log('Lines in bulletinLines table:', lines);
};

test().catch((e) => {
  console.error(e);
  process.exit(1);
});
