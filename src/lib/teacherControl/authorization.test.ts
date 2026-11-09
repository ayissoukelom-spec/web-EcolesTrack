import { describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import { schools, teacherClassSubjects, teachers, userSchools } from '../../db/schema.ts';

const mockState = vi.hoisted(() => ({
  membership: { userId: 10, schoolId: 8, role: 'teacher', isActive: true } as {
    userId: number;
    schoolId: number;
    role: string;
    isActive: boolean | null;
  } | undefined,
  school: { id: 8, name: 'École A', isSuspended: false } as {
    id: number;
    name: string;
    isSuspended: boolean;
  } | undefined,
  teacher: { id: 20, userId: 10, schoolId: 8 } as {
    id: number;
    userId: number;
    schoolId: number;
  } | undefined,
  assignment: {
    id: 30,
    teacherId: 20,
    schoolId: 8,
    classId: 40,
    subjectId: 50,
    isActive: true,
  } as {
    id: number;
    teacherId: number;
    schoolId: number;
    classId: number;
    subjectId: number;
    isActive: boolean;
  } | undefined,
}));

const mockDb = vi.hoisted(() => ({
  select: vi.fn(() => {
    const builder: any = {
      table: null as any,
      rows: [] as any[],
      from(table: any) {
        builder.table = table;
        builder.rows = table === userSchools
          ? mockState.membership ? [mockState.membership] : []
          : table === schools
            ? mockState.school ? [mockState.school] : []
            : table === teachers
              ? mockState.teacher ? [mockState.teacher] : []
              : table === teacherClassSubjects
                ? mockState.assignment ? [mockState.assignment] : []
                : [];
        return builder;
      },
      where(condition: any) {
        const params = new PgDialect().sqlToQuery(condition).params;
        if (builder.table === userSchools) {
          builder.rows = builder.rows.filter((row: any) => row.userId === params[0]
            && row.schoolId === params[1]
            && row.role === params[2]);
        } else if (builder.table === schools) {
          builder.rows = builder.rows.filter((row: any) => row.id === params[0]);
        } else if (builder.table === teachers) {
          builder.rows = builder.rows.filter((row: any) => row.userId === params[0]
            && row.schoolId === params[1]);
        } else if (builder.table === teacherClassSubjects) {
          builder.rows = builder.rows.filter((row: any) => row.teacherId === params[0]
            && row.schoolId === params[1]
            && row.classId === params[2]
            && row.subjectId === params[3]
            && row.isActive === true);
        }
        return builder;
      },
      limit() { return builder; },
      then(resolve: (rows: any[]) => unknown) {
        return Promise.resolve(builder.rows).then(resolve);
      },
    };
    return builder;
  }),
}));

vi.mock('../../db/index.ts', () => ({ db: mockDb }));

import {
  authorizeTeacherControlSchool,
  findActiveTeacherControlAssignment,
  isExactActiveTeacherControlAssignment,
} from './authorization.ts';

const activeSchool = { id: 8, name: 'École A', isSuspended: false };

describe('teacher control authorization', () => {
  it('resolves a teacher profile only in the exact active school', async () => {
    mockState.membership = { userId: 10, schoolId: 8, role: 'teacher', isActive: true };
    mockState.school = activeSchool;
    mockState.teacher = { id: 20, userId: 10, schoolId: 8 };
    mockState.assignment = { id: 30, teacherId: 20, schoolId: 8, classId: 40, subjectId: 50, isActive: true };

    await expect(findActiveTeacherControlAssignment({
      actor: { id: 10, role: 'teacher', schoolId: 8 },
      schoolId: 8,
      classId: 40,
      subjectId: 50,
    })).resolves.toMatchObject({ teacherId: 20, schoolId: 8 });

    mockState.teacher = { id: 21, userId: 10, schoolId: 9 };
    await expect(findActiveTeacherControlAssignment({
      actor: { id: 10, role: 'teacher', schoolId: 8 },
      schoolId: 8,
      classId: 40,
      subjectId: 50,
    })).resolves.toBeNull();
  });

  it('requires an exact supported business role and allows active or legacy-null memberships', () => {
    for (const isActive of [true, null]) {
      expect(authorizeTeacherControlSchool(
        { id: 10, role: 'teacher', schoolId: 8 },
        8,
        { role: 'teacher', isActive },
        activeSchool,
      )).toMatchObject({ allowed: true, role: 'teacher', schoolId: 8 });
    }

    expect(authorizeTeacherControlSchool(
      { id: 10, role: 'teacher', schoolId: 8 },
      8,
      { role: 'teacher', isActive: false },
      activeSchool,
    )).toMatchObject({ allowed: false, reason: 'inactive_membership' });
    expect(authorizeTeacherControlSchool(
      { id: 10, role: 'teacher', schoolId: 9 },
      8,
      { role: 'teacher', isActive: true },
      activeSchool,
    )).toMatchObject({ allowed: false, reason: 'wrong_school' });
    expect(authorizeTeacherControlSchool(
      { id: 10, role: 'teacher', schoolId: 8 },
      8,
      null,
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
