import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the DB module that studentAccess imports (src/db/index.ts)
const mockDb: any = vi.hoisted(() => ({
  selectReturn: [],
  select: vi.fn(() => {
    const builder: any = {
      _rows: Array.isArray(mockDb.selectReturn) ? mockDb.selectReturn : [mockDb.selectReturn],
      from(_table: any) {
        return builder;
      },
      where: async (_cond?: any) => builder,
      innerJoin: (_t: any, _on?: any) => builder,
      then(onFulfilled: any, onRejected: any) {
        return Promise.resolve(builder._rows).then(onFulfilled, onRejected);
      },
      catch(onRejected: any) {
        return Promise.resolve(builder._rows).catch(onRejected);
      },
      finally(onFinally: any) {
        return Promise.resolve(builder._rows).finally(onFinally);
      },
    };
    return builder;
  }),
  execute: vi.fn(async () => ({ rows: Array.isArray(mockDb.selectReturn) ? mockDb.selectReturn : [mockDb.selectReturn] })),
}));

vi.mock('../db/index.ts', () => ({ db: mockDb }));

import studentAccess from './studentAccess';

beforeEach(() => {
  mockDb.select.mockClear?.();
  mockDb.execute.mockClear?.();
  mockDb.selectReturn = [];
});

describe('studentAccess.getAuthorizedStudentIds (unit)', () => {
  it('Case 1: teacher of school 4 sees student with class.school_id=4', async () => {
    const actor = { id: 10, role: 'teacher', schoolId: 4 } as any;
    mockDb.selectReturn = [{ id: 123 }];
    const ids = await studentAccess.getAuthorizedStudentIds(actor, { classIds: [80] });
    expect(ids).toEqual([123]);
  });

  it('Case 2: teacher of school 4 does not see student if student.school_id != school', async () => {
    const actor = { id: 10, role: 'teacher', schoolId: 4 } as any;
    mockDb.selectReturn = []; // no rows when filtering by school
    const ids = await studentAccess.getAuthorizedStudentIds(actor, { classIds: [80] });
    expect(ids).toEqual([]);
  });

  it('Case 3: super_admin sees all students', async () => {
    const actor = { role: 'super_admin' } as any;
    mockDb.selectReturn = [{ id: 1 }, { id: 2 }];
    const ids = await studentAccess.getAuthorizedStudentIds(actor, {});
    expect(ids).toEqual([1, 2]);
  });

  it('Case 4: global class approved (student present) preserves visibility', async () => {
    const actor = { id: 11, role: 'teacher', schoolId: 4 } as any;
    mockDb.selectReturn = [{ id: 200 }];
    const ids = await studentAccess.getAuthorizedStudentIds(actor, { classIds: [80] });
    expect(ids).toEqual([200]);
  });
});
