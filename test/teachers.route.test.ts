import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { teachers, users, classTeachers, userSchools } from '../src/db/schema.ts';

const mockState: any = {
  actorRole: 'super_admin',
  actorSchoolId: null as number | null,
  actorId: null as number | null,
  oldTeachers: [] as any[],
  newTeachers: [] as any[],
  classAssignments: [] as Array<{ teacherId: number; classId: number }> ,
  users: [] as any[],
  filterSchoolId: null as number | null,
};

const createBuilder = (selectArgs: any[] = []) => {
  const builder: any = {
    _rows: [],
    selectArgs,
    table: null as any,
    joinedUserSchools: false,
    from(table: any) {
      builder.table = table;
      try { console.log('DBG builder.from table:', table && (table.name || table)); } catch(e) {}
      return builder;
    },
    innerJoin(table?: any) {
      if (table === userSchools) builder.joinedUserSchools = true;
      return builder;
    },
    leftJoin() { return builder; },
    where() { return builder; },
    then(resolve: (value: any) => void) {
      // Decide return rows based on table and join context
      let out: any[] = [];
      try { console.log('DBG then selectArgs:', builder.selectArgs, 'joinedUserSchools=', builder.joinedUserSchools, 'table=', builder.table && (builder.table.name || builder.table)); } catch(e) {}
      if (builder.table === teachers) {
        // Detect oldModel when projection includes teachers.id
        const projectionIndicatesOld = Array.isArray(builder.selectArgs) && builder.selectArgs.some((arg: any) => {
          if (!arg || typeof arg !== 'object') return false;
          return Object.values(arg).some((v: any) => v === (teachers as any).id || v === (teachers as any));
        });
        const projectionIndicatesNew = Array.isArray(builder.selectArgs) && builder.selectArgs.some((arg: any) => {
          if (!arg || typeof arg !== 'object') return false;
          return Object.values(arg).some((v: any) => v === (userSchools as any).schoolId || v === (userSchools as any));
        });
        if (builder.joinedUserSchools || projectionIndicatesNew) {
          out = mockState.newTeachers || [];
        } else if (projectionIndicatesOld) {
          out = mockState.oldTeachers || [];
        } else {
          // default to combining both if we cannot detect
          out = (mockState.oldTeachers || []).concat(mockState.newTeachers || []);
        }
        if (mockState.filterSchoolId != null) {
          out = out.filter((t: any) => (t.schoolId === mockState.filterSchoolId) || (Array.isArray(t.schoolIds) && t.schoolIds.includes(mockState.filterSchoolId)));
        }
      } else if (builder.table === classTeachers) {
        out = mockState.classAssignments || [];
      } else if (builder.table === users) {
        out = mockState.users || [];
      }
      return Promise.resolve(out).then(resolve);
    },
    catch(reject: (reason?: any) => void) { return Promise.resolve(builder._rows).catch(reject); },
    finally(cb: () => void) { return Promise.resolve(builder._rows).finally(cb); },
  };
  return builder;
};

const mockDb = {
  select: (...args: any[]) => createBuilder(args),
  insert: () => ({ values: () => ({ returning: async () => [] }) }),
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
        uid: req.headers['x-simulated-uid'] || 'sim-user',
        email: req.headers['x-simulated-email'] || null,
        role: req.headers['x-simulated-role'] || 'super_admin',
        schoolId: req.headers['x-simulated-school-id'] ? Number(req.headers['x-simulated-school-id']) : null,
        id: req.headers['x-simulated-user-id'] ? Number(req.headers['x-simulated-user-id']) : null,
        simulated: true,
      };
      // reflect into mockState for builder logic
      mockState.actorRole = req.user.role;
      mockState.actorSchoolId = req.user.schoolId;
      mockState.actorId = req.user.id;
      // ensure a DB users row exists for the simulated uid so resolveActor can resolve
      if (!mockState.users.find((u: any) => u && u.uid === req.user.uid)) {
        mockState.users.unshift({ id: req.user.id ?? 999, uid: req.user.uid, schoolId: req.user.schoolId });
      }
      // set filterSchoolId from query or actor.schoolId for non-super_admin flows
      mockState.filterSchoolId = req.query && req.query.schoolId ? Number(req.query.schoolId) : (req.user.role !== 'super_admin' ? req.user.schoolId : null);
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
        uid: req.headers['x-simulated-uid'] || 'sim-user',
        email: req.headers['x-simulated-email'] || null,
        role: req.headers['x-simulated-role'] || 'super_admin',
        schoolId: req.headers['x-simulated-school-id'] ? Number(req.headers['x-simulated-school-id']) : null,
        id: req.headers['x-simulated-user-id'] ? Number(req.headers['x-simulated-user-id']) : null,
        simulated: true,
      };
      mockState.actorRole = req.user.role;
      mockState.actorSchoolId = req.user.schoolId;
      mockState.actorId = req.user.id;
      if (!mockState.users.find((u: any) => u && u.uid === req.user.uid)) {
        mockState.users.unshift({ id: req.user.id ?? 999, uid: req.user.uid, schoolId: req.user.schoolId });
      }
      mockState.filterSchoolId = req.query && req.query.schoolId ? Number(req.query.schoolId) : (req.user.role !== 'super_admin' ? req.user.schoolId : null);
      next();
    },
  };
});

describe('GET /api/teachers (RBAC & merging)', () => {
  let app: any;

  beforeAll(async () => {
    try {
      const util = await import('util');
      const UE = (util as any).TextEncoder;
      const UD = (util as any).TextDecoder;
      if (UE && typeof (globalThis as any).TextEncoder === 'undefined') {
        (globalThis as any).TextEncoder = class TextEncoderShim { private _enc: any; constructor() { this._enc = new UE(); } encode(str: string) { return Uint8Array.from(this._enc.encode(str)); } } as any;
      }
      if (UD && typeof (globalThis as any).TextDecoder === 'undefined') {
        (globalThis as any).TextDecoder = class TextDecoderShim { private _dec: any; constructor() { this._dec = new UD(); } decode(buf: any) { return this._dec.decode(Buffer.from(buf)); } } as any;
      }
    } catch (e) {}

    const serverModule = await import('../server.ts');
    app = await serverModule.createApp();
  });

  beforeEach(() => {
    mockState.actorRole = 'super_admin';
    mockState.actorSchoolId = null;
    mockState.actorId = null;
    mockState.oldTeachers = [];
    mockState.newTeachers = [];
    mockState.classAssignments = [];
    mockState.users = [];
    mockState.filterSchoolId = null;
  });

  it('super_admin: retrieves all teachers and their classIds', async () => {
    mockState.oldTeachers = [{ id: 1, userId: 11, uid: 'u1', name: 'T1', email: 't1@example.com', gender: null, phone: null, specialization: null, schoolId: 10 }];
    mockState.newTeachers = [{ id: 2, userId: 12, uid: 'u2', name: 'T2', email: 't2@example.com', gender: null, phone: null, specialization: null, schoolId: 20 }];
    mockState.classAssignments = [{ teacherId: 1, classId: 100 }, { teacherId: 1, classId: 101 }, { teacherId: 2, classId: 200 }];
    mockState.users = [{ id: 11, uid: 'u1' }, { id: 12, uid: 'u2' }];

    const res = await request(app)
      .get('/api/teachers')
      .set('x-simulated-role', 'super_admin')
      .expect(200);

    expect(Array.isArray(res.body)).toBe(true);
    console.log('DEBUG teachers response', JSON.stringify(res.body));
    expect(res.body.map((t: any) => t.id).sort()).toEqual([1,2]);
    const t1 = res.body.find((t: any) => t.id === 1);
    expect(t1.classIds.sort()).toEqual([100,101]);
  });

  it('super_admin: can filter by ?schoolId=', async () => {
    mockState.oldTeachers = [{ id: 1, userId: 11, uid: 'u1', name: 'T1', email: 't1@example.com', schoolId: 10 }];
    mockState.newTeachers = [{ id: 2, userId: 12, uid: 'u2', name: 'T2', email: 't2@example.com', schoolId: 20 }];
    mockState.classAssignments = [];

    const res = await request(app)
      .get('/api/teachers?schoolId=10')
      .set('x-simulated-role', 'super_admin')
      .expect(200);

    expect(res.body.map((t: any) => t.id)).toEqual([1]);
  });

  it('school_admin: sees teachers of their school', async () => {
    mockState.oldTeachers = [{ id: 3, userId: 13, uid: 'u3', name: 'T3', email: 't3@example.com', schoolId: 10 }, { id: 4, userId: 14, uid: 'u4', name: 'T4', email: 't4@example.com', schoolId: 20 }];
    mockState.newTeachers = [];
    mockState.classAssignments = [];

    const res = await request(app)
      .get('/api/teachers')
      .set('x-simulated-role', 'school_admin')
      .set('x-simulated-school-id', '10')
      .expect(200);

    expect(res.body.map((t: any) => t.id)).toEqual([3]);
  });

  it('school_admin: cannot request another school via ?schoolId (403)', async () => {
    const res = await request(app)
      .get('/api/teachers?schoolId=20')
      .set('x-simulated-role', 'school_admin')
      .set('x-simulated-school-id', '10')
      .expect(403);

    expect(res.body).toHaveProperty('error');
  });

  it('school_admin without schoolId returns []', async () => {
    const res = await request(app)
      .get('/api/teachers')
      .set('x-simulated-role', 'school_admin')
      .set('x-simulated-school-id', '')
      .expect(200);
    expect(res.body).toEqual([]);
  });

  it('teacher: with schoolId sees teachers for their school', async () => {
    mockState.oldTeachers = [{ id: 5, userId: 15, uid: 'u5', name: 'T5', email: 't5@example.com', schoolId: 30 }];
    mockState.newTeachers = [];
    const res = await request(app)
      .get('/api/teachers')
      .set('x-simulated-role', 'teacher')
      .set('x-simulated-school-id', '30')
      .expect(200);
    expect(res.body.map((t: any) => t.id)).toEqual([5]);
  });

  it('teacher without schoolId returns []', async () => {
    const res = await request(app)
      .get('/api/teachers')
      .set('x-simulated-role', 'teacher')
      .set('x-simulated-school-id', '')
      .expect(200);
    expect(res.body).toEqual([]);
  });

  it('parent without schoolId returns []', async () => {
    const res = await request(app)
      .get('/api/teachers')
      .set('x-simulated-role', 'parent')
      .set('x-simulated-school-id', '')
      .expect(200);
    expect(res.body).toEqual([]);
  });

  it('parent with schoolId behaves like other non-super admins', async () => {
    mockState.oldTeachers = [{ id: 6, userId: 16, uid: 'u6', name: 'T6', email: 't6@example.com', schoolId: 40 }];
    const res = await request(app)
      .get('/api/teachers')
      .set('x-simulated-role', 'parent')
      .set('x-simulated-school-id', '40')
      .expect(200);
    expect(res.body.map((t: any) => t.id)).toEqual([6]);
  });

  it('merges oldModel and newModel without duplicates and accumulates schoolIds', async () => {
    mockState.oldTeachers = [{ id: 7, userId: 17, uid: 'u7', name: 'T7', email: 't7@example.com', schoolId: 50 }];
    mockState.newTeachers = [{ id: 7, userId: 17, uid: 'u7', name: 'T7', email: 't7@example.com', schoolId: 51 }];
    mockState.classAssignments = [{ teacherId: 7, classId: 700 }];

    const res = await request(app)
      .get('/api/teachers')
      .set('x-simulated-role', 'super_admin')
      .expect(200);

    expect(res.body).toHaveLength(1);
    const t = res.body[0];
    expect(t.schoolIds.sort()).toEqual([50,51]);
    expect(t.classIds).toEqual([700]);
  });
});
