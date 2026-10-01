import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import { classTeachers, students, teachers } from '../db/schema.ts';

const mockState = vi.hoisted(() => ({
  teacherRows: [] as Array<{ id: number; userId: number }>,
  classAssignments: [] as Array<{ teacherId: number; classId: number; schoolId: number | null; classSchoolId?: number | null; isApprovedForSchool?: boolean }>,
  studentRows: [] as Array<{ id: number; schoolId: number; classId: number; isActive: boolean }>,
  lastStudentWhere: null as any,
}));

const mockDb = vi.hoisted(() => ({
  select: vi.fn(() => {
    const builder: any = {
      _rows: [] as any[],
      table: null as any,
      from(table: any) {
        builder.table = table;
        if (table === teachers) builder._rows = mockState.teacherRows;
        else if (table === classTeachers) builder._rows = mockState.classAssignments;
        else if (table === students) builder._rows = mockState.studentRows;
        return builder;
      },
      innerJoin() { return builder; },
      where(condition?: any) {
        const query = new PgDialect().sqlToQuery(condition);
        if (builder.table === teachers) {
          const userId = query.params[0];
          builder._rows = builder._rows.filter((teacher: any) => teacher.userId === userId);
        } else if (builder.table === classTeachers) {
          const teacherId = query.params[0];
          builder._rows = builder._rows.filter((assignment: any) => assignment.teacherId === teacherId);
        } else if (builder.table === students) {
          mockState.lastStudentWhere = condition;
          builder._rows = mockState.studentRows;
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
vi.mock('./teacherAuthorization.ts', () => ({
  getTeacherAuthorizationScope: vi.fn(async (actor: any) => {
    const teacher = mockState.teacherRows.find((row) => row.userId === actor.id);
    if (!teacher || actor.role !== 'teacher' || actor.schoolId == null) return null;
    const teachingClassIds = mockState.classAssignments
      .filter((assignment) => assignment.teacherId === teacher.id)
      .filter((assignment) => assignment.schoolId === actor.schoolId)
      .filter((assignment) => assignment.classSchoolId === undefined
        ? true
        : assignment.classSchoolId === actor.schoolId || (assignment.classSchoolId == null && assignment.isApprovedForSchool === true))
      .map((assignment) => assignment.classId);
    return {
      teacherId: teacher.id,
      schoolId: actor.schoolId,
      specialization: null,
      teachingClassIds: new Set(teachingClassIds),
      homeroomClassIds: new Set<number>(),
      subjectIds: new Set<number>(),
    };
  }),
}));

import studentAccess from './studentAccess';

beforeEach(() => {
  mockDb.select.mockClear();
  mockState.teacherRows = [{ id: 5, userId: 10 }];
  mockState.classAssignments = [{ teacherId: 5, classId: 80, schoolId: 4 }];
  mockState.studentRows = [{ id: 123, schoolId: 4, classId: 80, isActive: true }];
  mockState.lastStudentWhere = null;
});

describe('studentAccess.getAuthorizedStudentIds (unit)', () => {
  it('returns active students in an actually assigned class and the teacher school', async () => {
    const actor = { id: 10, role: 'teacher', schoolId: 4 };
    const ids = await studentAccess.getAuthorizedStudentIds(actor, { classIds: [80] });
    expect(ids).toEqual([123]);
  });

  it('does not return students from another school', async () => {
    const actor = { id: 10, role: 'teacher', schoolId: 4 };
    mockState.studentRows = [];
    const ids = await studentAccess.getAuthorizedStudentIds(actor, { classIds: [80] });
    expect(ids).toEqual([]);
  });

  it('returns all students for super_admin', async () => {
    mockState.studentRows = [
      { id: 1, schoolId: 4, classId: 80, isActive: true },
      { id: 2, schoolId: 9, classId: 200, isActive: false },
    ];
    const ids = await studentAccess.getAuthorizedStudentIds({ role: 'super_admin' });
    expect(ids).toEqual([1, 2]);
  });

  it('keeps approved global-class assignments visible in the teacher school', async () => {
    const actor = { id: 10, role: 'teacher', schoolId: 4 };
    mockState.classAssignments = [{ teacherId: 5, classId: 80, schoolId: 4, classSchoolId: null, isApprovedForSchool: true }];
    const ids = await studentAccess.getAuthorizedStudentIds(actor, { classIds: [80] });
    expect(ids).toEqual([123]);
  });

  it('keeps the active-student restriction for class-scoped access', async () => {
    const actor = { id: 10, role: 'teacher', schoolId: 4 };
    const ids = await studentAccess.getAuthorizedStudentIds(actor, { classIds: [80] });
    const query = new PgDialect().sqlToQuery(mockState.lastStudentWhere);
    expect(ids).toEqual([123]);
    expect(query.sql).toContain('"students"."is_active" = $');
  });

  it('does not let a caller-supplied classId expand teacher authorization', async () => {
    const actor = { id: 10, role: 'teacher', schoolId: 4 };
    mockState.classAssignments = [{ teacherId: 5, classId: 80, schoolId: 4 }];
    const ids = await studentAccess.getAuthorizedStudentIds(actor, { classIds: [999] });
    expect(ids).toEqual([]);
    expect(mockState.lastStudentWhere).toBeNull();
  });

  it('intersects requested classIds with the assigned class set', async () => {
    const actor = { id: 10, role: 'teacher', schoolId: 4 };
    mockState.classAssignments = [
      { teacherId: 5, classId: 80, schoolId: 4 },
      { teacherId: 5, classId: 81, schoolId: 4 },
    ];
    const ids = await studentAccess.getAuthorizedStudentIds(actor, { classIds: [80, 999] });
    const query = new PgDialect().sqlToQuery(mockState.lastStudentWhere);
    expect(ids).toEqual([123]);
    expect(query.params).not.toContain(999);
  });
});