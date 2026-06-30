import { db } from './src/db/index.ts';
import { bulletins } from './src/db/schema.ts';

const results = await db
  .select({
    id: bulletins.id,
    mention: bulletins.mention,
    appreciation: bulletins.appreciation,
  })
  .from(bulletins)
  .limit(10);

console.log('Sample bulletins with null values:');
results.forEach(b => {
  const appShort = b.appreciation?.substring(0, 30) ?? 'null';
  console.log(`  ID ${b.id}: mention=${b.mention ?? 'null'}, appreciation=${appShort}...`);
});
