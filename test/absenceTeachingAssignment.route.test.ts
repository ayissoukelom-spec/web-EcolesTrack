import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { PgDialect } from 'drizzle-orm/pg-core';
import {
  absenceJustifications,
  absenceDeclarations,
  absenceControls,
  absences,
  classes,
  lateArrivals,
  parents,
  studentAcademicYearStatuses,
  students,
  teacherClassSubjects,
  users,
} from '../src/db/schema.ts';

const mockState = {
  actorTeacherId: 11,
  actorSchoolId: 1,
  users: [{ id: 7, uid: 'sim-teacher', email: 'teacher@example.com', name: 'Teacher', role: 'teacher', schoolId: 1, isDeleted: false }],
  assignments: [
    { id: 101, teacherId: 11, schoolId: 1, classId: 10, subjectId: 5, isActive: true },
    { id: 102, teacherId: 12, schoolId: 1, classId: 10, subjectId: 5, isActive: true },
  ],
  teachingClassIds: [10],
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

const tableRows = (table: any) => table === users ? mockState.users
  : table === teacherClassSubjects ? mockState.assignments.filter((assignment) => assignment.teacherId === mockState.actorTeacherId && assignment.schoolId === mockState.actorSchoolId)
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
    lateArrivalId: null as number | null,
    lateArrivalDuplicateKey: null as { studentId: number; classId: number; date: string; period: string } | null,
    rowId: null as number | null,
    from(table: any) { builder.table = table; return builder; },
    where(condition: any) {
      if (builder.table === absences) {
        const query = new PgDialect().sqlToQuery(condition);
        mockState.absenceWhereQueries.push(query);
      }
      if (builder.table === teacherClassSubjects) {
        const query = new PgDialect().sqlToQuery(condition);
        builder.activeTeacherAssignmentsOnly = query.sql.includes('is_active') && query.params.includes(true);
      }
      if (builder.table === lateArrivals) {
        const query = new PgDialect().sqlToQuery(condition);
        mockState.lateArrivalWhereQueries.push(query);
        builder.lateArrivalAssignmentFilter = query.sql.includes('teaching_assignment_id');
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
        const query = new PgDialect().sqlToQuery(condition);
        if (query.sql.includes('"id"')) builder.rowId = Number(query.params[0]);
      }
      return builder;
    },
    innerJoin() { return builder; },
    leftJoin() { return builder; },
    orderBy() { return builder; },
    limit() { return builder; },
    then(resolve: (value: any) => void, reject: (reason?: any) => void) {
      const rows = tableRows(builder.table);
      let result = rows;
      if ((builder.table === students || builder.table === classes) && builder.rowId != null) {
        result = rows.filter((row: any) => row.id === builder.rowId);
      }
      if (builder.table === teacherClassSubjects && builder.activeTeacherAssignmentsOnly) {
        result = rows.filter((assignment: any) => assignment.isActive);
      }
      if (builder.table === lateArrivals && builder.lateArrivalAssignmentFilter) {
        result = rows.filter((lateArrival: any) => mockState.assignments.some((assignment) =>
          assignment.id === lateArrival.teachingAssignmentId
          && assignment.teacherId === mockState.actorTeacherId
          && assignment.schoolId === mockState.actorSchoolId
          && assignment.isActive,
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
        id: 7,
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
      req.user = { uid: 'sim-teacher', email: 'teacher@example.com', role: 'teacher', schoolId: mockState.actorSchoolId, id: 7, simulated: true };
      next();
    },
  };
});
vi.mock('../src/lib/teacherAuthorization.ts', async () => {
  const actual = await vi.importActual('../src/lib/teacherAuthorization.ts');
  return {
    ...actual,
    getTeacherAuthorizationScope: async () => ({
      teacherId: mockState.actorTeacherId,
      schoolId: mockState.actorSchoolId,
      specialization: null,
      teachingClassIds: new Set(mockState.teachingClassIds),
      homeroomClassIds: new Set(),
      subjectIds: new Set(mockState.subjectIds),
    }),
  };
});

 describe('absence teaching assignment routes', () => {
  let app: any;

  beforeAll(async () => {
    const serverModule = await import('../server.ts');
    app = await serverModule.createApp();
  });

  beforeEach(() => {
    mockState.actorTeacherId = 11;
    mockState.actorSchoolId = 1;
    mockState.teachingClassIds = [10];
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

    mockState.actorTeacherId = 12;
    const teacherB = await request(app).get('/api/absences').expect(200);
    expect(teacherB.body).toEqual([]);
  });

  it('isolates different subjects in the same class by assignment id', async () => {
    mockState.assignments = [
      { id: 101, teacherId: 11, schoolId: 1, classId: 10, subjectId: 5, isActive: true },
      { id: 102, teacherId: 12, schoolId: 1, classId: 10, subjectId: 6, isActive: true },
    ];
    mockState.absences = [
      { id: 30, studentId: 20, classId: 10, subjectId: 5, teachingAssignmentId: 101, schoolId: 1 },
      { id: 31, studentId: 20, classId: 10, subjectId: 6, teachingAssignmentId: 102, schoolId: 1 },
    ];

    const teacherA = await request(app).get('/api/absences').expect(200);
    expect(teacherA.body.map((absence: any) => absence.id)).toEqual([30]);

    mockState.actorTeacherId = 12;
    const teacherB = await request(app).get('/api/absences').expect(200);
    expect(teacherB.body.map((absence: any) => absence.id)).toEqual([31]);
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

  it('creates an authorized canonical assignment on first absence and reuses it', async () => {
    mockState.assignments = [];
    const payload = {
      studentId: 20,
      classId: 10,
      date: '2026-10-01',
      subjectId: 5,
      startTime: '09:00',
      endTime: '10:00',
    };

    const first = await request(app).post('/api/absences').send(payload).expect(201);
    const assignmentId = first.body.teachingAssignmentId;
    expect(assignmentId).toBeGreaterThan(0);
    expect(mockState.assignments).toEqual([expect.objectContaining({
      id: assignmentId,
      teacherId: 11,
      schoolId: 1,
      classId: 10,
      subjectId: 5,
      isActive: true,
    })]);

    const second = await request(app).post('/api/absences').send(payload).expect(201);
    expect(second.body.teachingAssignmentId).toBe(assignmentId);
    expect(mockState.assignments).toHaveLength(1);
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
    mockState.actorTeacherId = 12;

    await request(app).put('/api/absences/30/justification/review').send({ status: 'APPROVED' }).expect(403);
    await request(app).get('/api/absences/30/justification/download').expect(403);
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
    await request(app).get('/api/absences/30/justification/download').expect(403);

    const dashboard = await request(app).get('/api/dashboard/summary').expect(200);
    expect(dashboard.body.stats.totalAbsences).toBe(0);
    expect(mockState.absenceWhereQueries.filter((query) => /\bfalse\b/.test(query.sql)).length).toBeGreaterThanOrEqual(3);
  });

  it('creates a teacher late arrival with the server-resolved assignment and reuses it', async () => {
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

    const first = await request(app).post('/api/late-arrivals').send(payload).expect(201);
    const assignmentId = first.body.teachingAssignmentId;
    expect(assignmentId).toBeGreaterThan(0);
    expect(first.body.createdBy).toBe(7);
    expect(assignmentId).not.toBe(102);
    expect(mockState.assignments).toHaveLength(2);
    expect(mockState.assignments).toEqual(expect.arrayContaining([expect.objectContaining({
      id: assignmentId,
      teacherId: 11,
      schoolId: 1,
      classId: 10,
      subjectId: 5,
      isActive: true,
    })]));

    const second = await request(app).post('/api/late-arrivals').send({ ...payload, date: '2026-10-02' }).expect(201);
    expect(second.body.teachingAssignmentId).toBe(assignmentId);
    expect(mockState.assignments).toHaveLength(2);
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

    mockState.actorTeacherId = 12;
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

    mockState.actorTeacherId = 12;
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
