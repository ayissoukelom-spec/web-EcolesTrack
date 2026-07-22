import { sql } from 'drizzle-orm';

const query = sql`INSERT INTO evaluation_participations (evaluation_id, student_id, status, created_at, updated_at) VALUES (${200}, ${101}, ${'absent'}, NOW(), NOW()) ON CONFLICT (evaluation_id, student_id) DO UPDATE SET status = ${'absent'}, updated_at = NOW();`;

console.log('query constructor', query.constructor?.name, typeof query);
console.log('query keys', Object.keys(query));
console.log('query.queryChunks length', (query as any).queryChunks?.length);
console.log('query.queryChunks raw types');
(query as any).queryChunks?.forEach((chunk:any, idx:number) => {
  console.log(idx, chunk?.constructor?.name || typeof chunk, chunk, Array.isArray(chunk), typeof chunk === 'object' ? Object.keys(chunk) : '');
});

function getQueryParams(sqlObj: any, visited = new WeakSet()): any[] {
  if (sqlObj === null || sqlObj === undefined) return [];
  if (typeof sqlObj !== 'object') return [sqlObj];
  if (visited.has(sqlObj)) return [];
  visited.add(sqlObj);

  if (Array.isArray(sqlObj)) {
    return sqlObj.flatMap((chunk) => getQueryParams(chunk, visited));
  }
  if (Array.isArray(sqlObj.queryChunks)) {
    return sqlObj.queryChunks.flatMap((chunk:any) => getQueryParams(chunk, visited));
  }
  if (Array.isArray(sqlObj._strings)) {
    return sqlObj._strings.flatMap((chunk:any) => getQueryParams(chunk, visited));
  }
  if ('value' in sqlObj) {
    const value = sqlObj.value;
    if (Array.isArray(value)) {
      return value.flatMap((item:any) => getQueryParams(item, visited));
    }
    if (typeof value !== 'object' || value === null) {
      return [value];
    }
    return getQueryParams(value, visited);
  }
  return [];
}

console.log('params:', getQueryParams(query));
