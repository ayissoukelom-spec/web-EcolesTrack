import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';

const mockState = vi.hoisted(() => ({
  teacher: { id: 5, schoolId: 10, userId: 50 } as { id: number; schoolId: number; userId: number } | undefined,
  homeroomRows: [] as Array<{ classId: number; schoolId: number; teacherId: number; classSchoolId: number | null; schoolClassStatus: string }>,
  teachingRows: [] as Array<{ classId: number; schoolId: number | null; teacherId: number; classSchoolId?: number | null }>,
}));

const mockDb = vi.hoisted(() => ({
  select: vi.fn(() => {
    const builder: any = {
      _rows: [] as any[],
      table: null as any,
      from(table: any) {
        builder.table = table;
        if (table === teachers) builder._rows = mockState.teacher ? [mockState.teacher] : [];
        if (table === classHomeroomAssignments) builder._rows = mockState.homeroomRows;
        if (table === classTeachers) builder._rows = mockState.teachingRows;
        return builder;
      },
      innerJoin(table: any) {
        if (builder.table === classTeachers && table === classes) {
          builder._rows = builder._rows.map((row: any) => ({
            ...row,
            assignmentSchoolId: row.schoolId,
            schoolId: row.classSchoolId ?? null,
          }));
        }
        return builder;
      },
      leftJoin() { return builder; },
      where(condition: any) {
        if (condition && [teachers, classHomeroomAssignments, classTeachers].includes(builder.table)) {
          const query = new PgDialect().sqlToQuery(condition);
          if (builder.table === teachers) {
            const requestedUserId = query.params.find((value) => typeof value === 'number');
            builder._rows = builder._rows.filter((teacher: any) => teacher.userId === requestedUserId);
          } else if (builder.table === classHomeroomAssignments) {
            const [teacherId, schoolId] = query.params;
            builder._rows = builder._rows.filter((assignment: any) => assignment.teacherId === teacherId && assignment.schoolId === schoolId);
          } else {
            const [teacherId, schoolId] = query.params;
            builder._rows = builder._rows.filter((assignment: any) => assignment.teacherId === teacherId && assignment.assignmentSchoolId === schoolId);
          }
        }
        return builder;
      },
      then(resolve: (value: any) => unknown) { return Promise.resolve(builder._rows).then(resolve); },
    };
    return builder;
  }),
}));

vi.mock('../db/index.ts', () => ({ db: mockDb }));

import { classHomeroomAssignments, classTeachers, classes, teachers } from '../db/schema.ts';
import { getTeacherHomeroomClassIds, getTeacherReadableClassIds, getTeacherHomeroomScopes } from './homeroomAccess.ts';

describe('homeroom access scope', () => {
  beforeEach(() => {
    mockState.teacher = { id: 5, schoolId: 10, userId: 50 };
    mockState.homeroomRows = [
      { classId: 21, schoolId: 10, teacherId: 5, classSchoolId: 10, schoolClassStatus: 'approved' },
      { classId: 22, schoolId: 10, teacherId: 5, classSchoolId: null, schoolClassStatus: 'approved' },
    ];
    mockState.teachingRows = [
      { classId: 30, schoolId: 10, teacherId: 5, classSchoolId: 10 },
      { classId: 31, schoolId: 20, teacherId: 5, classSchoolId: 10 },
      { classId: 32, schoolId: null, teacherId: 5, classSchoolId: 10 },
    ];
  });

  it('resolves multiple homeroom classes only for the authenticated teacher school', async () => {
    const actor = { id: 50, role: 'teacher', schoolId: 10 };
    expect(await getTeacherHomeroomClassIds(actor)).toEqual([21, 22]);
    expect(await getTeacherHomeroomScopes({ ...actor, schoolId: 20 })).toEqual([]);
    expect(await getTeacherHomeroomScopes({ id: 51, role: 'teacher', schoolId: 10 })).toEqual([]);
    expect(await getTeacherHomeroomScopes({ id: 50, role: 'school_admin', schoolId: 10 })).toEqual([]);
  });

  it('keeps homeroom reading separate from pedagogical class assignments', async () => {
    expect(await getTeacherReadableClassIds({ id: 50, role: 'teacher', schoolId: 10 })).toEqual([30, 21, 22]);
    expect(await getTeacherReadableClassIds({ id: 50, role: 'teacher', schoolId: 20 })).toEqual([]);
  });

  it('does not include local classes through foreign or schoolless class-teacher assignments', async () => {
    const classIds = await getTeacherReadableClassIds({ id: 50, role: 'teacher', schoolId: 10 });

    expect(classIds).toContain(30);
    expect(classIds).not.toContain(31);
    expect(classIds).not.toContain(32);
  });
});