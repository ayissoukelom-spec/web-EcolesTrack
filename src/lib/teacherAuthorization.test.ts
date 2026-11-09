import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import { classes, schoolClasses, schoolSubjects, subjects, teacherClassSubjects, teachers, userSchools } from '../db/schema.ts';

const mockState = vi.hoisted(() => ({
  teachers: [] as Array<{ id: number; userId: number; schoolId: number; specialization: string | null }>,
  teachingAssignments: [] as Array<{
    id?: number;
    teacherId: number;
    classId: number;
    subjectId: number;
    schoolId: number;
    isActive: boolean;
    classSchoolId?: number | null;
    approvedClassForSchoolIds?: number[];
    subjectSchoolId?: number | null;
    approvedSubjectForSchoolIds?: number[];
  }>,
  userSchools: [] as Array<{ userId: number; schoolId: number; role: string; isActive?: boolean | null }>,
  homeroomScopes: [] as Array<{ classId: number; schoolId: number; teacherId: number }>,
}));

const mockDb = vi.hoisted(() => ({
  select: vi.fn((projection?: any) => {
    const builder: any = {
      _rows: [] as any[],
      table: null as any,
      from(table: any) {
        builder.table = table;
        if (table === teachers) builder._rows = mockState.teachers;
        else if (table === teacherClassSubjects) builder._rows = mockState.teachingAssignments;
        else if (table === classes || table === schoolClasses || table === subjects || table === schoolSubjects) builder._rows = [];
        else if (table === userSchools) builder._rows = mockState.userSchools;
        return builder;
      },
      where(condition: any) {
        if (!builder.table) return builder;
        const query = new PgDialect().sqlToQuery(condition);
        const params = Array.isArray(query.params) ? query.params : [];

        if (builder.table === teachers) {
          const userId = params[0];
          const schoolId = params[1];
          builder._rows = builder._rows.filter((row: any) => row.userId === userId && row.schoolId === schoolId);
        } else if (builder.table === teacherClassSubjects) {
          const teacherId = params[0];
          const schoolId = params[1];
          builder._rows = builder._rows.filter((row: any) => row.teacherId === teacherId
            && row.schoolId === schoolId
            && row.isActive === true
            && (row.classSchoolId === schoolId
              || row.classSchoolId == null && row.approvedClassForSchoolIds?.includes(schoolId) === true)
            && (row.subjectSchoolId === schoolId
              || row.subjectSchoolId == null && row.approvedSubjectForSchoolIds?.includes(schoolId) === true));
        } else if (builder.table === userSchools) {
          const userId = params[0];
          const schoolId = params[1];
          builder._rows = builder._rows.filter((row: any) => row.userId === userId
            && row.schoolId === schoolId
            && row.role === 'teacher'
            && row.isActive !== false);
        }

        return builder;
      },
      innerJoin(_table: any) {
        return builder;
      },
      leftJoin(_table: any, _condition: any) {
        return builder;
      },
      then(resolve: (value: any) => unknown) { return Promise.resolve(builder._rows).then(resolve); },
      catch(reject: (reason?: any) => unknown) { return Promise.resolve(builder._rows).catch(reject); },
      finally(callback: () => void) { return Promise.resolve(builder._rows).finally(callback); },
    };
    return builder;
  }),
}));

vi.mock('../db/index.ts', () => ({ db: mockDb }));
vi.mock('./homeroomAccess.ts', async () => ({
  getTeacherHomeroomScopes: vi.fn(async (actor: any) => {
    const teacher = mockState.teachers.find((row) => row.userId === actor.id);
    if (!teacher) return [];
    return mockState.homeroomScopes.filter((scope) => scope.teacherId === teacher.id && scope.schoolId === actor.schoolId);
  }),
}));

import { canTeacherReadEvaluation, canTeacherWriteEvaluation, getTeacherAuthorizationScope } from './teacherAuthorization';

describe('teacherAuthorization scope rules', () => {
  beforeEach(() => {
    mockState.teachers = [
      { id: 10, userId: 100, schoolId: 1, specialization: 'Physique' },
      { id: 20, userId: 200, schoolId: 2, specialization: 'Histoire' },
    ];
    mockState.teachingAssignments = [
      { teacherId: 10, classId: 101, subjectId: 501, schoolId: 1, isActive: true, classSchoolId: 1, subjectSchoolId: 1 },
      { teacherId: 10, classId: 999, subjectId: 502, schoolId: 1, isActive: true, classSchoolId: null, approvedClassForSchoolIds: [1], subjectSchoolId: null, approvedSubjectForSchoolIds: [1] },
    ];
    mockState.userSchools = [
      { userId: 100, schoolId: 1, role: 'teacher', isActive: true },
      { userId: 100, schoolId: 2, role: 'teacher', isActive: true },
    ];
    mockState.homeroomScopes = [{ classId: 202, schoolId: 1, teacherId: 10 }];
  });

  it('1. returns only school A classes and school A subject assignments for an A teacher', async () => {
    const scope = await getTeacherAuthorizationScope({ id: 100, role: 'teacher', schoolId: 1 });
    expect(scope).not.toBeNull();
    expect(scope!.schoolId).toBe(1);
    expect(Array.from(scope!.teachingClassIds)).toEqual([101, 999]);
    expect(Array.from(scope!.subjectIds)).toEqual([501, 502]);
    expect(Array.from(scope!.teachingAssignmentKeys)).toEqual(['101:501', '999:502']);
  });

  it('2. scopes a teacher with active memberships in A and B to the selected school', async () => {
    const scope = await getTeacherAuthorizationScope({ id: 100, role: 'teacher', schoolId: 1 });
    expect(scope!.schoolId).toBe(1);
    expect(scope!.teachingClassIds.has(102)).toBe(false);
    expect(scope!.subjectIds.has(601)).toBe(false);
  });

  it('only exposes exact active pairs for the current teacher and school', async () => {
    mockState.teachingAssignments = [
      ...mockState.teachingAssignments,
      { teacherId: 10, classId: 101, subjectId: 601, schoolId: 1, isActive: false, classSchoolId: 1, subjectSchoolId: 1 },
      { teacherId: 20, classId: 101, subjectId: 601, schoolId: 1, isActive: true, classSchoolId: 1, subjectSchoolId: 1 },
      { teacherId: 10, classId: 102, subjectId: 601, schoolId: 2, isActive: true, classSchoolId: 2, subjectSchoolId: 2 },
    ];

    const scope = await getTeacherAuthorizationScope({ id: 100, role: 'teacher', schoolId: 1 });

    expect(Array.from(scope!.teachingAssignmentKeys)).toEqual(['101:501', '999:502']);
    expect(scope!.teachingAssignmentKeys.has('101:601')).toBe(false);
    expect(scope!.teachingAssignmentKeys.has('102:601')).toBe(false);
  });

  it.each([true, null])('does not use a teacher profile from another school when membership isActive=%s', async (isActive) => {
    mockState.teachers[0] = { id: 10, userId: 100, schoolId: 2, specialization: 'Physique' };
    mockState.userSchools = [{ userId: 100, schoolId: 1, role: 'teacher', isActive }];

    const scope = await getTeacherAuthorizationScope({ id: 100, role: 'teacher', schoolId: 1 });

    expect(scope).toBeNull();
  });

  it('accepts a legacy-null active membership when the profile is in the exact school', async () => {
    mockState.userSchools = [{ userId: 100, schoolId: 1, role: 'teacher', isActive: null }];

    const scope = await getTeacherAuthorizationScope({ id: 100, role: 'teacher', schoolId: 1 });

    expect(scope).not.toBeNull();
    expect(scope?.teacherId).toBe(10);
  });

  it('does not resolve a profile when the exact school membership is inactive', async () => {
    mockState.userSchools = [{ userId: 100, schoolId: 1, role: 'teacher', isActive: false }];

    await expect(getTeacherAuthorizationScope({ id: 100, role: 'teacher', schoolId: 1 })).resolves.toBeNull();
  });

  it('3. rejects a local class owned by school B', async () => {
    mockState.teachingAssignments = [{ teacherId: 10, classId: 405, subjectId: 501, schoolId: 1, isActive: true, classSchoolId: 2, subjectSchoolId: 1 }];
    const scope = await getTeacherAuthorizationScope({ id: 100, role: 'teacher', schoolId: 1 });
    expect(scope!.teachingClassIds.has(405)).toBe(false);
  });

  it('4. rejects a subject owned by school B', async () => {
    mockState.teachingAssignments = [{ teacherId: 10, classId: 101, subjectId: 601, schoolId: 1, isActive: true, classSchoolId: 1, subjectSchoolId: 2 }];
    const scope = await getTeacherAuthorizationScope({ id: 100, role: 'teacher', schoolId: 1 });
    expect(scope!.subjectIds.has(601)).toBe(false);
  });

  it('4a. rejects a school A subject assignment in a school B teacher context', async () => {
    mockState.teachingAssignments = [{
      teacherId: 10,
      classId: 102,
      subjectId: 601,
      schoolId: 1,
      isActive: true,
      classSchoolId: 2,
      subjectSchoolId: 2,
    }];

    const scope = await getTeacherAuthorizationScope({ id: 100, role: 'teacher', schoolId: 2 });

    expect(scope).toBeNull();
  });

  it('5. rejects a global class that is not approved for the active school', async () => {
    mockState.teachingAssignments = [{ teacherId: 10, classId: 999, subjectId: 501, schoolId: 1, isActive: true, classSchoolId: null, subjectSchoolId: 1, approvedClassForSchoolIds: [] }];
    const scope = await getTeacherAuthorizationScope({ id: 100, role: 'teacher', schoolId: 1 });
    expect(scope!.teachingClassIds.has(999)).toBe(false);
  });

  it('6. accepts a global class when it is approved for the active school', async () => {
    mockState.teachingAssignments = [{ teacherId: 10, classId: 999, subjectId: 501, schoolId: 1, isActive: true, classSchoolId: null, subjectSchoolId: 1, approvedClassForSchoolIds: [1] }];
    const scope = await getTeacherAuthorizationScope({ id: 100, role: 'teacher', schoolId: 1 });
    expect(scope!.teachingClassIds.has(999)).toBe(true);
  });

  it('6a. rejects a school A assignment to a global class in a school B teacher context', async () => {
    mockState.teachingAssignments = [{
      teacherId: 10,
      classId: 999,
      subjectId: 501,
      schoolId: 1,
      isActive: true,
      classSchoolId: null,
      subjectSchoolId: 1,
      approvedClassForSchoolIds: [2],
    }];

    const scope = await getTeacherAuthorizationScope({ id: 100, role: 'teacher', schoolId: 2 });

    expect(scope).toBeNull();
  });

  it('7. rejects a global class approved only for another school', async () => {
    mockState.teachingAssignments = [{ teacherId: 10, classId: 999, subjectId: 501, schoolId: 1, isActive: true, classSchoolId: null, subjectSchoolId: 1, approvedClassForSchoolIds: [] }];
    mockState.teachers = [{ id: 10, userId: 100, schoolId: 1, specialization: 'Physique' }];
    const scope = await getTeacherAuthorizationScope({ id: 100, role: 'teacher', schoolId: 1 });
    expect(scope!.teachingClassIds.has(999)).toBe(false);
  });

  it('8. allows a subject assigned in the active school', () => {
    const scope = {
      teacherId: 10,
      schoolId: 1,
      specialization: 'Physique',
      teachingClassIds: new Set([101]),
      homeroomClassIds: new Set<number>(),
      subjectIds: new Set([501]),
      teachingAssignmentKeys: new Set(['101:501']),
    };
    expect(canTeacherReadEvaluation(scope, { schoolId: 1, classId: 101, subjectId: 501, subject: 'Physique' })).toBe(true);
  });

  it('9. denies a subject from another school even if the class matches', () => {
    const scope = {
      teacherId: 10,
      schoolId: 1,
      specialization: 'Physique',
      teachingClassIds: new Set([101]),
      homeroomClassIds: new Set<number>(),
      subjectIds: new Set([501]),
      teachingAssignmentKeys: new Set(['101:501']),
    };
    expect(canTeacherReadEvaluation(scope, { schoolId: 1, classId: 101, subjectId: 601, subject: 'Histoire' })).toBe(false);
  });

  it('does not infer an exact class-subject assignment from separate class and subject membership', () => {
    const scope = {
      teacherId: 10,
      schoolId: 1,
      specialization: 'Physique',
      teachingClassIds: new Set([101]),
      homeroomClassIds: new Set<number>(),
      subjectIds: new Set([501, 601]),
      teachingAssignmentKeys: new Set(['101:501']),
    };

    expect(canTeacherReadEvaluation(scope, { schoolId: 1, classId: 101, subjectId: 601, subject: 'Histoire' })).toBe(false);
    expect(canTeacherWriteEvaluation(scope, { schoolId: 1, classId: 101, subjectId: 601, subject: 'Histoire' })).toBe(false);
  });

  it('10. titular adds only homeroomClassIds to the read scope', async () => {
    mockState.homeroomScopes = [
      { classId: 202, schoolId: 1, teacherId: 10 },
      { classId: 203, schoolId: 1, teacherId: 20 },
      { classId: 204, schoolId: 2, teacherId: 10 },
    ];
    const scope = await getTeacherAuthorizationScope({ id: 100, role: 'teacher', schoolId: 1 });
    expect(scope!.homeroomClassIds.has(202)).toBe(true);
    expect(scope!.homeroomClassIds.has(203)).toBe(false);
    expect(scope!.homeroomClassIds.has(204)).toBe(false);
    expect(scope!.teachingClassIds.has(202)).toBe(false);
  });

  it('11. homeroom access does not extend evaluation or grade reads or writes', async () => {
    mockState.homeroomScopes = [{ classId: 202, schoolId: 1, teacherId: 10 }];
    const scope = await getTeacherAuthorizationScope({ id: 100, role: 'teacher', schoolId: 1 });
    expect(canTeacherReadEvaluation(scope!, { schoolId: 1, classId: 202, subjectId: null, subject: 'Français' })).toBe(false);
    expect(canTeacherReadEvaluation(scope!, { schoolId: 1, classId: 202, subjectId: 501, subject: 'Physique' })).toBe(false);
    expect(canTeacherWriteEvaluation(scope!, { schoolId: 1, classId: 202, subjectId: null, subject: 'Français' })).toBe(false);
  });

  it('12. a homeroom teacher reads an evaluation only with an exact active pair', async () => {
    mockState.homeroomScopes = [{ classId: 202, schoolId: 1, teacherId: 10 }];
    const scope = await getTeacherAuthorizationScope({ id: 100, role: 'teacher', schoolId: 1 });
    expect(canTeacherReadEvaluation(scope!, { schoolId: 1, classId: 202, subjectId: 501, subject: 'Physique' })).toBe(false);
    expect(canTeacherReadEvaluation(scope!, { schoolId: 1, classId: 101, subjectId: 501, subject: 'Physique' })).toBe(true);
  });

  it('13. writing must use teachingClassIds and not homeroomClassIds', async () => {
    mockState.homeroomScopes = [{ classId: 202, schoolId: 1, teacherId: 10 }];
    const scope = await getTeacherAuthorizationScope({ id: 100, role: 'teacher', schoolId: 1 });
    expect(canTeacherWriteEvaluation(scope!, { schoolId: 1, classId: 202, subjectId: 999, subject: 'Français' })).toBe(false);
    expect(canTeacherWriteEvaluation(scope!, { schoolId: 1, classId: 101, subjectId: 501, subject: 'Physique' })).toBe(true);
  });

  it('14. super_admin is never restricted by this helper', async () => {
    expect(await getTeacherAuthorizationScope({ id: 999, role: 'super_admin', schoolId: 1 })).toBeNull();
  });
});
