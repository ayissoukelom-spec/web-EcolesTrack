import { describe, expect, it } from 'vitest';
import {
  authorizeTeacherControlSchool,
  isExactActiveTeacherControlAssignment,
} from './authorization.ts';

const activeSchool = { id: 8, name: 'École A', isSuspended: false };

describe('teacher control authorization', () => {
  it('requires an exact supported business role and an active membership in the active school', () => {
    expect(authorizeTeacherControlSchool(
      { id: 10, role: 'teacher', schoolId: 8 },
      8,
      { role: 'teacher', isActive: true },
      activeSchool,
    )).toMatchObject({ allowed: true, role: 'teacher', schoolId: 8 });

    expect(authorizeTeacherControlSchool(
      { id: 10, role: 'teacher', schoolId: 9 },
      8,
      { role: 'teacher', isActive: true },
      activeSchool,
    )).toMatchObject({ allowed: false, reason: 'wrong_school' });
    expect(authorizeTeacherControlSchool(
      { id: 10, role: 'teacher', schoolId: 8 },
      8,
      { role: 'teacher', isActive: false },
      activeSchool,
    )).toMatchObject({ allowed: false, reason: 'inactive_membership' });
  });

  it('blocks surveillants and suspended-school administrators without relying on app-role mapping', () => {
    expect(authorizeTeacherControlSchool(
      { id: 10, role: 'surveillant', schoolId: 8 },
      8,
      { role: 'surveillant', isActive: true },
      activeSchool,
    )).toMatchObject({ allowed: false, reason: 'unsupported_role' });
    expect(authorizeTeacherControlSchool(
      { id: 11, role: 'school_admin', schoolId: 8 },
      8,
      { role: 'school_admin', isActive: true },
      { ...activeSchool, isSuspended: true },
    )).toMatchObject({ allowed: false, reason: 'school_suspended' });
  });

  it('allows a super admin to consult a selected suspended school', () => {
    expect(authorizeTeacherControlSchool(
      { id: 1, role: 'super_admin', schoolId: null },
      8,
      null,
      { ...activeSchool, isSuspended: true },
    )).toMatchObject({ allowed: true, role: 'super_admin', schoolId: 8 });
  });

  it('accepts only the exact active teacher-school-class-subject assignment', () => {
    const assignment = {
      id: 20,
      teacherId: 10,
      schoolId: 8,
      classId: 30,
      subjectId: 40,
      isActive: true,
    };
    const expected = { teacherId: 10, schoolId: 8, classId: 30, subjectId: 40 };

    expect(isExactActiveTeacherControlAssignment(assignment, expected)).toBe(true);
    expect(isExactActiveTeacherControlAssignment({ ...assignment, isActive: false }, expected)).toBe(false);
    expect(isExactActiveTeacherControlAssignment({ ...assignment, subjectId: 41 }, expected)).toBe(false);
    expect(isExactActiveTeacherControlAssignment({ ...assignment, schoolId: 9 }, expected)).toBe(false);
  });
});
