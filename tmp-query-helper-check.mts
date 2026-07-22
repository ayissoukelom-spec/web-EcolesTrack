import { eq, and, sql } from 'drizzle-orm';
import { notifications } from './src/db/schema.ts';

function getQueryChunks(sqlObj: any): any[] {
  if (!sqlObj || typeof sqlObj !== 'object') return [];
  if (Array.isArray(sqlObj.queryChunks)) return sqlObj.queryChunks;
  if (Array.isArray(sqlObj._strings)) return sqlObj._strings;
  return [];
}

function getQueryText(sqlObj: any, visited = new WeakSet()): string {
  if (sqlObj === null || sqlObj === undefined) return '';
  if (typeof sqlObj !== 'object') return String(sqlObj);
  if (visited.has(sqlObj)) return '';
  visited.add(sqlObj);
  if ('queryChunks' in sqlObj && Array.isArray(sqlObj.queryChunks)) {
    return sqlObj.queryChunks.map((chunk: any) => getQueryText(chunk, visited)).join('');
  }
  if ('_strings' in sqlObj && Array.isArray(sqlObj._strings)) {
    return sqlObj._strings.map((chunk: any) => getQueryText(chunk, visited)).join('');
  }
  if ('value' in sqlObj) {
    const value = sqlObj.value;
    if (Array.isArray(value)) return value.map((item: any) => getQueryText(item, visited)).join('');
    if (typeof value === 'object') return getQueryText(value, visited);
    return String(value);
  }
  return Object.values(sqlObj).map((item) => getQueryText(item, visited)).join('');
}

function getQueryParams(sqlObj: any, visited = new WeakSet()): any[] {
  if (sqlObj === null || sqlObj === undefined) return [];
  if (typeof sqlObj !== 'object') return [];
  if (visited.has(sqlObj)) return [];
  visited.add(sqlObj);
  const values: any[] = [];
  if ('queryChunks' in sqlObj && Array.isArray(sqlObj.queryChunks)) {
    for (const chunk of sqlObj.queryChunks) {
      values.push(...getQueryParams(chunk, visited));
    }
    return values;
  }
  if ('_strings' in sqlObj && Array.isArray(sqlObj._strings)) {
    for (const chunk of sqlObj._strings) {
      values.push(...getQueryParams(chunk, visited));
    }
    return values;
  }
  if ('value' in sqlObj) {
    const value = sqlObj.value;
    if (Array.isArray(value)) {
      for (const item of value) values.push(...getQueryParams(item, visited));
      return values;
    }
    if (typeof value !== 'object' || value === null) {
      values.push(value);
      return values;
    }
    return getQueryParams(value, visited);
  }
  for (const item of Object.values(sqlObj)) {
    values.push(...getQueryParams(item, visited));
  }
  return values;
}

const cond = and(eq(notifications.evaluationId, 200), eq(notifications.category, 'evaluation_created'));
const query = sql`INSERT INTO evaluation_participations (evaluation_id, student_id, status, created_at, updated_at) VALUES (${200}, ${101}, ${'absent'}, NOW(), NOW()) ON CONFLICT (evaluation_id, student_id) DO UPDATE SET status = ${'absent'}, updated_at = NOW();`;

console.log('TEXT cond:', getQueryText(cond));
console.log('PARAMS cond:', getQueryParams(cond));
console.log('TEXT query:', getQueryText(query));
console.log('PARAMS query:', getQueryParams(query));
