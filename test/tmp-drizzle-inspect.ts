import { eq, and, sql } from 'drizzle-orm';
import { notifications } from './src/db/schema.ts';

const cond = and(eq(notifications.evaluationId, 200), eq(notifications.category, 'evaluation_created'));
const query = sql`INSERT INTO evaluation_participations (evaluation_id, student_id, status, created_at, updated_at) VALUES (${200}, ${101}, ${'absent'}, NOW(), NOW()) ON CONFLICT (evaluation_id, student_id) DO UPDATE SET status = ${'absent'}, updated_at = NOW();`;

const getChunks = (obj: any): any[] => obj.queryChunks || obj._strings || [];
const text = (obj: any): string => getChunks(obj).map((chunk: any) => {
  if (typeof chunk === 'string') return chunk;
  if (chunk && typeof chunk === 'object') {
    if ('value' in chunk) return String(chunk.value);
    return text(chunk);
  }
  return '';
}).join('');

const collect = (obj: any, arr: any[]) => {
  for (const chunk of getChunks(obj)) {
    if (typeof chunk === 'string') continue;
    if (chunk && typeof chunk === 'object') {
      if ('value' in chunk) arr.push(chunk.value);
      else collect(chunk, arr);
    }
  }
};

console.log('COND TEXT:', text(cond));
console.log('COND CHUNKS:', getChunks(cond).map((c) => typeof c === 'string' ? c : c.constructor?.name));
console.log('INSERT TEXT:', text(query));
const params: any[] = [];
collect(query, params);
console.log('INSERT PARAMS:', params);
