import { eq, inArray } from 'drizzle-orm';
import { users, teachers, classes } from './src/db/schema.ts';

function extractConditions(cond: any): Record<string, any> {
  const result: Record<string, any> = {};
  const visited = new WeakSet<any>();

  const parseQueryChunks = (sqlObj: any) => {
    if (!sqlObj || !Array.isArray(sqlObj.queryChunks)) return;
    let lastColumn: string | null = null;
    for (const chunk of sqlObj.queryChunks) {
      if (chunk == null) continue;
      const ctor = chunk.constructor?.name;
      let fieldName: string | null = null;

      if (ctor === 'PgText' && typeof chunk.name === 'string') {
        fieldName = chunk.name.toLowerCase();
      } else if (ctor === 'PgSerial' && typeof chunk.name === 'string') {
        fieldName = chunk.name.toLowerCase();
      } else if (ctor === 'PgInteger' && typeof chunk.name === 'string') {
        fieldName = chunk.name.toLowerCase();
      } else if (ctor === 'Param') {
        if (lastColumn) {
          const normalizedLast = lastColumn.replace(/_/g, '');
          const value = (chunk as any).value;
          if (normalizedLast.includes('uid')) result.uid = value;
          else if (normalizedLast.includes('email')) result.email = value;
          else if (normalizedLast.includes('schoolid')) result.schoolId = value === null ? null : Number(value);
          else if (normalizedLast.includes('userid')) result.userId = value === null ? null : Number(value);
          else if (normalizedLast.includes('classid')) {
            if (Array.isArray(value)) {
              result.classIds = value.map((v: any) => Number(v)).filter((n: any) => !Number.isNaN(n));
            } else {
              result.classId = value === null ? null : Number(value);
            }
          } else if (normalizedLast.includes('teacherid')) {
            result.teacherId = value === null ? null : Number(value);
          } else if (normalizedLast === 'id' || /\.id$/.test(normalizedLast) || /^id$/.test(normalizedLast)) {
            if (Array.isArray(value)) {
              result.ids = value.map((v: any) => Number(v)).filter((n: any) => !Number.isNaN(n));
            } else {
              result.id = value === null ? null : Number(value);
            }
          }
        }
        lastColumn = null;
        continue;
      } else if (ctor === 'Array') {
        if (lastColumn) {
          const normalizedLast = lastColumn.replace(/_/g, '');
          const value = chunk as any[];
          if (normalizedLast.includes('classid')) {
            result.classIds = value.map((v: any) => Number(v)).filter((n: any) => !Number.isNaN(n));
          } else if (normalizedLast.includes('id') || normalizedLast.endsWith('.id')) {
            result.ids = value.map((v: any) => Number(v)).filter((n: any) => !Number.isNaN(n));
          }
        }
        lastColumn = null;
        continue;
      } else if (typeof chunk === 'string') {
        fieldName = chunk.toLowerCase();
      } else if (typeof chunk.name === 'string') {
        fieldName = chunk.name.toLowerCase();
      } else if (typeof chunk.columnName === 'string') {
        fieldName = chunk.columnName.toLowerCase();
      } else if (typeof chunk.field === 'string') {
        fieldName = chunk.field.toLowerCase();
      } else if (typeof chunk.toString === 'function') {
        const text = String(chunk).toLowerCase();
        if (text.includes('uid') || text.includes('email') || text.includes('schoolid') || text.includes('userid') || text.includes('classid') || text.includes('teacherid') || text.includes('.id')) {
          fieldName = text;
        }
      }

      if (fieldName) {
        lastColumn = fieldName;
      }
    }
  };

  const search = (item: any) => {
    if (item == null || typeof item !== 'object' || visited.has(item)) return;
    visited.add(item);
    if (Array.isArray(item)) { item.forEach(search); return; }
    if (Array.isArray(item.queryChunks)) parseQueryChunks(item);
    const left = item.left;
    const right = item.right;
    if (left !== undefined && right !== undefined) {
      const leftStr = String(left).toLowerCase();
      const rightIsPrimitive = right === null || ['string', 'number', 'boolean'].includes(typeof right);
      if (leftStr.includes('uid') && rightIsPrimitive) result.uid = right;
      if (leftStr.includes('email') && rightIsPrimitive) result.email = right;
      if (leftStr.includes('schoolid') && rightIsPrimitive) result.schoolId = right === null ? null : Number(right);
      if (leftStr.includes('userid') && rightIsPrimitive) result.userId = right === null ? null : Number(right);
      if (leftStr.includes('classid')) {
        if (rightIsPrimitive) {
          if (Array.isArray(right)) result.classIds = right.map((v: any) => Number(v)).filter((n: any) => !Number.isNaN(n));
          else result.classId = right === null ? null : Number(right);
        }
      }
      if (leftStr.includes('teacherid') && rightIsPrimitive) result.teacherId = right === null ? null : Number(right);
      if (leftStr.includes('id') && !leftStr.includes('schoolid') && !leftStr.includes('userid') && !leftStr.includes('classid') && !leftStr.includes('teacherid')) {
        if (rightIsPrimitive) {
          if (Array.isArray(right)) result.ids = right.map((v: any) => Number(v)).filter((n: any) => !Number.isNaN(n));
          else result.id = right === null ? null : Number(right);
        }
      }
      if (typeof left === 'object' && left !== null) search(left);
      if (typeof right === 'object' && right !== null) search(right);
      return;
    }
    if (item.args && Array.isArray(item.args)) item.args.forEach(search);
    Object.values(item).forEach((value) => { if (typeof value === 'object' && value !== null) search(value); });
  };

  search(cond);
  return result;
}

console.log('teachers.userId:', extractConditions(eq(teachers.userId, 3)));
console.log('classTeachers.teacherId:', extractConditions(eq(classTeachers.teacherId, 77)));
console.log('classes.id in array:', extractConditions(inArray(classes.id, [1])));
