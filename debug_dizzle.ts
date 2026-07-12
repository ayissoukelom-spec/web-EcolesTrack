import { eq, inArray } from 'drizzle-orm';
import { teachers, classTeachers, classes } from './src/db/schema.ts';

function dump(cond: any) {
  console.log('--- cond type', cond.constructor?.name, 'keys', Object.keys(cond));
  if (!cond || !Array.isArray(cond.queryChunks)) { console.log('no queryChunks'); return; }
  for (const [idx, chunk] of cond.queryChunks.entries()) {
    console.log('idx', idx, 'ctor', chunk?.constructor?.name, 'type', typeof chunk, 'keys', chunk && typeof chunk === 'object' ? Object.keys(chunk) : undefined);
    if (chunk && typeof chunk === 'object') {
      if ('name' in chunk) console.log('  name', (chunk as any).name);
      if ('columnName' in chunk) console.log('  columnName', (chunk as any).columnName);
      if ('field' in chunk) console.log('  field', (chunk as any).field);
      if ('value' in chunk) console.log('  value', JSON.stringify((chunk as any).value));
    }
  }
}

const cond1 = eq(teachers.userId, 3);
dump(cond1);
const cond2 = eq(classTeachers.teacherId, 77);
dump(cond2);
const cond3 = inArray(classes.id, [1]);
dump(cond3);
