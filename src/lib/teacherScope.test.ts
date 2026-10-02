import { describe, expect, it } from 'vitest';
import { getTeacherClassIdSet } from './teacherScope';

describe('getTeacherClassIdSet', () => {
  it('returns only assigned local class ids and ignores null values', () => {
    expect(getTeacherClassIdSet([
      { classId: 10, schoolId: 1 },
      { classId: 12, schoolId: 1 },
      { classId: null, schoolId: 1 },
    ], 1)).toEqual([10, 12]);
  });

  it('filters out classes from other schools when a current school is provided', () => {
    expect(getTeacherClassIdSet([{ classId: 10, schoolId: 1 }, { classId: 12, schoolId: 2 }], 1)).toEqual([10]);
  });

  it('keeps a global class only when assignment and approval are school-scoped', () => {
    expect(getTeacherClassIdSet([
      { classId: 69, schoolId: null, assignmentSchoolId: 7, isApprovedForSchool: true },
      { classId: 70, schoolId: null, assignmentSchoolId: 7, isApprovedForSchool: false },
      { classId: 71, schoolId: null, assignmentSchoolId: 8, isApprovedForSchool: true },
      { classId: 72, schoolId: null },
      { classId: 73, schoolId: 7, assignmentSchoolId: null, isApprovedForSchool: true },
    ], 7)).toEqual([69]);
  });

  it('returns no classes without an active school context', () => {
    expect(getTeacherClassIdSet([{ classId: 10, schoolId: 1 }])).toEqual([]);
  });
});
