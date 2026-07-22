import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import request from 'supertest';

process.env.NODE_ENV = 'test';

import {
  users,
  evaluations as evaluationsTable,
  students as studentsTable,
  parents as parentsTable,
  notifications as notificationsTable,
  grades as gradesTable,
  evaluationParticipations as evaluationParticipationsTable,
} from '../src/db/schema.ts';

const mockDbState: any = {
  users: [] as any[],
  evaluations: [] as any[],
  students: [] as any[],
  parents: [] as any[],
  notifications: [] as any[],
  grades: [] as any[],
  evaluationParticipations: [] as any[],
};

function resolveTableName(table: any) {
  if (table === users) return 'users';
  if (table === evaluationsTable) return 'evaluations';
  if (table === studentsTable) return 'students';
  if (table === parentsTable) return 'parents';
  if (table === notificationsTable) return 'notifications';
  if (table === gradesTable) return 'grades';
  if (table === evaluationParticipationsTable) return 'evaluationParticipations';
  return '';
}

function getQueryChunks(sqlObj: any): any[] {
  if (!sqlObj || typeof sqlObj !== 'object') return [];
  if (Array.isArray(sqlObj.queryChunks)) return sqlObj.queryChunks;
  if (Array.isArray(sqlObj._strings)) return sqlObj._strings;
  return [];
}

function isStringChunkObject(obj: any): boolean {
  return obj && typeof obj === 'object' && obj.constructor?.name === 'StringChunk';
}

function getQueryText(sqlObj: any, visited = new WeakSet()): string {
  if (sqlObj === null || sqlObj === undefined) return '';
  if (typeof sqlObj !== 'object') return String(sqlObj);
  if (visited.has(sqlObj)) return '';
  visited.add(sqlObj);

  if (Array.isArray(sqlObj)) {
    return sqlObj.map((chunk) => getQueryText(chunk, visited)).join('');
  }

  if (isStringChunkObject(sqlObj)) {
    return sqlObj.value?.[0] ?? '';
  }

  if ('queryChunks' in sqlObj && Array.isArray(sqlObj.queryChunks)) {
    return sqlObj.queryChunks.map((chunk: any) => getQueryText(chunk, visited)).join('');
  }

  if ('_strings' in sqlObj && Array.isArray(sqlObj._strings)) {
    return sqlObj._strings.map((chunk: any) => getQueryText(chunk, visited)).join('');
  }

  if ('value' in sqlObj) {
    const value = sqlObj.value;
    if (Array.isArray(value)) {
      return value.map((item: any) => getQueryText(item, visited)).join('');
    }
    return getQueryText(value, visited);
  }

  if (typeof sqlObj.name === 'string') return sqlObj.name;
  if (typeof sqlObj.keyAsName === 'string') return sqlObj.keyAsName;

  return '';
}

function getQueryParams(sqlObj: any, visited = new WeakSet()): any[] {
  if (sqlObj === null || sqlObj === undefined) return [];
  if (typeof sqlObj !== 'object') return [sqlObj];
  if (visited.has(sqlObj)) return [];
  visited.add(sqlObj);

  if (Array.isArray(sqlObj)) {
    return sqlObj.flatMap((chunk) => getQueryParams(chunk, visited));
  }

  if (isStringChunkObject(sqlObj)) {
    return [];
  }

  if ('queryChunks' in sqlObj && Array.isArray(sqlObj.queryChunks)) {
    return sqlObj.queryChunks.flatMap((chunk: any) => getQueryParams(chunk, visited));
  }

  if ('_strings' in sqlObj && Array.isArray(sqlObj._strings)) {
    return sqlObj._strings.flatMap((chunk: any) => getQueryParams(chunk, visited));
  }

  if ('value' in sqlObj) {
    const value = sqlObj.value;
    if (Array.isArray(value)) {
      return value.flatMap((item: any) => getQueryParams(item, visited));
    }
    if (typeof value !== 'object' || value === null) {
      return [value];
    }
    return getQueryParams(value, visited);
  }

  return [];
}

function extractConditions(cond: any): Record<string, any> {
  const conditions: Record<string, any> = {};
  if (!cond || typeof cond !== 'object') return conditions;

  const text = getQueryText(cond).toLowerCase();
  const params = getQueryParams(cond).map((value) => (typeof value === 'string' ? value : String(value)));

  const matchByField = (field: string) => {
    const regex = new RegExp(`${field}\\s*=\\s*'([^']*)'`);
    const match = text.match(regex);
    if (match) return match[1];
    return null;
  };

  const matchByFieldOrEnum = (field: string) => {
    const regex = new RegExp(`${field}\\s*=\\s*(?:'([^']*)'|([A-Za-z0-9_]+))`);
    const match = text.match(regex);
    if (match) return match[1] ?? match[2] ?? null;
    return null;
  };

  const matchByNumber = (field: string) => {
    const regex = new RegExp(`${field}\\s*=\\s*(\\d+)`);
    const match = text.match(regex);
    if (match) return Number(match[1]);
    return null;
  };

  const matchByFieldOrNumber = (field: string) => {
    const stringValue = matchByField(field);
    if (stringValue !== null) return stringValue;
    return matchByNumber(field);
  };

  if (text.includes('evaluation_id') || text.includes('evaluationid')) {
    const value = matchByFieldOrNumber('evaluation_id') ?? matchByFieldOrNumber('evaluationid');
    if (value !== null) conditions.evaluationId = value;
  }
  if (text.includes('student_id') || text.includes('studentid')) {
    const value = matchByFieldOrNumber('student_id') ?? matchByFieldOrNumber('studentid');
    if (value !== null) conditions.studentId = value;
  }
  if (text.includes('user_id') || text.includes('userid')) {
    const value = matchByFieldOrNumber('user_id') ?? matchByFieldOrNumber('userid');
    if (value !== null) conditions.userId = value;
  }
  if (text.includes('id') && !text.includes('evaluation_id') && !text.includes('student_id') && !text.includes('user_id')) {
    const value = matchByNumber('id');
    if (value !== null) conditions.id = value;
  }

  const uid = matchByField('uid');
  if (uid !== null) conditions.uid = uid;
  const email = matchByField('email');
  if (email !== null) conditions.email = email;
  const category = matchByFieldOrEnum('category');
  if (category !== null) conditions.category = category;
  const status = matchByFieldOrEnum('status');
  if (status !== null) conditions.status = status;

  if (conditions.category === undefined) {
    const regex = /category\\s*=\\s*(?:'([^']*)'|([A-Za-z0-9_]+))/;
    const match = text.match(regex);
    if (match) conditions.category = match[1] ?? match[2];
  }

  return conditions;
}

function filterRows(rows: any[], conditions: Record<string, any>) {
  return rows.filter((row) => {
    if (conditions.id !== undefined && Number(row.id) !== Number(conditions.id)) return false;
    if (conditions.evaluationId !== undefined && Number(row.evaluationId) !== Number(conditions.evaluationId)) return false;
    if (conditions.studentId !== undefined && Number(row.studentId) !== Number(conditions.studentId)) return false;
    if (conditions.userId !== undefined && Number(row.userId) !== Number(conditions.userId)) return false;
    if (conditions.category !== undefined && row.category !== conditions.category) return false;
    if (conditions.status !== undefined && row.status !== conditions.status) return false;
    return true;
  });
}

function createBuilder(table: any, rows: any[]) {
  return {
    _table: table,
    _rows: rows,
    from(target: any) {
      const name = resolveTableName(target);
      this._table = target;
      this._rows = (mockDbState as any)[name] || [];
      return this;
    },
    innerJoin() { return this; },
    leftJoin() { return this; },
    where(cond?: any) {
      if (!cond) return this;
      const conditions = extractConditions(cond);
      this._rows = filterRows(this._rows, conditions);
      return this;
    },
    limit(n: number) {
      this._rows = this._rows.slice(0, n);
      return this;
    },
    orderBy() { return this; },
    then(resolve: (value: any) => any) {
      return Promise.resolve(this._rows).then(resolve);
    },
    catch(reject: (reason?: any) => any) {
      return Promise.resolve(this._rows).catch(reject);
    },
    finally(cb: () => any) {
      return Promise.resolve(this._rows).finally(cb);
    },
  };
}

function getNextId(table: string) {
  const state = (mockDbState as any)[table] as any[];
  return state.length === 0 ? 1 : Math.max(...state.map((row) => row.id || 0)) + 1;
}

function handleExecute(sqlObj: any) {
  const text = getQueryText(sqlObj).toLowerCase();
  const params = getQueryParams(sqlObj);

  if (text.includes('insert into evaluation_participations') && text.includes('select')) {
    const evaluationId = Number(params[0]);
    const evaluation = mockDbState.evaluations.find((ev: any) => Number(ev.id) === evaluationId);
    if (!evaluation) {
      return { rows: [] };
    }
    const dueStudents = mockDbState.students.filter((student: any) => student.classId === evaluation.classId);
    for (const student of dueStudents) {
      const exists = mockDbState.evaluationParticipations.some(
        (participation: any) => Number(participation.evaluationId) === evaluationId && Number(participation.studentId) === Number(student.id)
      );
      if (exists) continue;
      const enrollmentOk = !student.enrolledAt || new Date(student.enrolledAt).getTime() <= new Date(evaluation.date).getTime();
      if (!enrollmentOk) continue;
      mockDbState.evaluationParticipations.push({
        id: getNextId('evaluationParticipations'),
        evaluationId,
        studentId: student.id,
        status: 'pending',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    }
    return { rows: [] };
  }

  if (text.includes('insert into evaluation_participations') && text.includes('on conflict')) {
    const evaluationId = Number(params[0]);
    const studentId = Number(params[1]);
    const status = params[2];
    const existing = mockDbState.evaluationParticipations.find(
      (participation: any) => Number(participation.evaluationId) === evaluationId && Number(participation.studentId) === studentId
    );
    if (existing) {
      existing.status = status;
      existing.updatedAt = new Date().toISOString();
    } else {
      mockDbState.evaluationParticipations.push({
        id: getNextId('evaluationParticipations'),
        evaluationId,
        studentId,
        status,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    }
    return { rows: [] };
  }

  if (text.includes('count(*)')) {
    const evaluationId = Number(params[0]);
    const rows = mockDbState.evaluationParticipations.filter(
      (participation: any) => Number(participation.evaluationId) === evaluationId
    );
    const completedCount = rows.filter((participation: any) => participation.status === 'graded' || participation.status === 'absent').length;
    return { rows: [{ completed_count: completedCount, eligible_count: rows.length }] };
  }

  return { rows: [] };
}

const mockDb = {
  select: () => createBuilder(null, []),
  insert: (table: any) => ({
    values: (values: any) => ({
      returning: async () => {
        const name = resolveTableName(table);
        if (name === 'notifications') {
          const inserted = Array.isArray(values) ? values : { id: getNextId('notifications'), ...values };
          if (Array.isArray(values)) {
            for (const row of values) {
              const rowWithId = { id: getNextId('notifications'), ...row };
              mockDbState.notifications.push(rowWithId);
            }
            return mockDbState.notifications.slice(-values.length);
          }
          mockDbState.notifications.push(inserted);
          return [inserted];
        }
        if (name === 'grades') {
          const inserted = { id: getNextId('grades'), ...values };
          mockDbState.grades.push(inserted);
          return [inserted];
        }
        return [values];
      },
    }),
  }),
  update: (table: any) => ({
    set: (values: any) => ({
      where: async (_cond: any) => {
        const name = resolveTableName(table);
        if (name === 'grades' && mockDbState.grades.length > 0) {
          mockDbState.grades[0] = { ...mockDbState.grades[0], ...values };
          return [mockDbState.grades[0]];
        }
        return [];
      },
    }),
  }),
  delete: (table: any) => ({
    where: async (cond: any) => {
      const name = resolveTableName(table);
      const conditions = extractConditions(cond);
      const rows = (mockDbState as any)[name] || [];
      const remaining = rows.filter((row: any) => !filterRows([row], conditions).length);
      const deletedCount = rows.length - remaining.length;
      (mockDbState as any)[name] = remaining;
      return { rowCount: deletedCount };
    },
  }),
  execute: async (sqlObj: any) => handleExecute(sqlObj),
  transaction: async (callback: any) => {
    const tx = mockDb as any;
    return callback(tx);
  },
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
        uid: 'sim-user',
        email: 'teacher@example.com',
        role: 'super_admin',
        schoolId: null,
        id: 1,
        simulated: true,
      };
      next();
    },
  };
});

describe('Evaluation participations and notification lifecycle', () => {
  let app: any;

  beforeAll(async () => {
    const serverModule = await import('../server.ts');
    app = await serverModule.createApp();
  });

  beforeEach(() => {
    mockDbState.users = [{ id: 1, uid: 'sim-user', email: 'teacher@example.com', role: 'super_admin', schoolId: null }];
    mockDbState.parents = [{ id: 10, userId: 2 }];
    mockDbState.students = [
      { id: 101, firstName: 'Alice', lastName: 'A', schoolId: 1, classId: 100, enrolledAt: null, parentId: 10 },
      { id: 102, firstName: 'Bob', lastName: 'B', schoolId: 1, classId: 100, enrolledAt: null, parentId: null },
      { id: 103, firstName: 'Claire', lastName: 'C', schoolId: 1, classId: 100, enrolledAt: null, parentId: null },
    ];
    mockDbState.evaluations = [
      {
        id: 200,
        classId: 100,
        teacherId: 1,
        termId: null,
        subject: 'Mathématiques',
        title: 'Contrôle final',
        coefficient: 1,
        maxScore: 20,
        countInBulletin: true,
        date: '2026-06-01',
        createdAt: '2026-05-01T10:00:00Z',
        schoolId: 1,
      },
    ];
    mockDbState.notifications = [];
    mockDbState.grades = [];
    mockDbState.evaluationParticipations = [];
  });

  it('removes evaluation_created only when all eligible students are graded or absent', async () => {
    mockDbState.notifications = [
      { id: 1, userId: 1, title: 'Devoir publié', body: '...', type: 'grade', category: 'evaluation_created', evaluationId: 200 },
    ];

    await request(app)
      .post('/api/evaluation-participations')
      .send({ evaluationId: 200, studentId: 101, status: 'graded' })
      .set('Content-Type', 'application/json');

    await request(app)
      .post('/api/evaluation-participations')
      .send({ evaluationId: 200, studentId: 102, status: 'graded' })
      .set('Content-Type', 'application/json');

    const res = await request(app)
      .post('/api/evaluation-participations')
      .send({ evaluationId: 200, studentId: 103, status: 'absent' })
      .set('Content-Type', 'application/json');

    expect(res.status).toBe(200);
    expect(mockDbState.notifications.some((n: any) => n.category === 'evaluation_created')).toBe(false);
  });

  it('keeps the evaluation_created notification when a student remains pending', async () => {
    mockDbState.notifications = [
      { id: 2, userId: 1, title: 'Devoir publié', body: '...', type: 'grade', category: 'evaluation_created', evaluationId: 200 },
    ];

    await request(app)
      .post('/api/evaluation-participations')
      .send({ evaluationId: 200, studentId: 101, status: 'graded' })
      .set('Content-Type', 'application/json');

    await request(app)
      .post('/api/evaluation-participations')
      .send({ evaluationId: 200, studentId: 102, status: 'graded' })
      .set('Content-Type', 'application/json');

    expect(mockDbState.notifications.some((n: any) => n.category === 'evaluation_created')).toBe(true);
  });

  it('does not delete grade_created notification when evaluation_created is removed', async () => {
    mockDbState.notifications = [
      { id: 3, userId: 1, title: 'Devoir publié', body: '...', type: 'grade', category: 'evaluation_created', evaluationId: 200 },
      { id: 4, userId: 1, title: 'Note enregistrée', body: '...', type: 'grade', category: 'grade_created', evaluationId: 200 },
    ];

    await request(app)
      .post('/api/evaluation-participations')
      .send({ evaluationId: 200, studentId: 101, status: 'graded' })
      .set('Content-Type', 'application/json');

    await request(app)
      .post('/api/evaluation-participations')
      .send({ evaluationId: 200, studentId: 102, status: 'graded' })
      .set('Content-Type', 'application/json');

    await request(app)
      .post('/api/evaluation-participations')
      .send({ evaluationId: 200, studentId: 103, status: 'absent' })
      .set('Content-Type', 'application/json');

    expect(mockDbState.notifications.some((n: any) => n.category === 'evaluation_created')).toBe(false);
    expect(mockDbState.notifications.some((n: any) => n.category === 'grade_created')).toBe(true);
  });

  it('creates an absent participation without creating grades', async () => {
    const res = await request(app)
      .post('/api/evaluation-participations')
      .send({ evaluationId: 200, studentId: 101, status: 'absent' })
      .set('Content-Type', 'application/json');

    expect(res.status).toBe(200);
    expect(mockDbState.evaluationParticipations.some((row: any) => row.evaluationId === 200 && row.studentId === 101 && row.status === 'absent')).toBe(true);
    expect(mockDbState.grades).toHaveLength(0);
  });

  it('does not duplicate participations when initializeEvaluationParticipations runs twice', async () => {
    await request(app)
      .post('/api/evaluation-participations')
      .send({ evaluationId: 200, studentId: 101, status: 'absent' })
      .set('Content-Type', 'application/json');

    await request(app)
      .post('/api/evaluation-participations')
      .send({ evaluationId: 200, studentId: 101, status: 'absent' })
      .set('Content-Type', 'application/json');

    const duplicates = mockDbState.evaluationParticipations.filter(
      (row: any) => row.evaluationId === 200 && row.studentId === 101
    );
    expect(duplicates).toHaveLength(1);
  });
});
