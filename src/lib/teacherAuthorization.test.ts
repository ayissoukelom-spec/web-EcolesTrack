import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import { classTeachers, classes, schoolClasses, schoolSubjects, subjects, teacherSubjects, teachers, userSchools } from '../db/schema.ts';

const mockState = vi.hoisted(() => ({
  teachers: [] as Array<{ id: number; userId: number; schoolId: number; specialization: string | null }>,
  classAssignments: [] as Array<{
    teacherId: number;
    classId: number;
    schoolId: number | null;
    assignmentSchoolId?: number | null;
    classSchoolId?: number | null;
    isApprovedForSchool?: boolean;
    approvedForSchoolIds?: number[];
  }>,
  teacherSubjects: [] as Array<{ teacherId: number; subjectId: number; schoolId: number }>,
  userSchools: [] as Array<{ userId: number; schoolId: number; role: string; isActive: boolean }>,
  homeroomScopes: [] as Array<{ classId: number; schoolId: number; teacherId: number }>,
}));

const mockDb = vi.hoisted(() => ({
  select: vi.fn((projection?: any) => {
    if (Object.values(projection ?? {}).includes(classTeachers.schoolId)) {
      throw new Error('class_teachers.school_id does not exist');
    }
    if (Object.values(projection ?? {}).includes(teacherSubjects.schoolId)) {
      throw new Error('teacher_subjects.school_id does not exist');
    }
    const builder: any = {
      _rows: [] as any[],
      table: null as any,
      from(table: any) {
        builder.table = table;
        if (table === teachers) builder._rows = mockState.teachers;
        else if (table === classTeachers) builder._rows = mockState.classAssignments;
        else if (table === teacherSubjects) builder._rows = mockState.teacherSubjects;
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
          builder._rows = builder._rows.filter((row: any) => row.userId === userId);
        } else if (builder.table === classTeachers) {
          const teacherId = params[0];
          if (query.sql.includes('"class_teachers"."school_id"')) throw new Error('class_teachers.school_id does not exist');
          builder._rows = builder._rows.filter((row: any) => row.teacherId === teacherId);
        } else if (builder.table === teacherSubjects) {
          const teacherId = params[0];
          const schoolId = params[1];
          if (query.sql.includes('"teacher_subjects"."school_id"')) throw new Error('teacher_subjects.school_id does not exist');
          builder._rows = builder._rows.filter((row: any) => row.teacherId === teacherId
            && (row.subjectSchoolId === schoolId || row.isApprovedForSchool === true));
        } else if (builder.table === userSchools) {
          const userId = params[0];
          const schoolId = params[1];
          builder._rows = builder._rows.filter((row: any) => row.userId === userId && row.schoolId === schoolId && row.role === 'teacher' && row.isActive === true);
        }

        return builder;
      },
      innerJoin(table: any) {
        if (builder.table === classTeachers && table === classes) {
          builder._rows = builder._rows.map((row: any) => ({ ...row, classSchoolId: row.classSchoolId ?? row.schoolId }));
        } else if (builder.table === teacherSubjects && table === subjects) {
          builder._rows = builder._rows.map((row: any) => ({ ...row, subjectSchoolId: row.subjectSchoolId ?? row.schoolId }));
        }
        return builder;
      },
      leftJoin(table: any, condition: any) {
        const query = condition ? new PgDialect().sqlToQuery(condition) : { params: [] };
        const schoolId = (query.params as any[]).find((value) => typeof value === 'number');
        if (builder.table === classTeachers && table === schoolClasses) {
          builder._rows = builder._rows.map((row: any) => ({
            ...row,
            isApprovedForSchool: row.approvedForSchoolIds
              ? row.approvedForSchoolIds.includes(schoolId)
              : row.isApprovedForSchool === true,
          }));
        } else if (builder.table === teacherSubjects && table === schoolSubjects) {
          builder._rows = builder._rows.map((row: any) => ({
            ...row,
            isApprovedForSchool: row.approvedForSchoolIds?.includes(schoolId) === true,
          }));
        }
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
    mockState.classAssignments = [
      { teacherId: 10, classId: 101, schoolId: 1, assignmentSchoolId: 1, classSchoolId: 1, isApprovedForSchool: true },
      { teacherId: 10, classId: 102, schoolId: 2, assignmentSchoolId: 2, classSchoolId: 2, isApprovedForSchool: true },
      { teacherId: 10, classId: 999, schoolId: null, assignmentSchoolId: 1, classSchoolId: null, isApprovedForSchool: true },
    ];
    mockState.teacherSubjects = [
      { teacherId: 10, subjectId: 501, schoolId: 1 },
      { teacherId: 10, subjectId: 601, schoolId: 2 },
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
    expect(Array.from(scope!.subjectIds)).toEqual([501]);
  });

  it('2. scopes a teacher with active memberships in A and B to the selected school', async () => {
    const scope = await getTeacherAuthorizationScope({ id: 100, role: 'teacher', schoolId: 1 });
    expect(scope!.schoolId).toBe(1);
    expect(scope!.teachingClassIds.has(102)).toBe(false);
    expect(scope!.subjectIds.has(601)).toBe(false);
  });

  it('3. rejects a local class owned by school B', async () => {
    mockState.classAssignments = [{ teacherId: 10, classId: 405, schoolId: 2, assignmentSchoolId: 2, classSchoolId: 2, isApprovedForSchool: true }];
    const scope = await getTeacherAuthorizationScope({ id: 100, role: 'teacher', schoolId: 1 });
    expect(scope!.teachingClassIds.has(405)).toBe(false);
  });

  it('4. rejects a subject owned by school B', async () => {
    mockState.teacherSubjects = [{ teacherId: 10, subjectId: 601, schoolId: 2 }];
    const scope = await getTeacherAuthorizationScope({ id: 100, role: 'teacher', schoolId: 1 });
    expect(scope!.subjectIds.has(601)).toBe(false);
  });

  it('5. rejects a global class that is not approved for the active school', async () => {
    mockState.classAssignments = [{ teacherId: 10, classId: 999, schoolId: null, assignmentSchoolId: 1, classSchoolId: null, isApprovedForSchool: false }];
    const scope = await getTeacherAuthorizationScope({ id: 100, role: 'teacher', schoolId: 1 });
    expect(scope!.teachingClassIds.has(999)).toBe(false);
  });

  it('6. accepts a global class when it is approved for the active school', async () => {
    mockState.classAssignments = [{ teacherId: 10, classId: 999, schoolId: null, assignmentSchoolId: 1, classSchoolId: null, isApprovedForSchool: true }];
    const scope = await getTeacherAuthorizationScope({ id: 100, role: 'teacher', schoolId: 1 });
    expect(scope!.teachingClassIds.has(999)).toBe(true);
  });

  it('6a. rejects the same global class in school B when it is approved only for A', async () => {
    mockState.classAssignments = [{
      teacherId: 10,
      classId: 999,
      schoolId: null,
      classSchoolId: null,
      approvedForSchoolIds: [1],
    }];

    const scope = await getTeacherAuthorizationScope({ id: 100, role: 'teacher', schoolId: 2 });

    expect(scope).not.toBeNull();
    expect(scope!.teachingClassIds.has(999)).toBe(false);
  });

  it('7. rejects a global class approved only for another school', async () => {
    mockState.classAssignments = [{ teacherId: 10, classId: 999, schoolId: null, assignmentSchoolId: 1, classSchoolId: null, isApprovedForSchool: false }];
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
    };
    expect(canTeacherReadEvaluation(scope, { schoolId: 1, classId: 101, subjectId: 601, subject: 'Histoire' })).toBe(false);
  });

  it('10. titular adds only homeroomClassIds to the read scope', async () => {
    mockState.homeroomScopes = [{ classId: 202, schoolId: 1, teacherId: 10 }];
    const scope = await getTeacherAuthorizationScope({ id: 100, role: 'teacher', schoolId: 1 });
    expect(scope!.homeroomClassIds.has(202)).toBe(true);
    expect(scope!.teachingClassIds.has(202)).toBe(false);
  });

  it('11. homeroom access does not extend write permissions', async () => {
    mockState.homeroomScopes = [{ classId: 202, schoolId: 1, teacherId: 10 }];
    const scope = await getTeacherAuthorizationScope({ id: 100, role: 'teacher', schoolId: 1 });
    expect(canTeacherReadEvaluation(scope!, { schoolId: 1, classId: 202, subjectId: null, subject: 'Français' })).toBe(true);
    expect(canTeacherWriteEvaluation(scope!, { schoolId: 1, classId: 202, subjectId: null, subject: 'Français' })).toBe(false);
  });

  it('12. reading can use the homeroom scope', async () => {
    mockState.homeroomScopes = [{ classId: 202, schoolId: 1, teacherId: 10 }];
    const scope = await getTeacherAuthorizationScope({ id: 100, role: 'teacher', schoolId: 1 });
    expect(canTeacherReadEvaluation(scope!, { schoolId: 1, classId: 202, subjectId: 999, subject: 'Français' })).toBe(true);
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
