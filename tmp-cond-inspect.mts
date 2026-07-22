import { eq, and } from 'drizzle-orm';
import { notifications } from './src/db/schema.ts';

const cond = and(eq(notifications.evaluationId, 200), eq(notifications.category, 'evaluation_created'));

const results: string[] = [];
const visited = new WeakSet<any>();
function traverse(obj: any, path = 'root') {
  if (!obj || typeof obj !== 'object') return;
  if (visited.has(obj)) return;
  visited.add(obj);
  if ('name' in obj && typeof obj.name === 'string') results.push(`${path}.name=${obj.name}`);
  if ('keyAsName' in obj && typeof obj.keyAsName === 'string') results.push(`${path}.keyAsName=${obj.keyAsName}`);
  if ('table' in obj && obj.table && typeof obj.table === 'object' && 'name' in obj.table) results.push(`${path}.table.name=${obj.table.name}`);
  if ('queryChunks' in obj && Array.isArray(obj.queryChunks)) {
    obj.queryChunks.forEach((chunk: any, idx: number) => traverse(chunk, `${path}.queryChunks[${idx}]`));
  }
  if ('_strings' in obj && Array.isArray(obj._strings)) {
    obj._strings.forEach((chunk: any, idx: number) => traverse(chunk, `${path}._strings[${idx}]`));
  }
  if ('value' in obj) {
    traverse(obj.value, `${path}.value`);
  }
  for (const key of Object.keys(obj)) {
    if (['queryChunks','_strings','value'].includes(key)) continue;
    traverse(obj[key], `${path}.${key}`);
  }
}

traverse(cond);
console.log(results.join('\n'));