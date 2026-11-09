import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import { parents, schools, students, userSchools } from '../db/schema.ts';

const mockState: { parents: any[]; students: any[]; memberships: any[]; schools: number[] } = {
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
  memberships: [
    { userId: 10, schoolId: 1, role: 'parent', isActive: true },
    { userId: 20, schoolId: 1, role: 'parent', isActive: true },
  ],
  schools: [1, 2],
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
      limit() {
        return builder;
      },
      then(resolve: (rows: any[]) => void, reject: (error: unknown) => void) {
        const params = builder.query?.params ?? [];
        const rows = builder.table === schools
          ? mockState.schools
            .filter((id) => id === params[0])
            .map((id) => ({ id }))
          : builder.table === parents
          ? mockState.parents.filter((parent) => parent.userId === params[0] && parent.schoolId === params[1])
          : builder.table === students
            ? mockState.students.filter((student) => student.parentId === params[0] && student.schoolId === params[1])
            : builder.table === userSchools
              ? mockState.memberships.filter((membership) => membership.userId === params[0]
                && membership.schoolId === params[1]
                && membership.role === 'parent'
                && membership.isActive !== false)
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
    mockState.memberships = [
      { userId: 10, schoolId: 1, role: 'parent', isActive: true },
      { userId: 20, schoolId: 1, role: 'parent', isActive: true },
    ];
    mockState.schools = [1, 2];
  });

  it('returns all currently linked children, but not another parent or school', async () => {
    await expect(getParentChildStudentIds(10, 1)).resolves.toEqual([101, 102]);
    await expect(getParentChildStudentIds(20, 1)).resolves.toEqual([201, 203]);
  });

  it('does not treat a stale parents.studentId as an active relationship', async () => {
    await expect(getParentChildStudentIds(10, 1)).resolves.not.toContain(900);
  });

  it('revokes access as soon as students.parentId changes', async () => {
    mockState.students[0].parentId = 2;

    await expect(getParentChildStudentIds(10, 1)).resolves.toEqual([102]);
    await expect(getParentChildStudentIds(20, 1)).resolves.toEqual([101, 201, 203]);
  });

  it('returns children only for the requested school when a parent has profiles in two schools', async () => {
    mockState.parents.push({ id: 3, userId: 10, schoolId: 2, studentId: 902 });
    mockState.memberships.push({ userId: 10, schoolId: 2, role: 'parent', isActive: true });
    mockState.students.push(
      { id: 301, parentId: 3, schoolId: 2 },
      { id: 302, parentId: 1, schoolId: 1 },
    );

    await expect(getParentChildStudentIds(10, 1)).resolves.toEqual([101, 102, 302]);
    await expect(getParentChildStudentIds(10, 2)).resolves.toEqual([301]);
  });

  it('does not include a student linked to another parent profile in the same school', async () => {
    await expect(getParentChildStudentIds(10, 1)).resolves.not.toContain(201);
  });

  it('fails closed without a parent identity or verified school scope', async () => {
    mockState.parents.push({ id: 3, userId: 30, schoolId: null, studentId: 204 });
    mockState.students.push({ id: 204, parentId: 3, schoolId: 1 });

    await expect(getParentChildStudentIds(null, 1)).resolves.toEqual([]);
    await expect(getParentChildStudentIds(999, 1)).resolves.toEqual([]);
    await expect(getParentChildStudentIds(30, 1)).resolves.toEqual([]);
    await expect(getParentChildStudentIds(10, null)).resolves.toEqual([]);
  });

  it('does not reuse a historical orphan profile in another school', async () => {
    mockState.parents.push(
      { id: 3, userId: 30, schoolId: null, studentId: null },
      { id: 4, userId: 40, schoolId: 99, studentId: null },
    );
    mockState.students.push(
      { id: 204, parentId: 3, schoolId: 1 },
      { id: 205, parentId: 4, schoolId: 99 },
    );
    mockState.memberships.push(
      { userId: 30, schoolId: 1, role: 'parent', isActive: true },
      { userId: 40, schoolId: 99, role: 'parent', isActive: true },
    );

    await expect(getParentChildStudentIds(30, 1)).resolves.toEqual([]);
    await expect(getParentChildStudentIds(40, 99)).resolves.toEqual([]);
  });

  it.each([true, null])('accepts an exact parent membership with isActive=%s', async (isActive) => {
    mockState.memberships = [{ userId: 10, schoolId: 1, role: 'parent', isActive }];

    await expect(getParentChildStudentIds(10, 1)).resolves.toEqual([101, 102]);
  });

  it('fails closed when the exact parent membership is inactive', async () => {
    const isActive = false;
    mockState.memberships = [{ userId: 10, schoolId: 1, role: 'parent', isActive }];

    await expect(getParentChildStudentIds(10, 1)).resolves.toEqual([]);
  });
});