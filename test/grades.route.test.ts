import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { users, evaluations as evaluationsTable, students as studentsTable, grades as gradesTable, notifications as notificationsTable, parents as parentsTable } from '../src/db/schema.ts';

const mockDbState: any = {
  evaluations: [] as any[],
  students: [] as any[],
  grades: [] as any[],
  notifications: [] as any[],
  users: [] as any[],
};

const getRowsForTable = (table: any) => {
  if (table === users) return mockDbState.users;
  if (table === evaluationsTable) return mockDbState.evaluations;
  if (table === studentsTable) return mockDbState.students;
  if (table === gradesTable) return mockDbState.grades;
  if (table === notificationsTable) return mockDbState.notifications;
  if (table === parentsTable) return [];
  return [];
};

const createBuilder = (table: any, rows: any[]) => ({
  _rows: rows,
  _table: table,
  from(target: any) {
    return createBuilder(target, getRowsForTable(target));
  },
  where() {
    return this;
  },
  values(values: any) {
    return {
      returning: async () => {
        const inserted = { id: mockDbState.grades.length + 1, ...values };
        mockDbState.grades.push(inserted);
        return [inserted];
      },
    };
  },
  set(values: any) {
    return {
      where() {
        return {
          returning: async () => {
            const updated = { id: 1, ...values };
            if (mockDbState.grades.length > 0) {
              mockDbState.grades[0] = { ...mockDbState.grades[0], ...values };
              return [mockDbState.grades[0]];
            }
            return [updated];
          },
        };
      },
    };
  },
  then(resolve: (value: any) => void) {
    resolve(rows);
    return this;
  },
  catch(reject: (reason?: any) => void) {
    return Promise.resolve(rows).catch(reject);
  },
  finally(cb: () => void) {
    return Promise.resolve(rows).finally(cb);
  },
});

const mockDb = {
  select: () => createBuilder(null, []),
  insert: () => ({ values: (values: any) => ({ returning: async () => { const inserted = { id: mockDbState.grades.length + 1, ...values }; mockDbState.grades.push(inserted); return [inserted]; } }) }),
  update: () => ({ set: (values: any) => ({ where: () => ({ returning: async () => { const updated = { id: 1, ...values }; return [updated]; } }) }) }),
};

vi.mock('../src/db/index.ts', () => ({ db: mockDb }));
vi.mock('../src/db', () => ({ db: mockDb }));
vi.mock('src/db/index.ts', () => ({ db: mockDb }));
vi.mock('src/db', () => ({ db: mockDb }));

vi.mock('../src/middleware/auth.ts', async () => {
  const actual = await vi.importActual('../src/middleware/auth.ts');
  return {
    ...actual,
    requireAuth(req: any, _res: any, next: () => void) {
      req.user = {
        uid: 'sim-user',
        email: 'teacher@example.com',
        role: req.headers['x-simulated-role'] || 'super_admin',
        schoolId: req.headers['x-simulated-school-id'] ? Number(req.headers['x-simulated-school-id']) : null,
        id: req.headers['x-simulated-user-id'] ? Number(req.headers['x-simulated-user-id']) : null,
        simulated: true,
      };
      next();
    },
  };
});

vi.mock('src/middleware/auth', async () => {
  const actual = await vi.importActual('../src/middleware/auth.ts');
  return {
    ...actual,
    requireAuth(req: any, _res: any, next: () => void) {
      req.user = {
        uid: 'sim-user',
        email: 'teacher@example.com',
        role: req.headers['x-simulated-role'] || 'super_admin',
        schoolId: req.headers['x-simulated-school-id'] ? Number(req.headers['x-simulated-school-id']) : null,
        id: req.headers['x-simulated-user-id'] ? Number(req.headers['x-simulated-user-id']) : null,
        simulated: true,
      };
      next();
    },
  };
});

describe('POST /api/grades', () => {
  let app: any;

  beforeAll(async () => {
    const util = await import('util');
    const UE = (util as any).TextEncoder;
    const UD = (util as any).TextDecoder;
    if (UE && typeof (globalThis as any).TextEncoder === 'undefined') {
      (globalThis as any).TextEncoder = class TextEncoderShim { private _enc: any; constructor() { this._enc = new UE(); } encode(str: string) { return Uint8Array.from(this._enc.encode(str)); } } as any;
    }
    if (UD && typeof (globalThis as any).TextDecoder === 'undefined') {
      (globalThis as any).TextDecoder = class TextDecoderShim { private _dec: any; constructor() { this._dec = new UD(); } decode(buf: any) { return this._dec.decode(Buffer.from(buf)); } } as any;
    }

    const serverModule = await import('../server.ts');
    app = await serverModule.createApp();
  });

  beforeEach(() => {
    mockDbState.evaluations = [];
    mockDbState.students = [];
    mockDbState.grades = [];
    mockDbState.notifications = [];
    mockDbState.users = [{ id: 1, uid: 'sim-user', schoolId: null, role: 'super_admin' }];
  });

  it('rejects grade entry before the planned evaluation date', async () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const futureDate = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;

    mockDbState.evaluations = [{
      id: 77,
      classId: 1,
      teacherId: 1,
      termId: null,
      subject: 'Mathématiques',
      title: 'Devoir 1',
      coefficient: 1,
      maxScore: 20,
      countInBulletin: true,
      date: futureDate,
      createdAt: null,
      schoolId: 1,
    }];
    mockDbState.students = [{
      id: 11,
      firstName: 'Jean',
      lastName: 'Dupont',
      schoolId: 1,
      enrolledAt: null,
      parentId: null,
    }];

    const res = await request(app)
      .post('/api/grades')
      .set('x-simulated-role', 'super_admin')
      .send({ evaluationId: 77, studentId: 11, score: '15', remarks: '' });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('date prévue');
    expect(mockDbState.grades).toHaveLength(0);
  });
});
