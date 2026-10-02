import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import { parents, students } from '../db/schema.ts';

const mockState: { parents: any[]; students: any[] } = {
  parents: [
    { id: 1, userId: 10, schoolId: 1, studentId: 900 },
    { id: 2, userId: 20, schoolId: 1, studentId: 901 },
  ],
  students: [
    { id: 101, parentId: 1, schoolId: 1 },
    { id: 102, parentId: 1, schoolId: 1 },
    { id: 201, parentId: 2, schoolId: 1 },
    { id: 202, parentId: 1, schoolId: 2 },
    { id: 203, parentId: 2, schoolId: 1 },
  ],
};

const mockDb = {
  select: () => {
    const builder: any = {
      table: null as any,
      query: null as any,
      from(table: any) {
        builder.table = table;
        return builder;
      },
      where(condition: any) {
        builder.query = new PgDialect().sqlToQuery(condition);
        return builder;
      },
      then(resolve: (rows: any[]) => void, reject: (error: unknown) => void) {
        const params = builder.query?.params ?? [];
        const rows = builder.table === parents
          ? mockState.parents.filter((parent) => parent.userId === params[0])
          : builder.table === students
            ? mockState.students.filter((student) => student.parentId === params[0] && student.schoolId === params[1])
            : [];
        return Promise.resolve(rows).then(resolve, reject);
      },
    };
    return builder;
  },
};

vi.mock('../db/index.ts', () => ({ db: mockDb }));

const { getParentChildStudentIds } = await import('./parentStudentAccess.ts');

describe('getParentChildStudentIds', () => {
  beforeEach(() => {
    mockState.parents = [
      { id: 1, userId: 10, schoolId: 1, studentId: 900 },
      { id: 2, userId: 20, schoolId: 1, studentId: 901 },
    ];
    mockState.students = [
      { id: 101, parentId: 1, schoolId: 1 },
      { id: 102, parentId: 1, schoolId: 1 },
      { id: 201, parentId: 2, schoolId: 1 },
      { id: 202, parentId: 1, schoolId: 2 },
      { id: 203, parentId: 2, schoolId: 1 },
    ];
  });

  it('returns all currently linked children, but not another parent or school', async () => {
    await expect(getParentChildStudentIds(10)).resolves.toEqual([101, 102]);
    await expect(getParentChildStudentIds(20)).resolves.toEqual([201, 203]);
  });

  it('does not treat a stale parents.studentId as an active relationship', async () => {
    await expect(getParentChildStudentIds(10)).resolves.not.toContain(900);
  });

  it('revokes access as soon as students.parentId changes', async () => {
    mockState.students[0].parentId = 2;

    await expect(getParentChildStudentIds(10)).resolves.toEqual([102]);
    await expect(getParentChildStudentIds(20)).resolves.toEqual([101, 201, 203]);
  });

  it('fails closed without a parent profile or school scope', async () => {
    mockState.parents.push({ id: 3, userId: 30, schoolId: null, studentId: 204 });
    mockState.students.push({ id: 204, parentId: 3, schoolId: 1 });

    await expect(getParentChildStudentIds(null)).resolves.toEqual([]);
    await expect(getParentChildStudentIds(999)).resolves.toEqual([]);
    await expect(getParentChildStudentIds(30)).resolves.toEqual([]);
  });
});