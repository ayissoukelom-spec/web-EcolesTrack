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

  if (Array.isArray(sqlObj)) {
    return sqlObj.map((chunk) => getQueryText(chunk, visited)).join('');
  }

  if ('queryChunks' in sqlObj && Array.isArray(sqlObj.queryChunks)) {
    return sqlObj.queryChunks.map((chunk: any) => getQueryText(chunk, visited)).join('');
  }

  if ('_strings' in sqlObj && Array.isArray(sqlObj._strings)) {
    return sqlObj._strings.map((chunk: any) => getQueryText(chunk, visited)).join('');
  }

  if ('value' in sqlObj) {
    const value = sqlObj.value;
    if (Array.isArray(value)) {
      return value.map((item: any) => getQueryText(item, visited)).join('');
    }
    return getQueryText(value, visited);
  }

  if (typeof sqlObj.name === 'string') return sqlObj.name;
  if (typeof sqlObj.keyAsName === 'string') return sqlObj.keyAsName;
  return '';
}

function getQueryParams(sqlObj: any, visited = new WeakSet()): any[] {
  if (sqlObj === null || sqlObj === undefined) return [];
  if (typeof sqlObj !== 'object') return [sqlObj];
  if (visited.has(sqlObj)) return [];
  visited.add(sqlObj);

  if (Array.isArray(sqlObj)) {
    return sqlObj.flatMap((chunk) => getQueryParams(chunk, visited));
  }

  if ('queryChunks' in sqlObj && Array.isArray(sqlObj.queryChunks)) {
    return sqlObj.queryChunks.flatMap((chunk: any) => getQueryParams(chunk, visited));
  }

  if ('_strings' in sqlObj && Array.isArray(sqlObj._strings)) {
    return sqlObj._strings.flatMap((chunk: any) => getQueryParams(chunk, visited));
  }

  if ('value' in sqlObj) {
    const value = sqlObj.value;
    if (Array.isArray(value)) {
      return value.flatMap((item: any) => getQueryParams(item, visited));
    }
    if (typeof value !== 'object' || value === null) {
      return [value];
    }
    return getQueryParams(value, visited);
  }

  return [];
}

const cond = and(eq(notifications.evaluationId, 200), eq(notifications.category, 'evaluation_created'));
console.log('TEXT cond:', getQueryText(cond));
console.log('PARAMS cond:', getQueryParams(cond));
console.log('COND queryChunks count', (cond as any).queryChunks?.length);
console.log('cond.queryChunks types', (cond as any).queryChunks.map((c:any)=> typeof c === 'object' ? c.constructor?.name : typeof c));
