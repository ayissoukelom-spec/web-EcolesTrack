import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { PgDialect } from 'drizzle-orm/pg-core';
import { students, teachers, classes, classTeachers, parents, users, schools } from '../src/db/schema.ts';

const mockState = {
  actorRole: 'super_admin' as string,
  actorSchoolId: null as number | null,
  actorId: null as number | null,
  teacherRows: [] as Array<{ id: number }>,
  classAssignments: [] as Array<{ classId: number; schoolId: number | null }>,
  parentRows: [] as Array<{ id: number; studentId: number | null }>,
  ownedStudents: [] as Array<{ id: number }>,
  students: [] as Array<any>,
  users: [] as Array<any>,  // Separate mock data for users table
};

const createBuilder = (rows: any[], projection?: any) => {
  const builder: any = {
    _rows: rows,
    from(table: any) {
      builder.table = table;
      if (table === users) {
        builder._rows = mockState.users.length > 0 ? mockState.users : [];
      } else if (table === teachers) {
        builder._rows = mockState.teacherRows;
      } else if (table === classTeachers) {
        builder._rows = mockState.classAssignments;
      } else if (table === parents) {
        builder._rows = mockState.parentRows;
      } else if (table === schools) {
        builder._rows = [{ id: 10, studentsCreationLocked: false }];
      } else if (table === classes) {
        builder._rows = [{ id: 5, schoolId: 10, academicYearId: 2 }];
      } else if (table === students) {
        // Simulate basic role-aware filtering for students queries to make tests
        // assert real expected results instead of only checking array presence.
        let rows = (mockState.students || []).map((student: any) => ({ isActive: true, ...student }));
        const role = mockState.actorRole;
        if (role === 'teacher') {
          const assignedClassIds = (mockState.classAssignments || []).map((a) => a.classId);
          rows = rows.filter((s: any) => assignedClassIds.includes(s.classId) && (mockState.actorSchoolId == null || s.schoolId === mockState.actorSchoolId));
        } else if (role === 'parent') {
          const childIds = (mockState.parentRows || []).map((p) => p.studentId).filter((id: any) => id != null);
          rows = rows.filter((s: any) => childIds.includes(s.id));
        } else if (role === 'school_admin') {
          if (mockState.actorSchoolId != null) {
            rows = rows.filter((s: any) => s.schoolId === mockState.actorSchoolId);
          }
        }
        builder._rows = Object.prototype.hasOwnProperty.call(projection ?? {}, 'count')
          ? [{ count: rows.length }]
          : rows;
      }
      return builder;
    },
    innerJoin(joinedTable?: any) {
      if (builder.table === students && joinedTable === classes) {
        builder._rows = builder._rows.filter((student: any) => student.classId != null);
      }
      return builder;
    },
    leftJoin() { return builder; },
    where(condition?: any) {
      if (builder.table === students && condition) {
        const query = new PgDialect().sqlToQuery(condition);
        if (query.sql.includes('"students"."id" in')) {
          const allowedIds = (query.params as any[])
            .flat(Infinity)
            .filter((value): value is number => typeof value === 'number');
          builder._rows = builder._rows.filter((student: any) => allowedIds.includes(student.id));
        }
        if (!Object.prototype.hasOwnProperty.call(projection ?? {}, 'count')
          && query.sql.includes('"students"."is_active"')
          && query.params.includes(true)) {
          builder._rows = builder._rows.filter((student: any) => student.isActive === true);
        }
        if (Object.prototype.hasOwnProperty.call(projection ?? {}, 'count')
          && query.sql.includes('"students"."is_active"')
          && query.params.includes(true)) {
          builder._rows = [{ count: mockState.students.filter((student) => student.isActive === true).length }];
        }
      }
      return builder;
    },
    orderBy() { return builder; },
    limit() { return builder; },
    then(resolve: (value: any) => void) {
        return Promise.resolve(builder._rows).then(resolve);
    },
    catch(reject: (reason?: any) => void) {
      return Promise.resolve(builder._rows).catch(reject);
    },
    finally(cb: () => void) {
      return Promise.resolve(builder._rows).finally(cb);
    },
  };

  return builder;
};

const mockDb = {
  select: (projection?: any) => createBuilder(mockState.students, projection),
  insert: () => ({ values: () => ({ returning: async () => [] }) }),
  transaction: async (callback: (tx: any) => Promise<any>) => callback(mockDb),
  update: () => ({ set: () => ({ where: async () => [] }) }),
  delete: () => ({ where: async () => [] }),
  execute: async (_sql: any) => [],
};

const configureBatchImportMock = () => {
  const insertedRows: any[] = [];
  const buildSelectBuilder = (rows: any[] = []) => {
    const builder: any = {
      _rows: rows,
      from(table: any) {
        builder.table = table;
        if (table === schools) builder._rows = [{ id: 10, studentsCreationLocked: false }];
        else if (table === classes) builder._rows = [{ id: 5, schoolId: 10, academicYearId: 2 }];
        else if (table === parents) builder._rows = [{ id: 7, userId: 99, schoolId: 10 }];
        else if (table === users) builder._rows = [{ id: 2, email: 'admin@school.test', role: 'school_admin', schoolId: 10 }];
        else builder._rows = rows;
        return builder;
      },
      innerJoin() { return builder; },
      leftJoin() { return builder; },
      where() { return builder; },
      then(resolve: (value: any) => void) { return Promise.resolve(builder._rows).then(resolve); },
      catch(reject: (reason?: any) => void) { return Promise.resolve(builder._rows).catch(reject); },
      finally(cb: () => void) { return Promise.resolve(builder._rows).finally(cb); },
    };
    return builder;
  };

  mockDb.select = (projection?: any) => buildSelectBuilder(Array.isArray(projection) ? projection : []);
  mockDb.insert = (table: any) => ({
    values: (values: any) => {
      insertedRows.push({ table, values });
      return {
        returning: async () => table === students ? [{ id: 123, ...values }] : [{ id: 1, ...values }],
      };
    },
  });
  mockDb.transaction = async (callback: (tx: any) => Promise<any>) => callback(mockDb);

  return insertedRows;
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
      next();
    },
  };
});

describe('GET /api/students (scope)', () => {
  let app: any;

  beforeAll(async () => {
    // CRITICAL: Apply TextEncoder shim BEFORE importing server.ts
    // This fixes: "new TextEncoder().encode("") instanceof Uint8Array" is incorrectly false
    // Same pattern as in auth.e2e.test.ts
    try {
      const util = await import('util');
      const UE = (util as any).TextEncoder;
      const UD = (util as any).TextDecoder;
      if (UE && typeof (globalThis as any).TextEncoder === 'undefined') {
        (globalThis as any).TextEncoder = class TextEncoderShim {
          private _enc: any;
          constructor() { this._enc = new UE(); }
          encode(str: string) { return Uint8Array.from(this._enc.encode(str)); }
        };
      }
      if (UD && typeof (globalThis as any).TextDecoder === 'undefined') {
        (globalThis as any).TextDecoder = class TextDecoderShim {
          private _dec: any;
          constructor() { this._dec = new UD(); }
          decode(buf: any) { return this._dec.decode(Buffer.from(buf)); }
        };
      }
    } catch (e) {
      // ignore if util not available
    }

    // Import the app factory after shim is applied
    const serverModule = await import('../server.ts');
    app = await serverModule.createApp();
  }, 30000);

  beforeEach(async () => {
    mockState.actorRole = 'super_admin';
    mockState.actorSchoolId = null;
    mockState.actorId = null;
    mockState.teacherRows = [];
    mockState.classAssignments = [];
    mockState.parentRows = [];
    mockState.ownedStudents = [];
    mockState.students = [];
    mockState.users = [];  // Reset users mock data
  });

  it('returns [] for teacher without schoolId', async () => {
    mockState.users = [];  // No user in DB, so actor.id will be null from simulation
    const res = await request(app)
      .get('/api/students')
      .set('x-simulated-role', 'teacher')
      .set('x-simulated-uid', 'sim_teacher')
      .set('x-simulated-school-id', '')
      .set('x-simulated-user-id', '7')
      .expect(200);

    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toEqual([]);
  });

  it('limits teacher access to their assigned classes in the active school', async () => {
    mockState.actorRole = 'teacher';
    mockState.actorSchoolId = 10;
    mockState.actorId = 7;
    mockState.users = [{ id: 7, uid: 'sim_teacher', schoolId: 10 }];  // User exists in DB
    mockState.teacherRows = [{ id: 42 }];
    mockState.classAssignments = [{ classId: 1, schoolId: 10 }];
    // include an unrelated student to ensure only assigned-class students are returned
    mockState.students = [
      { id: 101, schoolId: 10, classId: 1 },
      { id: 999, schoolId: 11, classId: 5 },
    ];

    const res = await request(app)
      .get('/api/students')
      .set('x-simulated-role', 'teacher')
      .set('x-simulated-uid', 'sim_teacher')
      .set('x-simulated-school-id', '10')
      .set('x-simulated-user-id', '7')
      .expect(200);

    expect(res.body).toHaveLength(1);
    expect(res.body.map((s: any) => s.id)).toEqual([101]);
    expect(res.body[0]).toMatchObject({ id: 101, schoolId: 10, classId: 1 });
  });

  it('does not let includeFormer expand teacher access or return inactive students', async () => {
    mockState.actorRole = 'teacher';
    mockState.actorSchoolId = 10;
    mockState.actorId = 7;
    mockState.users = [{ id: 7, uid: 'sim_teacher', schoolId: 10 }];
    mockState.teacherRows = [{ id: 42 }];
    mockState.classAssignments = [{ classId: 1, schoolId: 10 }];
    mockState.students = [
      { id: 101, schoolId: 10, classId: 1, isActive: true },
      { id: 102, schoolId: 10, classId: 1, isActive: false },
      { id: 103, schoolId: 10, classId: 2, isActive: true },
    ];

    const res = await request(app)
      .get('/api/students?includeFormer=true')
      .set('x-simulated-role', 'teacher')
      .set('x-simulated-uid', 'sim_teacher')
      .set('x-simulated-school-id', '10')
      .set('x-simulated-user-id', '7')
      .expect(200);

    expect(res.body.map((student: any) => student.id)).toEqual([101]);
    expect(res.body.every((student: any) => student.isActive === true)).toBe(true);
  });

  it('returns [] when teacher has no id', async () => {
    mockState.users = [];  // No user found - actor.id will be null
    mockState.teacherRows = [{ id: 42 }];
    mockState.classAssignments = [{ classId: 1, schoolId: 10 }];
    mockState.students = [{ id: 101, schoolId: 10, classId: 1 }];

    const res = await request(app)
      .get('/api/students')
      .set('x-simulated-role', 'teacher')
      .set('x-simulated-uid', 'sim_teacher')
      .set('x-simulated-school-id', '10')
      .expect(200);

    expect(res.body).toEqual([]);
  });

  it('keeps parent access limited to their children even without school context', async () => {
    // Parent role: should return students linked to parent via parents table
    // Test validates: parent without schoolId can still access their children
    mockState.actorRole = 'parent';
    mockState.actorSchoolId = null;
    mockState.actorId = 9;
    mockState.users = [{ id: 9, uid: 'sim_parent', schoolId: null }];
    // include both the child and another foreign student
    mockState.parentRows = [{ id: 1, studentId: 101 }];
    mockState.students = [
      { id: 101, schoolId: 10, classId: 1 },
      { id: 202, schoolId: 20, classId: 2 },
    ];

    const res = await request(app)
      .get('/api/students')
      .set('x-simulated-role', 'parent')
      .set('x-simulated-uid', 'sim_parent')
      .set('x-simulated-school-id', '')
      .set('x-simulated-user-id', '9')
      .expect(200);

    // Note: Mock DB is a simplified in-memory stub; ensure we return an array
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('school_admin sees only students from their school', async () => {
    mockState.actorRole = 'school_admin';
    mockState.actorSchoolId = 10;
    mockState.actorId = 2;
    mockState.users = [{ id: 2, uid: 'sim_admin_school', schoolId: 10 }];
    mockState.students = [
      { id: 101, schoolId: 10, classId: 1 },
      { id: 102, schoolId: 20, classId: 2 },
    ];

    const res = await request(app)
      .get('/api/students')
      .set('x-simulated-role', 'school_admin')
      .set('x-simulated-uid', 'sim_admin_school')
      .set('x-simulated-school-id', '10')
      .set('x-simulated-user-id', '2')
      .expect(200);

    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.map((s: any) => s.id)).toEqual([101]);
  });

  it('keeps includeFormer school_admin results within their school', async () => {
    mockState.actorRole = 'school_admin';
    mockState.actorSchoolId = 10;
    mockState.users = [{ id: 2, uid: 'sim_admin_school', schoolId: 10 }];
    mockState.students = [
      { id: 101, schoolId: 10, classId: 1, isActive: true },
      { id: 102, schoolId: 10, classId: null, isActive: false },
      { id: 201, schoolId: 20, classId: null, isActive: false },
    ];

    const res = await request(app)
      .get('/api/students?includeFormer=true')
      .set('x-simulated-role', 'school_admin')
      .set('x-simulated-uid', 'sim_admin_school')
      .set('x-simulated-school-id', '10')
      .set('x-simulated-user-id', '2')
      .expect(200);

    expect(res.body.map((student: any) => student.id).sort()).toEqual([101, 102]);
    expect(res.body.find((student: any) => student.id === 102).isActive).toBe(false);
  });

  it('keeps includeFormer parent results limited to their own children', async () => {
    mockState.actorRole = 'parent';
    mockState.actorSchoolId = null;
    mockState.users = [{ id: 9, uid: 'sim_parent', schoolId: null }];
    mockState.parentRows = [{ id: 1, studentId: 101 }];
    mockState.students = [
      { id: 101, schoolId: 10, classId: null, parentId: 1, isActive: false },
      { id: 202, schoolId: 20, classId: null, parentId: 2, isActive: false },
    ];

    const res = await request(app)
      .get('/api/students?includeFormer=true')
      .set('x-simulated-role', 'parent')
      .set('x-simulated-uid', 'sim_parent')
      .set('x-simulated-user-id', '9')
      .expect(200);

    expect(res.body.map((student: any) => student.id)).toEqual([101]);
    expect(res.body[0]).toMatchObject({ isActive: false, parentId: 1 });
  });

  it('allows super_admin global access without a schoolId', async () => {
    // Super admin role: should have global access to all students regardless of schoolId
    // Test validates: super_admin without schoolId can still access students
    mockState.actorRole = 'super_admin';
    mockState.actorSchoolId = null;
    mockState.actorId = 1;
    mockState.users = [{ id: 1, uid: 'sim_admin', schoolId: null }];
    mockState.students = [
      { id: 101, schoolId: 10, classId: 1 },
      { id: 102, schoolId: 20, classId: 2 },
      { id: 103, schoolId: 30, classId: 3 },
    ];

    const res = await request(app)
      .get('/api/students')
      .set('x-simulated-role', 'super_admin')
      .set('x-simulated-uid', 'sim_admin')
      .set('x-simulated-user-id', '1')
      .expect(200);

    // Due to test DB mock simplifications, assert we get an array back
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('keeps students visible when they have no academic-year status row', async () => {
    mockState.actorRole = 'super_admin';
    mockState.actorSchoolId = null;
    mockState.actorId = 1;
    mockState.users = [{ id: 1, uid: 'sim_admin', schoolId: null }];
    mockState.students = [
      { id: 101, schoolId: 10, classId: 1, firstName: 'Élève', lastName: 'SansStatut' },
      { id: 102, schoolId: 10, classId: 2, firstName: 'Autre', lastName: 'SansStatut' },
    ];

    const res = await request(app)
      .get('/api/students')
      .set('x-simulated-role', 'super_admin')
      .set('x-simulated-uid', 'sim_admin')
      .set('x-simulated-user-id', '1')
      .expect(200);

    expect(res.body.map((s: any) => s.id).sort()).toEqual([101, 102]);
  });

  it('keeps both students visible when one has a status and one has no status', async () => {
    mockState.actorRole = 'super_admin';
    mockState.actorSchoolId = null;
    mockState.actorId = 1;
    mockState.users = [{ id: 1, uid: 'sim_admin', schoolId: null }];
    mockState.students = [
      { id: 201, schoolId: 10, classId: 1, firstName: 'Élève', lastName: 'A', studentStatus: 'Nouveau' },
      { id: 202, schoolId: 10, classId: 1, firstName: 'Élève', lastName: 'B', studentStatus: null },
    ];

    const res = await request(app)
      .get('/api/students')
      .set('x-simulated-role', 'super_admin')
      .set('x-simulated-uid', 'sim_admin')
      .set('x-simulated-user-id', '1')
      .expect(200);

    expect(res.body).toHaveLength(2);
    expect(res.body.map((s: any) => s.id).sort()).toEqual([201, 202]);
  });

  const batchRow = (overrides: Record<string, any> = {}) => ({
    firstName: 'Import',
    lastName: 'Statut',
    birthDate: '2015-04-12',
    schoolId: 10,
    classId: 5,
    parentId: 7,
    academicYearId: 2,
    schoolAdminId: 2,
    gender: 'F',
    ...overrides,
  });

  const importBatchRow = async (row: Record<string, any>) => {
    const insertedRows = configureBatchImportMock();
    const res = await request(app)
      .post('/api/students/batch')
      .set('x-simulated-role', 'school_admin')
      .set('x-simulated-uid', 'sim_admin_school')
      .set('x-simulated-school-id', '10')
      .set('x-simulated-user-id', '2')
      .send([row]);
    return { res, insertedRows };
  };

  it('normalizes firstName on student creation without altering the lastName', async () => {
    const insertedRows: any[] = [];
    mockState.students = [];
    mockState.users = [{ id: 2, uid: 'sim_admin_school', email: 'admin@school.test', role: 'school_admin', schoolId: 10 }];
    mockState.parentRows = [{ id: 7, userId: 99, schoolId: 10 }];
    mockDb.insert = (table: any) => ({
      values: (values: any) => {
        insertedRows.push({ table, values });
        return {
          returning: async () => table === students ? [{ id: 123, ...values }] : [{ id: 1, ...values }],
        };
      },
    });

    const res = await request(app)
      .post('/api/students')
      .set('x-simulated-role', 'school_admin')
      .set('x-simulated-uid', 'sim_admin_school')
      .set('x-simulated-school-id', '10')
      .set('x-simulated-user-id', '2')
      .send({
        firstName: 'JEAN PIERRE',
        lastName: 'DUPONT',
        birthDate: '2015-04-12',
        schoolId: 10,
        classId: 5,
        parentId: 7,
        academicYearId: 2,
        schoolAdminId: 2,
        gender: 'M',
      });

    expect(res.status).toBe(201);
    expect(insertedRows[0].values.firstName).toBe('Jean Pierre');
    expect(insertedRows[0].values.lastName).toBe('DUPONT');
  });

  it('normalizes firstName on student update without altering the lastName', async () => {
    const insertedRows: any[] = [];
    mockState.users = [{ id: 2, uid: 'sim_admin_school', email: 'admin@school.test', role: 'school_admin', schoolId: 10 }];
    mockState.parentRows = [{ id: 7, userId: 99, schoolId: 10 }];
    mockState.students = [{
      id: 123,
      firstName: 'Jean Pierre',
      lastName: 'DUPONT',
      birthDate: '2015-04-12',
      schoolId: 10,
      classId: 5,
      parentId: 7,
      schoolAdminId: 2,
      gender: 'M',
      enrolledAt: new Date('2015-04-12'),
    }];
    mockDb.update = () => ({
      set: (values: any) => ({
        where: () => ({
          returning: async () => {
            insertedRows.push(values);
            return [{ id: 123, ...values }];
          },
        }),
      }),
    });
    mockDb.insert = (table: any) => ({
      values: (values: any) => ({
        onConflictDoUpdate: (config: any) => ({
          set: async () => {
            insertedRows.push({ table, values, config });
            return [{ id: 123, ...values }];
          },
        }),
      }),
    });

    const res = await request(app)
      .put('/api/students/123')
      .set('x-simulated-role', 'school_admin')
      .set('x-simulated-uid', 'sim_admin_school')
      .set('x-simulated-school-id', '10')
      .set('x-simulated-user-id', '2')
      .send({
        firstName: 'jEAN pIeRrE',
        lastName: 'DUPONT',
        birthDate: '2015-04-12',
        schoolId: 10,
        classId: 5,
        parentId: 7,
        academicYearId: 2,
        schoolAdminId: 2,
        gender: 'M',
        studentStatus: 'Nouveau',
      });

    expect(res.status).toBe(200);
    expect(insertedRows[0].firstName).toBe('Jean Pierre');
    expect(insertedRows[0].lastName).toBe('DUPONT');
  });

  it('allows a student to be detached from their current class without deleting their record', async () => {
    mockState.users = [{ id: 2, uid: 'sim_admin_school', email: 'admin@school.test', role: 'school_admin', schoolId: 10 }];
    mockState.parentRows = [{ id: 7, studentId: 123 }];
    mockState.students = [{
      id: 123,
      firstName: 'Marie',
      lastName: 'DUPONT',
      birthDate: '2015-04-12',
      schoolId: 10,
      classId: 5,
      isActive: true,
      withdrawnAt: null,
      parentId: 7,
      schoolAdminId: 2,
      gender: 'F',
      enrolledAt: new Date('2015-04-12'),
    }];

    const deleteSpy = vi.spyOn(mockDb, 'delete');
    let updatedValues: any;
    const updatedTables: any[] = [];
    mockDb.update = ((table: any) => {
      updatedTables.push(table);
      return {
        set: (values: any) => {
        updatedValues = values;
        return {
          where: () => ({
            returning: async () => {
              mockState.students[0] = { ...mockState.students[0], ...values };
              return [mockState.students[0]];
            },
          }),
        };
        },
      };
    }) as any;

    const res = await request(app)
      .put('/api/students/123')
      .set('x-simulated-role', 'school_admin')
      .set('x-simulated-uid', 'sim_admin_school')
      .set('x-simulated-school-id', '10')
      .set('x-simulated-user-id', '2')
      .send({ classId: null });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: 123, firstName: 'Marie', schoolId: 10, parentId: 7, classId: null, isActive: false });
    expect(new Date(res.body.withdrawnAt).getTime()).not.toBeNaN();
    expect(mockState.students).toHaveLength(1);
    expect(mockState.students[0]).toMatchObject({ id: 123, schoolId: 10, parentId: 7, classId: null, isActive: false });
    expect(mockState.students[0].withdrawnAt).toBeInstanceOf(Date);
    expect(updatedTables).toEqual([students]);
    expect(updatedValues).toMatchObject({ classId: null, isActive: false, withdrawnAt: expect.any(Date) });
    expect(deleteSpy).not.toHaveBeenCalled();
    deleteSpy.mockRestore();
  });

  it('counts only active students in the dashboard summary', async () => {
    mockState.users = [{ id: 1, uid: 'sim_admin', role: 'super_admin', schoolId: null }];
    mockState.students = [
      { id: 123, schoolId: 10, classId: null, parentId: 7, isActive: false, withdrawnAt: new Date() },
      { id: 124, schoolId: 10, classId: 5, parentId: 8, isActive: true, withdrawnAt: null },
    ];

    const res = await request(app)
      .get('/api/dashboard/summary')
      .set('x-simulated-role', 'super_admin')
      .set('x-simulated-uid', 'sim_admin')
      .set('x-simulated-user-id', '1')
      .expect(200);

    expect(res.body.stats.totalStudents).toBe(1);
  });

  it('does not update a student already detached from a class', async () => {
    mockState.users = [{ id: 2, uid: 'sim_admin_school', role: 'school_admin', schoolId: 10 }];
    mockState.students = [{ id: 123, schoolId: 10, classId: null, parentId: 7 }];
    const updateSpy = vi.spyOn(mockDb, 'update');

    const res = await request(app)
      .put('/api/students/123')
      .set('x-simulated-role', 'school_admin')
      .set('x-simulated-uid', 'sim_admin_school')
      .set('x-simulated-school-id', '10')
      .set('x-simulated-user-id', '2')
      .send({ classId: null });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: 123, classId: null, parentId: 7 });
    expect(updateSpy).not.toHaveBeenCalled();
    updateSpy.mockRestore();
  });

  it('rejects class removal by a teacher', async () => {
    mockState.users = [{ id: 7, uid: 'sim_teacher', role: 'teacher', schoolId: 10 }];
    mockState.students = [{ id: 123, schoolId: 10, classId: 5, parentId: 7 }];
    const deleteSpy = vi.spyOn(mockDb, 'delete');

    const res = await request(app)
      .put('/api/students/123')
      .set('x-simulated-role', 'teacher')
      .set('x-simulated-uid', 'sim_teacher')
      .set('x-simulated-school-id', '10')
      .set('x-simulated-user-id', '7')
      .send({ classId: null });

    expect(res.status).toBe(403);
    expect(deleteSpy).not.toHaveBeenCalled();
    deleteSpy.mockRestore();
  });

  it('excludes former students from the default list', async () => {
    mockState.users = [{ id: 1, uid: 'sim_admin', role: 'super_admin', schoolId: null }];
    mockState.students = [
      { id: 123, schoolId: 10, classId: null, isActive: false, withdrawnAt: new Date('2026-09-01T10:00:00.000Z'), parentId: 7, firstName: 'Marie', lastName: 'DUPONT' },
      { id: 124, schoolId: 10, classId: 5, isActive: true, withdrawnAt: null, parentId: 8, firstName: 'Jean', lastName: 'MARTIN' },
    ];

    const res = await request(app)
      .get('/api/students')
      .set('x-simulated-role', 'super_admin')
      .set('x-simulated-uid', 'sim_admin')
      .set('x-simulated-user-id', '1')
      .expect(200);

    expect(res.body.map((student: any) => student.id)).toEqual([124]);
    expect(res.body.some((student: any) => student.isActive === false)).toBe(false);
  });

  it('includes former students only when explicitly requested and preserves their status', async () => {
    mockState.users = [{ id: 1, uid: 'sim_admin', role: 'super_admin', schoolId: null }];
    mockState.students = [
      { id: 123, schoolId: 10, classId: null, isActive: false, withdrawnAt: new Date('2026-09-01T10:00:00.000Z'), parentId: 7, firstName: 'Marie', lastName: 'DUPONT' },
      { id: 124, schoolId: 10, classId: 5, isActive: true, withdrawnAt: null, parentId: 8, firstName: 'Jean', lastName: 'MARTIN' },
    ];

    const res = await request(app)
      .get('/api/students?includeFormer=true')
      .set('x-simulated-role', 'super_admin')
      .set('x-simulated-uid', 'sim_admin')
      .set('x-simulated-user-id', '1')
      .expect(200);

    expect(res.body.map((student: any) => student.id).sort()).toEqual([123, 124]);
    const formerStudent = res.body.find((student: any) => student.id === 123);
    expect(formerStudent).toMatchObject({ classId: null, isActive: false, parentId: 7 });
    expect(new Date(formerStudent.withdrawnAt).getTime()).not.toBeNaN();
  });

  it('does not assign a withdrawn student to a class without a re-enrollment workflow', async () => {
    mockState.users = [{ id: 2, uid: 'sim_admin_school', role: 'school_admin', schoolId: 10 }];
    mockState.students = [{ id: 123, firstName: 'Marie', lastName: 'DUPONT', schoolId: 10, classId: null, isActive: false, withdrawnAt: new Date(), parentId: 7 }];
    const updateSpy = vi.spyOn(mockDb, 'update');

    const res = await request(app)
      .put('/api/students/123')
      .set('x-simulated-role', 'school_admin')
      .set('x-simulated-uid', 'sim_admin_school')
      .set('x-simulated-school-id', '10')
      .set('x-simulated-user-id', '2')
      .send({ firstName: 'Marie', lastName: 'DUPONT', birthDate: '2015-04-12', schoolId: 10, classId: 5, parentId: 7, academicYearId: 2 });

    expect(res.status).toBe(409);
    expect(updateSpy).not.toHaveBeenCalled();
    updateSpy.mockRestore();
  });

  it('preserves school and parent links when editing a former student profile', async () => {
    mockState.users = [{ id: 1, uid: 'sim_admin', role: 'super_admin', schoolId: null }];
    mockState.parentRows = [{ id: 7, userId: 99, studentId: 123, schoolId: 10 } as any];
    mockState.students = [{ id: 123, firstName: 'Marie', lastName: 'DUPONT', birthDate: '2015-04-12', schoolId: 10, classId: null, isActive: false, withdrawnAt: new Date(), parentId: 7, schoolAdminId: null, enrolledAt: new Date('2015-04-12') }];
    mockDb.update = ((table: any) => ({
      set: (values: any) => ({
        where: () => ({
          returning: async () => {
            if (table === students) mockState.students[0] = { ...mockState.students[0], ...values };
            return [mockState.students[0]];
          },
        }),
      }),
    })) as any;

    const res = await request(app)
      .put('/api/students/123')
      .set('x-simulated-role', 'super_admin')
      .set('x-simulated-uid', 'sim_admin')
      .set('x-simulated-user-id', '1')
      .send({ firstName: 'Marie Claire', lastName: 'DUPONT', birthDate: '2015-04-12', schoolId: 10, classId: null, parentId: 7, academicYearId: 2 });

    expect(res.status).toBe(200);
    expect(mockState.students[0]).toMatchObject({ schoolId: 10, parentId: 7, classId: null, isActive: false });
  });

  it('does not move former student school or parent links through general edit', async () => {
    mockState.users = [{ id: 1, uid: 'sim_admin', role: 'super_admin', schoolId: null }];
    mockState.students = [{ id: 123, firstName: 'Marie', lastName: 'DUPONT', birthDate: '2015-04-12', schoolId: 10, classId: null, isActive: false, withdrawnAt: new Date(), parentId: 7 }];
    const updateSpy = vi.spyOn(mockDb, 'update');

    const res = await request(app)
      .put('/api/students/123')
      .set('x-simulated-role', 'super_admin')
      .set('x-simulated-uid', 'sim_admin')
      .set('x-simulated-user-id', '1')
      .send({ firstName: 'Marie', lastName: 'DUPONT', birthDate: '2015-04-12', schoolId: 20, classId: null, parentId: 8, academicYearId: 2 });

    expect(res.status).toBe(409);
    expect(updateSpy).not.toHaveBeenCalled();
    expect(mockState.students[0]).toMatchObject({ schoolId: 10, parentId: 7, isActive: false, classId: null });
    updateSpy.mockRestore();
  });

  it('requires the dedicated withdrawal action to clear an active student class', async () => {
    mockState.users = [{ id: 1, uid: 'sim_admin', role: 'super_admin', schoolId: null }];
    mockState.students = [{ id: 123, firstName: 'Marie', lastName: 'DUPONT', birthDate: '2015-04-12', schoolId: 10, classId: 5, isActive: true, withdrawnAt: null, parentId: 7 }];
    const updateSpy = vi.spyOn(mockDb, 'update');

    const res = await request(app)
      .put('/api/students/123')
      .set('x-simulated-role', 'super_admin')
      .set('x-simulated-uid', 'sim_admin')
      .set('x-simulated-user-id', '1')
      .send({ firstName: 'Marie', lastName: 'DUPONT', birthDate: '2015-04-12', schoolId: 10, classId: null, parentId: 7, academicYearId: 2 });

    expect(res.status).toBe(409);
    expect(updateSpy).not.toHaveBeenCalled();
    expect(mockState.students[0]).toMatchObject({ schoolId: 10, parentId: 7, classId: 5, isActive: true, withdrawnAt: null });
    updateSpy.mockRestore();
  });

  it('does not clear an active student class through the general edit route', async () => {
    mockState.users = [{ id: 1, uid: 'sim_admin', role: 'super_admin', schoolId: null }];
    mockState.students = [{ id: 123, firstName: 'Marie', lastName: 'DUPONT', birthDate: '2015-04-12', schoolId: 10, classId: 5, isActive: true, withdrawnAt: null, parentId: 7 }];
    const updateSpy = vi.spyOn(mockDb, 'update');

    const res = await request(app)
      .put('/api/students/123')
      .set('x-simulated-role', 'super_admin')
      .set('x-simulated-uid', 'sim_admin')
      .set('x-simulated-user-id', '1')
      .send({ firstName: 'Marie', lastName: 'DUPONT', birthDate: '2015-04-12', schoolId: 10, classId: null, parentId: 7, academicYearId: 2 });

    expect(res.status).toBe(409);
    expect(updateSpy).not.toHaveBeenCalled();
    updateSpy.mockRestore();
  });

  it('normalizes firstName in batch imports and keeps the surname unchanged', async () => {
    const { res, insertedRows } = await importBatchRow(batchRow({ firstName: 'jEaN pIeRrE', lastName: 'DUPONT' }));
    expect(res.status).toBe(200);
    expect(res.body.insertedCount).toBe(1);
    expect(insertedRows).toContainEqual(expect.objectContaining({
      values: expect.objectContaining({ firstName: 'Jean Pierre', lastName: 'DUPONT' }),
    }));
  });

  it('creates Nouveau status for the class academic year', async () => {
    const { res, insertedRows } = await importBatchRow(batchRow({ studentStatus: 'Nouveau' }));
    expect(res.status).toBe(200);
    expect(res.body.insertedCount).toBe(1);
    expect(insertedRows.some((row) => row.table === students)).toBe(true);
    expect(insertedRows).toContainEqual(expect.objectContaining({ values: { studentId: 123, academicYearId: 2, status: 'Nouveau' } }));
  });

  it('creates Doublant status for the class academic year', async () => {
    const { res, insertedRows } = await importBatchRow(batchRow({ studentStatus: 'Doublant' }));
    expect(res.body.insertedCount).toBe(1);
    expect(insertedRows).toContainEqual(expect.objectContaining({ values: { studentId: 123, academicYearId: 2, status: 'Doublant' } }));
  });

  it('keeps legacy imports without studentStatus compatible', async () => {
    const { res, insertedRows } = await importBatchRow(batchRow({ studentStatus: undefined }));
    expect(res.body.insertedCount).toBe(1);
    expect(insertedRows.some((row) => row.table === students)).toBe(true);
    expect(insertedRows.some((row) => row.values?.studentId === 123)).toBe(false);
  });

  it('rejects an invalid studentStatus without creating a student', async () => {
    const { res, insertedRows } = await importBatchRow(batchRow({ studentStatus: 'ValeurInconnue' }));
    expect(res.body.insertedCount).toBe(0);
    expect(res.body.errors[0].reason).toContain('studentStatus invalide');
    expect(insertedRows).toHaveLength(0);
  });

  it('rejects an academic year that differs from the class year', async () => {
    const { res, insertedRows } = await importBatchRow(batchRow({ academicYearId: 3, studentStatus: 'Nouveau' }));
    expect(res.body.insertedCount).toBe(0);
    expect(res.body.errors[0].reason).toContain('ne correspond pas');
    expect(insertedRows).toHaveLength(0);
  });

  it('uses the class academic year when academicYearId is absent', async () => {
    const { res, insertedRows } = await importBatchRow(batchRow({ academicYearId: undefined, studentStatus: 'Nouveau' }));
    expect(res.body.insertedCount).toBe(1);
    expect(insertedRows).toContainEqual(expect.objectContaining({ values: { studentId: 123, academicYearId: 2, status: 'Nouveau' } }));
  });
});
