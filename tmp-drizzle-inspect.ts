import { eq, and, sql } from 'drizzle-orm';
import { notifications } from './src/db/schema.ts';

const cond = and(eq(notifications.evaluationId, 200), eq(notifications.category, 'evaluation_created'));
const query = sql`INSERT INTO evaluation_participations (evaluation_id, student_id, status, created_at, updated_at) VALUES (${200}, ${101}, ${'absent'}, NOW(), NOW()) ON CONFLICT (evaluation_id, student_id) DO UPDATE SET status = ${'absent'}, updated_at = NOW();`;

const traverse = (obj: any, cb: (item: any, path: string) => void, path = 'obj') => {
  cb(obj, path);
  if (!obj || typeof obj !== 'object') return;
  if (Array.isArray(obj)) {
    obj.forEach((item, idx) => traverse(item, cb, `${path}[${idx}]`));
    return;
  }
  for (const key of Object.keys(obj)) {
    traverse(obj[key], cb, `${path}.${key}`);
  }
};

console.log('COND keys', Object.keys(cond));
console.log('COND top level', JSON.stringify(cond, (k,v)=> typeof v==='function'?'[Function]': v, 2));
console.log('QUERY keys', Object.keys(query));
console.log('QUERY top level', JSON.stringify(query, (k,v)=> typeof v==='function'?'[Function]': v, 2));

const objInfo = (obj: any) => {
  if (!obj || typeof obj !== 'object') return String(obj);
  if (Array.isArray(obj)) return `Array(${obj.length})`;
  return `${obj.constructor?.name || 'Object'} keys=${Object.keys(obj).join(',')}`;
};
const inspect = (obj: any, depth = 0) => {
  const indent = '  '.repeat(depth);
  if (!obj || typeof obj !== 'object') return `${obj}`;
  if (Array.isArray(obj)) return `[
${obj.map((x:any)=>indent+'  '+inspect(x, depth+1)).join(',
')}
${indent}]`;
  const keys = Object.keys(obj);
  return `{
${keys.map(k => `${indent}  ${k}: ${inspect(obj[k], depth+1)}`).join(',
')}
${indent}}`;
};
console.log('COND inspect', inspect(cond));
console.log('QUERY inspect', inspect(query));
