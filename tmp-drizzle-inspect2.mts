import { eq, and, sql } from 'drizzle-orm';
import { notifications } from './src/db/schema.ts';

const cond = and(eq(notifications.evaluationId, 200), eq(notifications.category, 'evaluation_created'));
const query = sql`INSERT INTO evaluation_participations (evaluation_id, student_id, status, created_at, updated_at) VALUES (${200}, ${101}, ${'absent'}, NOW(), NOW()) ON CONFLICT (evaluation_id, student_id) DO UPDATE SET status = ${'absent'}, updated_at = NOW();`;

const dump = (obj: any, path = 'root', depth = 0) => {
  const indent = '  '.repeat(depth);
  if (depth > 10) {
    console.log(`${indent}${path}: <max depth>`);
    return;
  }
  if (obj === null || obj === undefined || typeof obj !== 'object') {
    console.log(`${indent}${path}: ${String(obj)} (${typeof obj})`);
    return;
  }
  if (Array.isArray(obj)) {
    console.log(`${indent}${path}: Array(${obj.length})`);
    obj.forEach((item, idx) => dump(item, `${path}[${idx}]`, depth + 1));
    return;
  }
  const keys = Object.keys(obj);
  console.log(`${indent}${path}: ${obj.constructor?.name || 'Object'} keys=[${keys.join(', ')}]`);
  for (const key of keys) {
    if (key === 'query') {
      console.log(`${indent}  ${path}.${key}: ${typeof obj[key]}`);
    } else {
      dump(obj[key], `${path}.${key}`, depth + 1);
    }
  }
};

console.log('=== COND ===');
dump(cond, 'cond');
console.log('--- cond.queryChunks ---');
dump((cond as any).queryChunks, 'cond.queryChunks');
console.log('--- cond._strings ---');
dump((cond as any)._strings, 'cond._strings');
console.log('=== QUERY ===');
dump(query, 'query');
console.log('--- query.queryChunks ---');
dump((query as any).queryChunks, 'query.queryChunks');
console.log('--- query._strings ---');
dump((query as any)._strings, 'query._strings');
