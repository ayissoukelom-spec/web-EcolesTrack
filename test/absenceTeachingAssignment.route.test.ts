import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { PgDialect } from 'drizzle-orm/pg-core';
import {
  absenceJustifications,
  absenceDeclarations,
  absenceControls,
  absences,
  classes,
  parents,
  studentAcademicYearStatuses,
  students,
  teacherClassSubjects,
  users,
} from '../src/db/schema.ts';

const mockState = {
  actorTeacherId: 11,
  users: [{ id: 7, uid: 'sim-teacher', email: 'teacher@example.com', name: 'Teacher', role: 'teacher', schoolId: 1, isDeleted: false }],
  assignments: [
    { id: 101, teacherId: 11, schoolId: 1, classId: 10, subjectId: 5, isActive: true },
    { id: 102, teacherId: 12, schoolId: 1, classId: 10, subjectId: 5, isActive: true },
  ],
  teachingClassIds: [10],
  subjectIds: [5],
  students: [{ id: 20, schoolId: 1, classId: 10, firstName: 'Awa', lastName: 'Test', isActive: true, parentId: null }],
  classes: [{ id: 10, schoolId: 1 }],
  absences: [] as any[],
  declarations: [] as any[],
  justifications: [] as any[],
  updates: [] as Array<{ table: any; values: Record<string, any> }>,
  absenceWhereQueries: [] as Array<{ sql: string; params: unknown[] }>,
};

const tableRows = (table: any) => table === users ? mockState.users
  : table === teacherClassSubjects ? mockState.assignments.filter((assignment) => assignment.teacherId === mockState.actorTeacherId && assignment.schoolId === 1)
    : table === students ? mockState.students
      : table === classes ? mockState.classes
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
      return builder;
    },
    innerJoin() { return builder; },
    leftJoin() { return builder; },
    orderBy() { return builder; },
    limit() { return builder; },
    then(resolve: (value: any) => void, reject: (reason?: any) => void) {
      const rows = tableRows(builder.table);
      const result = builder.table === teacherClassSubjects && builder.activeTeacherAssignmentsOnly
        ? rows.filter((assignment: any) => assignment.isActive)
        : rows;
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
      where: () => {
        mockState.updates.push({ table, values });
        return {
          returning: async () => {
            if (table === absences && mockState.absences[0]) Object.assign(mockState.absences[0], values);
            return table === absences && mockState.absences[0] ? [mockState.absences[0]] : [];
          },
          then: (resolve: (value: any) => void, reject: (reason?: any) => void) => Promise.resolve([]).then(resolve, reject),
          catch: (reject: (reason?: any) => void) => Promise.resolve([]).catch(reject),
          finally: (callback: () => void) => Promise.resolve([]).finally(callback),
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
      req.user = {
        uid: 'sim-teacher',
        email: 'teacher@example.com',
        role: 'teacher',
        schoolId: 1,
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
      req.user = { uid: 'sim-teacher', email: 'teacher@example.com', role: 'teacher', schoolId: 1, id: 7, simulated: true };
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
      schoolId: 1,
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
    mockState.teachingClassIds = [10];
    mockState.subjectIds = [5];
    mockState.assignments = [
      { id: 101, teacherId: 11, schoolId: 1, classId: 10, subjectId: 5, isActive: true },
      { id: 102, teacherId: 12, schoolId: 1, classId: 10, subjectId: 5, isActive: true },
    ];
    mockState.absences = [];
    mockState.declarations = [];
    mockState.justifications = [];
    mockState.updates = [];
    mockState.absenceWhereQueries = [];
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
});
