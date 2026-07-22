import { eq, and } from 'drizzle-orm';
import { notifications } from './src/db/schema.ts';

const cond = and(eq(notifications.evaluationId, 200), eq(notifications.category, 'evaluation_created'));

const describe = (obj:any, path='root') => {
  if (!obj || typeof obj !== 'object') {
    console.log(`${path}: ${String(obj)} (${typeof obj})`);
    return;
  }
  if (Array.isArray(obj)) {
    console.log(`${path}: Array(${obj.length})`);
    obj.forEach((item, idx) => describe(item, `${path}[${idx}]`));
    return;
  }
  const keys = Object.keys(obj);
  console.log(`${path}: ${obj.constructor?.name || 'Object'} keys=[${keys.join(', ')}]`);
  if ('queryChunks' in obj) {
    (obj.queryChunks as any[]).forEach((chunk:any, idx:number) => describe(chunk, `${path}.queryChunks[${idx}]`));
  }
  if ('_strings' in obj) {
    (obj._strings as any[]).forEach((chunk:any, idx:number) => describe(chunk, `${path}._strings[${idx}]`));
  }
  if ('value' in obj) console.log(`${path}.value => ${String(obj.value)} type=${typeof obj.value}`);
};

describe(cond, 'cond');
