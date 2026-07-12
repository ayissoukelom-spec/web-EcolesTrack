import { beforeAll, describe, it, expect, vi } from 'vitest';
import request from 'supertest';

const FIXTURES = {
  users: [
    { id: 1, uid: 'super-uid', email: 'super@x.test', name: 'Super', role: 'super_admin', schoolId: null, isDeleted: false },
    { id: 2, uid: 'school-uid', email: 'school@x.test', name: 'SchoolAdmin', role: 'school_admin', schoolId: 10, isDeleted: false },
    { id: 3, uid: 'teacher-uid', email: 'teacher@x.test', name: 'Teacher', role: 'teacher', schoolId: 10, isDeleted: false },
  ],
  classes: [
    { id: 100, name: 'Class A', schoolId: 10, academicYearId: 1, teacherId: 77 },
    { id: 200, name: 'Other School Class', schoolId: 20, academicYearId: 1, teacherId: 88 },
    { id: 300, name: 'Global Class', schoolId: null, academicYearId: 1, teacherId: null },
  ],
  teachers: [
    { id: 77, userId: 3, schoolId: 10, phone: '+22911111111', specialization: 'Math' },
  ],
  classTeachers: [
    { classId: 100, teacherId: 77 },
  ],
  schoolClasses: [
    { id: 500, classId: 300, schoolId: 10, status: 'approved' },
  ],
  schoolTerms: [
    { id: 1, academicYearId: 1, startDate: '2026-01-01', endDate: '2026-12-31', orderIndex: 1, isActive: true },
  ],
  subjects: [
    { id: 1, name: 'Global', schoolId: 20 },
    { id: 2, name: 'Science', schoolId: 10 },
  ],
  schoolSubjects: [
    { id: 1, subjectId: 1, schoolId: 20, status: 'approved' },
    { id: 2, subjectId: 2, schoolId: 10, status: 'approved' },
  ],
  evaluations: [] as any[],
  parents: [],
  students: [],
  notifications: [],
};

type Cond = Record<string, any>;

function getValue(node: any) {
  if (node == null) return node;
  if (typeof node === 'object' && 'value' in node) return node.value;
  return node;
}

function parseQueryChunks(sqlObj: any, conditions: Cond) {
  if (!sqlObj || !Array.isArray(sqlObj.queryChunks)) return;
  let lastField: string | null = null;
  for (const chunk of sqlObj.queryChunks) {
    if (!chunk || typeof chunk !== 'object') continue;
    const ctor = chunk.constructor?.name;
    if (ctor === 'Param') {
      if (lastField) {
        const value = getValue(chunk);
        if (lastField.includes('uid')) conditions.uid = value;
        else if (lastField.includes('email')) conditions.email = value;
        else if (lastField.includes('schoolid')) conditions.schoolId = value === null ? null : Number(value);
        else if (lastField.includes('classid')) conditions.classId = value === null ? null : Number(value);
        else if (lastField.includes('teacherid')) conditions.teacherId = value === null ? null : Number(value);
        else if (lastField.includes('subjectid')) conditions.subjectId = value === null ? null : Number(value);
        else if (lastField === 'id') conditions.id = value === null ? null : Number(value);
      }
      lastField = null;
      continue;
    }
    if (typeof chunk.name === 'string') {
      lastField = chunk.name.toLowerCase();
      continue;
    }
    if (typeof chunk === 'string') {
      lastField = chunk.toLowerCase();
      continue;
    }
  }
}

function extractConditions(cond: any): Cond {
  const conditions: Cond = {};
  const visited = new WeakSet<any>();

  const scan = (item: any) => {
    if (item == null || typeof item !== 'object' || visited.has(item)) return;
    visited.add(item);
    if (Array.isArray(item)) {
      item.forEach(scan);
      return;
    }
    if (Array.isArray(item.queryChunks)) {
      parseQueryChunks(item, conditions);
    }
    if ('left' in item && 'right' in item) {
      const left = String(item.left).toLowerCase();
      const right = getValue(item.right);
      if (left.includes('uid')) conditions.uid = right;
      else if (left.includes('email')) conditions.email = right;
      else if (left.includes('schoolid')) conditions.schoolId = right === null ? null : Number(right);
      else if (left.includes('classid')) conditions.classId = right === null ? null : Number(right);
      else if (left.includes('teacherid')) conditions.teacherId = right === null ? null : Number(right);
      else if (left.includes('subjectid')) conditions.subjectId = right === null ? null : Number(right);
      else if (left === 'id' || left.endsWith('.id')) conditions.id = right === null ? null : Number(right);
      scan(item.left);
      scan(item.right);
    }
    if (item.args && Array.isArray(item.args)) {
      item.args.forEach(scan);
    }
    Object.values(item).forEach((child) => {
      if (typeof child === 'object' && child !== null) scan(child);
    });
  };

  scan(cond);
  return conditions;
}

function resolveTableName(table: any) {
  if (typeof table === 'string') {
    const lower = table.toLowerCase();
    const normalized = lower.replace(/_/g, '');
    if (normalized.includes('users')) return 'users';
    if (normalized.includes('classes')) return 'classes';
    if (normalized.includes('teachers')) return 'teachers';
    if (normalized.includes('classteachers')) return 'classTeachers';
    if (normalized.includes('schoolclasses')) return 'schoolClasses';
    if (normalized.includes('schoolterms')) return 'schoolTerms';
    if (normalized.includes('subjects')) return 'subjects';
    if (normalized.includes('schoolsubjects')) return 'schoolSubjects';
    if (normalized.includes('evaluations')) return 'evaluations';
    if (normalized.includes('parents')) return 'parents';
    if (normalized.includes('students')) return 'students';
    if (normalized.includes('notifications')) return 'notifications';
  }
  if (table && typeof table === 'object') {
    const keys = Object.keys(table).map((k) => k.toLowerCase());
    if (keys.includes('uid') && keys.includes('email') && keys.includes('role')) return 'users';
    if (keys.includes('name') && keys.includes('schoolid') && keys.includes('teacherid')) return 'classes';
    if (keys.includes('userid') && keys.includes('schoolid') && keys.includes('specialization')) return 'teachers';
    if (keys.includes('classid') && keys.includes('teacherid')) return 'classTeachers';
    if (keys.includes('classid') && keys.includes('schoolid') && keys.includes('status')) return 'schoolClasses';
    if (keys.includes('id') && keys.includes('academicyearid') && keys.includes('orderindex') && keys.includes('isactive')) return 'schoolTerms';
    if (keys.includes('name') && keys.includes('schoolid')) return 'subjects';
    if (keys.includes('subjectid') && keys.includes('schoolid') && keys.includes('status')) return 'schoolSubjects';
    if (keys.includes('termid') && keys.includes('maxscore')) return 'evaluations';
    if (keys.includes('title') && keys.includes('body')) return 'notifications';
    if (keys.includes('parentid') && keys.includes('classid')) return 'students';
  }
  return '';
}

function filterRows(rows: any[], conditions: Cond) {
  return rows.filter((row) => {
    if (conditions.id !== undefined && Number(row.id) !== Number(conditions.id)) return false;
    if (conditions.uid !== undefined && row.uid !== conditions.uid) return false;
    if (conditions.email !== undefined && String(row.email).toLowerCase() !== String(conditions.email).toLowerCase()) return false;
    if (conditions.schoolId !== undefined && row.schoolId !== conditions.schoolId) return false;
    if (conditions.userId !== undefined && row.userId !== conditions.userId) return false;
    if (conditions.classId !== undefined && row.classId !== conditions.classId) return false;
    if (conditions.teacherId !== undefined && row.teacherId !== conditions.teacherId) return false;
    if (conditions.subjectId !== undefined && row.subjectId !== conditions.subjectId) return false;
    if (conditions.status !== undefined && row.status !== conditions.status) return false;
    if (conditions.isActive !== undefined && row.isActive !== conditions.isActive) return false;
    return true;
  });
}

function createMockDb() {
  const db = {
    select() {
      const builder: any = {
        _rows: [] as any[],
        _table: '',
        from(table: any) {
          this._table = resolveTableName(table);
          this._rows = (this._table === 'users' ? FIXTURES.users
            : this._table === 'classes' ? FIXTURES.classes
            : this._table === 'teachers' ? FIXTURES.teachers
            : this._table === 'classTeachers' ? FIXTURES.classTeachers
            : this._table === 'schoolClasses' ? FIXTURES.schoolClasses
            : this._table === 'schoolTerms' ? FIXTURES.schoolTerms
            : this._table === 'subjects' ? FIXTURES.subjects
            : this._table === 'schoolSubjects' ? FIXTURES.schoolSubjects
            : this._table === 'evaluations' ? FIXTURES.evaluations
            : this._table === 'parents' ? FIXTURES.parents
            : this._table === 'students' ? FIXTURES.students
            : this._table === 'notifications' ? FIXTURES.notifications
            : []) as any[];
          return this;
        },
        innerJoin() { return this; },
        leftJoin() { return this; },
        where(...conds: any[]) {
          if (!conds.length) return this;
          const combined: Cond = {};
          conds.forEach((cond) => Object.assign(combined, extractConditions(cond)));
          this._rows = filterRows(this._rows, combined);
          return this;
        },
        orderBy() { return this; },
        limit(n: number) { this._rows = this._rows.slice(0, n); return this; },
        then(resolve: (value: any) => any) { return Promise.resolve(this._rows).then(resolve); },
        catch(reject: (reason?: any) => any) { return Promise.resolve(this._rows).catch(reject); },
        finally(cb: () => any) { return Promise.resolve(this._rows).finally(cb); },
      };
      return builder;
    },
    insert() {
      return {
        values: (obj: any) => ({
          returning: async () => {
            if (Array.isArray(obj)) {
              FIXTURES.notifications.push(...obj);
              return obj;
            }
            if (obj.termId !== undefined && obj.subject !== undefined) {
              const newId = FIXTURES.evaluations.length + 1000;
              const row = { id: newId, ...obj };
              FIXTURES.evaluations.push(row);
              return [row];
            }
            if (obj.userId !== undefined && obj.title && obj.body) {
              FIXTURES.notifications.push(obj);
              return [obj];
            }
            return [obj];
          },
        }),
      };
    },
    update() { return { set: () => ({ where: async () => [] }) }; },
    delete() { return { where: async () => [] }; },
  } as any;
  (db as any).execute = async (_sql: any) => [];
  return db;
}

const mockDb = { db: createMockDb() };
vi.mock('../../src/db/index.ts', () => mockDb);
vi.mock('src/db/index.ts', () => mockDb);
vi.mock('src/db', () => mockDb);

vi.mock('../../src/middleware/auth.ts', async () => {
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
      else if (token === 'token-school') req.user = { uid: 'school-uid', role: 'school_admin', email: 'school@x.test', schoolId: 10, simulated: false };
      else if (token === 'token-teacher') req.user = { uid: 'teacher-uid', role: 'teacher', email: 'teacher@x.test', schoolId: 10, simulated: false };
      else req.user = null;
      next();
      return;
    }
    if (simulatedRole) {
      req.user = {
        uid: req.headers['x-simulated-uid'] || `sim-${Date.now()}`,
        email: req.headers['x-simulated-email'] || null,
        role: simulatedRole,
        schoolId: req.headers['x-simulated-school-id'] ? Number(req.headers['x-simulated-school-id']) : null,
        id: req.headers['x-simulated-user-id'] ? Number(req.headers['x-simulated-user-id']) : null,
        simulated: true,
      };
      next();
      return;
    }
    res.status(401).json({ error: 'Unauthenticated' });
  }
  return { ...expr, verifyToken: requireAuth, requireAuth };
});

let app: any = null;

beforeAll(async () => {
  process.env.NODE_ENV = 'test';
  const serverModule = await import('../../server.ts');
  app = await serverModule.createApp();
});

describe('POST /api/evaluations security', () => {
  it('rejects school_admin without schoolId', async () => {
    const res = await request(app)
      .post('/api/evaluations')
      .set('x-simulated-role', 'school_admin')
      .set('x-simulated-uid', 'school-sim')
      .send({ classId: '100', subject: 'Math', title: 'Test', date: '2026-09-01', coefficient: 1, maxScore: 20 });

    expect(res.status).toBe(403);
    expect(res.body).toHaveProperty('error');
    expect(String(res.body.error)).toContain('school context');
  });

  it('rejects teacher without schoolId', async () => {
    const res = await request(app)
      .post('/api/evaluations')
      .set('x-simulated-role', 'teacher')
      .set('x-simulated-uid', 'teacher-sim')
      .set('x-simulated-user-id', '3')
      .send({ classId: '100', subject: 'Math', title: 'Teacher Test', date: '2026-09-01', coefficient: 1, maxScore: 20 });

    expect(res.status).toBe(403);
    expect(res.body).toHaveProperty('error');
    expect(String(res.body.error)).toContain('school context');
  });

  it('allows teacher with schoolId and assigned class', async () => {
    FIXTURES.users.push({ id: 4, uid: 'teacher-sim', email: 'teacher-sim@x.test', name: 'Teacher Sim', role: 'teacher', schoolId: 10, isDeleted: false });
    FIXTURES.teachers.push({ id: 78, userId: 4, schoolId: 10, phone: '', specialization: 'Science' });
    FIXTURES.classTeachers.push({ classId: 100, teacherId: 78 });

    const res = await request(app)
      .post('/api/evaluations')
      .set('x-simulated-role', 'teacher')
      .set('x-simulated-uid', 'teacher-sim')
      .set('x-simulated-user-id', '4')
      .set('x-simulated-school-id', '10')
      .send({ classId: '100', subject: 'Science', title: 'Teacher Assigned', date: '2026-09-01', coefficient: 2, maxScore: 20 });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('id');
    expect(res.body).toMatchObject({ classId: 100, subject: 'Science', title: 'Teacher Assigned', coefficient: 2, maxScore: 20 });
  });

  it('rejects school_admin for class in another school', async () => {
    const res = await request(app)
      .post('/api/evaluations')
      .set('x-simulated-role', 'school_admin')
      .set('x-simulated-uid', 'school-sim2')
      .set('x-simulated-school-id', '10')
      .set('x-simulated-user-id', '2')
      .send({ classId: '200', subject: 'History', title: 'Wrong School', date: '2026-09-01', coefficient: 1, maxScore: 20 });

    expect(res.status).toBe(403);
    expect(res.body).toHaveProperty('error');
    expect(String(res.body.error)).toContain('another school');
  });

  it('allows super_admin without schoolId', async () => {
    const res = await request(app)
      .post('/api/evaluations')
      .set('Authorization', 'Bearer token-super')
      .send({ classId: '200', teacherId: '88', subject: 'Global', title: 'Super Admin', date: '2026-09-01', coefficient: 1, maxScore: 20 });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('id');
    expect(res.body).toMatchObject({ classId: 200, teacherId: 88, subject: 'Global', title: 'Super Admin' });
  });
});
