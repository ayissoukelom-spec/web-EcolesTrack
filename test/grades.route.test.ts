import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { PgDialect } from 'drizzle-orm/pg-core';
import { users, evaluations as evaluationsTable, students as studentsTable, grades as gradesTable, notifications as notificationsTable, parents as parentsTable, teachers as teachersTable, teacherClassSubjects as teacherClassSubjectsTable, userSchools } from '../src/db/schema.ts';

const mockDbState: any = {
  evaluations: [] as any[],
  students: [] as any[],
  grades: [] as any[],
  notifications: [] as any[],
  users: [] as any[],
  teachers: [] as any[],
  teacherClassSubjects: [] as any[],
  userSchools: [] as any[],
};

const getRowsForTable = (table: any) => {
  if (table === users) return mockDbState.users;
  if (table === evaluationsTable) return mockDbState.evaluations;
  if (table === studentsTable) return mockDbState.students;
  if (table === gradesTable) return mockDbState.grades;
  if (table === notificationsTable) return mockDbState.notifications;
  if (table === parentsTable) return [];
  if (table === teachersTable) return mockDbState.teachers;
  if (table === userSchools) return mockDbState.userSchools;
  if (table === teacherClassSubjectsTable) {
    return mockDbState.teacherClassSubjects.filter((assignment: any) =>
      assignment.teacherId === 9 && assignment.schoolId === 1 && assignment.isActive === true,
    );
  }
  if (table?.[Symbol.for('drizzle:Name')] === 'class_homeroom_assignments') return [];
  return [];
};

const createBuilder = (table: any, rows: any[]) => ({
  _rows: rows,
  _table: table,
  from(target: any) {
    return createBuilder(target, getRowsForTable(target));
  },
  where(condition: any) {
    if (this._table === userSchools) {
      const query = new PgDialect().sqlToQuery(condition);
      const equalityConditions = Array.from(query.sql.matchAll(/"[^"]+"\."([^"]+)"\s*=\s*\$(\d+)/g), (match: any) => ({
        key: match[1].replace(/_([a-z])/g, (_: string, letter: string) => letter.toUpperCase()),
        value: query.params[Number(match[2]) - 1],
      }));
      this._rows = this._rows.filter((row: any) => (
        equalityConditions.every(({ key, value }: any) => row[key] === value)
        && (!query.sql.includes('is_active') || row.isActive !== false)
      ));
    }
    return this;
  },
  innerJoin() {
    return this;
  },
  leftJoin() {
    return this;
  },
  limit() {
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
    resolve(this._rows);
    return this;
  },
  catch(reject: (reason?: any) => void) {
    return Promise.resolve(this._rows).catch(reject);
  },
  finally(cb: () => void) {
    return Promise.resolve(this._rows).finally(cb);
  },
});

const mockDb = {
  select: () => createBuilder(null, []),
  insert: () => ({ values: (values: any) => ({ returning: async () => { const inserted = { id: mockDbState.grades.length + 1, ...values }; mockDbState.grades.push(inserted); return [inserted]; } }) }),
  update: () => ({ set: (values: any) => ({ where: () => ({ returning: async () => { const updated = { id: 1, ...values }; return [updated]; } }) }) }),  execute: async (_sql: any) => [],};

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
    mockDbState.teachers = [];
    mockDbState.teacherClassSubjects = [];
    mockDbState.userSchools = [];
  });

  const setTeacherGradeFixtures = (assignment: any, evaluationOverrides: any = {}) => {
    mockDbState.users = [{ id: 1, uid: 'sim-user', schoolId: 1, role: 'teacher' }];
    mockDbState.teachers = [{ id: 9, userId: 1, schoolId: 1, specialization: 'Mathématiques' }];
    mockDbState.teacherClassSubjects = assignment ? [assignment] : [];
    mockDbState.userSchools = [{ userId: 1, schoolId: 1, role: 'teacher', isActive: true }];
    mockDbState.evaluations = [{
      id: 77,
      classId: 1,
      teacherId: 9,
      termId: null,
      subjectId: 101,
      subject: 'Mathématiques',
      title: 'Devoir 1',
      coefficient: 1,
      maxScore: 20,
      countInBulletin: true,
      date: '2026-01-01',
      createdAt: null,
      schoolId: 1,
      ...evaluationOverrides,
    }];
    mockDbState.students = [{
      id: 11,
      firstName: 'Jean',
      lastName: 'Dupont',
      schoolId: 1,
      classId: 1,
      isActive: true,
      withdrawnAt: null,
      enrolledAt: null,
      parentId: null,
    }];
  };

  const postTeacherGrade = () => request(app)
    .post('/api/grades')
    .set('x-simulated-role', 'teacher')
    .set('x-simulated-user-id', '1')
    .set('x-simulated-school-id', '1')
    .send({ evaluationId: 77, studentId: 11, score: '15', remarks: '' });

  it('allows a teacher to create a grade with an active exact class-subject assignment', async () => {
    setTeacherGradeFixtures({ id: 301, teacherId: 9, schoolId: 1, classId: 1, subjectId: 101, isActive: true });

    const res = await postTeacherGrade();

    expect(res.status).toBe(200);
    expect(mockDbState.grades).toContainEqual(expect.objectContaining({ evaluationId: 77, studentId: 11, score: '15' }));
  });

  it('rejects a teacher without an active exact school membership', async () => {
    setTeacherGradeFixtures({ id: 301, teacherId: 9, schoolId: 1, classId: 1, subjectId: 101, isActive: true });
    mockDbState.userSchools = [{ userId: 1, schoolId: 2, role: 'teacher', isActive: true }];

    const response = await postTeacherGrade();

    expect(response.status).toBe(403);
    expect(mockDbState.grades).toHaveLength(0);
  });

  it('rejects a teacher grade when the class-subject assignment is inactive', async () => {
    setTeacherGradeFixtures({ id: 301, teacherId: 9, schoolId: 1, classId: 1, subjectId: 101, isActive: false });

    const res = await postTeacherGrade();

    expect(res.status).toBe(403);
    expect(mockDbState.grades).toHaveLength(0);
  });

  it('rejects a teacher grade when the exact assignment belongs to another teacher', async () => {
    setTeacherGradeFixtures({ id: 301, teacherId: 10, schoolId: 1, classId: 1, subjectId: 101, isActive: true });

    const res = await postTeacherGrade();

    expect(res.status).toBe(403);
    expect(mockDbState.grades).toHaveLength(0);
  });

  it('rejects a teacher grade when the subject is not assigned to the evaluation class', async () => {
    setTeacherGradeFixtures({ id: 301, teacherId: 9, schoolId: 1, classId: 1, subjectId: 102, isActive: true });

    const res = await postTeacherGrade();

    expect(res.status).toBe(403);
    expect(mockDbState.grades).toHaveLength(0);
  });

  it('rejects a teacher grade when the exact assignment belongs to another school', async () => {
    setTeacherGradeFixtures({ id: 301, teacherId: 9, schoolId: 2, classId: 1, subjectId: 101, isActive: true });

    const res = await postTeacherGrade();

    expect(res.status).toBe(403);
    expect(mockDbState.grades).toHaveLength(0);
  });

  it('rejects grading a legacy evaluation without subjectId when no exact assignment can be proven', async () => {
    setTeacherGradeFixtures(
      { id: 301, teacherId: 9, schoolId: 1, classId: 1, subjectId: 101, isActive: true },
      { subjectId: null },
    );

    const res = await postTeacherGrade();

    expect(res.status).toBe(403);
    expect(mockDbState.grades).toHaveLength(0);
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

  it('allows a grade for an active student in the evaluation class', async () => {
    mockDbState.evaluations = [{ id: 77, classId: 1, teacherId: 1, termId: null, subject: 'Mathématiques', title: 'Devoir 1', coefficient: 1, maxScore: 20, countInBulletin: true, date: '2026-01-01', createdAt: null, schoolId: 1 }];
    mockDbState.students = [{ id: 11, firstName: 'Jean', lastName: 'Dupont', schoolId: 1, classId: 1, isActive: true, withdrawnAt: null, enrolledAt: null, parentId: null }];

    const res = await request(app)
      .post('/api/grades')
      .set('x-simulated-role', 'super_admin')
      .send({ evaluationId: 77, studentId: 11, score: '15', remarks: '' });

    expect(res.status).toBe(200);
    expect(mockDbState.grades).toContainEqual(expect.objectContaining({ evaluationId: 77, studentId: 11, score: '15' }));
  });

  it('rejects a new grade for a withdrawn student without deleting existing grade history', async () => {
    mockDbState.evaluations = [{ id: 77, classId: 1, teacherId: 1, termId: null, subject: 'Mathématiques', title: 'Devoir 1', coefficient: 1, maxScore: 20, countInBulletin: true, date: '2026-01-01', createdAt: null, schoolId: 1 }];
    mockDbState.students = [{ id: 11, firstName: 'Jean', lastName: 'Dupont', schoolId: 1, classId: null, isActive: false, withdrawnAt: new Date('2026-09-01T10:00:00.000Z'), enrolledAt: null, parentId: null }];
    mockDbState.grades = [{ id: 9, evaluationId: 76, studentId: 11, score: '12', remarks: 'Historique' }];

    const res = await request(app)
      .post('/api/grades')
      .set('x-simulated-role', 'super_admin')
      .send({ evaluationId: 77, studentId: 11, score: '15', remarks: '' });

    expect(res.status).toBe(403);
    expect(mockDbState.grades).toEqual([{ id: 9, evaluationId: 76, studentId: 11, score: '12', remarks: 'Historique' }]);
  });

  it('keeps grades for a withdrawn student readable', async () => {
    mockDbState.students = [{ id: 11, firstName: 'Jean', lastName: 'Dupont', schoolId: 1, classId: null, isActive: false, withdrawnAt: new Date(), parentId: null }];
    mockDbState.grades = [{ id: 9, evaluationId: 76, studentId: 11, score: '12', remarks: 'Historique' }];

    const res = await request(app)
      .get('/api/grades')
      .set('x-simulated-role', 'super_admin');

    expect(res.status).toBe(200);
    expect(res.body).toEqual(mockDbState.grades);
  });
});
