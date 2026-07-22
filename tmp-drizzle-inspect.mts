import { eq, and, sql } from 'drizzle-orm';
import { notifications } from './src/db/schema.ts';

const cond = and(eq(notifications.evaluationId, 200), eq(notifications.category, 'evaluation_created'));
const query = sql`INSERT INTO evaluation_participations (evaluation_id, student_id, status, created_at, updated_at) VALUES (${200}, ${101}, ${'absent'}, NOW(), NOW()) ON CONFLICT (evaluation_id, student_id) DO UPDATE SET status = ${'absent'}, updated_at = NOW();`;

const getQueryChunks = (obj: any): any[] => obj?.queryChunks || obj?._strings || [];
const getQueryText = (obj: any): string => getQueryChunks(obj)
  .map((chunk: any) => {
    if (typeof chunk === 'string') return chunk;
    if (chunk && typeof chunk === 'object') {
      if ('value' in chunk) return String(chunk.value);
      return getQueryText(chunk);
    }
    return '';
  })
  .join('');

const params: any[] = [];
const collect = (obj: any) => {
  for (const chunk of getQueryChunks(obj)) {
    if (typeof chunk === 'string') continue;
    if (chunk && typeof chunk === 'object') {
      if ('value' in chunk) params.push(chunk.value);
      else collect(chunk);
    }
  }
};

console.log('COND TEXT:', getQueryText(cond));
console.log('COND CHUNKS:', getQueryChunks(cond).map((c: any) => (typeof c === 'string' ? c : c.constructor?.name)));
console.log('INSERT TEXT:', getQueryText(query));
collect(query);
console.log('INSERT PARAMS:', params);
