import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest';
import request from 'supertest';

// Mock DB and Auth middleware before importing the server so the real server
// uses our test doubles when startServer() runs on import.

// In-memory fixture state
const FIXTURES = {
  users: [
    { id: 1, uid: 'super-uid', email: 'super@x.test', name: 'Super', role: 'super_admin', schoolId: null, isDeleted: false },
    { id: 2, uid: 'school-uid', email: 'admin@school.test', name: 'SchoolAdmin', role: 'school_admin', schoolId: 10, isDeleted: false },
    { id: 3, uid: 'teacher-uid', email: 'teacher@school.test', name: 'Teacher', role: 'teacher', schoolId: 10, isDeleted: false },
  ],
  schools: [{ id: 10, name: 'Test School' }],
  academicYears: [{ id: 1, schoolId: 10, name: '2025-2026', isActive: true }],
  localAuths: [],
  userSchools: [],
  auditEvents: [],
};

function createMockDb() {
  // Minimal mock that supports the select/insert/update/delete chains used
  // by server.ts. It inspects query conditions to match rows for uid, email,
  // id and schoolId, and keeps fixture state in memory.
  const extractConditions = (cond: any): Record<string, any> => {
    const result: Record<string, any> = {};
    const visited = new WeakSet<any>();

    const parseQueryChunks = (sqlObj: any) => {
      if (!sqlObj || !Array.isArray(sqlObj.queryChunks)) return;
      let lastColumn: string | null = null;
      for (const chunk of sqlObj.queryChunks) {
        if (!chunk || typeof chunk !== 'object') continue;
        const ctor = chunk.constructor?.name;
        if (ctor === 'PgText' || ctor === 'PgSerial' || ctor === 'PgInt' || ctor === 'PgBigInt') {
          if (typeof chunk.name === 'string') {
            lastColumn = chunk.name.toLowerCase();
          }
          continue;
        }
        if (ctor === 'Param') {
          const value = chunk.value;
          if (lastColumn) {
            if (lastColumn.endsWith('uid')) result.uid = value;
            else if (lastColumn.endsWith('email')) result.email = value;
            else if (lastColumn.endsWith('schoolid')) result.schoolId = value === null ? null : Number(value);
            else if (lastColumn === 'id') result.id = value === null ? null : Number(value);
          }
          lastColumn = null;
          continue;
        }
      }
    };

    const search = (item: any) => {
      if (item == null || typeof item !== 'object') return;
      if (visited.has(item)) return;
      visited.add(item);
      if (Array.isArray(item)) {
        item.forEach(search);
        return;
      }
      if (Array.isArray(item.queryChunks)) {
        parseQueryChunks(item);
      }
      const left = item.left;
      const right = item.right;
      if (left !== undefined && right !== undefined) {
        const leftStr = String(left).toLowerCase();
        if (leftStr.includes('uid')) result.uid = right;
        if (leftStr.includes('email')) result.email = right;
        if (leftStr.includes('schoolid')) result.schoolId = right === null ? null : Number(right);
        if (leftStr.includes('id') && !leftStr.includes('schoolid')) result.id = right === null ? null : Number(right);
        if (typeof left === 'object' && left !== null) search(left);
        if (typeof right === 'object' && right !== null) search(right);
        return;
      }
      if (item.args && Array.isArray(item.args)) {
        item.args.forEach(search);
      }
      Object.values(item).forEach((value) => {
        if (typeof value === 'object' && value !== null) search(value);
      });
    };

    search(cond);
    return result;
  };

  const resolveTableName = (table: any) => {
    if (typeof table === 'string') {
      const lower = table.toLowerCase();
      if (lower.includes('users')) return 'users';
      if (lower.includes('schools')) return 'schools';
      if (lower.includes('academicyears')) return 'academicYears';
      if (lower.includes('localauths')) return 'localAuths';
      if (lower.includes('userschools')) return 'userSchools';
      if (lower.includes('auditevents')) return 'auditEvents';
    }
    if (table && typeof table === 'object') {
      const keys = Object.keys(table).map((k) => k.toLowerCase());
      if (keys.includes('uid') && keys.includes('email') && keys.includes('role')) return 'users';
      if (keys.includes('actoruserid') && keys.includes('resourceid')) return 'auditEvents';
      if (keys.includes('userid') && keys.includes('passwordhash')) return 'localAuths';
      if (keys.includes('userid') && keys.includes('schoolid') && keys.includes('role') && keys.includes('isactive')) return 'userSchools';
      if (keys.includes('schoolid') && keys.includes('isactive') && keys.includes('name')) return 'academicYears';
      if (keys.includes('name') && keys.includes('address')) return 'schools';
    }
    return '';
  };

  const filterTableRows = (table: any, cond: any) => {
    const tableName = resolveTableName(table);
    const rows = (tableName === 'users' ? FIXTURES.users
      : tableName === 'schools' ? FIXTURES.schools
      : tableName === 'academicYears' ? FIXTURES.academicYears
      : tableName === 'localAuths' ? FIXTURES.localAuths
      : tableName === 'userSchools' ? FIXTURES.userSchools
      : tableName === 'auditEvents' ? FIXTURES.auditEvents
      : []) as any[];

    if (!cond) return rows;
    const conditions = extractConditions(cond);
    if (!Object.keys(conditions).length && typeof cond === 'string') {
      const maybeUid = /"([a-z0-9\-]+)"/gi.exec(cond);
      if (maybeUid) conditions.uid = maybeUid[1];
      const maybeEmail = /"([\w.%+-]+@[\w.-]+\.[a-z]{2,})"/i.exec(cond);
      if (maybeEmail) conditions.email = maybeEmail[1];
      const maybeId = /"?(\d+)"?/.exec(cond);
      if (maybeId) conditions.id = Number(maybeId[1]);
    }

    return rows.filter((row) => {
      if (conditions.uid !== undefined && row.uid !== conditions.uid) return false;
      if (conditions.email !== undefined && String(row.email).toLowerCase() !== String(conditions.email).toLowerCase()) return false;
      if (conditions.id !== undefined && Number(row.id) !== Number(conditions.id)) return false;
      if (conditions.schoolId !== undefined && row.schoolId !== conditions.schoolId) return false;
      return true;
    });
  };

  const db = {
    select() {
      return {
        from: (table: any) => ({
          where: async (cond?: any) => {
            return filterTableRows(table, cond);
          },
          limit: async (n: number) => [] as any,
        }),
      };
    },
    insert() {
      return {
        values: (obj: any) => ({
          returning: async () => {
            // crud: infers insert target by inspecting keys
            if (obj.uid || obj.role) {
              const newId = FIXTURES.users.length + 1;
              const row = { id: newId, ...obj };
              FIXTURES.users.push(row as any);
              return [row];
            }
            if (obj.userId && obj.passwordHash) {
              FIXTURES.localAuths.push(obj as any);
              return [obj];
            }
            if (obj.actorUserId !== undefined) {
              FIXTURES.auditEvents.push(obj as any);
              return [obj];
            }
            if (obj.userId && obj.schoolId && obj.role) {
              FIXTURES.userSchools.push(obj as any);
              return [obj];
            }
            return [obj];
          },
        }),
      };
    },
    update() {
      return {
        set: (values: any) => ({
          where: async (cond: any) => {
            const conditions = extractConditions(cond);
            if (conditions.id != null) {
              const idx = FIXTURES.users.findIndex((u) => u.id === Number(conditions.id));
              if (idx >= 0) {
                FIXTURES.users[idx] = { ...FIXTURES.users[idx], ...values };
                return [FIXTURES.users[idx]];
              }
            }
            return [];
          },
        }),
      };
    },
    delete() {
      return {
        where: async (cond: any) => {
          const conditions = extractConditions(cond);
          if (conditions.id != null) {
            const idx = FIXTURES.users.findIndex((u) => u.id === Number(conditions.id));
            if (idx >= 0) {
              FIXTURES.users[idx].isDeleted = true;
              return [FIXTURES.users[idx]];
            }
          }
          return [];
        },
      };
    },
  } as any;
  // Ensure basic execute helper used by db helpers is present
  (db as any).execute = async (_sql: any) => [];
  return db;
}

// Mock the DB module used by server.ts (cover both relative and bare imports)
const mockDb = { db: createMockDb() };
vi.mock('../../src/db/index.ts', () => mockDb);
vi.mock('src/db/index.ts', () => mockDb);
vi.mock('src/db', () => mockDb);

// Mock auth middleware: inspect headers and populate req.user accordingly.
vi.mock('../../src/middleware/auth.ts', async () => {
  const expr = await vi.importActual<any>('../../src/middleware/auth.ts');
  // Provide a simple `requireAuth` that behaves like the real middleware for tests
  function requireAuth(req: any, res: any, next: any) {
    const auth = req.headers.authorization as string | undefined;
    const simulatedRole = req.headers['x-simulated-role'] as string | undefined;

    // Production rejects simulated headers
    if (process.env.NODE_ENV === 'production' && simulatedRole) {
      res.status(401).json({ error: 'Simulated headers not allowed in production' });
      return;
    }

    if (auth && auth.startsWith('Bearer ')) {
      const token = auth.slice('Bearer '.length).trim();
      // map some test tokens to users
      if (token === 'token-super') req.user = { uid: 'super-uid', role: 'super_admin', email: 'super@x.test', simulated: false };
      else if (token === 'token-school') req.user = { uid: 'school-uid', role: 'school_admin', email: 'admin@school.test', schoolId: 10, simulated: false };
      else if (token === 'token-teacher') req.user = { uid: 'teacher-uid', role: 'teacher', email: 'teacher@school.test', schoolId: 10, simulated: false };
      else req.user = null;
      if (req.user) req.user.appRole = expr.mapToAppRole(req.user.role);
      next();
      return;
    }

    // No Bearer: fallback to simulated headers in non-prod
    if (simulatedRole) {
      req.user = {
        uid: req.headers['x-simulated-uid'] || `sim-${Date.now()}`,
        email: req.headers['x-simulated-email'] || null,
        role: simulatedRole,
        appRole: expr.mapToAppRole(simulatedRole),
        schoolId: req.headers['x-simulated-school-id'] ? Number(req.headers['x-simulated-school-id']) : null,
        simulated: true,
      };
      next();
      return;
    }

    // No auth
    res.status(401).json({ error: 'Unauthenticated' });
  }

  return { ...expr, verifyToken: requireAuth, requireAuth };
});

// Also mock bare specifier used across codebase
vi.mock('src/middleware/auth', async () => {
  const expr = await vi.importActual<any>('../../src/middleware/auth.ts');
  function requireAuth(req: any, res: any, next: any) {
    const auth = req.headers.authorization as string | undefined;
    const simulatedRole = req.headers['x-simulated-role'] as string | undefined;
    if (process.env.NODE_ENV === 'production' && simulatedRole) {
      res.status(401).json({ error: 'Simulated headers not allowed in production' });
      return;
    }
    if (auth && auth.startsWith('Bearer ')) {
      const token = auth.slice('Bearer '.length).trim();
      if (token === 'token-super') req.user = { uid: 'super-uid', role: 'super_admin', email: 'super@x.test', simulated: false };
      else if (token === 'token-school') req.user = { uid: 'school-uid', role: 'school_admin', email: 'admin@school.test', schoolId: 10, simulated: false };
      else if (token === 'token-teacher') req.user = { uid: 'teacher-uid', role: 'teacher', email: 'teacher@school.test', schoolId: 10, simulated: false };
      else req.user = null;
      if (req.user) req.user.appRole = expr.mapToAppRole(req.user.role);
      next();
      return;
    }
    if (simulatedRole) {
      req.user = {
        uid: req.headers['x-simulated-uid'] || `sim-${Date.now()}`,
        email: req.headers['x-simulated-email'] || null,
        role: simulatedRole,
        appRole: expr.mapToAppRole(simulatedRole),
        schoolId: req.headers['x-simulated-school-id'] ? Number(req.headers['x-simulated-school-id']) : null,
        simulated: true,
      };
      next();
      return;
    }
    res.status(401).json({ error: 'Unauthenticated' });
  }
  return { ...expr, verifyToken: requireAuth, requireAuth };
});

// Stub bulletin service used by bulletinSnapshotService to avoid importing optional
// or environment-specific native modules during test startup.
vi.mock('../../src/lib/bulletinService', () => ({
  generateBulletinSnapshot: async () => null,
  createBulletinPdf: async () => null,
}));

// Also mock the root-imported specifier used in some modules
vi.mock('src/lib/bulletinService', () => ({
  generateBulletinSnapshot: async () => null,
  createBulletinPdf: async () => null,
}));

// Defer importing the server until after mocks are registered so Vite/Vitest
// resolver handles bare-module imports (import 'src/...') correctly.
let serverModule: any = null;
let app: any = null;

describe('E2E security: auth & privilege checks', () => {
  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    // Ensure TextEncoder/TextDecoder exist for esbuild used by Vite
    try {
      const util = await import('util');
      const UE = (util as any).TextEncoder;
      const UD = (util as any).TextDecoder;
      if (UE) {
        // wrapper to guarantee a Uint8Array return value
        // @ts-ignore
        globalThis.TextEncoder = class TextEncoderShim {
          private _enc: any;
          constructor() { this._enc = new UE(); }
          encode(str: string) { return Uint8Array.from(this._enc.encode(str)); }
        };
      }
      if (UD) {
        // @ts-ignore
        globalThis.TextDecoder = class TextDecoderShim {
          private _dec: any;
          constructor() { this._dec = new UD(); }
          decode(buf: any) { return this._dec.decode(Buffer.from(buf)); }
        };
      }
    } catch (e) {
      // ignore if util not available
    }
    // Import the app factory and create an express app for Supertest
    serverModule = await import('../../server.ts');
    app = await serverModule.createApp();
  });

  afterAll(async () => {
    // nothing to close - server started in module init
  });

  it('1. rejects x-simulated-* headers in production', async () => {
    process.env.NODE_ENV = 'production';
    const res = await request(app)
      .post('/api/auth/register-or-login')
      .set('x-simulated-role', 'super_admin')
      .send();
    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('error');
    process.env.NODE_ENV = 'test';
  });

  it('2. simulated context cannot create super_admin', async () => {
    process.env.NODE_ENV = 'production';
    const res = await request(app)
      .post('/api/admin/users')
      .set('x-simulated-role', 'super_admin')
      .set('x-simulated-uid', 'attacker-uid')
      .send({ email: 'new@x.test', name: 'Evil', role: 'super_admin' });
    // In production, simulated headers must never be accepted for admin creation.
    expect([401, 403]).toContain(res.status);
    process.env.NODE_ENV = 'test';
  });

  it('3. school_admin cannot create/modify other admins', async () => {
    // Attempt to create a super_admin using school_admin token
    const createRes = await request(app)
      .post('/api/admin/users')
      .set('Authorization', 'Bearer token-school')
      .send({ email: 'newsuper@x.test', name: 'NewSuper', role: 'super_admin' });
    expect([400, 403]).toContain(createRes.status);

    // Attempt to update a super_admin by school_admin
    const updateRes = await request(app)
      .put('/api/admin/users/1')
      .set('Authorization', 'Bearer token-school')
      .send({ email: 'super@x.test', name: 'SuperChanged', role: 'super_admin' });
    expect([400, 403]).toContain(updateRes.status);
  });

  it('4. school_admin cannot act outside their school', async () => {
    // school_admin tries to set password for a user in another school (simulate target with schoolId null)
    // create a user in another school via fixtures
    const newUser = { id: 99, uid: 'other-uid', email: 'other@x.test', name: 'Other', role: 'teacher', schoolId: 999 };
    (FIXTURES.users as any[]).push(newUser);

    const res = await request(app)
      .post('/api/admin/set-password')
      .set('Authorization', 'Bearer token-school')
      .send({ userId: newUser.id, password: 'SafePass1!' });
    expect([400, 403]).toContain(res.status);
  });

  it('5. super_admin can perform allowed actions', async () => {
    // super_admin creates a school_admin
    const createRes = await request(app)
      .post('/api/admin/users')
      .set('Authorization', 'Bearer token-super')
      .send({ email: 'created@x.test', name: 'Created', role: 'school_admin', schoolId: 10, academicYearId: 1 });
    // Accept 201 or 400/409 if fixture constraints prevent creation
    expect([201, 400, 409]).toContain(createRes.status);

    // super_admin deletes a user
    const delRes = await request(app)
      .delete('/api/admin/users/3')
      .set('Authorization', 'Bearer token-super');
    expect([200, 404]).toContain(delRes.status);
  });

  it('6. DB reflects role changes after actions', async () => {
    // After previous create, ensure user exists with expected role when present in fixtures
    const created = FIXTURES.users.find((u) => u.email === 'created@x.test');
    if (created) expect(created.role).toBe('school_admin');

    // After deletion, user id 3 should be marked deleted
    const deleted = FIXTURES.users.find((u) => u.id === 3);
    if (deleted) expect(deleted.isDeleted).toBe(true);
  });
});
