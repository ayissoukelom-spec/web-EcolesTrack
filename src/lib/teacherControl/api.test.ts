import { createHash } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockActor = vi.hoisted(() => ({
  role: 'teacher',
  id: 501,
  schoolId: 8,
  name: 'Test actor',
  email: 'actor@example.test',
}));
const mockDatabaseState = vi.hoisted(() => ({
  memberships: [] as Array<Record<string, unknown>>,
  schools: [] as Array<Record<string, unknown>>,
  gpsSettings: [] as Array<Record<string, unknown>>,
  auditEvents: [] as Array<Record<string, unknown>>,
  teachers: [] as Array<Record<string, unknown>>,
  assignments: [] as Array<Record<string, unknown>>,
  classTeacherAssociations: [] as Array<Record<string, unknown>>,
  teacherSubjectAssociations: [] as Array<Record<string, unknown>>,
  classes: [] as Array<Record<string, unknown>>,
  subjects: [] as Array<Record<string, unknown>>,
  hourlyRates: [] as Array<Record<string, unknown>>,
  sessions: [] as Array<Record<string, unknown>>,
  regularizationRequests: [] as Array<Record<string, unknown>>,
  challenges: [] as Array<Record<string, unknown>>,
  failAuditInsert: false,
}));

vi.mock('../../db/index.ts', async () => {
  const { PgDialect } = await import('drizzle-orm/pg-core');
  const schema = await import('../../db/schema.ts');
  const rowsFor = (table: unknown) => {
    if (table === schema.userSchools) return mockDatabaseState.memberships;
    if (table === schema.schools) return mockDatabaseState.schools;
    if (table === schema.teacherControlGpsSettings) return mockDatabaseState.gpsSettings;
    if (table === schema.teacherControlAuditEvents) return mockDatabaseState.auditEvents;
    if (table === schema.teachers) return mockDatabaseState.teachers;
    if (table === schema.teacherClassSubjects) return mockDatabaseState.assignments;
    if (table === schema.classTeachers) return mockDatabaseState.classTeacherAssociations;
    if (table === schema.teacherSubjects) return mockDatabaseState.teacherSubjectAssociations;
    if (table === schema.classes) return mockDatabaseState.classes;
    if (table === schema.subjects) return mockDatabaseState.subjects;
    if (table === schema.teacherControlHourlyRates) return mockDatabaseState.hourlyRates;
    if (table === schema.teacherControlSessions) return mockDatabaseState.sessions;
    if (table === schema.teacherControlRegularizationRequests) return mockDatabaseState.regularizationRequests;
    if (table === schema.teacherControlGpsChallenges) return mockDatabaseState.challenges;
    return [];
  };
  const select = vi.fn((selection?: Record<string, unknown>) => {
    const builder: any = {
      table: null as unknown,
      selection,
      joinedTables: new Set<unknown>(),
      whereSql: '',
      params: [] as unknown[],
      hasWhere: false,
      grouped: false,
      from(table: unknown) {
        builder.table = table;
        return builder;
      },
      where(condition: unknown) {
        builder.hasWhere = true;
        const query = new PgDialect().sqlToQuery(condition as never);
        builder.whereSql = query.sql;
        builder.params = query.params;
        return builder;
      },
      leftJoin(table: unknown) {
        builder.joinedTables.add(table);
        return builder;
      },
      innerJoin(table: unknown) {
        builder.joinedTables.add(table);
        return builder;
      },
      groupBy() {
        builder.grouped = true;
        return builder;
      },
      limit() { return builder; },
      offset() { return builder; },
      orderBy() { return builder; },
      for() { return builder; },
      then(resolve: (value: Array<Record<string, unknown>>) => unknown, reject?: (error: unknown) => unknown) {
        if (builder.table === schema.teacherControlSessions && builder.grouped) {
          const groupedSessions = new Map<number, Array<Record<string, unknown>>>();
          for (const session of mockDatabaseState.sessions) {
            const schoolId = Number(session.schoolId);
            const group = groupedSessions.get(schoolId) ?? [];
            group.push(session);
            groupedSessions.set(schoolId, group);
          }
          const groupedRows = [...groupedSessions].map(([schoolId, sessions]) => {
            const school = mockDatabaseState.schools.find((row) => row.id === schoolId);
            const completedSessions = sessions.filter((row) => row.validatedEndedAt != null);
            const validatedDurationMilliseconds = completedSessions.reduce((total, session) => (
              total + new Date(session.validatedEndedAt as string | Date).getTime()
                - new Date(session.startedAt as string | Date).getTime()
            ), 0);
            const estimatedCompensationXof = completedSessions.reduce((total, session) => {
              if (session.hourlyRateXofSnapshot == null) return total;
              const duration = new Date(session.validatedEndedAt as string | Date).getTime()
                - new Date(session.startedAt as string | Date).getTime();
              return total + Math.round(Number(session.hourlyRateXofSnapshot) * duration / 3_600_000);
            }, 0);
            return {
              schoolId,
              schoolName: school?.name ?? 'École supprimée',
              totalSessions: sessions.length,
              openSessions: sessions.filter((row) => row.status === 'open').length,
              completedSessions: completedSessions.length,
              incompleteSessions: sessions.filter((row) => row.status === 'closed_without_end').length,
              regularizedSessions: sessions.filter((row) => row.endSource === 'regularization').length,
              validatedDurationMilliseconds,
              estimatedCompensationXof,
            };
          });
          return Promise.resolve(groupedRows).then(resolve, reject);
        }
        if (builder.table === schema.teacherControlRegularizationRequests && builder.grouped) {
          return Promise.resolve([]).then(resolve, reject);
        }
        let rows = [...rowsFor(builder.table)];
        if (builder.table === schema.userSchools) {
          rows = rows.filter((row) => builder.params.includes(row.userId)
            && builder.params.includes(row.schoolId)
            && row.isActive === true);
        } else if (builder.table === schema.schools) {
          if (builder.hasWhere) rows = rows.filter((row) => builder.params.includes(row.id));
          if (builder.selection?.schoolName) {
            rows = rows.map((row) => ({ schoolId: row.id, schoolName: row.name }));
          }
        } else if (builder.table === schema.teacherControlGpsSettings) {
          rows = rows.filter((row) => builder.params.includes(row.schoolId));
        } else if (builder.table === schema.teacherControlAuditEvents) {
          rows = rows.filter((row) => builder.params.includes(row.schoolId)
            && builder.params.includes(row.resourceType));
        } else if (builder.table === schema.teachers) {
          rows = rows.filter((row) => builder.params.includes(row.userId)
            && builder.params.includes(row.schoolId)
            || builder.params.includes(row.id) && builder.params.includes(row.schoolId));
        } else if (builder.table === schema.teacherClassSubjects) {
          rows = rows.filter((row) => builder.params.includes(row.teacherId)
            && builder.params.includes(row.schoolId)
            && (!builder.whereSql.includes('"teacher_class_subjects"."class_id" =')
              || builder.params.includes(row.classId))
            && (!builder.whereSql.includes('"teacher_class_subjects"."subject_id" =')
              || builder.params.includes(row.subjectId)));
        } else if (builder.table === schema.classTeachers
          && builder.joinedTables.has(schema.teacherSubjects)) {
          rows = [];
          for (const classAssociation of mockDatabaseState.classTeacherAssociations) {
            for (const subjectAssociation of mockDatabaseState.teacherSubjectAssociations) {
              const classId = Number(classAssociation.classId);
              const subjectId = Number(subjectAssociation.subjectId);
              const schoolId = Number(classAssociation.schoolId);
              const teacherId = Number(classAssociation.teacherId);
              const classEligible = classAssociation.classSchoolId === schoolId
                || classAssociation.classSchoolId == null && classAssociation.classApproved === true;
              const subjectEligible = subjectAssociation.subjectSchoolId === schoolId
                || subjectAssociation.subjectSchoolId == null && subjectAssociation.subjectApproved === true;
              if (teacherId !== Number(subjectAssociation.teacherId)
                || schoolId !== Number(subjectAssociation.schoolId)
                || !classEligible
                || !subjectEligible
                || !builder.params.includes(teacherId)
                || !builder.params.includes(schoolId)
                || (builder.whereSql.includes('"class_teachers"."class_id" =') && !builder.params.includes(classId))
                || (builder.whereSql.includes('"teacher_subjects"."subject_id" =') && !builder.params.includes(subjectId))) {
                continue;
              }
              rows.push({
                classTeacherAssociationId: classAssociation.id,
                teacherSubjectAssociationId: subjectAssociation.id,
                classId,
                className: classAssociation.className,
                subjectId,
                subjectName: subjectAssociation.subjectName,
              });
            }
          }
        } else if (builder.table === schema.classes) {
          rows = rows.filter((row) => builder.params.includes(row.id)
            && builder.params.includes(row.schoolId));
        } else if (builder.table === schema.subjects) {
          rows = rows.filter((row) => builder.params.includes(row.id));
        } else if (builder.table === schema.teacherControlHourlyRates) {
          rows = rows.filter((row) => builder.params.includes(row.schoolId)
            && builder.params.includes(row.teacherId));
        } else if (builder.table === schema.teacherControlSessions) {
          rows = rows.filter((row) => builder.params.every((param: unknown) => (
            param instanceof Date || Object.values(row).includes(param)
          )));
        } else if (builder.table === schema.teacherControlGpsChallenges) {
          rows = rows.filter((row) => builder.params.includes(row.challengeHash)
            && builder.params.includes(row.actorUserId)
            && builder.params.includes(row.schoolId)
            && builder.params.includes(row.action)
            && row.consumedAt == null
            && row.expiresAt instanceof Date
            && row.expiresAt > new Date()
            && (builder.whereSql.includes('"resource_id" IS NULL')
              ? row.resourceId == null
              : builder.params.includes(row.resourceId)));
        }
        return Promise.resolve(rows).then(resolve, reject);
      },
    };
    return builder;
  });
  const insert = vi.fn((table: unknown) => {
    let values: Record<string, unknown> | null = null;
    const builder: any = {
      values(input: Record<string, unknown>) {
        values = input;
        return builder;
      },
      onConflictDoUpdate() { return builder; },
      async returning() {
        if (!values) throw new Error('Missing insert values');
        const collection = rowsFor(table);
        if (table === schema.teacherControlAuditEvents && mockDatabaseState.failAuditInsert) {
          throw new Error('Forced audit insert failure');
        }
        const existingIndex = table === schema.teacherControlGpsSettings
          ? collection.findIndex((row) => row.schoolId === values?.schoolId)
          : table === schema.teacherControlHourlyRates
            ? collection.findIndex((row) => row.schoolId === values?.schoolId && row.teacherId === values?.teacherId)
          : -1;
        const saved = existingIndex >= 0
          ? { ...collection[existingIndex], ...values, id: collection[existingIndex]?.id }
          : { ...values, id: collection.length + 1 };
        if (existingIndex >= 0) collection[existingIndex] = saved;
        else collection.push(saved);
        return table === schema.teacherControlAuditEvents ? undefined : [saved];
      },
      then(resolve: (value: undefined) => unknown, reject?: (error: unknown) => unknown) {
        if (!values) return Promise.resolve(undefined).then(resolve, reject);
        if (table === schema.teacherControlAuditEvents && mockDatabaseState.failAuditInsert) {
          return Promise.reject(new Error('Forced audit insert failure')).then(resolve, reject);
        }
        rowsFor(table).push({ ...values, id: rowsFor(table).length + 1 });
        return Promise.resolve(undefined).then(resolve, reject);
      },
    };
    return builder;
  });
  const update = vi.fn((table: unknown) => {
    let values: Record<string, unknown> = {};
    let params: unknown[] = [];
    const builder: any = {
      set(input: Record<string, unknown>) {
        values = input;
        return builder;
      },
      where(condition: unknown) {
        params = new PgDialect().sqlToQuery(condition as never).params;
        return builder;
      },
      async returning() {
        const rows = rowsFor(table);
        const filtered = table === schema.teacherControlGpsChallenges
          ? rows.filter((row) => params.includes(row.challengeHash)
            && params.includes(row.actorUserId)
            && params.includes(row.schoolId)
            && params.includes(row.action)
            && (row.resourceId == null
              ? !params.some((param) => typeof param === 'number' && param !== row.actorUserId && param !== row.schoolId)
              : params.includes(row.resourceId))
            && row.consumedAt == null
            && row.expiresAt instanceof Date
            && row.expiresAt > new Date())
          : table === schema.teacherControlSessions
            ? rows.filter((row) => params.includes(row.id))
            : [];
        for (const row of filtered) Object.assign(row, values);
        return filtered;
      },
    };
    return builder;
  });
  const deleteRows = vi.fn((table: unknown) => {
    let params: unknown[] = [];
    const builder: any = {
      where(condition: unknown) {
        params = new PgDialect().sqlToQuery(condition as never).params;
        return builder;
      },
      then(resolve: (value: undefined) => unknown, reject?: (error: unknown) => unknown) {
        const rows = rowsFor(table);
        const retained = rows.filter((row) => {
          if (table === schema.teacherControlGpsChallenges) {
            return !(row.expiresAt instanceof Date && row.expiresAt < new Date());
          }
          return !params.includes(row.schoolId);
        });
        rows.splice(0, rows.length, ...retained);
        return Promise.resolve(undefined).then(resolve, reject);
      },
    };
    return builder;
  });
  const db = {
    select,
    insert,
    update,
    delete: deleteRows,
    transaction: async <T>(callback: (tx: typeof db) => Promise<T>): Promise<T> => {
      const snapshot = {
        memberships: structuredClone(mockDatabaseState.memberships),
        schools: structuredClone(mockDatabaseState.schools),
        gpsSettings: structuredClone(mockDatabaseState.gpsSettings),
        auditEvents: structuredClone(mockDatabaseState.auditEvents),
        teachers: structuredClone(mockDatabaseState.teachers),
        assignments: structuredClone(mockDatabaseState.assignments),
        classTeacherAssociations: structuredClone(mockDatabaseState.classTeacherAssociations),
        teacherSubjectAssociations: structuredClone(mockDatabaseState.teacherSubjectAssociations),
        classes: structuredClone(mockDatabaseState.classes),
        subjects: structuredClone(mockDatabaseState.subjects),
        hourlyRates: structuredClone(mockDatabaseState.hourlyRates),
        sessions: structuredClone(mockDatabaseState.sessions),
        regularizationRequests: structuredClone(mockDatabaseState.regularizationRequests),
        challenges: structuredClone(mockDatabaseState.challenges),
      };
      try {
        return await callback(db);
      } catch (error) {
        Object.assign(mockDatabaseState, snapshot);
        throw error;
      }
    },
  };
  return { db };
});

import { registerTeacherControlApi } from './api.ts';

describe('teacher control API authorization and input validation', () => {
  beforeEach(() => {
    mockActor.role = 'teacher';
    mockActor.id = 501;
    mockActor.schoolId = 8;
    mockActor.name = 'Test actor';
    mockActor.email = 'actor@example.test';
    mockDatabaseState.memberships = [{ userId: 501, schoolId: 8, role: 'school_admin', isActive: true }];
    mockDatabaseState.schools = [{ id: 8, name: 'School Eight', isSuspended: false }];
    mockDatabaseState.gpsSettings = [];
    mockDatabaseState.auditEvents = [];
    mockDatabaseState.teachers = [];
    mockDatabaseState.assignments = [];
    mockDatabaseState.classTeacherAssociations = [];
    mockDatabaseState.teacherSubjectAssociations = [];
    mockDatabaseState.classes = [];
    mockDatabaseState.subjects = [];
    mockDatabaseState.hourlyRates = [];
    mockDatabaseState.sessions = [];
    mockDatabaseState.regularizationRequests = [];
    mockDatabaseState.challenges = [];
    mockDatabaseState.failAuditInsert = false;
  });

  const createTestApp = () => {
    const testApp = express();
    testApp.use(express.json());
    registerTeacherControlApi(testApp, {
      resolveActor: async () => mockActor,
      requireAuth: (_req, _res, next) => next(),
    });
    return testApp;
  };

  it('rejects unsupported raw roles for protected configuration and GPS operations', async () => {
    mockActor.role = 'surveillant';
    const testApp = createTestApp();

    const settingsResponse = await request(testApp).get('/api/teacher-control/gps-settings');
    expect(settingsResponse.status).toBe(403);

    const challengeResponse = await request(testApp)
      .post('/api/teacher-control/gps-challenges')
      .send({ action: 'start_session' });
    expect(challengeResponse.status).toBe(403);
  });

  it('requires a super admin to select an explicit school for configuration access', async () => {
    mockActor.role = 'super_admin';
    mockActor.schoolId = null;
    const response = await request(createTestApp()).get('/api/teacher-control/gps-settings');

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('schoolId');
  });

  it('creates a short-lived navigation cookie only for an authenticated teacher with enabled GPS', async () => {
    mockDatabaseState.memberships = [{ userId: 501, schoolId: 8, role: 'teacher', isActive: true }];
    mockDatabaseState.teachers = [{ id: 21, userId: 501, schoolId: 8 }];
    mockDatabaseState.gpsSettings = [{
      id: 4,
      schoolId: 8,
      isEnabled: true,
      latitude: '6.1375',
      longitude: '1.2123',
      geofenceRadiusMeters: 200,
    }];

    const response = await request(createTestApp())
      .post('/api/teacher-control/teacher-document-session')
      .set('Authorization', 'Bearer existing-access-token')
      .send({});

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ready: true });
    expect(JSON.stringify(response.body)).not.toContain('existing-access-token');
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['set-cookie'][0]).toMatch(
      /^ecoletrack_teacher_document_auth=existing-access-token; Path=\/teacher-control\/teacher; Max-Age=60; HttpOnly; SameSite=Strict/,
    );
  });

  it('rejects malformed GPS data before attempting any session mutation', async () => {
    const response = await request(createTestApp())
      .post('/api/teacher-control/sessions/start')
      .send({ classId: 1, subjectId: 2, latitude: '6.1', longitude: 1.2, accuracyMeters: 10 });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('must be numbers');
  });

  it('returns a session audit timeline with GPS coordinates redacted from stored values', async () => {
    mockActor.role = 'school_admin';
    mockDatabaseState.sessions = [{
      id: 44,
      schoolId: 8,
      teacherId: 21,
      status: 'completed',
    }];
    mockDatabaseState.auditEvents = [
      {
        id: 5,
        schoolId: 8,
        resourceType: 'session',
        resourceId: 44,
        actorRole: 'teacher',
        actorNameSnapshot: 'Afi Mensah',
        actorEmailSnapshot: 'afi@example.test',
        action: 'session_started',
        reason: null,
        beforeValues: null,
        afterValues: { latitude: 6.1, longitude: 1.2, startDistanceMeters: 12 },
        createdAt: new Date('2026-10-31T08:00:00.000Z'),
      },
      {
        id: 6,
        schoolId: 8,
        resourceType: 'session',
        resourceId: 44,
        actorRole: 'school_admin',
        actorNameSnapshot: 'Admin école',
        actorEmailSnapshot: 'admin@example.test',
        action: 'session_closed_without_end',
        reason: 'Absence constatée',
        beforeValues: { gpsCoordinates: { lat: 6.1, lon: 1.2 }, status: 'open' },
        afterValues: { status: 'closed_without_end' },
        createdAt: new Date('2026-10-31T09:00:00.000Z'),
      },
    ];

    const response = await request(createTestApp()).get('/api/teacher-control/sessions/44/audit');

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(2);
    expect(response.body[0]).toMatchObject({
      action: 'session_started',
      afterValues: { startDistanceMeters: 12 },
    });
    expect(response.body[0].afterValues).not.toHaveProperty('latitude');
    expect(response.body[0].afterValues).not.toHaveProperty('longitude');
    expect(response.body[1].beforeValues).toEqual({ status: 'open' });
    expect(response.body[1].reason).toBe('Absence constatée');
  });

  it('rejects invalid server-side session filter values', async () => {
    mockActor.role = 'school_admin';
    const response = await request(createTestApp()).get('/api/teacher-control/sessions?status=unknown');

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('status is invalid');
  });

  it('includes existing and deleted schools in global statistics only for super admins', async () => {
    mockActor.role = 'school_admin';
    const deniedResponse = await request(createTestApp()).get('/api/teacher-control/statistics/global');
    expect(deniedResponse.status).toBe(403);

    mockActor.role = 'super_admin';
    mockDatabaseState.schools.push({ id: 10, name: 'School Ten', isSuspended: false });
    mockDatabaseState.sessions = [
      {
        id: 61,
        schoolId: 8,
        status: 'completed',
        startedAt: new Date('2026-10-31T08:00:00.000Z'),
        validatedEndedAt: new Date('2026-10-31T09:00:00.000Z'),
        hourlyRateXofSnapshot: 1800,
      },
      {
        id: 62,
        schoolId: 99,
        status: 'completed',
        startedAt: new Date('2026-10-31T08:00:00.000Z'),
        validatedEndedAt: new Date('2026-10-31T08:30:00.000Z'),
        hourlyRateXofSnapshot: null,
      },
    ];

    const response = await request(createTestApp()).get('/api/teacher-control/statistics/global');

    expect(response.status).toBe(200);
    expect(response.body.totalSessions).toBe(2);
    expect(response.body.validatedDurationMilliseconds).toBe(5_400_000);
    expect(response.body.estimatedCompensationXof).toBe(1800);
    expect(response.body.schools).toEqual(expect.arrayContaining([
      expect.objectContaining({ schoolId: 8, schoolName: 'School Eight', totalSessions: 1 }),
      expect.objectContaining({ schoolId: 99, schoolName: 'École supprimée', totalSessions: 1 }),
      expect.objectContaining({
        schoolId: 10,
        schoolName: 'School Ten',
        totalSessions: 0,
        openSessions: 0,
        completedSessions: 0,
        incompleteSessions: 0,
        regularizedSessions: 0,
        pendingRegularizations: 0,
        validatedDurationMilliseconds: 0,
        estimatedCompensationXof: 0,
      }),
    ]));
  });

  it('keeps session history scoped to the school-admin school despite a different schoolId query', async () => {
    mockActor.role = 'school_admin';
    mockDatabaseState.sessions = [
      { id: 71, schoolId: 8, startedAt: new Date('2026-10-31T08:00:00.000Z'), status: 'open' },
      { id: 72, schoolId: 9, startedAt: new Date('2026-10-31T08:00:00.000Z'), status: 'open' },
    ];

    const response = await request(createTestApp()).get('/api/teacher-control/sessions?schoolId=9');

    expect(response.status).toBe(200);
    expect(response.body.items).toHaveLength(1);
    expect(response.body.items[0]).toMatchObject({ id: 71, schoolId: 8 });
  });

  it('updates GPS configuration only in the school-admin scope and records before and after values', async () => {
    mockActor.role = 'school_admin';
    mockDatabaseState.gpsSettings = [{
      id: 4,
      schoolId: 8,
      schoolNameSnapshot: 'School Eight',
      isEnabled: false,
      latitude: null,
      longitude: null,
      geofenceRadiusMeters: 200,
    }];
    const response = await request(createTestApp())
      .put('/api/teacher-control/gps-settings')
      .send({
        schoolId: 999,
        isEnabled: true,
        latitude: 6.1375,
        longitude: 1.2123,
        geofenceRadiusMeters: 250,
      });

    expect(response.status).toBe(200);
    expect(response.body.schoolId).toBe(8);
    expect(response.body.isEnabled).toBe(true);
    expect(response.body.geofenceRadiusMeters).toBe(250);
    expect(mockDatabaseState.auditEvents).toHaveLength(1);
    expect(mockDatabaseState.auditEvents[0]).toMatchObject({
      action: 'gps_settings_updated',
      resourceType: 'gps_settings',
      actorRole: 'school_admin',
      beforeValues: { isEnabled: false, geofenceRadiusMeters: 200 },
      afterValues: { isEnabled: true, latitude: '6.1375', longitude: '1.2123', geofenceRadiusMeters: 250 },
    });
  });

  it('rolls back a GPS configuration update when its audit insert fails', async () => {
    mockActor.role = 'school_admin';
    mockDatabaseState.failAuditInsert = true;
    const response = await request(createTestApp())
      .put('/api/teacher-control/gps-settings')
      .send({ isEnabled: false, latitude: null, longitude: null, geofenceRadiusMeters: 300 });

    expect(response.status).toBe(500);
    expect(mockDatabaseState.gpsSettings).toHaveLength(0);
    expect(mockDatabaseState.auditEvents).toHaveLength(0);
  });

  it('starts a session only with an active exact assignment and consumes the GPS challenge once', async () => {
    mockDatabaseState.memberships = [{ userId: 501, schoolId: 8, role: 'teacher', isActive: true }];
    mockDatabaseState.teachers = [{ id: 21, userId: 501, schoolId: 8 }];
    mockDatabaseState.classTeacherAssociations = [{
      id: 301,
      teacherId: 21,
      schoolId: 8,
      classId: 31,
      className: '6e A',
      classSchoolId: 8,
    }];
    mockDatabaseState.teacherSubjectAssociations = [{
      id: 401,
      teacherId: 21,
      schoolId: 8,
      subjectId: 41,
      subjectName: 'Mathématiques',
      subjectSchoolId: 8,
    }];
    mockDatabaseState.assignments = [{
      id: 91,
      teacherId: 21,
      schoolId: 8,
      classId: 31,
      subjectId: 41,
      isActive: true,
    }];
    mockDatabaseState.classes = [{ id: 31, schoolId: 8, name: '6e A' }];
    mockDatabaseState.subjects = [{ id: 41, name: 'Mathématiques' }];
    mockDatabaseState.gpsSettings = [{
      id: 4,
      schoolId: 8,
      schoolNameSnapshot: 'School Eight',
      isEnabled: true,
      latitude: '6.1375',
      longitude: '1.2123',
      geofenceRadiusMeters: 200,
    }];
    const app = createTestApp();

    const challengeResponse = await request(app)
      .post('/api/teacher-control/gps-challenges')
      .send({ action: 'start_session' });
    expect(challengeResponse.status).toBe(200);
    const startBody = {
      classId: 31,
      subjectId: 41,
      latitude: 6.1375,
      longitude: 1.2123,
      accuracyMeters: 100,
      startedAt: '2099-12-31T23:59:59.999Z',
      gpsChallenge: challengeResponse.body.challenge,
    };

    const requestStartedAt = Date.now();
    const startResponse = await request(app).post('/api/teacher-control/sessions/start').send(startBody);
    const responseReceivedAt = Date.now();
    expect(startResponse.status).toBe(200);
    expect(startResponse.body).toMatchObject({
      schoolId: 8,
      teacherId: 21,
      classId: 31,
      subjectId: 41,
      status: 'open',
      startDistanceMeters: 0,
      startAccuracyMeters: 100,
      startGeofenceRadiusMeters: 200,
    });
    expect(Date.parse(startResponse.body.startedAt)).toBeGreaterThanOrEqual(requestStartedAt);
    expect(Date.parse(startResponse.body.startedAt)).toBeLessThanOrEqual(responseReceivedAt);
    expect(startResponse.body.startedAt).not.toBe(startBody.startedAt);
    expect(startResponse.body).not.toHaveProperty('latitude');
    expect(startResponse.body).not.toHaveProperty('longitude');
    expect(mockDatabaseState.auditEvents).toHaveLength(1);
    expect(mockDatabaseState.auditEvents[0]).toMatchObject({
      action: 'session_started',
      resourceType: 'session',
      actorRole: 'teacher',
    });

    const replayResponse = await request(app).post('/api/teacher-control/sessions/start').send(startBody);
    expect(replayResponse.status).toBe(409);
    expect(mockDatabaseState.sessions).toHaveLength(1);
    expect(mockDatabaseState.auditEvents).toHaveLength(1);

    const endChallengeResponse = await request(app)
      .post('/api/teacher-control/gps-challenges')
      .send({ action: 'end_session', sessionId: startResponse.body.id });
    expect(endChallengeResponse.status).toBe(200);
    const endRequestStartedAt = Date.now();
    const endResponse = await request(app)
      .post(`/api/teacher-control/sessions/${startResponse.body.id}/end`)
      .send({
        latitude: 6.1375,
        longitude: 1.2123,
        accuracyMeters: 20,
        validatedEndedAt: '2099-12-31T23:59:59.999Z',
        endedAt: '2099-12-31T23:59:59.999Z',
        gpsChallenge: endChallengeResponse.body.challenge,
      });
    const endResponseReceivedAt = Date.now();
    expect(endResponse.status).toBe(200);
    expect(endResponse.body.status).toBe('completed');
    expect(Date.parse(endResponse.body.validatedEndedAt)).toBeGreaterThanOrEqual(endRequestStartedAt);
    expect(Date.parse(endResponse.body.validatedEndedAt)).toBeLessThanOrEqual(endResponseReceivedAt);
    expect(endResponse.body.validatedEndedAt).not.toBe('2099-12-31T23:59:59.999Z');
    expect(mockDatabaseState.auditEvents).toHaveLength(2);
  });

  it('rejects a GPS challenge when the teacher or school changes before session start', async () => {
    mockDatabaseState.memberships = [
      { userId: 501, schoolId: 8, role: 'teacher', isActive: true },
      { userId: 502, schoolId: 8, role: 'teacher', isActive: true },
      { userId: 501, schoolId: 9, role: 'teacher', isActive: true },
    ];
    mockDatabaseState.schools.push({ id: 9, name: 'School Nine', isSuspended: false });
    mockDatabaseState.teachers = [
      { id: 21, userId: 501, schoolId: 8 },
      { id: 22, userId: 502, schoolId: 8 },
      { id: 23, userId: 501, schoolId: 9 },
    ];
    mockDatabaseState.classTeacherAssociations = [
      { id: 301, teacherId: 21, schoolId: 8, classId: 31, className: '6e A', classSchoolId: 8 },
      { id: 302, teacherId: 22, schoolId: 8, classId: 32, className: '5e B', classSchoolId: 8 },
      { id: 303, teacherId: 23, schoolId: 9, classId: 33, className: '4e C', classSchoolId: 9 },
    ];
    mockDatabaseState.teacherSubjectAssociations = [
      { id: 401, teacherId: 21, schoolId: 8, subjectId: 41, subjectName: 'Mathématiques', subjectSchoolId: 8 },
      { id: 402, teacherId: 22, schoolId: 8, subjectId: 42, subjectName: 'Histoire', subjectSchoolId: 8 },
      { id: 403, teacherId: 23, schoolId: 9, subjectId: 43, subjectName: 'Sciences', subjectSchoolId: 9 },
    ];
    mockDatabaseState.classes = [
      { id: 31, schoolId: 8, name: '6e A' },
      { id: 32, schoolId: 8, name: '5e B' },
      { id: 33, schoolId: 9, name: '4e C' },
    ];
    mockDatabaseState.subjects = [
      { id: 41, name: 'Mathématiques' },
      { id: 42, name: 'Histoire' },
      { id: 43, name: 'Sciences' },
    ];
    mockDatabaseState.gpsSettings = [
      {
        id: 4,
        schoolId: 8,
        isEnabled: true,
        latitude: '6.1375',
        longitude: '1.2123',
        geofenceRadiusMeters: 200,
      },
      {
        id: 5,
        schoolId: 9,
        isEnabled: true,
        latitude: '6.1375',
        longitude: '1.2123',
        geofenceRadiusMeters: 200,
      },
    ];
    const app = createTestApp();
    const challenge = await request(app)
      .post('/api/teacher-control/gps-challenges')
      .send({ action: 'start_session' });
    expect(challenge.status).toBe(200);
    const challengeToken = challenge.body.challenge as string;
    const startBody = {
      classId: 32,
      subjectId: 42,
      latitude: 6.1375,
      longitude: 1.2123,
      accuracyMeters: 20,
      gpsChallenge: challengeToken,
    };
    const hashedChallenge = createHash('sha256').update(challengeToken).digest('hex');

    mockActor.id = 502;
    const otherTeacherResponse = await request(app).post('/api/teacher-control/sessions/start').send(startBody);
    expect(otherTeacherResponse.status).toBe(409);

    mockActor.id = 501;
    mockActor.schoolId = 9;
    const otherSchoolResponse = await request(app).post('/api/teacher-control/sessions/start').send({
      ...startBody,
      classId: 33,
      subjectId: 43,
    });
    expect(otherSchoolResponse.status).toBe(409);
    const storedChallenge = mockDatabaseState.challenges.find((entry) => entry.challengeHash === hashedChallenge);
    expect(storedChallenge).toMatchObject({ actorUserId: 501, schoolId: 8 });
    expect(storedChallenge?.consumedAt).toBeUndefined();
    expect(mockDatabaseState.sessions).toHaveLength(0);
  });

  it('lists existing teacher classes and subjects without creating a canonical assignment', async () => {
    mockDatabaseState.memberships = [{ userId: 501, schoolId: 8, role: 'teacher', isActive: true }];
    mockDatabaseState.teachers = [{ id: 21, userId: 501, schoolId: 8 }];
    mockDatabaseState.classTeacherAssociations = [
      { id: 301, teacherId: 21, schoolId: 8, classId: 31, className: '6e A', classSchoolId: 8 },
      { id: 302, teacherId: 21, schoolId: 8, classId: 32, className: '5e B', classSchoolId: 9 },
      { id: 303, teacherId: 22, schoolId: 8, classId: 33, className: '4e C', classSchoolId: 8 },
      { id: 304, teacherId: 21, schoolId: 8, classId: 34, className: '3e D', classSchoolId: null, classApproved: true },
    ];
    mockDatabaseState.teacherSubjectAssociations = [
      { id: 401, teacherId: 21, schoolId: 8, subjectId: 41, subjectName: 'Mathématiques', subjectSchoolId: 8 },
      { id: 402, teacherId: 21, schoolId: 8, subjectId: 42, subjectName: 'Histoire', subjectSchoolId: 9 },
      { id: 403, teacherId: 22, schoolId: 8, subjectId: 43, subjectName: 'Physique', subjectSchoolId: 8 },
      { id: 404, teacherId: 21, schoolId: 8, subjectId: 44, subjectName: 'Sciences', subjectSchoolId: null, subjectApproved: true },
    ];
    mockDatabaseState.gpsSettings = [{
      id: 4,
      schoolId: 8,
      schoolNameSnapshot: 'School Eight',
      isEnabled: true,
      latitude: '6.1375',
      longitude: '1.2123',
      geofenceRadiusMeters: 200,
    }];

    const response = await request(createTestApp()).get('/api/teacher-control/assignments');

    expect(response.status).toBe(200);
    expect(response.body).toEqual(expect.arrayContaining([
      { classId: 31, className: '6e A', subjectId: 41, subjectName: 'Mathématiques' },
      { classId: 31, className: '6e A', subjectId: 44, subjectName: 'Sciences' },
      { classId: 34, className: '3e D', subjectId: 41, subjectName: 'Mathématiques' },
      { classId: 34, className: '3e D', subjectId: 44, subjectName: 'Sciences' },
    ]));
    expect(response.body).toHaveLength(4);
    expect(mockDatabaseState.assignments).toHaveLength(0);

    for (const pair of [{ classId: 33, subjectId: 43 }, { classId: 32, subjectId: 42 }]) {
      const start = await request(createTestApp()).post('/api/teacher-control/sessions/start').send({
        ...pair,
        latitude: 6.1375,
        longitude: 1.2123,
        accuracyMeters: 20,
        gpsChallenge: 'unused-challenge',
      });
      expect(start.status).toBe(403);
    }
  });

  it('starts and closes a session from existing associations without creating an assignment row', async () => {
    mockDatabaseState.memberships = [{ userId: 501, schoolId: 8, role: 'teacher', isActive: true }];
    mockDatabaseState.teachers = [{ id: 21, userId: 501, schoolId: 8 }];
    mockDatabaseState.classTeacherAssociations = [{
      id: 301,
      teacherId: 21,
      schoolId: 8,
      classId: 31,
      className: '6e A',
      classSchoolId: 8,
    }];
    mockDatabaseState.teacherSubjectAssociations = [{
      id: 401,
      teacherId: 21,
      schoolId: 8,
      subjectId: 41,
      subjectName: 'Mathématiques',
      subjectSchoolId: 8,
    }];
    mockDatabaseState.gpsSettings = [{
      id: 4,
      schoolId: 8,
      schoolNameSnapshot: 'School Eight',
      isEnabled: true,
      latitude: '6.1375',
      longitude: '1.2123',
      geofenceRadiusMeters: 200,
    }];
    const app = createTestApp();
    const invalidPair = await request(app).post('/api/teacher-control/sessions/start').send({
      classId: 31,
      subjectId: 42,
      latitude: 6.1375,
      longitude: 1.2123,
      accuracyMeters: 20,
      gpsChallenge: 'unused-challenge',
    });
    expect(invalidPair.status).toBe(403);

    const challenge = await request(app)
      .post('/api/teacher-control/gps-challenges')
      .send({ action: 'start_session' });
    expect(challenge.status).toBe(200);
    const start = await request(app).post('/api/teacher-control/sessions/start').send({
      classId: 31,
      subjectId: 41,
      latitude: 6.1375,
      longitude: 1.2123,
      accuracyMeters: 20,
      gpsChallenge: challenge.body.challenge,
    });

    expect(start.status).toBe(200);
    expect(start.body).toMatchObject({
      teachingAssignmentId: null,
      classTeacherAssociationId: 301,
      teacherSubjectAssociationId: 401,
      classId: 31,
      subjectId: 41,
      classNameSnapshot: '6e A',
      subjectNameSnapshot: 'Mathématiques',
    });
    expect(mockDatabaseState.assignments).toHaveLength(0);

    const endChallenge = await request(app).post('/api/teacher-control/gps-challenges').send({
      action: 'end_session',
      sessionId: start.body.id,
    });
    expect(endChallenge.status).toBe(200);
    const invalidEndValidation = await request(app)
      .post(`/api/teacher-control/sessions/${start.body.id}/validate-end`)
      .send({
        latitude: 6.1375,
        longitude: 1.2123,
        accuracyMeters: 20,
        gpsChallenge: `${endChallenge.body.challenge}invalid`,
      });
    expect(invalidEndValidation.status).toBe(409);

    const outsideGeofenceValidation = await request(app)
      .post(`/api/teacher-control/sessions/${start.body.id}/validate-end`)
      .send({
        latitude: 7,
        longitude: 2,
        accuracyMeters: 20,
        gpsChallenge: endChallenge.body.challenge,
      });
    expect(outsideGeofenceValidation.status).toBe(400);
    expect(mockDatabaseState.sessions[0].status).toBe('open');
    expect(mockDatabaseState.challenges[1].consumedAt).toBeUndefined();

    const endValidation = await request(app)
      .post(`/api/teacher-control/sessions/${start.body.id}/validate-end`)
      .send({
        latitude: 6.1375,
        longitude: 1.2123,
        accuracyMeters: 20,
        gpsChallenge: endChallenge.body.challenge,
        validatedEndedAt: '2000-01-01T00:00:00.000Z',
      });
    expect(endValidation.status).toBe(200);
    expect(endValidation.headers['cache-control']).toBe('no-store');
    expect(endValidation.body).toMatchObject({
      sessionId: start.body.id,
      latitude: 6.1375,
      longitude: 1.2123,
    });
    expect(endValidation.body.validatedAt).not.toBe('2000-01-01T00:00:00.000Z');
    expect(mockDatabaseState.sessions[0].status).toBe('open');
    expect(mockDatabaseState.challenges[1].consumedAt).toBeUndefined();

    const end = await request(app).post(`/api/teacher-control/sessions/${start.body.id}/end`).send({
      latitude: 6.1375,
      longitude: 1.2123,
      accuracyMeters: 20,
      gpsChallenge: endChallenge.body.challenge,
      validatedEndedAt: '2000-01-01T00:00:00.000Z',
    });
    expect(end.status).toBe(200);
    expect(end.body).toMatchObject({ status: 'completed', teachingAssignmentId: null });
    expect(end.body.validatedEndedAt).not.toBe('2000-01-01T00:00:00.000Z');
    expect(mockDatabaseState.sessions).toHaveLength(1);
    expect(mockDatabaseState.auditEvents).toHaveLength(2);
    const duplicateEnd = await request(app).post(`/api/teacher-control/sessions/${start.body.id}/end`).send({
      latitude: 6.1375,
      longitude: 1.2123,
      accuracyMeters: 20,
      gpsChallenge: endChallenge.body.challenge,
    });
    expect(duplicateEnd.status).toBe(404);
    expect(mockDatabaseState.auditEvents).toHaveLength(2);
  });

  it('does not let legacy associations bypass an explicitly inactive class-subject pair', async () => {
    mockDatabaseState.memberships = [{ userId: 501, schoolId: 8, role: 'teacher', isActive: true }];
    mockDatabaseState.teachers = [{ id: 21, userId: 501, schoolId: 8 }];
    mockDatabaseState.classTeacherAssociations = [{
      id: 301,
      teacherId: 21,
      schoolId: 8,
      classId: 31,
      className: '6e A',
      classSchoolId: 8,
    }];
    mockDatabaseState.teacherSubjectAssociations = [{
      id: 401,
      teacherId: 21,
      schoolId: 8,
      subjectId: 41,
      subjectName: 'Mathématiques',
      subjectSchoolId: 8,
    }];
    mockDatabaseState.assignments = [{
      id: 91,
      teacherId: 21,
      schoolId: 8,
      classId: 31,
      subjectId: 41,
      isActive: false,
    }];
    mockDatabaseState.gpsSettings = [{
      id: 4,
      schoolId: 8,
      schoolNameSnapshot: 'School Eight',
      isEnabled: true,
      latitude: '6.1375',
      longitude: '1.2123',
      geofenceRadiusMeters: 200,
    }];

    const response = await request(createTestApp()).get('/api/teacher-control/assignments');

    expect(response.status).toBe(200);
    expect(response.body).toEqual([]);
    const start = await request(createTestApp()).post('/api/teacher-control/sessions/start').send({
      classId: 31,
      subjectId: 41,
      latitude: 6.1375,
      longitude: 1.2123,
      accuracyMeters: 20,
      gpsChallenge: 'unused-challenge',
    });
    expect(start.status).toBe(403);
    expect(mockDatabaseState.sessions).toHaveLength(0);
  });

  it('keeps already archived canonical sessions readable after association compatibility changes', async () => {
    mockActor.role = 'school_admin';
    mockDatabaseState.sessions = [{
      id: 77,
      schoolId: 8,
      teacherId: 21,
      teachingAssignmentId: 91,
      classTeacherAssociationId: null,
      teacherSubjectAssociationId: null,
      classId: 31,
      classNameSnapshot: '6e A',
      subjectId: 41,
      subjectNameSnapshot: 'Mathématiques',
      status: 'completed',
      startedAt: new Date('2026-10-30T08:00:00.000Z'),
      validatedEndedAt: new Date('2026-10-30T09:00:00.000Z'),
      hourlyRateXofSnapshot: 1500,
    }];

    const response = await request(createTestApp()).get('/api/teacher-control/sessions');

    expect(response.status).toBe(200);
    expect(response.body.items).toEqual([expect.objectContaining({
      id: 77,
      teachingAssignmentId: 91,
      classTeacherAssociationId: null,
      teacherSubjectAssociationId: null,
      classNameSnapshot: '6e A',
      subjectNameSnapshot: 'Mathématiques',
      durationMilliseconds: 3_600_000,
      estimatedAmountXof: 1500,
    })]);
  });
});
