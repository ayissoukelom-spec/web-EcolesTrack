import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { PgDialect } from 'drizzle-orm/pg-core';
import {
  absenceJustifications,
  absenceDeclarations,
  absenceControls,
  absences,
  classes,
  classHomeroomAssignments,
  lateArrivals,
  parents,
  studentAcademicYearStatuses,
  students,
  teacherClassSubjects,
  teachers,
  users,
  userSchools,
} from '../src/db/schema.ts';

const mockState = {
  actorUserId: 7,
  actorTeacherId: 11,
  actorSchoolId: 1,
  users: [{ id: 7, uid: 'sim-teacher', email: 'teacher@example.com', name: 'Teacher', role: 'teacher', schoolId: 1, isDeleted: false }],
  userSchools: [{ userId: 7, schoolId: 1, role: 'teacher', isActive: true }] as Array<{
    userId: number;
    schoolId: number;
    role: string;
    isActive: boolean | null;
  }>,
  assignments: [
    { id: 101, teacherId: 11, schoolId: 1, classId: 10, subjectId: 5, isActive: true },
    { id: 102, teacherId: 12, schoolId: 1, classId: 10, subjectId: 5, isActive: true },
  ],
  teachingClassIds: [10],
  homeroomClassIds: [] as number[],
  subjectIds: [5],
  students: [{ id: 20, schoolId: 1, classId: 10, firstName: 'Awa', lastName: 'Test', isActive: true, parentId: null }],
  classes: [{ id: 10, schoolId: 1 }],
  lateArrivals: [] as any[],
  absences: [] as any[],
  declarations: [] as any[],
  justifications: [] as any[],
  updates: [] as Array<{ table: any; values: Record<string, any> }>,
  absenceWhereQueries: [] as Array<{ sql: string; params: unknown[] }>,
  lateArrivalWhereQueries: [] as Array<{ sql: string; params: unknown[] }>,
};

const switchToSecondTeacher = () => {
  mockState.actorUserId = 8;
  mockState.actorTeacherId = 12;
  mockState.users = [{ id: 8, uid: 'sim-teacher-2', email: 'teacher-2@example.com', name: 'Teacher 2', role: 'teacher', schoolId: 1, isDeleted: false }];
  mockState.userSchools = [{ userId: 8, schoolId: 1, role: 'teacher', isActive: true }];
};

const tableRows = (table: any) => table === users ? mockState.users
    : table === userSchools ? mockState.userSchools
      : table === teachers ? [{ id: mockState.actorTeacherId, userId: mockState.actorUserId, schoolId: mockState.actorSchoolId }]
        : table === teacherClassSubjects ? mockState.assignments.filter((assignment) =>
          assignment.teacherId === mockState.actorTeacherId
          && assignment.schoolId === mockState.actorSchoolId
          && mockState.teachingClassIds.includes(assignment.classId)
          && mockState.subjectIds.includes(assignment.subjectId),
        )
          : table === classHomeroomAssignments ? mockState.homeroomClassIds.map((classId) => ({
            classId,
            schoolId: mockState.actorSchoolId,
            teacherId: mockState.actorTeacherId,
            classSchoolId: mockState.actorSchoolId,
          }))
    : table === students ? mockState.students
      : table === classes ? mockState.classes
          : table === lateArrivals ? mockState.lateArrivals
        : table === absences ? mockState.absences
          : table === absenceJustifications ? mockState.justifications
            : table === studentAcademicYearStatuses ? []
              : table === absenceDeclarations ? mockState.declarations
                : table === parents || table === absenceControls ? []
                : [];

const createSelectBuilder = () => {
  const builder: any = {
    table: null as any,
    activeTeacherAssignmentsOnly: false,
    lateArrivalAssignmentFilter: false,
    lateArrivalHomeroomFilter: false,
    lateArrivalId: null as number | null,
    lateArrivalDuplicateKey: null as { studentId: number; classId: number; date: string; period: string } | null,
    rowId: null as number | null,
    _rows: [] as any[],
    from(table: any) { builder.table = table; builder._rows = tableRows(table); return builder; },
    where(condition: any) {
      const query = new PgDialect().sqlToQuery(condition);
      const equalityConditions = Array.from(query.sql.matchAll(/"[^"]+"\."([^"]+)"\s*=\s*\$(\d+)/g), (match: any) => ({
        key: match[1].replace(/_([a-z])/g, (_: string, letter: string) => letter.toUpperCase()),
        value: query.params[Number(match[2]) - 1],
      }));
      if (builder.table === userSchools || builder.table === teachers) {
        builder._rows = builder._rows.filter((row: any) => (
          equalityConditions.every(({ key, value }: any) => row[key] === value)
          && (builder.table !== userSchools || !query.sql.includes('is_active') || row.isActive !== false)
        ));
      }
      if (builder.table === absences) {
        mockState.absenceWhereQueries.push(query);
      }
      if (builder.table === teacherClassSubjects) {
        builder.activeTeacherAssignmentsOnly = query.sql.includes('is_active') && query.params.includes(true);
      }
      if (builder.table === lateArrivals) {
        mockState.lateArrivalWhereQueries.push(query);
        builder.lateArrivalAssignmentFilter = query.sql.includes('"late_arrivals"."teaching_assignment_id" in');
        builder.lateArrivalHomeroomFilter = query.sql.includes('"late_arrivals"."class_id"')
          && query.sql.includes('"late_arrivals"."teaching_assignment_id" is null');
        if (query.sql.includes('"late_arrivals"."id"')) {
          builder.lateArrivalId = Number(query.params[0]);
        } else if (query.sql.includes('"late_arrivals"."student_id"')) {
          builder.lateArrivalDuplicateKey = {
            studentId: Number(query.params[0]),
            classId: Number(query.params[1]),
            date: String(query.params[2]),
            period: String(query.params[3]),
          };
        }
      }
      if (builder.table === students || builder.table === classes) {
        if (query.sql.includes('"id"')) builder.rowId = Number(query.params[0]);
      }
      return builder;
    },
    innerJoin() { return builder; },
    leftJoin() { return builder; },
    orderBy() { return builder; },
    limit() { return builder; },
    then(resolve: (value: any) => void, reject: (reason?: any) => void) {
      const rows = builder._rows;
      let result = rows;
      if ((builder.table === students || builder.table === classes) && builder.rowId != null) {
        result = rows.filter((row: any) => row.id === builder.rowId);
      }
      if (builder.table === teacherClassSubjects && builder.activeTeacherAssignmentsOnly) {
        result = rows.filter((assignment: any) => assignment.isActive === true);
      }
      if (builder.table === lateArrivals && (builder.lateArrivalAssignmentFilter || builder.lateArrivalHomeroomFilter)) {
        result = rows.filter((lateArrival: any) => (
          builder.lateArrivalAssignmentFilter && mockState.assignments.some((assignment) =>
            assignment.id === lateArrival.teachingAssignmentId
            && assignment.teacherId === mockState.actorTeacherId
            && assignment.schoolId === mockState.actorSchoolId
            && assignment.classId === lateArrival.classId
            && assignment.isActive,
          )
        ) || (
          builder.lateArrivalHomeroomFilter
          && mockState.homeroomClassIds.includes(lateArrival.classId)
          && lateArrival.teachingAssignmentId == null
        ));
      }
      if (builder.table === lateArrivals && builder.lateArrivalId != null) {
        result = rows.filter((lateArrival: any) => lateArrival.id === builder.lateArrivalId);
      }
      if (builder.table === lateArrivals && builder.lateArrivalDuplicateKey) {
        const key = builder.lateArrivalDuplicateKey;
        result = rows.filter((lateArrival: any) =>
          lateArrival.studentId === key.studentId
          && lateArrival.classId === key.classId
          && lateArrival.date === key.date
          && lateArrival.period === key.period,
        );
      }
      return Promise.resolve(result).then(resolve, reject);
    },
    catch(reject: (reason?: any) => void) { return Promise.resolve([]).catch(reject); },
    finally(callback: () => void) { return Promise.resolve([]).finally(callback); },
  };
  return builder;
};

const mockDb = {
  select: () => createSelectBuilder(),
  execute: async () => [],
  insert: (table: any) => ({
    values: (values: any) => {
      const builder: any = {
        onConflictDoNothing() { return builder; },
        returning: async () => {
          if (table === teacherClassSubjects) {
            const existing = mockState.assignments.find((assignment) =>
              assignment.teacherId === values.teacherId
              && assignment.schoolId === values.schoolId
              && assignment.classId === values.classId
              && assignment.subjectId === values.subjectId,
            );
            if (existing) return [];
            const id = Math.max(100, ...mockState.assignments.map((assignment) => assignment.id)) + 1;
            const row = { id, ...values };
            mockState.assignments.push(row);
            return [row];
          }
          if (table === absences) {
            const row = { id: mockState.absences.length + 1, ...values };
            mockState.absences.push(row);
            return [row];
          }
          if (table === lateArrivals) {
            const row = { id: mockState.lateArrivals.length + 1, ...values };
            mockState.lateArrivals.push(row);
            return [row];
          }
          return [{ id: 1, ...values }];
        },
        then: (resolve: (value: any) => void, reject: (reason?: any) => void) => {
          if (table === teacherClassSubjects) {
            const existing = mockState.assignments.find((assignment) =>
              assignment.teacherId === values.teacherId
              && assignment.schoolId === values.schoolId
              && assignment.classId === values.classId
              && assignment.subjectId === values.subjectId,
            );
            if (!existing) {
              const id = Math.max(100, ...mockState.assignments.map((assignment) => assignment.id)) + 1;
              mockState.assignments.push({ id, ...values });
            }
            return Promise.resolve({ rowCount: existing ? 0 : 1 }).then(resolve, reject);
          }
          return Promise.resolve({ rowCount: 1 }).then(resolve, reject);
        },
        catch: (reject: (reason?: any) => void) => Promise.resolve({ rowCount: 1 }).catch(reject),
        finally: (callback: () => void) => Promise.resolve({ rowCount: 1 }).finally(callback),
      };
      return builder;
    },
  }),
  update: (table: any) => ({
    set: (values: Record<string, any>) => ({
      where: (condition: any) => {
        const query = new PgDialect().sqlToQuery(condition);
        const rowId = Number(query.params[0]);
        mockState.updates.push({ table, values });
        return {
          returning: async () => {
            if (table === absences && mockState.absences[0]) Object.assign(mockState.absences[0], values);
            if (table === lateArrivals) {
              const row = mockState.lateArrivals.find((lateArrival) => lateArrival.id === rowId);
              if (row) Object.assign(row, values);
              return row ? [row] : [];
            }
            return table === absences && mockState.absences[0] ? [mockState.absences[0]] : [];
          },
          then: (resolve: (value: any) => void, reject: (reason?: any) => void) => Promise.resolve([]).then(resolve, reject),
          catch: (reject: (reason?: any) => void) => Promise.resolve([]).catch(reject),
          finally: (callback: () => void) => Promise.resolve([]).finally(callback),
        };
      },
    }),
  }),
  delete: (table: any) => ({ where: async (condition: any) => {
    const query = new PgDialect().sqlToQuery(condition);
    const rowId = Number(query.params[0]);
    if (table === lateArrivals) {
      mockState.lateArrivals = mockState.lateArrivals.filter((lateArrival) => lateArrival.id !== rowId);
    }
    return [];
  } }),
};

vi.mock('../src/db/index.ts', () => ({ db: mockDb }));
vi.mock('../src/db', () => ({ db: mockDb }));
vi.mock('src/db/index.ts', () => ({ db: mockDb }));
vi.mock('../src/middleware/auth.ts', async () => {
  const actual = await vi.importActual('../src/middleware/auth.ts');
  return {
    ...actual,
    requireAuth(req: any, _res: any, next: () => void) {
      req.user = {
        uid: 'sim-teacher',
        email: 'teacher@example.com',
        role: 'teacher',
        schoolId: mockState.actorSchoolId,
        id: mockState.actorUserId,
        simulated: true,
      };
      req.user.uid = mockState.actorUserId === 7 ? 'sim-teacher' : 'sim-teacher-2';
      req.user.email = mockState.actorUserId === 7 ? 'teacher@example.com' : 'teacher-2@example.com';
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
        uid: mockState.actorUserId === 7 ? 'sim-teacher' : 'sim-teacher-2',
        email: mockState.actorUserId === 7 ? 'teacher@example.com' : 'teacher-2@example.com',
        role: 'teacher',
        schoolId: mockState.actorSchoolId,
        id: mockState.actorUserId,
        simulated: true,
      };
      next();
    },
  };
});
 describe('absence teaching assignment routes', () => {
  let app: any;

  beforeAll(async () => {
    const serverModule = await import('../server.ts');
    app = await serverModule.createApp();
  });

  beforeEach(() => {
    mockState.actorUserId = 7;
    mockState.actorTeacherId = 11;
    mockState.actorSchoolId = 1;
    mockState.users = [{ id: 7, uid: 'sim-teacher', email: 'teacher@example.com', name: 'Teacher', role: 'teacher', schoolId: 1, isDeleted: false }];
    mockState.userSchools = [{ userId: 7, schoolId: 1, role: 'teacher', isActive: true }];
    mockState.teachingClassIds = [10];
    mockState.homeroomClassIds = [];
    mockState.subjectIds = [5];
    mockState.assignments = [
      { id: 101, teacherId: 11, schoolId: 1, classId: 10, subjectId: 5, isActive: true },
      { id: 102, teacherId: 12, schoolId: 1, classId: 10, subjectId: 5, isActive: true },
    ];
    mockState.absences = [];
    mockState.lateArrivals = [];
    mockState.declarations = [];
    mockState.justifications = [];
    mockState.updates = [];
    mockState.absenceWhereQueries = [];
    mockState.lateArrivalWhereQueries = [];
  });

  it('returns a shared-subject absence only to the teacher owning its assignment', async () => {
    mockState.absences = [{ id: 30, studentId: 20, classId: 10, subjectId: 5, teachingAssignmentId: 101, schoolId: 1 }];

    const teacherA = await request(app).get('/api/absences').expect(200);
    expect(teacherA.body.map((absence: any) => absence.id)).toEqual([30]);

    switchToSecondTeacher();
    const teacherB = await request(app).get('/api/absences').expect(200);
    expect(teacherB.body).toEqual([]);
  });

  it('isolates different subjects in the same class by assignment id', async () => {
    mockState.assignments = [
      { id: 101, teacherId: 11, schoolId: 1, classId: 10, subjectId: 5, isActive: true },
      { id: 102, teacherId: 12, schoolId: 1, classId: 10, subjectId: 6, isActive: true },
    ];
    mockState.subjectIds = [5];
    mockState.absences = [
      { id: 30, studentId: 20, classId: 10, subjectId: 5, teachingAssignmentId: 101, schoolId: 1 },
      { id: 31, studentId: 20, classId: 10, subjectId: 6, teachingAssignmentId: 102, schoolId: 1 },
    ];

    const teacherA = await request(app).get('/api/absences').expect(200);
    expect(teacherA.body.map((absence: any) => absence.id)).toEqual([30]);

    switchToSecondTeacher();
    mockState.subjectIds = [6];
    const teacherB = await request(app).get('/api/absences').expect(200);
    expect(teacherB.body.map((absence: any) => absence.id)).toEqual([31]);
  });

  it('requires an active exact teacher membership for the current school before granting an assignment scope', async () => {
    mockState.assignments = [{ id: 101, teacherId: 11, schoolId: 1, classId: 10, subjectId: 5, isActive: true }];

    for (const membership of [
      { userId: 7, schoolId: 2, role: 'teacher', isActive: true },
      { userId: 7, schoolId: 1, role: 'parent', isActive: true },
      { userId: 7, schoolId: 1, role: 'teacher', isActive: false },
    ]) {
      mockState.userSchools = [membership];
      await request(app).post('/api/absences').send({
        studentId: 20,
        classId: 10,
        date: '2026-10-01',
        subjectId: 5,
        startTime: '09:00',
        endTime: '10:00',
      }).expect(403);
    }

    expect(mockState.absences).toHaveLength(0);
  });

  it('rejects a class-subject combination without the exact assignment', async () => {
    mockState.assignments = [{ id: 103, teacherId: 11, schoolId: 1, classId: 11, subjectId: 6, isActive: true }];

    await request(app).post('/api/absences').send({
      studentId: 20,
      classId: 10,
      date: '2026-10-01',
      subjectId: 6,
      teachingAssignmentId: 103,
      startTime: '09:00',
      endTime: '10:00',
    }).expect(403);

    expect(mockState.absences).toHaveLength(0);
  });

  it('rejects absence creation without an existing canonical assignment', async () => {
    mockState.assignments = [];
    const payload = {
      studentId: 20,
      classId: 10,
      date: '2026-10-01',
      subjectId: 5,
      startTime: '09:00',
      endTime: '10:00',
    };

    await request(app).post('/api/absences').send(payload).expect(403);
    expect(mockState.assignments).toHaveLength(0);
    expect(mockState.absences).toHaveLength(0);
  });

  it('allows a homeroom teacher to read and record class attendance without a subject or teaching assignment', async () => {
    mockState.assignments = [];
    mockState.homeroomClassIds = [10];
    mockState.absences = [{
      id: 30,
      studentId: 20,
      classId: 10,
      subjectId: null,
      teachingAssignmentId: null,
      schoolId: 1,
    }];

    const absenceList = await request(app).get('/api/absences').expect(200);
    expect(absenceList.body.map((absence: any) => absence.id)).toEqual([30]);

    const absence = await request(app).post('/api/absences').send({
      studentId: 20,
      classId: 10,
      date: '2026-10-01',
      startTime: '09:00',
      endTime: '10:00',
    }).expect(201);
    expect(absence.body).toMatchObject({ classId: 10, subjectId: null, teachingAssignmentId: null });
    expect(mockState.assignments).toHaveLength(0);
  });

  it('limits homeroom reads to class-level absences, not another teacher subject entries', async () => {
    mockState.assignments = [
      { id: 101, teacherId: 11, schoolId: 1, classId: 10, subjectId: 5, isActive: true },
      { id: 102, teacherId: 12, schoolId: 1, classId: 10, subjectId: 6, isActive: true },
    ];
    mockState.homeroomClassIds = [10];
    mockState.absences = [
      { id: 31, studentId: 20, classId: 10, subjectId: null, teachingAssignmentId: null, schoolId: 1 },
      { id: 32, studentId: 20, classId: 10, subjectId: 5, teachingAssignmentId: 101, schoolId: 1 },
      { id: 33, studentId: 20, classId: 10, subjectId: 6, teachingAssignmentId: 102, schoolId: 1 },
      { id: 34, studentId: 20, classId: 10, subjectId: 6, teachingAssignmentId: null, schoolId: 1 },
    ];

    const response = await request(app).get('/api/absences').expect(200);
    expect(response.body.map((absence: any) => absence.id).sort()).toEqual([31, 32]);
  });

  it('does not let a homeroom teacher record a subject absence without an exact active pair', async () => {
    mockState.assignments = [];
    mockState.homeroomClassIds = [10];

    await request(app).post('/api/absences').send({
      studentId: 20,
      classId: 10,
      date: '2026-10-01',
      subjectId: 6,
      startTime: '09:00',
      endTime: '10:00',
    }).expect(403);
    expect(mockState.absences).toHaveLength(0);
    expect(mockState.assignments).toHaveLength(0);
  });

  it('does not create an assignment for a class the teacher is not assigned to', async () => {
    mockState.assignments = [];
    mockState.teachingClassIds = [];

    await request(app).post('/api/absences').send({
      studentId: 20,
      classId: 10,
      date: '2026-10-01',
      subjectId: 5,
      startTime: '09:00',
      endTime: '10:00',
    }).expect(403);
    expect(mockState.assignments).toHaveLength(0);
  });

  it('does not create an assignment for a subject the teacher is not assigned to', async () => {
    mockState.assignments = [];
    mockState.subjectIds = [];

    await request(app).post('/api/absences').send({
      studentId: 20,
      classId: 10,
      date: '2026-10-01',
      subjectId: 5,
      startTime: '09:00',
      endTime: '10:00',
    }).expect(403);
    expect(mockState.assignments).toHaveLength(0);
  });

  it('does not reactivate an inactive exact assignment during automatic resolution', async () => {
    mockState.assignments = [{ id: 101, teacherId: 11, schoolId: 1, classId: 10, subjectId: 5, isActive: false }];

    await request(app).post('/api/absences').send({
      studentId: 20,
      classId: 10,
      date: '2026-10-01',
      subjectId: 5,
      startTime: '09:00',
      endTime: '10:00',
    }).expect(403);
    expect(mockState.assignments[0].isActive).toBe(false);
  });

  it('rejects a subject assignment from another school for absence and tardy writes', async () => {
    mockState.assignments = [{
      id: 901,
      teacherId: 11,
      schoolId: 2,
      classId: 10,
      subjectId: 5,
      isActive: true,
    }];

    await request(app).post('/api/absences').send({
      studentId: 20,
      classId: 10,
      date: '2026-10-01',
      subjectId: 5,
      startTime: '09:00',
      endTime: '10:00',
    }).expect(403);
    await request(app).post('/api/late-arrivals').send({
      studentId: 20,
      classId: 10,
      date: '2026-10-01',
      period: 'morning',
      subjectId: 5,
      expectedStartTime: '08:00',
      arrivalTime: '08:10',
    }).expect(403);
    expect(mockState.absences).toHaveLength(0);
    expect(mockState.lateArrivals).toHaveLength(0);
  });

  it('rejects a client-supplied assignment id owned by another teacher', async () => {
    await request(app).post('/api/absences').send({
      teacherId: 11,
      studentId: 20,
      classId: 10,
      date: '2026-10-01',
      subjectId: 5,
      teachingAssignmentId: 102,
      startTime: '09:00',
      endTime: '10:00',
    }).expect(403);

    expect(mockState.absences).toHaveLength(0);
  });

  it('persists the selected canonical assignment and ignores a client-supplied teacher id', async () => {
    const response = await request(app).post('/api/absences').send({
      teacherId: 12,
      studentId: 20,
      classId: 10,
      date: '2026-10-01',
      subjectId: 5,
      teachingAssignmentId: 101,
      startTime: '09:00',
      endTime: '10:00',
    }).expect(201);

    expect(response.body.teachingAssignmentId).toBe(101);
    expect(response.body.classId).toBe(10);
    expect(response.body.subjectId).toBe(5);
    expect(response.body).not.toHaveProperty('teacherId');
  });

  it('rejects review and file download by another teacher sharing the same subject', async () => {
    mockState.absences = [{ id: 30, studentId: 20, classId: 10, subjectId: 5, teachingAssignmentId: 101, schoolId: 1 }];
    switchToSecondTeacher();

    await request(app).put('/api/absences/30/justification/review').send({ status: 'APPROVED' }).expect(403);
    const download = await request(app).get('/api/absences/30/justification/download').expect(403);
    expect(download.headers['content-type']).toMatch(/application\/json/);
    expect(download.headers['content-disposition']).toBeUndefined();
    expect(mockState.updates).toHaveLength(0);
  });

  it('does not expose or let teachers review unassigned parent declarations', async () => {
    mockState.declarations = [{ id: 99, studentId: 20, parentId: 2, date: '2026-10-01', status: 'RECEIVED' }];
    const list = await request(app).get('/api/absence-declarations').expect(200);
    expect(list.body).toEqual([]);

    await request(app).put('/api/absence-declarations/99/review')
      .send({ status: 'ACCEPTED' })
      .expect(403);
    await request(app).put('/api/absence-declarations/99/not-realized').expect(403);
  });

  it('filters teacher dashboard absence aggregates by owned assignment ids', async () => {
    mockState.absences = [
      { id: 30, studentId: 20, classId: 10, subjectId: 5, teachingAssignmentId: 101, schoolId: 1, isJustified: false },
      { id: 31, studentId: 20, classId: 10, subjectId: 5, teachingAssignmentId: 102, schoolId: 1, isJustified: false },
    ];

    await request(app).get('/api/dashboard/summary').expect(200);

    const assignmentFilters = mockState.absenceWhereQueries.filter((query) => query.sql.includes('teaching_assignment_id'));
    expect(assignmentFilters.length).toBeGreaterThanOrEqual(3);
    expect(assignmentFilters.every((query) => query.params.includes(101) && !query.params.includes(102))).toBe(true);
  });

  it('revokes teacher list, review, download and dashboard access when the assignment is inactive', async () => {
    mockState.assignments = [{ id: 101, teacherId: 11, schoolId: 1, classId: 10, subjectId: 5, isActive: false }];
    mockState.absences = [{ id: 30, studentId: 20, classId: 10, subjectId: 5, teachingAssignmentId: 101, schoolId: 1 }];

    const list = await request(app).get('/api/absences').expect(200);
    expect(list.body).toEqual([]);
    await request(app).put('/api/absences/30/justification/review').send({ status: 'APPROVED' }).expect(403);
    const download = await request(app).get('/api/absences/30/justification/download').expect(403);
    expect(download.headers['content-type']).toMatch(/application\/json/);
    expect(download.headers['content-disposition']).toBeUndefined();

    const dashboard = await request(app).get('/api/dashboard/summary').expect(200);
    expect(dashboard.body.stats.totalAbsences).toBe(0);
    expect(mockState.updates).toHaveLength(0);
  });

  it('rejects a teacher late arrival when only another teacher owns the assignment', async () => {
    mockState.assignments = [
      { id: 102, teacherId: 12, schoolId: 1, classId: 10, subjectId: 5, isActive: true },
    ];
    const payload = {
      teacherId: 12,
      teachingAssignmentId: 102,
      studentId: 20,
      classId: 10,
      subjectId: 5,
      date: '2026-10-01',
      period: 'morning',
      expectedStartTime: '08:00',
      arrivalTime: '08:10',
    };

    await request(app).post('/api/late-arrivals').send(payload).expect(403);
    expect(mockState.lateArrivals).toHaveLength(0);
    expect(mockState.assignments).toEqual([
      { id: 102, teacherId: 12, schoolId: 1, classId: 10, subjectId: 5, isActive: true },
    ]);
  });

  it('rejects a teacher late arrival for an unassigned subject or class', async () => {
    mockState.assignments = [];
    await request(app).post('/api/late-arrivals').send({
      studentId: 20,
      classId: 10,
      subjectId: 6,
      date: '2026-10-01',
      period: 'morning',
      expectedStartTime: '08:00',
      arrivalTime: '08:10',
    }).expect(403);
    expect(mockState.assignments).toHaveLength(0);

    mockState.subjectIds = [5];
    mockState.teachingClassIds = [];
    await request(app).post('/api/late-arrivals').send({
      studentId: 20,
      classId: 10,
      subjectId: 5,
      date: '2026-10-02',
      period: 'morning',
      expectedStartTime: '08:00',
      arrivalTime: '08:10',
    }).expect(403);
    expect(mockState.assignments).toHaveLength(0);
  });

  it('allows homeroom-only class attendance operations without granting subject access', async () => {
    mockState.assignments = [];
    mockState.teachingClassIds = [];
    mockState.homeroomClassIds = [10];

    const response = await request(app).post('/api/late-arrivals').send({
      studentId: 20,
      classId: 10,
      date: '2026-10-01',
      period: 'morning',
      expectedStartTime: '08:00',
      arrivalTime: '08:10',
    }).expect(201);
    expect(response.body).toMatchObject({ classId: 10, teachingAssignmentId: null });
    expect(mockState.assignments).toHaveLength(0);

    mockState.lateArrivals = [{
      id: 205,
      studentId: 20,
      classId: 10,
      teachingAssignmentId: null,
      expectedStartTime: '08:00',
      arrivalTime: '08:10',
      reason: null,
    }];
    await request(app).put('/api/late-arrivals/205').send({ arrivalTime: '08:15' }).expect(200);
    expect(mockState.lateArrivals[0].arrivalTime).toBe('08:15');
    await request(app).delete('/api/late-arrivals/205').expect(204);
    expect(mockState.lateArrivals).toHaveLength(0);
  });

  it('lets a homeroom teacher read class tardies without requiring a teaching assignment', async () => {
    mockState.assignments = [];
    mockState.teachingClassIds = [];
    mockState.homeroomClassIds = [10];
    mockState.lateArrivals = [
      { id: 205, studentId: 20, classId: 10, teachingAssignmentId: null },
    ];

    const response = await request(app).get('/api/late-arrivals').expect(200);
    expect(response.body.map((lateArrival: any) => lateArrival.id)).toEqual([205]);
    expect(mockState.lateArrivalWhereQueries.some((query) => query.sql.includes('"late_arrivals"."class_id"') && query.params.includes(10))).toBe(true);
  });

  it('limits homeroom tardy reads to class-level entries, not another teacher assignment', async () => {
    mockState.assignments = [
      { id: 101, teacherId: 11, schoolId: 1, classId: 10, subjectId: 5, isActive: true },
      { id: 102, teacherId: 12, schoolId: 1, classId: 10, subjectId: 6, isActive: true },
    ];
    mockState.homeroomClassIds = [10];
    mockState.lateArrivals = [
      { id: 205, studentId: 20, classId: 10, teachingAssignmentId: null },
      { id: 206, studentId: 20, classId: 10, teachingAssignmentId: 101 },
      { id: 207, studentId: 20, classId: 10, teachingAssignmentId: 102 },
    ];

    const response = await request(app).get('/api/late-arrivals').expect(200);
    expect(response.body.map((lateArrival: any) => lateArrival.id).sort()).toEqual([205, 206]);
  });

  it('does not let a homeroom teacher create a subject-specific tardy without an exact active pair', async () => {
    mockState.assignments = [];
    mockState.teachingClassIds = [];
    mockState.homeroomClassIds = [10];

    await request(app).post('/api/late-arrivals').send({
      studentId: 20,
      classId: 10,
      subjectId: 6,
      date: '2026-10-01',
      period: 'morning',
      expectedStartTime: '08:00',
      arrivalTime: '08:10',
    }).expect(403);
    expect(mockState.lateArrivals).toHaveLength(0);
    expect(mockState.assignments).toHaveLength(0);
  });

  it('rejects a late arrival whose student and class are in another school', async () => {
    mockState.students.push({ id: 21, schoolId: 2, classId: 20, firstName: 'Other', lastName: 'School', isActive: true, parentId: null });
    mockState.classes.push({ id: 20, schoolId: 2 });

    await request(app).post('/api/late-arrivals').send({
      studentId: 21,
      classId: 20,
      subjectId: 5,
      date: '2026-10-01',
      period: 'morning',
      expectedStartTime: '08:00',
      arrivalTime: '08:10',
    }).expect(403);
    expect(mockState.lateArrivals).toHaveLength(0);
  });

  it('isolates late-arrival reads by active teacher-school-class-subject assignments', async () => {
    mockState.assignments = [
      { id: 101, teacherId: 11, schoolId: 1, classId: 10, subjectId: 5, isActive: true },
      { id: 102, teacherId: 12, schoolId: 1, classId: 10, subjectId: 6, isActive: true },
      { id: 103, teacherId: 11, schoolId: 2, classId: 20, subjectId: 5, isActive: true },
      { id: 104, teacherId: 11, schoolId: 1, classId: 10, subjectId: 7, isActive: false },
    ];
    mockState.lateArrivals = [
      { id: 201, studentId: 20, classId: 10, teachingAssignmentId: 101, createdBy: 7 },
      { id: 202, studentId: 20, classId: 10, teachingAssignmentId: 102, createdBy: 8 },
      { id: 203, studentId: 20, classId: 10, teachingAssignmentId: 104, createdBy: 7 },
      { id: 204, studentId: 20, classId: 10, teachingAssignmentId: null, createdBy: 7 },
    ];

    const teacherA = await request(app).get('/api/late-arrivals').expect(200);
    expect(teacherA.body.map((lateArrival: any) => lateArrival.id)).toEqual([201]);

    switchToSecondTeacher();
    mockState.subjectIds = [6];
    const teacherB = await request(app).get('/api/late-arrivals').expect(200);
    expect(teacherB.body.map((lateArrival: any) => lateArrival.id)).toEqual([202]);
  });

  it('allows teacher updates and deletion only for rows on their active assignment', async () => {
    mockState.assignments = [
      { id: 101, teacherId: 11, schoolId: 1, classId: 10, subjectId: 5, isActive: true },
      { id: 102, teacherId: 12, schoolId: 1, classId: 10, subjectId: 6, isActive: true },
    ];
    mockState.lateArrivals = [
      { id: 201, studentId: 20, classId: 10, teachingAssignmentId: 101, expectedStartTime: '08:00', arrivalTime: '08:10', reason: null },
      { id: 202, studentId: 20, classId: 10, teachingAssignmentId: 102, expectedStartTime: '08:00', arrivalTime: '08:15', reason: null },
    ];

    await request(app).put('/api/late-arrivals/202').send({ arrivalTime: '08:30' }).expect(403);
    await request(app).delete('/api/late-arrivals/202').expect(403);
    expect(mockState.lateArrivals.find((item) => item.id === 202)?.arrivalTime).toBe('08:15');

    switchToSecondTeacher();
    mockState.subjectIds = [6];
    await request(app).put('/api/late-arrivals/202').send({ arrivalTime: '08:20' }).expect(200);
    await request(app).delete('/api/late-arrivals/202').expect(204);
    expect(mockState.lateArrivals.some((item) => item.id === 202)).toBe(false);
  });

  it('blocks create, read, update and delete after a teaching assignment is deactivated', async () => {
    mockState.assignments = [{ id: 101, teacherId: 11, schoolId: 1, classId: 10, subjectId: 5, isActive: false }];
    mockState.lateArrivals = [{ id: 201, studentId: 20, classId: 10, teachingAssignmentId: 101, expectedStartTime: '08:00', arrivalTime: '08:10', reason: null }];

    const list = await request(app).get('/api/late-arrivals').expect(200);
    expect(list.body).toEqual([]);
    await request(app).post('/api/late-arrivals').send({
      studentId: 20,
      classId: 10,
      subjectId: 5,
      date: '2026-10-02',
      period: 'morning',
      expectedStartTime: '08:00',
      arrivalTime: '08:10',
    }).expect(403);
    await request(app).put('/api/late-arrivals/201').send({ arrivalTime: '08:20' }).expect(403);
    await request(app).delete('/api/late-arrivals/201').expect(403);
    expect(mockState.lateArrivals).toHaveLength(1);
  });
});
