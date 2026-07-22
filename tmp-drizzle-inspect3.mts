import { eq, and } from 'drizzle-orm';
import { notifications } from './src/db/schema.ts';

const cond = and(eq(notifications.evaluationId, 200), eq(notifications.category, 'evaluation_created'));

const keys = (obj:any) => obj && typeof obj==='object' ? Object.keys(obj) : [];
console.log('cond keys', keys(cond));
console.log('cond.queryChunks length', (cond as any).queryChunks?.length);
for (let i=0; i<((cond as any).queryChunks?.length||0); i++) {
  const chunk = (cond as any).queryChunks[i];
  console.log(`chunk ${i}: type=${chunk?.constructor?.name||typeof chunk} value=${typeof chunk==='object' ? '[object]' : String(chunk)} keys=${keys(chunk).join(', ')}`);
  if (chunk && typeof chunk==='object' && !Array.isArray(chunk)) {
    console.log(' nested keys', keys((chunk as any).queryChunks), ' _strings ', keys((chunk as any)._strings));
    if ((chunk as any).queryChunks) {
      for (let j=0; j<((chunk as any).queryChunks.length); j++) {
        const inner = (chunk as any).queryChunks[j];
        console.log(`  inner ${j}: type=${inner?.constructor?.name||typeof inner} value=${typeof inner==='object'? '[object]' : String(inner)} keys=${keys(inner).join(', ')}`);
      }
    }
  }
}
