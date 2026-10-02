import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import crypto from 'node:crypto';
import request from 'supertest';
import { PgDialect } from 'drizzle-orm/pg-core';
import { absenceDeclarations, absences, classes, notifications, parents, students, users } from '../src/db/schema.ts';

const mockState = {
  users: [{ id: 7, uid: 'test-user', email: 'parent@example.com', name: 'Parent Test', role: 'parent', schoolId: 1, isDeleted: false }],
  parents: [{ id: 2, userId: 7, studentId: 20, schoolId: 1 }],
  students: [{ id: 20, schoolId: 1, classId: 10, firstName: 'Awa', lastName: 'Test', parentId: 2, isActive: true }],
  classes: [{ id: 10, schoolId: 1 }],
  declarations: [] as any[],
  absences: [] as any[],
};
const declarationListWhereConditions: any[] = [];
const declarationListSelections: any[] = [];

const createSelectBuilder = (selection?: any) => {
  const builder: any = {
    table: null as any,
    selection,
    condition: null as any,
    from(table: any) {
      builder.table = table;
      if (table === absenceDeclarations && selection) declarationListSelections.push(selection);
      return builder;
    },
    where(condition: any) {
      builder.condition = condition;
      if (builder.table === absenceDeclarations) declarationListWhereConditions.push(condition);
      return builder;
    },
    innerJoin() { return builder; },
    leftJoin() { return builder; },
    orderBy() { return builder; },
    limit() { return builder; },
    then(resolve: (value: any) => void, reject: (reason?: any) => void) {
      const rows = builder.table === users ? mockState.users
        : builder.table === parents ? mockState.parents
          : builder.table === students ? mockState.students
            : builder.table === classes ? mockState.classes
              : builder.table === absenceDeclarations ? mockState.declarations
                : builder.table === absences ? mockState.absences
                  : [];
      const query = builder.condition ? new PgDialect().sqlToQuery(builder.condition) : { sql: '', params: [] };
      const equalityConditions = Array.from(query.sql.matchAll(/"[^"]+"\."([^"]+)"\s*=\s*\$(\d+)/g), (match: any) => ({
        key: match[1].replace(/_([a-z])/g, (_: string, letter: string) => letter.toUpperCase()),
        value: query.params[Number(match[2]) - 1],
      }));
      const filteredRows = rows.filter((row: any) => equalityConditions.every(({ key, value }: any) => !(key in row) || row[key] === value));
      return Promise.resolve(filteredRows).then(resolve, reject);
    },
    catch(reject: (reason?: any) => void) { return Promise.resolve([]).catch(reject); },
    finally(callback: () => void) { return Promise.resolve([]).finally(callback); },
  };
  return builder;
};

const makeQuery = (rows: any[]) => ({
  returning: async () => rows,
  then: (resolve: (value: any) => void, reject: (reason?: any) => void) => Promise.resolve({ rowCount: rows.length }).then(resolve, reject),
  catch: (reject: (reason?: any) => void) => Promise.resolve({ rowCount: rows.length }).catch(reject),
  finally: (callback: () => void) => Promise.resolve({ rowCount: rows.length }).finally(callback),
});

const mockDb = {
  select: (selection?: any) => createSelectBuilder(selection),
  execute: async () => [],
  insert: (table: any) => ({
    values: (values: any) => {
      if (table === absenceDeclarations) {
        const row = { id: mockState.declarations.length + 1, ...values };
        mockState.declarations.push(row);
        return makeQuery([row]);
      }
      if (table === absences) {
        const row = { id: mockState.absences.length + 1, ...values };
        mockState.absences.push(row);
        return makeQuery([row]);
      }
      if (table === notifications) return makeQuery([{ id: 1, ...values }]);
      return makeQuery([]);
    },
  }),
  update: (table: any) => ({
    set: (values: Record<string, any>) => ({
      where: (condition: any) => {
        let didUpdate = false;
        const targetRows = () => {
          const rows = table === absenceDeclarations ? mockState.declarations
            : table === absences ? mockState.absences
              : [];
          if (!condition) return rows;
          const query = new PgDialect().sqlToQuery(condition);
          const equalityConditions = Array.from(query.sql.matchAll(/"[^"]+"\."([^"]+)"\s*=\s*\$(\d+)/g), (match: any) => ({
            key: match[1].replace(/_([a-z])/g, (_: string, letter: string) => letter.toUpperCase()),
            value: query.params[Number(match[2]) - 1],
          }));
          return rows.filter((row: any) => equalityConditions.every(({ key, value }: any) => !(key in row) || row[key] === value));
        };
        const applyUpdate = () => {
          if (didUpdate) return;
          didUpdate = true;
          targetRows().forEach((row: any) => Object.assign(row, values));
        };
        const updatedRows = () => targetRows();
        return {
          then: (resolve: (value: any) => void, reject: (reason?: any) => void) => {
            applyUpdate();
            return Promise.resolve(updatedRows()).then(resolve, reject);
          },
          returning: async () => {
            applyUpdate();
            return updatedRows();
          },
        };
      },
    }),
  }),
  delete: () => ({ where: async () => [] }),
};

vi.mock('../src/db/index.ts', () => ({ db: mockDb }));
vi.mock('../src/db', () => ({ db: mockDb }));
vi.mock('src/db/index.ts', () => ({ db: mockDb }));
vi.mock('../src/middleware/auth.ts', async () => {
  const actual = await vi.importActual('../src/middleware/auth.ts');
  return {
    ...actual,
    requireAuth(req: any, _res: any, next: () => void) {
      const role = req.headers['x-test-role'] || 'parent';
      const id = Number(req.headers['x-test-user-id'] || 7);
      req.user = { uid: id === 7 ? 'test-user' : `test-user-${id}`, email: id === 7 ? 'parent@example.com' : `parent-${id}@example.com`, role, schoolId: id === 8 ? 2 : 1, id, simulated: true };
      next();
    },
  };
});
vi.mock('src/middleware/auth', async () => {
  const actual = await vi.importActual('../src/middleware/auth.ts');
  return {
    ...actual,
    requireAuth(req: any, _res: any, next: () => void) {
      const role = req.headers['x-test-role'] || 'parent';
      const id = Number(req.headers['x-test-user-id'] || 7);
      req.user = { uid: id === 7 ? 'test-user' : `test-user-${id}`, email: id === 7 ? 'parent@example.com' : `parent-${id}@example.com`, role, schoolId: id === 8 ? 2 : 1, id, simulated: true };
      next();
    },
  };
});

describe('parent absence declaration routes', () => {
  let app: any;
  let originalInternalSecret: string | undefined;

  beforeAll(async () => {
    originalInternalSecret = process.env.INTERNAL_SECRET;
    process.env.INTERNAL_SECRET = 'absence-declaration-test-secret';
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200 })));
    const serverModule = await import('../server.ts');
    app = await serverModule.createApp();
  });

  beforeEach(() => {
    mockState.users = [{ id: 7, uid: 'test-user', email: 'parent@example.com', name: 'Parent Test', role: 'parent', schoolId: 1, isDeleted: false }];
    mockState.parents = [{ id: 2, userId: 7, studentId: 20, schoolId: 1 }];
    mockState.students = [{ id: 20, schoolId: 1, classId: 10, firstName: 'Awa', lastName: 'Test', parentId: 2, isActive: true }];
    mockState.classes = [{ id: 10, schoolId: 1 }];
    mockState.declarations = [];
    mockState.absences = [];
    declarationListWhereConditions.length = 0;
    declarationListSelections.length = 0;
  });

  afterAll(() => {
    if (originalInternalSecret === undefined) delete process.env.INTERNAL_SECRET;
    else process.env.INTERNAL_SECRET = originalInternalSecret;
    vi.unstubAllGlobals();
  });

  const isoDay = (offset: number) => {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() + offset);
    return date.toISOString().slice(0, 10);
  };

  const declarationInput = (studentId: number, date = isoDay(0)) => ({
    studentId,
    date,
    startTime: '08:00',
    endTime: '10:00',
    reason: 'Rendez-vous médical',
  });

  it('accepts today and future for the parent’s child, rejects past dates and unrelated children', async () => {
    const today = await request(app).post('/api/absence-declarations').send(declarationInput(20)).expect(201);
    expect(today.body.status).toBe('RECEIVED');
    expect(mockState.absences).toHaveLength(0);

    const future = await request(app).post('/api/absence-declarations').send(declarationInput(20, isoDay(2))).expect(201);
    expect(future.body.date).toBe(isoDay(2));
    await request(app).post('/api/absence-declarations').send(declarationInput(20, isoDay(-1))).expect(400);
    await request(app).post('/api/absence-declarations').send(declarationInput(20, '2030-02-31')).expect(400);
    await request(app).post('/api/absence-declarations').send(declarationInput(999)).expect(403);
    await request(app).post('/api/absence-declarations').set('x-test-role', 'teacher').send(declarationInput(20)).expect(403);
    expect(mockState.absences).toHaveLength(0);
  });

  it('rejects declarations without a nonblank reason on create and update', async () => {
    const invalidReasons = [undefined, null, '', '   '];
    mockState.declarations = [{
      id: 18,
      studentId: 20,
      parentId: 2,
      date: isoDay(1),
      startTime: '08:00',
      endTime: '10:00',
      reason: 'Motif existant',
      status: 'RECEIVED',
    }];

    for (const reason of invalidReasons) {
      const payload = { ...declarationInput(20), reason };
      const created = await request(app).post('/api/absence-declarations').send(payload).expect(400);
      expect(created.body.error).toMatch(/motif.*obligatoire/i);

      const updated = await request(app).put('/api/absence-declarations/18').send(payload).expect(400);
      expect(updated.body.error).toMatch(/motif.*obligatoire/i);
    }

    expect(mockState.declarations).toHaveLength(1);
  });

  it('trims and accepts a nonblank reason on create and update', async () => {
    const created = await request(app)
      .post('/api/absence-declarations')
      .send({ ...declarationInput(20), reason: '  Maladie  ' })
      .expect(201);
    expect(created.body.reason).toBe('Maladie');

    mockState.declarations = [{
      id: 19,
      studentId: 20,
      parentId: 2,
      date: isoDay(1),
      startTime: '08:00',
      endTime: '10:00',
      reason: 'Ancien motif',
      status: 'RECEIVED',
    }];
    const updated = await request(app)
      .put('/api/absence-declarations/19')
      .send({ ...declarationInput(20), reason: '  Maladie  ' })
      .expect(200);
    expect(updated.body.reason).toBe('Maladie');
  });

  it('does not let the signed internal relay bypass the reason requirement', async () => {
    for (const action of ['create', 'update'] as const) {
      const payload = {
        parentUserId: 7,
        action,
        input: {
          id: 18,
          studentId: 20,
          date: isoDay(0),
          startTime: '08:00',
          endTime: '10:00',
          reason: '   ',
        },
      };
      const timestamp = Date.now().toString();
      const signature = crypto.createHmac('sha256', 'absence-declaration-test-secret')
        .update(`${JSON.stringify(payload)}${timestamp}`)
        .digest('hex');

      const response = await request(app)
        .post('/api/internal/absence-declarations')
        .set('X-Internal-Timestamp', timestamp)
        .set('X-Internal-Signature', signature)
        .send(payload)
        .expect(400);

      expect(response.body.error).toMatch(/motif.*obligatoire/i);
    }
    expect(mockState.declarations).toHaveLength(0);
  });

  it('allows edits only before the date and returns an approved edit to pending review', async () => {
    mockState.declarations = [{
      id: 8,
      studentId: 20,
      parentId: 2,
      date: isoDay(1),
      startTime: '08:00',
      endTime: '10:00',
      reason: 'Ancien motif',
      status: 'ACCEPTED',
    }];

    const updated = await request(app)
      .put('/api/absence-declarations/8')
      .send(declarationInput(20, isoDay(2)))
      .expect(200);
    expect(updated.body.status).toBe('RECEIVED');
    expect(updated.body.date).toBe(isoDay(2));

    await request(app)
      .put('/api/absence-declarations/8')
      .send(declarationInput(20, isoDay(-1)))
      .expect(400);

    mockState.declarations[0].status = 'REFUSED';
    await request(app)
      .put('/api/absence-declarations/8')
      .send(declarationInput(20))
      .expect(409);
  });

  it('cancels an owned pending declaration and keeps it out of absences', async () => {
    mockState.declarations = [{ id: 9, studentId: 20, parentId: 2, date: isoDay(0), status: 'RECEIVED' }];

    const cancelled = await request(app).put('/api/absence-declarations/9/cancel').send({}).expect(200);
    expect(cancelled.body.status).toBe('CANCELLED');
    await request(app).put('/api/absence-declarations/9/cancel').send({}).expect(409);
    expect(mockState.absences).toHaveLength(0);
  });

  it('denies update and cancellation after the declared child is transferred, and denies cross-parent declaration IDs', async () => {
    mockState.users.push({ id: 8, uid: 'test-user-8', email: 'parent-b@example.com', name: 'Parent B', role: 'parent', schoolId: 2, isDeleted: false });
    mockState.parents.push({ id: 3, userId: 8, studentId: 21, schoolId: 2 });
    mockState.parents[0].studentId = 21;
    mockState.students = [
      { id: 20, schoolId: 1, classId: 10, firstName: 'Awa', lastName: 'Test', parentId: 2, isActive: true },
      { id: 21, schoolId: 2, classId: 20, firstName: 'Binta', lastName: 'Test', parentId: 3, isActive: true },
    ];
    mockState.declarations = [
      { id: 40, studentId: 21, parentId: 2, date: isoDay(1), startTime: '08:00', endTime: '10:00', reason: 'Ancien rattachement', status: 'RECEIVED' },
      { id: 41, studentId: 21, parentId: 3, date: isoDay(1), startTime: '08:00', endTime: '10:00', reason: 'Parent B', status: 'RECEIVED' },
    ];

    await request(app)
      .put('/api/absence-declarations/40')
      .send(declarationInput(20, isoDay(2)))
      .expect(403);
    await request(app)
      .put('/api/absence-declarations/40/cancel')
      .send({})
      .expect(403);

    await request(app)
      .put('/api/absence-declarations/40')
      .set('x-test-user-id', '8')
      .send(declarationInput(21, isoDay(2)))
      .expect(404);
    await request(app)
      .put('/api/absence-declarations/40/cancel')
      .set('x-test-user-id', '8')
      .send({})
      .expect(404);

    await request(app)
      .put('/api/absence-declarations/41')
      .send(declarationInput(20, isoDay(2)))
      .expect(404);
    await request(app)
      .put('/api/absence-declarations/41/cancel')
      .send({})
      .expect(404);

    expect(mockState.declarations.map((declaration) => declaration.status)).toEqual(['RECEIVED', 'RECEIVED']);
    expect(mockState.declarations.map((declaration) => declaration.studentId)).toEqual([21, 21]);
  });

  it('closes a declaration as not realized without creating an absence', async () => {
    mockState.declarations = [{ id: 11, studentId: 20, parentId: 2, date: isoDay(0), status: 'RECEIVED' }];

    const closed = await request(app)
      .put('/api/absence-declarations/11/not-realized')
      .set('x-test-role', 'surveillant')
      .send({})
      .expect(200);

    expect(closed.body.status).toBe('NOT_REALIZED');
    expect(mockState.absences).toHaveLength(0);
  });

  it('lets authorized school staff approve or reject without creating an absence', async () => {
    mockState.declarations = [{ id: 10, studentId: 20, parentId: 2, date: isoDay(2), status: 'RECEIVED' }];

    const approved = await request(app)
      .put('/api/absence-declarations/10/review')
      .set('x-test-role', 'school_admin')
      .send({ status: 'ACCEPTED' })
      .expect(200);
    expect(approved.body.status).toBe('ACCEPTED');
    expect(approved.body.reviewedBy).toBe(7);
    expect(approved.body.reviewedAt).toBeTruthy();
    expect(mockState.absences).toHaveLength(0);

    mockState.declarations[0].status = 'RECEIVED';
    const rejected = await request(app)
      .put('/api/absence-declarations/10/review')
      .set('x-test-role', 'school_admin')
      .send({ status: 'REFUSED', rejectionReason: 'Plage non autorisée' })
      .expect(200);
    expect(rejected.body.status).toBe('REFUSED');
    expect(rejected.body.rejectionReason).toBe('Plage non autorisée');
    expect(rejected.body.reviewedBy).toBe(7);
    expect(rejected.body.reviewedAt).toBeTruthy();
    expect(mockState.absences).toHaveLength(0);
  });

  it('links a same-day declaration to an existing absence without inserting a duplicate', async () => {
    mockState.declarations = [{
      id: 12,
      studentId: 20,
      parentId: 2,
      date: isoDay(0),
      startTime: '08:00',
      endTime: '10:00',
      status: 'RECEIVED',
    }];
    mockState.absences = [{
      id: 25,
      studentId: 20,
      date: isoDay(0),
      startTime: '08:30',
      endTime: '09:30',
      isJustified: false,
      justificationStatus: null,
      declarationId: null,
    }];

    const response = await request(app)
      .put('/api/absence-declarations/12/review')
      .set('x-test-role', 'school_admin')
      .send({ status: 'ACCEPTED' })
      .expect(200);

    expect(response.body.reviewedBy).toBe(7);
    expect(response.body.reviewedAt).toBeTruthy();
    expect(mockState.absences).toHaveLength(1);
    expect(mockState.absences[0].declarationId).toBe(12);
    expect(mockState.absences[0].isJustified).toBe(false);
    expect(mockState.absences[0].justificationStatus).toBeNull();
  });

  it('denies declaration-list access to users without review permission', async () => {
    await request(app).get('/api/absence-declarations').set('x-test-role', 'student').expect(403);
  });

  it('scopes the declaration list used by the badge to the current school', async () => {
    mockState.declarations = [{ id: 31, studentId: 20, parentId: 2, date: isoDay(1), status: 'RECEIVED' }];

    await request(app).get('/api/absence-declarations').set('x-test-role', 'school_admin').expect(200);

    expect(declarationListWhereConditions).toHaveLength(1);
    const query = new PgDialect().sqlToQuery(declarationListWhereConditions[0]);
    expect(query.sql).toContain('school_id');
    expect(query.params).toContain(1);
  });

  it('selects parent name and creation time for the declaration validation view', async () => {
    await request(app).get('/api/absence-declarations').set('x-test-role', 'school_admin').expect(200);

    expect(declarationListSelections).toHaveLength(1);
    expect(declarationListSelections[0]).toHaveProperty('parentName', users.name);
    expect(declarationListSelections[0]).toHaveProperty('createdAt', absenceDeclarations.createdAt);
  });

  it('keeps declarations separate and only links an actual same-day absence after approval', async () => {
    mockState.declarations = [{
      id: 4,
      studentId: 20,
      parentId: 2,
      date: isoDay(0),
      startTime: '08:00',
      endTime: '10:00',
      reason: 'Rendez-vous médical',
      status: 'ACCEPTED',
      reviewedBy: 7,
      reviewedAt: new Date(),
    }];

    const response = await request(app)
      .post('/api/absences')
      .set('x-test-role', 'surveillant')
      .send({ studentId: 20, classId: 10, date: isoDay(0), subjectId: 5, startTime: '09:00', endTime: '10:30' })
      .expect(201);

    expect(response.body.isJustified).toBe(false);
    expect(response.body.justificationStatus).toBeUndefined();
    expect(response.body.declarationId).toBe(4);
  });

  it('links a received declaration without turning the real absence into a justification', async () => {
    mockState.declarations = [{
      id: 5,
      studentId: 20,
      parentId: 2,
      date: isoDay(0),
      startTime: '08:00',
      endTime: '10:00',
      status: 'RECEIVED',
    }];

    const response = await request(app)
      .post('/api/absences')
      .set('x-test-role', 'surveillant')
      .send({ studentId: 20, classId: 10, date: isoDay(0), subjectId: 5, startTime: '09:00', endTime: '10:30' })
      .expect(201);

    expect(response.body.isJustified).toBe(false);
    expect(response.body.justificationStatus).toBeUndefined();
    expect(response.body.declarationId).toBe(5);

    mockState.declarations[0].status = 'REFUSED';
    mockState.absences = [];
    const refusedDeclarationAbsence = await request(app)
      .post('/api/absences')
      .set('x-test-role', 'surveillant')
      .send({ studentId: 20, classId: 10, date: isoDay(0), subjectId: 5, startTime: '09:00', endTime: '10:30' })
      .expect(201);
    expect(refusedDeclarationAbsence.body.declarationId).toBe(5);
    expect(refusedDeclarationAbsence.body.isJustified).toBe(false);
    expect(refusedDeclarationAbsence.body.justificationStatus).toBeUndefined();
  });

  it('links an existing same-day absence when the parent declares afterward', async () => {
    mockState.absences = [{
      id: 15,
      studentId: 20,
      date: isoDay(0),
      startTime: '08:30',
      endTime: '09:30',
      isJustified: false,
      justificationStatus: null,
      declarationId: null,
    }];

    const response = await request(app)
      .post('/api/absence-declarations')
      .send(declarationInput(20))
      .expect(201);

    expect(mockState.absences[0].declarationId).toBe(response.body.id);
    expect(mockState.absences[0].isJustified).toBe(false);
    expect(mockState.absences[0].justificationStatus).toBeNull();
  });

  it('returns the declaration link with a real absence', async () => {
    mockState.absences = [{
      id: 15,
      studentId: 20,
      classId: 10,
      date: isoDay(0),
      period: 'morning',
      isJustified: false,
      justificationStatus: null,
      declarationId: 9,
    }];

    const response = await request(app).get('/api/absences').expect(200);

    expect(response.body[0].declarationId).toBe(9);
  });

  it('limits establishment review to the school that owns the student', async () => {
    mockState.declarations = [{ id: 6, studentId: 20, parentId: 2, date: isoDay(0), status: 'RECEIVED' }];
    mockState.students[0].schoolId = 2;

    await request(app)
      .put('/api/absence-declarations/6/review')
      .set('x-test-role', 'school_admin')
      .send({ status: 'ACCEPTED' })
      .expect(403);
  });
});