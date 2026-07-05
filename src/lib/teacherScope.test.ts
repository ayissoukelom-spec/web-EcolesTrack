import { describe, expect, it } from 'vitest';
import { getTeacherClassIdSet } from './teacherScope';

describe('getTeacherClassIdSet', () => {
  it('returns only assigned class ids and ignores null values', () => {
    expect(getTeacherClassIdSet([{ classId: 10 }, { classId: 12 }, { classId: null }])).toEqual([10, 12]);
  });

  it('filters out classes from other schools when a current school is provided', () => {
    expect(getTeacherClassIdSet([{ classId: 10, schoolId: 1 }, { classId: 12, schoolId: 2 }], 1)).toEqual([10]);
  });
});
