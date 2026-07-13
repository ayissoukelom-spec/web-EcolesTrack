import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { schools, academicYears, users, subjects, classes } from '../src/db/schema.ts';

const mockState = {
  users: [
    { id: 1, uid: 'sim-admin', email: 'admin@example.com', role: 'super_admin', schoolId: null },
  ],
  academicYears: [
    { id: 1, name: '2024-2025', isActive: true, schoolId: null },
  ],
};

const createBuilder = () => {
  const builder: any = {
    table: null as any,
    from(table: any) {
      builder.table = table;
      return builder;
    },
    where() {
      return builder;
    },
    limit() {
      return builder;
    },
    orderBy() {
      return builder;
    },
    then(resolve: (value: any) => void) {
      if (builder.table === users) {
        return Promise.resolve(mockState.users).then(resolve);
      }
      if (builder.table === academicYears) {
        return Promise.resolve(mockState.academicYears).then(resolve);
      }
      return Promise.resolve([]).then(resolve);
    },
    catch(reject: (reason?: any) => void) {
      return Promise.resolve([]).catch(reject);
    },
    finally(cb: () => void) {
      return Promise.resolve([]).finally(cb);
    },
  };
  return builder;
};

const mockDb = {
  select: () => createBuilder(),
  insert: (table: any) => ({
    values: () => ({
      returning: async () => {
        if (table === schools) {
          return [{ id: 1 }];
        }
        return [];
      },
    }),
  }),
  update: () => ({ set: () => ({ where: async () => [] }) }),
  delete: () => ({ where: async () => [] }),
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
        uid: 'sim-admin',
        email: 'admin@example.com',
        role: 'super_admin',
        schoolId: null,
        id: 1,
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
        uid: 'sim-admin',
        email: 'admin@example.com',
        role: 'super_admin',
        schoolId: null,
        id: 1,
        simulated: true,
      };
      next();
    },
  };
});

describe('POST /api/schools', () => {
  let app: any;

  beforeAll(async () => {
    const serverModule = await import('../server.ts');
    app = await serverModule.createApp();
  });

  beforeEach(() => {
    mockState.users = [
      { id: 1, uid: 'sim-admin', email: 'admin@example.com', role: 'super_admin', schoolId: null },
    ];
    mockState.academicYears = [
      { id: 1, name: '2024-2025', isActive: true, schoolId: null },
    ];
  });

  it('rejects creating a school without classNames', async () => {
    const res = await request(app)
      .post('/api/schools')
      .send({ name: 'École du Lac', address: '', phone: '+228 90000000', subjectNames: ['Mathématiques'] })
      .expect(400);

    expect(res.body.error).toContain('classNames must be a non-empty array');
  });

  it('rejects creating a school without subjectNames', async () => {
    const res = await request(app)
      .post('/api/schools')
      .send({ name: 'École du Lac', address: '', phone: '+228 90000000', classNames: ['6ème'] })
      .expect(400);

    expect(res.body.error).toContain('subjectNames must be a non-empty array');
  });

  it('creates a school when classNames and subjectNames are provided', async () => {
    const res = await request(app)
      .post('/api/schools')
      .send({ name: 'École du Lac', address: '', phone: '+228 90000000', classNames: ['6ème'], subjectNames: ['Mathématiques'] })
      .expect(201);

    expect(res.body).toMatchObject({ id: 1 });
  });
});
