import { eq, inArray } from 'drizzle-orm';
import { users, classes } from './src/db/schema.ts';

const cond1 = eq(users.uid, 'teacher-uid');
console.log('cond1 queryChunks length', cond1.queryChunks.length);
for (const [idx, chunk] of cond1.queryChunks.entries()) {
  console.log('idx', idx, 'ctor', chunk?.constructor?.name, 'keys', chunk && typeof chunk === 'object' ? Object.keys(chunk) : undefined);
  if (chunk && typeof chunk === 'object' && 'name' in chunk) console.log('  name', chunk.name);
  if (chunk && typeof chunk === 'object' && 'value' in chunk) console.log('  value', chunk.value, 'type', typeof chunk.value, 'isArray', Array.isArray(chunk.value));
}

const cond2 = inArray(classes.id, [1,2]);
console.log('cond2 queryChunks length', cond2.queryChunks.length);
for (const [idx, chunk] of cond2.queryChunks.entries()) {
  console.log('idx', idx, 'ctor', chunk?.constructor?.name, 'keys', chunk && typeof chunk === 'object' ? Object.keys(chunk) : undefined);
  if (chunk && typeof chunk === 'object' && 'name' in chunk) console.log('  name', chunk.name);
  if (chunk && typeof chunk === 'object' && 'value' in chunk) console.log('  value', chunk.value, 'type', typeof chunk.value, 'isArray', Array.isArray(chunk.value));
}
