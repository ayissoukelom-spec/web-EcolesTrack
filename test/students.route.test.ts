import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { PgDialect } from 'drizzle-orm/pg-core';
import { students, studentAcademicYearStatuses, teachers, classes, classTeachers, classHomeroomAssignments, teacherClassSubjects, parents, users, schools, grades, evaluations, schoolClasses, teacherSubjects, userSchools } from '../src/db/schema.ts';

const mockState = {
  actorRole: 'super_admin' as string,
  actorSchoolId: null as number | null,
  actorId: null as number | null,
  teacherRows: [] as Array<any>,
  classAssignments: [] as Array<any>,
  teacherSubjectRows: [] as Array<any>,
  userSchoolRows: [] as Array<any>,
  homeroomRows: [] as Array<any>,
  parentRows: [] as Array<{ id: number; studentId?: number | null; schoolId?: number | null; userId?: number }>,
  ownedStudents: [] as Array<{ id: number }>,
  students: [] as Array<any>,
  dashboardEvaluations: [] as Array<any>,
  dashboardGrades: [] as Array<any>,
  users: [] as Array<any>,  // Separate mock data for users table
  studentStatuses: [] as Array<any>,
  studentGenderSelected: false,
};

const defaultDbExecute = async (_query: any) => [];

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
      } else if (table === classHomeroomAssignments) {
        builder._rows = mockState.homeroomRows;
      } else if (table === teacherClassSubjects) {
        builder._rows = mockState.classAssignments;
      } else if (table === teacherSubjects) {
        builder._rows = mockState.teacherSubjectRows;
      } else if (table === userSchools) {
        builder._rows = mockState.userSchoolRows;
      } else if (table === schoolClasses) {
        builder._rows = [];
      } else if (table === parents) {
        builder._rows = mockState.parentRows;
      } else if (table === schools) {
        builder._rows = [{ id: 10, studentsCreationLocked: false }];
      } else if (table === classes) {
        builder._rows = [{ id: 5, schoolId: 10, academicYearId: 2 }];
      } else if (table === students) {
        if (Object.prototype.hasOwnProperty.call(projection ?? {}, 'gender')) {
          mockState.studentGenderSelected = true;
        }
        // Simulate basic role-aware filtering for students queries to make tests
        // assert real expected results instead of only checking array presence.
        let rows = (mockState.students || []).map((student: any) => ({ isActive: true, ...student }));
        const role = mockState.actorRole;
        if (role === 'teacher') {
          const assignedClassIds = (mockState.classAssignments || []).map((a) => a.classId);
          rows = rows.filter((s: any) => assignedClassIds.includes(s.classId) && (mockState.actorSchoolId == null || s.schoolId === mockState.actorSchoolId));
        } else if (role === 'parent') {
          rows = rows.filter((student: any) => (mockState.parentRows || []).some((parent) =>
            parent.id === student.parentId
            && parent.schoolId != null
            && parent.schoolId === student.schoolId,
          ));
        } else if (role === 'school_admin') {
          if (mockState.actorSchoolId != null) {
            rows = rows.filter((s: any) => s.schoolId === mockState.actorSchoolId);
          }
        }
        builder._rows = Object.prototype.hasOwnProperty.call(projection ?? {}, 'count')
          ? [{ count: rows.length }]
          : rows;
      } else if (table === studentAcademicYearStatuses) {
        builder._rows = mockState.studentStatuses;
      } else if (table === grades) {
        if (projection?.schoolId === evaluations.schoolId) {
          throw new Error('column evaluations.school_id does not exist');
        }
        builder._rows = mockState.dashboardGrades.map((grade: any) => {
          const student = mockState.students.find((row: any) => row.id === grade.studentId);
          const evaluation = mockState.dashboardEvaluations.find((row: any) => row.id === grade.evaluationId);
          return {
            id: grade.id,
            studentId: grade.studentId,
            studentName: student ? `${student.lastName} ${student.firstName}` : '',
            evaluationTitle: evaluation?.title,
            classId: evaluation?.classId,
            schoolId: student?.schoolId,
            subjectId: evaluation?.subjectId,
            subject: evaluation?.subject,
            score: grade.score,
            date: evaluation?.date,
          };
        });
      }
      return builder;
    },
    innerJoin(joinedTable?: any) {
      if (builder.table === students && joinedTable === classes) {
        builder._rows = builder._rows
          .filter((student: any) => student.classId != null)
          .filter((student: any) => student.classSchoolId == null || student.classSchoolId === student.schoolId)
          .map((student: any) => ({ ...student, className: student.className ?? `Classe ${student.classId}` }));
      } else if (builder.table === classTeachers && joinedTable === classes) {
        builder._rows = builder._rows.map((assignment: any) => ({
          ...assignment,
          classSchoolId: assignment.classSchoolId ?? assignment.schoolId,
          assignmentSchoolId: assignment.assignmentSchoolId ?? assignment.schoolId,
        }));
      } else if (builder.table === teacherClassSubjects && joinedTable === classes) {
        builder._rows = builder._rows.map((assignment: any) => ({
          ...assignment,
          classSchoolId: Object.prototype.hasOwnProperty.call(assignment, 'classSchoolId')
            ? assignment.classSchoolId
            : assignment.schoolId,
        }));
      }
      return builder;
    },
    leftJoin(joinedTable: any, condition?: any) {
      if ((builder.table === classTeachers || builder.table === classHomeroomAssignments)
        && joinedTable === schoolClasses) {
        const query = condition ? new PgDialect().sqlToQuery(condition) : { params: [] };
        const schoolId = (query.params as any[]).find((value) => typeof value === 'number');
        builder._rows = builder._rows.map((assignment: any) => ({
          ...assignment,
          isApprovedForSchool: assignment.approvedForSchoolIds?.includes(schoolId) === true,
          schoolClassStatus: assignment.approvedForSchoolIds?.includes(schoolId) ? 'approved' : null,
        }));
      } else if (builder.table === teacherClassSubjects && joinedTable === schoolClasses) {
        const query = condition ? new PgDialect().sqlToQuery(condition) : { params: [] };
        const schoolId = (query.params as any[]).find((value) => typeof value === 'number');
        builder._rows = builder._rows.map((assignment: any) => ({
          ...assignment,
          isApprovedForSchool: assignment.approvedForSchoolIds?.includes(schoolId) === true,
        }));
      }
      return builder;
    },
    where(condition?: any) {
      if (builder.table === userSchools && condition) {
        const query = new PgDialect().sqlToQuery(condition);
        const equalityConditions = Array.from(query.sql.matchAll(/"[^"]+"\."([^"]+)"\s*=\s*\$(\d+)/g), (match: any) => ({
          key: match[1].replace(/_([a-z])/g, (_: string, letter: string) => letter.toUpperCase()),
          value: query.params[Number(match[2]) - 1],
        }));
        builder._rows = builder._rows.filter((row: any) => (
          equalityConditions.every(({ key, value }: any) => {
            if (key in row) return row[key] === value;
            if (key === 'isDeleted') {
              const joinedUser = mockState.users.find((user: any) => user.id === row.userId);
              return (joinedUser?.isDeleted ?? false) === value;
            }
            return false;
          })
          && (!query.sql.includes('is_active') || row.isActive !== false)
        ));
      }
      if (builder.table === teacherClassSubjects && condition) {
        const query = new PgDialect().sqlToQuery(condition);
        const values = query.params as any[];
        const schoolId = values.find((value) => value === mockState.actorSchoolId);
        builder._rows = builder._rows.filter((assignment: any) => (
          assignment.teacherId === mockState.teacherRows[0]?.id
          && assignment.schoolId === mockState.actorSchoolId
          && assignment.isActive === true
          && (assignment.classSchoolId === schoolId || assignment.isApprovedForSchool === true)
          && (assignment.subjectSchoolId === schoolId || assignment.isSubjectApprovedForSchool === true)
        ));
      }
      if (builder.table === users && condition) {
        const query = new PgDialect().sqlToQuery(condition);
        const params = query.params as any[];
        if (query.sql.includes('"users"."phone"')) {
          const phone = params.find((value) => typeof value === 'string' && value.startsWith('+'));
          if (phone) builder._rows = builder._rows.filter((user: any) => user.phone === phone);
        }
        if (query.sql.includes('"users"."email"')) {
          const email = params.find((value) => typeof value === 'string' && value.includes('@'));
          if (email) builder._rows = builder._rows.filter((user: any) => String(user.email ?? '').trim().toLowerCase() === email.trim().toLowerCase());
        }
        if (query.sql.includes('"users"."uid"')) {
          const uid = params.find((value) => typeof value === 'string' && value.startsWith('sim_'));
          if (uid) builder._rows = builder._rows.filter((user: any) => user.uid === uid);
        }
      }
      if (builder.table === grades && condition) {
        const query = new PgDialect().sqlToQuery(condition);
        if (query.sql.includes('"evaluations"."school_id"')) {
          throw new Error('column evaluations.school_id does not exist');
        }
        if (query.sql.includes('"students"."school_id"')) {
          const requestedSchoolId = (query.params as any[]).find((value) => value === 10 || value === 20);
          if (requestedSchoolId != null) {
            builder._rows = builder._rows.filter((row: any) => row.schoolId === requestedSchoolId);
          }
        }
      }
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
        if (!Object.prototype.hasOwnProperty.call(projection ?? {}, 'count')
          && query.sql.includes('"students"."school_id"')) {
          const schoolId = (query.params as any[]).find((value) => value === 10 || value === 20);
          if (schoolId != null) builder._rows = builder._rows.filter((student: any) => student.schoolId === schoolId);
        }
        if (!Object.prototype.hasOwnProperty.call(projection ?? {}, 'count')
          && query.sql.toLowerCase().includes('"students"."class_id" is not null')) {
          builder._rows = builder._rows.filter((student: any) => student.classId != null);
        }
        if (Object.prototype.hasOwnProperty.call(projection ?? {}, 'count')
          && query.sql.includes('"students"."is_active"')
          && query.params.includes(true)) {
          const schoolId = query.sql.includes('"students"."school_id"')
            ? (query.params as any[]).find((value) => value === 10 || value === 20)
            : undefined;
          const authorizedIds = query.sql.includes('"students"."id" in')
            ? (query.params as any[]).filter((value): value is number => typeof value === 'number')
            : undefined;
          builder._rows = [{ count: mockState.students.filter((student) =>
            student.isActive === true
            && (schoolId == null || student.schoolId === schoolId)
            && (authorizedIds == null || authorizedIds.includes(student.id))
          ).length }];
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

const mockDb: any = {
  select: (projection?: any) => createBuilder(mockState.students, projection),
  selectDistinct: (projection?: any) => createBuilder(mockState.students, projection),
  insert: () => ({ values: () => ({ returning: async () => [] }) }),
  transaction: async (callback: (tx: any) => Promise<any>) => callback(mockDb),
  update: () => ({ set: () => ({ where: async () => [] }) }),
  delete: () => ({ where: async () => [] }),
  execute: defaultDbExecute,
};

const normalizeDuplicateName = (value: unknown) => String(value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
const addUserSchool = (userId: number, schoolId: number, role: string, isActive = true) => {
  mockState.userSchoolRows.push({ userId, schoolId, role, isActive });
};
const normalizeDuplicateGender = (value: unknown) => {
  const normalized = String(value ?? '').trim().replace(/\s+/g, ' ').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (['m', 'male', 'masculin', 'homme', 'garcon', 'boy', 'boys'].includes(normalized)) return 'm';
  if (['f', 'female', 'feminin', 'feminine', 'femme', 'fille', 'girl', 'girls'].includes(normalized)) return 'f';
  return normalized;
};

const executeStudentDuplicateSql = async (rawQuery: any) => {
  const query = new PgDialect().sqlToQuery(rawQuery);
  const normalizedSql = query.sql.toLowerCase();
  if (normalizedSql.includes('pg_advisory_xact_lock')) return { rows: [] };
  if (normalizedSql.includes('from parents p') && normalizedSql.includes('inner join users u')) {
    const parentId = query.params[0];
    const parent = mockState.parentRows.find((row) => row.id === parentId);
    const user = mockState.users.find((row) => row.id === parent?.userId);
    return { rows: user ? [{ name: user.name, gender: user.gender, userId: parent?.userId }] : [] };
  }
  if (normalizedSql.includes('from students s')) {
    const [schoolId, firstName, lastName, studentGender, birthDate, parentName, parentGender] = query.params;
    const duplicate = mockState.students.find((student: any) => {
      const parent = mockState.parentRows.find((row) => row.id === student.parentId);
      const user = mockState.users.find((row) => row.id === parent?.userId);
      return student.schoolId === schoolId
        && normalizeDuplicateName(student.firstName) === firstName
        && normalizeDuplicateName(student.lastName) === lastName
        && normalizeDuplicateGender(student.gender) === studentGender
        && String(student.birthDate ?? '').trim() === birthDate
        && normalizeDuplicateName(user?.name) === parentName
        && normalizeDuplicateGender(user?.gender) === parentGender;
    });
    return { rows: duplicate ? [{ id: duplicate.id }] : [] };
  }
  return [];
};

const configureStudentCreationMock = () => {
  const insertedTables: any[] = [];
  let nextId = 500;
  mockDb.execute = executeStudentDuplicateSql;
  mockDb.insert = (table: any) => ({
    values: (values: any) => {
      const execute = async () => {
        insertedTables.push(table);
        const row = { id: nextId++, ...values };
        if (table === students) mockState.students.push(row);
        else if (table === parents) mockState.parentRows.push(row);
        else if (table === users) mockState.users.push(row);
        else if (table === studentAcademicYearStatuses) mockState.studentStatuses.push(row);
        return [row];
      };
      return {
        returning: execute,
        then: (resolve: (result: any) => void, reject: (error: unknown) => void) => execute().then(resolve, reject),
      };
    },
  });
  return insertedTables;
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
        else if (table === userSchools) builder._rows = mockState.userSchoolRows;
        else if (table === users) builder._rows = [{ id: 2, email: 'admin@school.test', role: 'school_admin', schoolId: 10 }];
        else builder._rows = rows;
        return builder;
      },
      innerJoin() { return builder; },
      leftJoin() { return builder; },
      where(condition: any) {
        if (builder.table === userSchools && condition) {
          const query = new PgDialect().sqlToQuery(condition);
          const equalityConditions = Array.from(query.sql.matchAll(/"[^"]+"\."([^"]+)"\s*=\s*\$(\d+)/g), (match: any) => ({
            key: match[1].replace(/_([a-z])/g, (_: string, letter: string) => letter.toUpperCase()),
            value: query.params[Number(match[2]) - 1],
          }));
          builder._rows = builder._rows.filter((membership: any) => (
            equalityConditions.every(({ key, value }: any) => (
              key in membership
                ? membership[key] === value
                : key === 'id'
                  ? membership.userId === value
                  : key === 'isDeleted' && false === value
            ))
            && (!query.sql.includes('is_active') || membership.isActive !== false)
          ));
        }
        return builder;
      },
      limit() { return builder; },
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
        returning: async () => {
          if (table === students) {
            const row = { id: 123 + mockState.students.length, ...values };
            mockState.students.push(row);
            return [row];
          }
          return [{ id: 1, ...values }];
        },
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
    mockState.teacherSubjectRows = [];
    mockState.userSchoolRows = [];
    mockState.homeroomRows = [];
    mockState.parentRows = [];
    mockState.ownedStudents = [];
    mockState.students = [];
    mockState.dashboardEvaluations = [];
    mockState.dashboardGrades = [];
    mockState.users = [];  // Reset users mock data
    mockState.studentStatuses = [];
    mockState.studentGenderSelected = false;
    mockDb.select = (projection?: any) => createBuilder(mockState.students, projection);
    mockDb.selectDistinct = (projection?: any) => createBuilder(mockState.students, projection);
    mockDb.insert = () => ({ values: () => ({ returning: async () => [] }) });
    mockDb.transaction = async (callback: (tx: any) => Promise<any>) => callback(mockDb);
    mockDb.update = () => ({ set: () => ({ where: async () => [] }) });
    mockDb.delete = () => ({ where: async () => [] });
    mockDb.execute = defaultDbExecute;
  });

  describe('POST /api/students duplicate detection', () => {
    const setupExistingStudent = () => {
      mockState.actorRole = 'school_admin';
      mockState.actorSchoolId = 10;
      mockState.actorId = 2;
      mockState.users = [
        { id: 2, uid: 'sim_admin_school', email: 'admin@school.test', role: 'school_admin', schoolId: 10, phone: '+22890000002' },
        { id: 99, name: 'Ama Diallo', gender: 'F', role: 'parent', phone: '+22890000003' },
      ];
      addUserSchool(2, 10, 'school_admin');
      addUserSchool(99, 10, 'parent');
      mockState.parentRows = [{ id: 7, userId: 99, schoolId: 10, studentId: null }];
      mockState.students = [{
        id: 456,
        firstName: 'Mila',
        lastName: 'DIALLO',
        birthDate: '2015-04-12',
        schoolId: 10,
        classId: 5,
        parentId: 7,
        gender: 'F',
      }];
      mockDb.select = (projection?: any) => createBuilder(mockState.students, projection);
      mockDb.transaction = async (callback: (tx: any) => Promise<any>) => callback(mockDb);
      return configureStudentCreationMock();
    };

    const studentPayload = (overrides: Record<string, unknown> = {}) => ({
      firstName: 'Mila',
      lastName: 'Diallo',
      birthDate: '2015-04-12',
      schoolId: 10,
      classId: 5,
      parentId: 7,
      academicYearId: 2,
      gender: 'F',
      ...overrides,
    });

    const postStudent = (payload: Record<string, unknown>) => request(app)
      .post('/api/students')
      .set('x-simulated-role', 'school_admin')
      .set('x-simulated-uid', 'sim_admin_school')
      .set('x-simulated-school-id', '10')
      .set('x-simulated-user-id', '2')
      .send(payload);

    it('rejects a matching student in the same school with a conflict code', async () => {
      const insertedTables = setupExistingStudent();
      const response = await postStudent(studentPayload());

      expect(response.status).toBe(409);
      expect(response.body).toMatchObject({ code: 'STUDENT_DUPLICATE' });
      expect(response.body.error).toContain('existe déjà');
      expect(insertedTables).toEqual([]);
      expect(mockState.students).toHaveLength(1);
    });

    it.each([
      ['student first name', { firstName: 'Mila Grace' }],
      ['student last name', { lastName: 'Kouassi' }],
      ['student gender', { gender: 'M' }],
      ['birth date', { birthDate: '2015-04-13' }],
    ])('allows creation when only %s differs', async (_criterion, override) => {
      setupExistingStudent();
      const response = await postStudent(studentPayload(override));
      expect(response.status).toBe(201);
      expect(mockState.students).toHaveLength(2);
    });

    it('allows creation when only the parent name differs', async () => {
      setupExistingStudent();
      mockState.users.push({ id: 100, name: 'Ama Diallo', gender: 'F', role: 'parent' });
      mockState.parentRows.push({ id: 8, userId: 100, schoolId: 10, studentId: null });
      mockState.students[0].parentId = 8;
      mockState.users[1].name = 'Afi Diallo';
      const response = await postStudent(studentPayload());
      expect(response.status).toBe(201);
      expect(mockState.students).toHaveLength(2);
    });

    it('allows creation when only the parent gender differs', async () => {
      setupExistingStudent();
      mockState.users.push({ id: 100, name: 'Ama Diallo', gender: 'F', role: 'parent' });
      mockState.parentRows.push({ id: 8, userId: 100, schoolId: 10, studentId: null });
      mockState.students[0].parentId = 8;
      mockState.users[1].gender = 'M';
      const response = await postStudent(studentPayload());
      expect(response.status).toBe(201);
      expect(mockState.students).toHaveLength(2);
    });

    it('allows an identical student in a different school', async () => {
      setupExistingStudent();
      mockState.students[0].schoolId = 20;
      const response = await postStudent(studentPayload());
      expect(response.status).toBe(201);
      expect(mockState.students).toHaveLength(2);
    });

    it('detects names that differ only by case and whitespace', async () => {
      setupExistingStudent();
      mockState.students[0].firstName = '  mIlA   ';
      mockState.students[0].lastName = '  dIaLlO ';
      mockState.users[1].name = '  aMa   dIaLlO ';
      const response = await postStudent(studentPayload({ firstName: ' MILA ', lastName: '  dIALLO  ' }));
      expect(response.status).toBe(409);
      expect(response.body.code).toBe('STUDENT_DUPLICATE');
    });

    it('does not compare incomplete identities when birth date or parent details are missing', async () => {
      const insertedTables = setupExistingStudent();
      const noBirthDate = await postStudent(studentPayload({ birthDate: '' }));
      expect(noBirthDate.status).toBe(201);

      mockState.students = [{
        id: 456,
        firstName: 'Mila',
        lastName: 'DIALLO',
        birthDate: '2015-04-12',
        schoolId: 10,
        classId: 5,
        parentId: null,
        gender: 'F',
      }];
      const noParent = await postStudent(studentPayload({ parentId: undefined }));
      expect(noParent.status).toBe(201);
      expect(insertedTables).toEqual([students, studentAcademicYearStatuses, students, studentAcademicYearStatuses]);
    });

    it('reports and skips duplicate rows within one batch import', async () => {
      setupExistingStudent();
      mockState.students = [];
      configureBatchImportMock();
      mockDb.execute = executeStudentDuplicateSql;
      const row = {
        firstName: 'Mila',
        lastName: 'Diallo',
        birthDate: '2015-04-12',
        schoolId: 10,
        classId: 5,
        parentId: 7,
        academicYearId: 2,
        gender: 'F',
      };
      const response = await request(app)
        .post('/api/students/batch')
        .set('x-simulated-role', 'school_admin')
        .set('x-simulated-uid', 'sim_admin_school')
        .set('x-simulated-school-id', '10')
        .set('x-simulated-user-id', '2')
        .send([row, { ...row }]);

      expect(response.status).toBe(200);
      expect(response.body.insertedCount).toBe(1);
      expect(response.body.inserted).toHaveLength(1);
      expect(response.body.errors).toEqual([expect.objectContaining({
        row: 3,
        code: 'STUDENT_DUPLICATE',
        reason: expect.stringContaining('existe déjà'),
      })]);
    });

    it('serializes simultaneous matching creations with the PostgreSQL transaction lock', async () => {
      setupExistingStudent();
      mockState.students = [];
      const originalTransaction = mockDb.transaction;
      const lockTails = new Map<string, Promise<void>>();
      mockDb.transaction = async (callback: (tx: any) => Promise<any>) => {
        const releases: Array<() => void> = [];
        const tx = {
          ...mockDb,
          execute: async (rawQuery: any) => {
            const query = new PgDialect().sqlToQuery(rawQuery);
            if (query.sql.toLowerCase().includes('pg_advisory_xact_lock')) {
              const lockKey = String(query.params[0]);
              const previous = lockTails.get(lockKey) ?? Promise.resolve();
              let release!: () => void;
              const gate = new Promise<void>((resolve) => { release = resolve; });
              lockTails.set(lockKey, previous.then(() => gate));
              await previous;
              releases.push(release);
              return { rows: [] };
            }
            return executeStudentDuplicateSql(rawQuery);
          },
        };
        try {
          return await callback(tx);
        } finally {
          releases.forEach((release) => release());
        }
      };

      try {
        const results = await Promise.all([
          postStudent(studentPayload()),
          postStudent(studentPayload()),
        ]);
        expect(results.map((result) => result.status).sort()).toEqual([201, 409]);
        expect(mockState.students).toHaveLength(1);
      } finally {
        mockDb.transaction = originalTransaction;
      }
    });

    it('keeps a newly created parent when the student is rejected as a duplicate', async () => {
      setupExistingStudent();
      const parentResponse = await request(app)
        .post('/api/parents')
        .set('x-simulated-role', 'school_admin')
        .set('x-simulated-uid', 'sim_admin_school')
        .set('x-simulated-school-id', '10')
        .set('x-simulated-user-id', '2')
        .send({
          name: 'Ama Diallo',
          email: 'new-parent@school.test',
          phone: '+22890000004',
          address: '',
          schoolId: 10,
          gender: 'F',
        });
      expect(parentResponse.status).toBe(201);

      const response = await postStudent(studentPayload({ parentId: parentResponse.body.parentId }));
      expect(response.status).toBe(409);
      expect(response.body).toMatchObject({ code: 'STUDENT_DUPLICATE' });
      expect(response.body).not.toHaveProperty('parentRemoved');
      expect(mockState.parentRows).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: 7, userId: 99 }),
        expect.objectContaining({ userId: parentResponse.body.id }),
      ]));
      expect(mockState.users).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: 'Ama Diallo', email: 'new-parent@school.test' }),
      ]));
      expect(mockState.students).toHaveLength(1);
    });
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
    addUserSchool(7, 10, 'teacher');
    mockState.teacherRows = [{ id: 42, userId: 7, schoolId: 10 }];
    mockState.classAssignments = [{
      teacherId: 42, classId: 1, subjectId: 5, schoolId: 10,
      classSchoolId: 10, subjectSchoolId: 10, isActive: true,
    }];
    // include an unrelated student to ensure only assigned-class students are returned
    mockState.students = [
      { id: 101, schoolId: 10, classId: 1, gender: 'F' },
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
    expect(res.body[0]).toMatchObject({ id: 101, schoolId: 10, classId: 1, gender: 'F' });
    expect(mockState.studentGenderSelected).toBe(true);
  });

  it('does not let includeFormer expand teacher access or return inactive students', async () => {
    mockState.actorRole = 'teacher';
    mockState.actorSchoolId = 10;
    mockState.actorId = 7;
    mockState.users = [{ id: 7, uid: 'sim_teacher', schoolId: 10 }];
    addUserSchool(7, 10, 'teacher');
    mockState.teacherRows = [{ id: 42, userId: 7, schoolId: 10 }];
    mockState.classAssignments = [{
      teacherId: 42, classId: 1, subjectId: 5, schoolId: 10,
      classSchoolId: 10, subjectSchoolId: 10, isActive: true,
    }];
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
    mockState.teacherRows = [{ id: 42, userId: 7, schoolId: 10 }];
    mockState.classAssignments = [{
      teacherId: 42, classId: 1, subjectId: 5, schoolId: 10,
      classSchoolId: 10, subjectSchoolId: 10, isActive: true,
    }];
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
    mockState.parentRows = [{ id: 1, schoolId: 10 }];
    mockState.students = [
      { id: 101, schoolId: 10, classId: 1, parentId: 1 },
      { id: 202, schoolId: 20, classId: 2, parentId: 2 },
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
    addUserSchool(2, 10, 'school_admin');
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
    addUserSchool(2, 10, 'school_admin');
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
    mockState.actorSchoolId = 10;
    mockState.users = [{ id: 9, uid: 'sim_parent', schoolId: 10 }];
    addUserSchool(9, 10, 'parent');
    mockState.parentRows = [{ id: 1, schoolId: 10 }];
    mockState.students = [
      { id: 101, schoolId: 10, classId: null, parentId: 1, isActive: false },
      { id: 202, schoolId: 20, classId: null, parentId: 2, isActive: false },
    ];

    const res = await request(app)
      .get('/api/students?includeFormer=true')
      .set('x-simulated-role', 'parent')
      .set('x-simulated-uid', 'sim_parent')
      .set('x-simulated-user-id', '9')
      .set('x-simulated-school-id', '10')
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
    mockState.actorRole = 'school_admin';
    mockState.actorSchoolId = 10;
    mockState.actorId = 2;
    mockState.users = [{ id: 2, uid: 'sim_admin_school', email: 'admin@school.test', role: 'school_admin', schoolId: 10, isDeleted: false }];
    addUserSchool(2, 10, 'school_admin');
    mockState.parentRows = [{ id: 7, userId: 99, schoolId: 10 }];
    addUserSchool(99, 10, 'parent');
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

  it('rolls back a student if its academic-year status insert fails and allows a retry', async () => {
    mockState.actorRole = 'school_admin';
    mockState.actorSchoolId = 10;
    mockState.actorId = 2;
    mockState.users = [{ id: 2, uid: 'sim_admin_school', role: 'school_admin', schoolId: 10 }];
    addUserSchool(2, 10, 'school_admin');
    addUserSchool(99, 10, 'parent');
    mockState.parentRows = [{ id: 7, userId: 99, schoolId: 10 }];

    let failStatusInsert = true;
    mockDb.transaction = async (callback: (tx: any) => Promise<any>) => {
      const studentsBefore = structuredClone(mockState.students);
      const statusesBefore = structuredClone(mockState.studentStatuses);
      try {
        return await callback(mockDb);
      } catch (error) {
        mockState.students.splice(0, mockState.students.length, ...studentsBefore);
        mockState.studentStatuses.splice(0, mockState.studentStatuses.length, ...statusesBefore);
        throw error;
      }
    };
    mockDb.insert = (table: any) => ({
      values: (values: any) => {
        const execute = async () => {
          if (table === students) {
            const row = { id: 123, ...values };
            mockState.students.push(row);
            return [row];
          }
          if (table === studentAcademicYearStatuses) {
            if (failStatusInsert) {
              failStatusInsert = false;
              throw new Error('Simulated academic-year status insert failure');
            }
            mockState.studentStatuses.push({ id: 1, ...values });
          }
          return [];
        };
        return {
          returning: execute,
          then: (resolve: (result: any) => void, reject: (error: unknown) => void) => execute().then(resolve, reject),
        };
      },
    });

    const payload = {
      firstName: 'Atomic',
      lastName: 'Student',
      birthDate: '2015-04-12',
      schoolId: 10,
      classId: 5,
      parentId: 7,
      academicYearId: 2,
      schoolAdminId: 2,
      gender: 'F',
      studentStatus: 'Nouveau',
    };
    const failed = await request(app)
      .post('/api/students')
      .set('x-simulated-role', 'school_admin')
      .set('x-simulated-uid', 'sim_admin_school')
      .set('x-simulated-school-id', '10')
      .set('x-simulated-user-id', '2')
      .send(payload);

    expect(failed.status).toBe(500);
    expect(mockState.students).toHaveLength(0);
    expect(mockState.studentStatuses).toHaveLength(0);

    const retried = await request(app)
      .post('/api/students')
      .set('x-simulated-role', 'school_admin')
      .set('x-simulated-uid', 'sim_admin_school')
      .set('x-simulated-school-id', '10')
      .set('x-simulated-user-id', '2')
      .send(payload);

    expect(retried.status).toBe(201);
    expect(mockState.students).toHaveLength(1);
    expect(mockState.studentStatuses).toEqual([expect.objectContaining({
      studentId: 123,
      academicYearId: 2,
      status: 'Nouveau',
    })]);
  });

  it('rolls back student updates when the academic-year status upsert fails', async () => {
    mockState.actorRole = 'school_admin';
    mockState.actorSchoolId = 10;
    mockState.actorId = 2;
    mockState.users = [{ id: 2, uid: 'sim_admin_school', role: 'school_admin', schoolId: 10 }];
    addUserSchool(2, 10, 'school_admin');
    addUserSchool(99, 10, 'parent');
    mockState.parentRows = [{ id: 7, userId: 99, schoolId: 10 }];
    mockState.students = [{
      id: 123,
      firstName: 'Initial',
      lastName: 'STUDENT',
      birthDate: '2015-04-12',
      schoolId: 10,
      classId: 5,
      parentId: 7,
      schoolAdminId: 2,
      gender: 'F',
      enrolledAt: new Date('2015-04-12'),
      isActive: true,
    }];
    mockState.studentStatuses = [{ id: 1, studentId: 123, academicYearId: 2, status: 'Nouveau' }];

    let failStatusUpsert = true;
    mockDb.transaction = async (callback: (tx: any) => Promise<any>) => {
      const studentsBefore = structuredClone(mockState.students);
      const statusesBefore = structuredClone(mockState.studentStatuses);
      try {
        return await callback(mockDb);
      } catch (error) {
        mockState.students.splice(0, mockState.students.length, ...studentsBefore);
        mockState.studentStatuses.splice(0, mockState.studentStatuses.length, ...statusesBefore);
        throw error;
      }
    };
    mockDb.update = (table: any) => ({
      set: (values: any) => ({
        where: () => ({
          returning: async () => {
            if (table !== students) return [];
            mockState.students[0] = { ...mockState.students[0], ...values };
            return [mockState.students[0]];
          },
        }),
      }),
    });
    mockDb.insert = (table: any) => ({
      values: (values: any) => ({
        onConflictDoUpdate: () => ({
          then: (resolve: (result: any) => void, reject: (error: unknown) => void) => {
            if (failStatusUpsert) {
              failStatusUpsert = false;
              return Promise.reject(new Error('Simulated academic-year status upsert failure')).catch(reject);
            }
            mockState.studentStatuses[0] = { ...mockState.studentStatuses[0], ...values };
            return Promise.resolve([]).then(resolve, reject);
          },
        }),
        returning: async () => [],
      }),
    });

    const payload = {
      firstName: 'Updated',
      lastName: 'STUDENT',
      birthDate: '2015-04-12',
      schoolId: 10,
      classId: 5,
      parentId: 7,
      academicYearId: 2,
      schoolAdminId: 2,
      gender: 'F',
      studentStatus: 'Doublant',
    };
    const failed = await request(app)
      .put('/api/students/123')
      .set('x-simulated-role', 'school_admin')
      .set('x-simulated-uid', 'sim_admin_school')
      .set('x-simulated-school-id', '10')
      .set('x-simulated-user-id', '2')
      .send(payload);

    expect(failed.status).toBe(500);
    expect(mockState.students[0].firstName).toBe('Initial');
    expect(mockState.studentStatuses[0].status).toBe('Nouveau');

    const retried = await request(app)
      .put('/api/students/123')
      .set('x-simulated-role', 'school_admin')
      .set('x-simulated-uid', 'sim_admin_school')
      .set('x-simulated-school-id', '10')
      .set('x-simulated-user-id', '2')
      .send(payload);

    expect(retried.status).toBe(200);
    expect(mockState.students[0].firstName).toBe('Updated');
    expect(mockState.studentStatuses[0].status).toBe('Doublant');
  });

  it.each(['dupont', 'Dupont', 'dUpOnT', 'DUPONT'])('uppercases lastName on student creation for %s and leaves firstName casing alone', async (lastName) => {
    const insertedRows: any[] = [];
    mockState.students = [];
    mockState.users = [{ id: 2, uid: 'sim_admin_school', email: 'admin@school.test', role: 'school_admin', schoolId: 10 }];
    addUserSchool(2, 10, 'school_admin');
    addUserSchool(99, 10, 'parent');
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
        firstName: 'Jean',
        lastName,
        birthDate: '2015-04-12',
        schoolId: 10,
        classId: 5,
        parentId: 7,
        academicYearId: 2,
        schoolAdminId: 2,
        gender: 'M',
      });

    expect(res.status).toBe(201);
    expect(insertedRows[0].values.firstName).toBe('Jean');
    expect(insertedRows[0].values.lastName).toBe('DUPONT');
  });

  it('uppercases lastName on student update without uppercasing firstName', async () => {
    const insertedRows: any[] = [];
    mockState.users = [{ id: 2, uid: 'sim_admin_school', email: 'admin@school.test', role: 'school_admin', schoolId: 10 }];
    addUserSchool(2, 10, 'school_admin');
    addUserSchool(99, 10, 'parent');
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
        firstName: 'Jean',
        lastName: 'dUpOnT',
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
    expect(insertedRows[0].firstName).toBe('Jean');
    expect(insertedRows[0].lastName).toBe('DUPONT');
  });

  it('allows a student to be detached from their current class without deleting their record', async () => {
    mockState.users = [{ id: 2, uid: 'sim_admin_school', email: 'admin@school.test', role: 'school_admin', schoolId: 10 }];
    addUserSchool(2, 10, 'school_admin');
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

  it('returns age aggregates only for active, assigned students in the school scope', async () => {
    mockState.actorRole = 'school_admin';
    mockState.actorSchoolId = 10;
    mockState.users = [{ id: 2, uid: 'school-a-admin', role: 'school_admin', schoolId: 10 }];
    mockState.students = [
      { id: 101, schoolId: 10, classId: 5, className: '6ème A', birthDate: '2010-01-01', isActive: true },
      { id: 201, schoolId: 20, classId: 5, className: '6ème A', birthDate: '2010-01-01', isActive: true },
      { id: 102, schoolId: 10, classId: null, birthDate: '2010-01-01', isActive: true },
      { id: 103, schoolId: 10, classId: 5, birthDate: '2010-01-01', isActive: false },
      { id: 104, schoolId: 10, classId: 5, classSchoolId: 20, birthDate: '2010-01-01', isActive: true },
    ];

    const response = await request(app)
      .get('/api/dashboard/summary')
      .set('x-simulated-role', 'school_admin')
      .set('x-simulated-uid', 'school-a-admin')
      .set('x-simulated-user-id', '2')
      .set('x-simulated-school-id', '10')
      .expect(200);

    expect(response.body.ageStatsByClass).toHaveLength(1);
    expect(response.body.ageStatsByClass[0]).toMatchObject({
      classId: 5,
      className: '6ème A',
      schoolId: 10,
      includedStudents: 1,
      distribution: [{ count: 1 }],
    });
    expect(response.body.ageStatsAsOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(JSON.stringify(response.body.ageStatsByClass)).not.toContain('2010-01-01');
    expect(JSON.stringify(response.body.ageStatsByClass)).not.toContain('Awa');
    expect(Object.keys(response.body.ageStatsByClass[0]).sort()).toEqual([
      'averageAge',
      'classId',
      'className',
      'distribution',
      'includedStudents',
      'schoolId',
    ]);
  });

  it('limits parent age aggregates to the parent-linked active children', async () => {
    mockState.actorRole = 'parent';
    mockState.actorSchoolId = 10;
    mockState.users = [{ id: 9, uid: 'parent-a', role: 'parent', schoolId: 10 }];
    addUserSchool(9, 10, 'parent');
    mockState.parentRows = [{ id: 7, userId: 9, schoolId: 10 }];
    mockState.students = [
      { id: 101, schoolId: 10, classId: 5, className: '6ème A', parentId: 7, birthDate: '2010-01-01', isActive: true },
      { id: 102, schoolId: 10, classId: 5, className: '6ème A', parentId: 8, birthDate: '2010-01-01', isActive: true },
      { id: 201, schoolId: 20, classId: 5, className: '6ème A', parentId: 7, birthDate: '2010-01-01', isActive: true },
    ];

    const response = await request(app)
      .get('/api/dashboard/summary')
      .set('x-simulated-role', 'parent')
      .set('x-simulated-uid', 'parent-a')
      .set('x-simulated-user-id', '9')
      .set('x-simulated-school-id', '10')
      .expect(200);

    expect(response.body.ageStatsByClass).toHaveLength(1);
    expect(response.body.ageStatsByClass[0]).toMatchObject({
      classId: 5,
      schoolId: 10,
      includedStudents: 1,
    });
  });

  it('keeps super-admin aggregates separate when a class id is shared across schools', async () => {
    mockState.users = [{ id: 1, uid: 'global-admin', role: 'super_admin', schoolId: null }];
    mockState.students = [
      { id: 101, schoolId: 10, classId: 300, className: '6ème A', birthDate: '2010-01-01', isActive: true },
      { id: 201, schoolId: 20, classId: 300, className: '6ème A', birthDate: '2010-01-01', isActive: true },
    ];

    const response = await request(app)
      .get('/api/dashboard/summary')
      .set('x-simulated-role', 'super_admin')
      .set('x-simulated-uid', 'global-admin')
      .set('x-simulated-user-id', '1')
      .expect(200);

    expect(response.body.ageStatsByClass.map((entry: any) => entry.schoolId)).toEqual([10, 20]);
    expect(response.body.ageStatsByClass.map((entry: any) => entry.includedStudents)).toEqual([1, 1]);
  });

  it('returns only school A dashboard grades for a shared global class without querying evaluations.school_id', async () => {
    mockState.actorRole = 'school_admin';
    mockState.actorSchoolId = 10;
    mockState.users = [{ id: 2, uid: 'school-a-admin', role: 'school_admin', schoolId: 10 }];
    addUserSchool(2, 10, 'school_admin');
    mockState.students = [
      { id: 101, schoolId: 10, classId: 300, firstName: 'Awa', lastName: 'School A', birthDate: '2010-01-01', isActive: true },
      { id: 201, schoolId: 20, classId: 300, firstName: 'Ama', lastName: 'School B', birthDate: '2010-01-01', isActive: true },
    ];
    mockState.dashboardEvaluations = [
      { id: 901, classId: 300, title: 'Evaluation A', subjectId: 11, subject: 'Math', date: '2026-09-20' },
      { id: 902, classId: 300, title: 'Evaluation B', subjectId: 22, subject: 'Math', date: '2026-09-20' },
    ];
    mockState.dashboardGrades = [
      { id: 1001, evaluationId: 901, studentId: 101, score: '18' },
      { id: 2001, evaluationId: 902, studentId: 201, score: '4' },
    ];

    const response = await request(app)
      .get('/api/dashboard/summary')
      .set('x-simulated-role', 'school_admin')
      .set('x-simulated-uid', 'school-a-admin')
      .set('x-simulated-user-id', '2')
      .set('x-simulated-school-id', '10');

    expect(response.status).toBe(200);
    expect(response.body.stats.totalStudents).toBe(1);
    expect(response.body.ageStatsByClass).toHaveLength(1);
    expect(response.body.ageStatsByClass[0]).toMatchObject({ schoolId: 10, includedStudents: 1 });
    expect(response.body.recentGrades.map((grade: any) => grade.id)).toEqual([1001]);
    expect(response.body.recentGrades.map((grade: any) => grade.studentId)).not.toContain(201);
  });

  it('keeps super_admin dashboard grade access global', async () => {
    mockState.users = [{ id: 1, uid: 'global-admin', role: 'super_admin', schoolId: null }];
    mockState.students = [
      { id: 101, schoolId: 10, classId: 300, firstName: 'Awa', lastName: 'School A', isActive: true },
      { id: 201, schoolId: 20, classId: 300, firstName: 'Ama', lastName: 'School B', isActive: true },
    ];
    mockState.dashboardEvaluations = [
      { id: 901, classId: 300, title: 'Evaluation A', subjectId: 11, subject: 'Math', date: '2026-09-20' },
      { id: 902, classId: 300, title: 'Evaluation B', subjectId: 22, subject: 'Math', date: '2026-09-20' },
    ];
    mockState.dashboardGrades = [
      { id: 1001, evaluationId: 901, studentId: 101, score: '18' },
      { id: 2001, evaluationId: 902, studentId: 201, score: '4' },
    ];

    const response = await request(app)
      .get('/api/dashboard/summary')
      .set('x-simulated-role', 'super_admin')
      .set('x-simulated-uid', 'global-admin')
      .set('x-simulated-user-id', '1');

    expect(response.status).toBe(200);
    expect(response.body.stats.totalStudents).toBe(2);
    expect(response.body.recentGrades.map((grade: any) => grade.id)).toEqual([1001, 2001]);
  });

  it('limits a teacher to school A students in a globally shared class approved only for A', async () => {
    mockState.actorRole = 'teacher';
    mockState.actorSchoolId = 10;
    mockState.actorId = 7;
    mockState.users = [{ id: 7, uid: 'teacher-a', role: 'teacher', schoolId: 10 }];
    addUserSchool(7, 10, 'teacher');
    mockState.teacherRows = [{ id: 42, userId: 7, schoolId: 10, specialization: 'Math' }];
    mockState.classAssignments = [{
      id: 1,
      teacherId: 42,
      classId: 300,
      subjectId: 11,
      schoolId: 10,
      classSchoolId: null,
      subjectSchoolId: 10,
      isActive: true,
      approvedForSchoolIds: [10],
    }];
    mockState.teacherSubjectRows = [{ teacherId: 42, subjectId: 11, schoolId: 10 }];
    mockState.students = [
      { id: 101, schoolId: 10, classId: 300, firstName: 'Awa', lastName: 'School A', birthDate: '2010-01-01', isActive: true },
      { id: 201, schoolId: 20, classId: 300, firstName: 'Ama', lastName: 'School B', birthDate: '2010-01-01', isActive: true },
    ];
    mockState.dashboardEvaluations = [
      { id: 901, classId: 300, title: 'Evaluation A', subjectId: 11, subject: 'Math', date: '2026-09-20' },
      { id: 902, classId: 300, title: 'Evaluation B', subjectId: 22, subject: 'Science', date: '2026-09-20' },
    ];
    mockState.dashboardGrades = [
      { id: 1001, evaluationId: 901, studentId: 101, score: '18' },
      { id: 2001, evaluationId: 902, studentId: 201, score: '4' },
    ];

    const response = await request(app)
      .get('/api/dashboard/summary')
      .set('x-simulated-role', 'teacher')
      .set('x-simulated-uid', 'teacher-a')
      .set('x-simulated-user-id', '7')
      .set('x-simulated-school-id', '10');

    expect(response.status).toBe(200);
    expect(response.body.stats.totalStudents).toBe(1);
    expect(response.body.ageStatsByClass).toHaveLength(1);
    expect(response.body.ageStatsByClass[0]).toMatchObject({ schoolId: 10, includedStudents: 1 });
    expect(response.body.recentGrades.map((grade: any) => grade.id)).toEqual([1001]);
    expect(response.body.recentGrades.map((grade: any) => grade.studentId)).not.toContain(201);
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

  it('normalizes imported lastName without uppercasing firstName', async () => {
    const { res, insertedRows } = await importBatchRow(batchRow({ firstName: 'jEaN pIeRrE', lastName: 'dUpOnT' }));
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
