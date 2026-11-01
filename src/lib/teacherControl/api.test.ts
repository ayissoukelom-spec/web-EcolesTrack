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
  regularizationDecisions: [] as Array<Record<string, unknown>>,
  challenges: [] as Array<Record<string, unknown>>,
  lockOrder: [] as string[],
  teacherLockHooks: null as null | {
    onAcquired: () => void;
    onWaiting: () => void;
    hold: Promise<void>;
  },
  skipConcurrentRollback: false,
  failAuditInsert: false,
}));

vi.mock('../../db/index.ts', async () => {
  const { PgDialect } = await import('drizzle-orm/pg-core');
  const schema = await import('../../db/schema.ts');
  const teacherLocks = new Map<string, { held: boolean; waiters: Array<() => void> }>();
  const acquireTeacherLock = async (key: string, context: { releases: Array<() => void> }) => {
    let lock = teacherLocks.get(key);
    if (!lock) {
      lock = { held: false, waiters: [] };
      teacherLocks.set(key, lock);
    }
    const alreadyHeld = lock.held;
    if (alreadyHeld) {
      mockDatabaseState.teacherLockHooks?.onWaiting();
      await new Promise<void>((resolve) => lock?.waiters.push(resolve));
    } else {
      lock.held = true;
    }
    if (!alreadyHeld) {
      const hooks = mockDatabaseState.teacherLockHooks;
      hooks?.onAcquired();
      if (hooks) await hooks.hold;
    }
    context.releases.push(() => {
      const next = lock?.waiters.shift();
      if (next) next();
      else if (lock) lock.held = false;
    });
  };
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
    if (table === schema.teacherControlRegularizationDecisions) return mockDatabaseState.regularizationDecisions;
    if (table === schema.teacherControlGpsChallenges) return mockDatabaseState.challenges;
    return [];
  };
  const select = vi.fn((selection?: Record<string, unknown>, context?: { releases: Array<() => void> }) => {
    const builder: any = {
      table: null as unknown,
      selection,
      joinedTables: new Set<unknown>(),
      whereSql: '',
      params: [] as unknown[],
      hasWhere: false,
      grouped: false,
      lockMode: null as string | null,
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
      for(lockMode?: string) {
        builder.lockMode = lockMode ?? null;
        return builder;
      },
      async then(resolve: (value: Array<Record<string, unknown>>) => unknown, reject?: (error: unknown) => unknown) {
        if (builder.lockMode === 'update') {
          if (builder.table === schema.teachers) {
            const teacher = mockDatabaseState.teachers.find((row) => (
              builder.params.includes(row.id) && builder.params.includes(row.schoolId)
            ));
            if (teacher && context) {
              await acquireTeacherLock(`${teacher.id}:${teacher.schoolId}`, context);
            }
            mockDatabaseState.lockOrder.push('teacher');
          }
          if (builder.table === schema.teacherControlSessions) mockDatabaseState.lockOrder.push('session');
          if (builder.table === schema.teacherControlRegularizationRequests) mockDatabaseState.lockOrder.push('request');
        }
        if (builder.table === schema.teacherControlSessions && builder.grouped && builder.selection?.name) {
          let optionRows = [...mockDatabaseState.sessions];
          if (builder.hasWhere) {
            optionRows = optionRows.filter((row) => builder.params.every((param: unknown) => Object.values(row).includes(param)));
          }
          const idColumn = builder.selection.id;
          const nameColumn = builder.selection.name;
          const idKey = idColumn === schema.teacherControlSessions.teacherId ? 'teacherId'
            : idColumn === schema.teacherControlSessions.classId ? 'classId'
              : 'subjectId';
          const nameKey = nameColumn === schema.teacherControlSessions.teacherNameSnapshot ? 'teacherNameSnapshot'
            : nameColumn === schema.teacherControlSessions.classNameSnapshot ? 'classNameSnapshot'
              : 'subjectNameSnapshot';
          const groupedOptions = new Map<string, Record<string, unknown>>();
          for (const row of optionRows) {
            const option = {
              id: row[idKey],
              name: row[nameKey],
              schoolName: row.schoolNameSnapshot,
            };
            groupedOptions.set(`${option.id}:${option.name}:${option.schoolName}`, option);
          }
          return Promise.resolve([...groupedOptions.values()]).then(resolve, reject);
        }
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
              gpsCompletedSessions: completedSessions.filter((row) => row.endSource === 'gps').length,
              incompleteSessionRegularizations: completedSessions.filter((row) => row.startSource === 'gps' && row.endSource === 'regularization').length,
              gpsDurationMilliseconds: completedSessions.filter((row) => row.endSource === 'gps').reduce((total, session) => (
                total + new Date(session.validatedEndedAt as string | Date).getTime()
                  - new Date(session.startedAt as string | Date).getTime()
              ), 0),
              incompleteRegularizedDurationMilliseconds: completedSessions.filter((row) => row.startSource === 'gps' && row.endSource === 'regularization').reduce((total, session) => (
                total + new Date(session.validatedEndedAt as string | Date).getTime()
                  - new Date(session.startedAt as string | Date).getTime()
              ), 0),
              immediateRegularizedSessions: sessions.filter((row) => row.regularizationOrigin === 'immediate_report').length,
              immediateRegularizedDurationMilliseconds: completedSessions.filter((row) => row.regularizationOrigin === 'immediate_report').reduce((total, session) => (
                total + new Date(session.validatedEndedAt as string | Date).getTime()
                  - new Date(session.startedAt as string | Date).getTime()
              ), 0),
              lateRegularizedSessions: sessions.filter((row) => row.regularizationOrigin === 'late_declaration').length,
              lateRegularizedDurationMilliseconds: completedSessions.filter((row) => row.regularizationOrigin === 'late_declaration').reduce((total, session) => (
                total + new Date(session.validatedEndedAt as string | Date).getTime()
                  - new Date(session.startedAt as string | Date).getTime()
              ), 0),
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
          if (builder.selection?.teacherName) {
            rows = rows.map((row) => ({
              schoolId: row.schoolId,
              schoolName: row.schoolNameSnapshot,
              teacherId: row.teacherId,
              teacherName: row.teacherNameSnapshot,
              classId: row.classId,
              className: row.classNameSnapshot,
              subjectId: row.subjectId,
              subjectName: row.subjectNameSnapshot,
            }));
          }
        } else if (builder.table === schema.teacherControlRegularizationRequests) {
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
        return Promise.resolve(rows.map((row) => ({ ...row }))).then(resolve, reject);
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
            : table === schema.teacherControlRegularizationRequests
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
    const context = { releases: [] as Array<() => void> };
    const tx = {
      ...db,
      select: (selection?: Record<string, unknown>) => select(selection, context),
    };
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
        regularizationDecisions: structuredClone(mockDatabaseState.regularizationDecisions),
        challenges: structuredClone(mockDatabaseState.challenges),
      };
      try {
        return await callback(tx);
      } catch (error) {
        if (!mockDatabaseState.skipConcurrentRollback) Object.assign(mockDatabaseState, snapshot);
        throw error;
      } finally {
        for (const release of context.releases.reverse()) release();
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
    mockDatabaseState.regularizationDecisions = [];
    mockDatabaseState.challenges = [];
    mockDatabaseState.lockOrder = [];
    mockDatabaseState.teacherLockHooks = null;
    mockDatabaseState.skipConcurrentRollback = false;
    mockDatabaseState.failAuditInsert = false;
  });

  const createDeferred = () => {
    let resolve!: () => void;
    const promise = new Promise<void>((complete) => {
      resolve = complete;
    });
    return { promise, resolve };
  };

  const createTestApp = () => {
    const testApp = express();
    testApp.use(express.json());
    registerTeacherControlApi(testApp, {
      resolveActor: async () => mockActor,
      requireAuth: (_req, _res, next) => next(),
    });
    return testApp;
  };

  const configureUnrecordedTeacher = () => {
    mockActor.role = 'teacher';
    mockDatabaseState.memberships = [{ userId: 501, schoolId: 8, role: 'teacher', isActive: true }];
    mockDatabaseState.schools = [{ id: 8, name: 'School Eight', isSuspended: false }];
    mockDatabaseState.teachers = [{ id: 21, userId: 501, schoolId: 8 }];
    mockDatabaseState.classTeacherAssociations = [{
      id: 31, teacherId: 21, schoolId: 8, classId: 41, className: '6e A', classSchoolId: 8,
    }];
    mockDatabaseState.teacherSubjectAssociations = [{
      id: 32, teacherId: 21, schoolId: 8, subjectId: 51, subjectName: 'Mathématiques', subjectSchoolId: 8,
    }];
    mockDatabaseState.assignments = [{
      id: 33, teacherId: 21, schoolId: 8, classId: 41, subjectId: 51, isActive: true,
    }];
    mockDatabaseState.hourlyRates = [{
      id: 34, schoolId: 8, teacherId: 21, hourlyRateXof: 3600,
    }];
  };

  const configureUnrecordedAdmin = () => {
    mockActor.role = 'school_admin';
    mockDatabaseState.memberships = [{ userId: 501, schoolId: 8, role: 'school_admin', isActive: true }];
    mockDatabaseState.teachers = [{ id: 21, userId: 601, schoolId: 8 }];
  };

  const configureGpsStart = async () => {
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
    return {
      app,
      startBody: {
        classId: 31,
        subjectId: 41,
        latitude: 6.1375,
        longitude: 1.2123,
        accuracyMeters: 500,
        gpsChallenge: challengeResponse.body.challenge as string,
      },
    };
  };

  const configureTeacherRegularization = () => {
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

  it('returns filter options only from the school-admin school and rejects a forged school scope', async () => {
    mockActor.role = 'school_admin';
    mockActor.schoolId = 8;
    mockDatabaseState.memberships = [{ userId: 501, schoolId: 8, role: 'school_admin', isActive: true }];
    mockDatabaseState.schools = [
      { id: 8, name: 'School Eight', isSuspended: false },
      { id: 9, name: 'School Nine', isSuspended: false },
    ];
    mockDatabaseState.sessions = [
      {
        id: 1, schoolId: 8, schoolNameSnapshot: 'School Eight', teacherId: 21, teacherNameSnapshot: 'Afi Mensah',
        classId: 31, classNameSnapshot: '6e A', subjectId: 41, subjectNameSnapshot: 'Mathématiques',
      },
      {
        id: 2, schoolId: 9, schoolNameSnapshot: 'School Nine', teacherId: 22, teacherNameSnapshot: 'Kossi Doe',
        classId: 32, classNameSnapshot: '5e B', subjectId: 42, subjectNameSnapshot: 'Histoire',
      },
    ];
    const app = createTestApp();

    const options = await request(app).get('/api/teacher-control/filter-options');
    expect(options.status).toBe(200);
    expect(options.body).toEqual({
      teachers: [{ id: 21, name: 'Afi Mensah' }],
      classes: [{ id: 31, name: '6e A' }],
      subjects: [{ id: 41, name: 'Mathématiques' }],
    });

    const forgedOptions = await request(app).get('/api/teacher-control/filter-options?schoolId=9');
    const forgedSessions = await request(app).get('/api/teacher-control/sessions?schoolId=9');
    const forgedStatistics = await request(app).get('/api/teacher-control/statistics?schoolId=9');
    expect(forgedOptions.status).toBe(403);
    expect(forgedSessions.status).toBe(403);
    expect(forgedStatistics.status).toBe(403);
  });

  it('limits super-admin filter options to existing selectable schools and supports the all-schools scope', async () => {
    mockActor.role = 'super_admin';
    mockActor.schoolId = null;
    mockDatabaseState.schools = [
      { id: 8, name: 'School Eight', isSuspended: false },
      { id: 9, name: 'School Nine', isSuspended: false },
    ];
    mockDatabaseState.sessions = [
      {
        id: 1, schoolId: 8, schoolNameSnapshot: 'School Eight', teacherId: 21, teacherNameSnapshot: 'Afi Mensah',
        classId: 31, classNameSnapshot: '6e A', subjectId: 41, subjectNameSnapshot: 'Mathématiques',
      },
      {
        id: 2, schoolId: 9, schoolNameSnapshot: 'School Nine', teacherId: 22, teacherNameSnapshot: 'Kossi Doe',
        classId: 32, classNameSnapshot: '5e B', subjectId: 42, subjectNameSnapshot: 'Histoire',
      },
    ];
    const app = createTestApp();

    const scoped = await request(app).get('/api/teacher-control/filter-options?schoolId=9');
    expect(scoped.status).toBe(200);
    expect(scoped.body.teachers).toEqual([{ id: 22, name: 'Kossi Doe' }]);

    const allSchools = await request(app).get('/api/teacher-control/filter-options');
    expect(allSchools.status).toBe(200);
    expect(allSchools.body.teachers).toEqual([
      { id: 21, name: 'Afi Mensah · School Eight' },
      { id: 22, name: 'Kossi Doe · School Nine' },
    ]);

    const unavailableSchool = await request(app).get('/api/teacher-control/filter-options?schoolId=999');
    expect(unavailableSchool.status).toBe(404);
  });

  it('records an immediate report with an immutable server timestamp and unverified GPS evidence', async () => {
    mockActor.role = 'teacher';
    mockDatabaseState.memberships = [{ userId: 501, schoolId: 8, role: 'teacher', isActive: true }];
    mockDatabaseState.schools = [{ id: 8, name: 'School Eight', isSuspended: false }];
    mockDatabaseState.teachers = [{ id: 21, userId: 501, schoolId: 8 }];
    mockDatabaseState.classTeacherAssociations = [{
      id: 31, teacherId: 21, schoolId: 8, classId: 41, className: '6e A', classSchoolId: 8,
    }];
    mockDatabaseState.teacherSubjectAssociations = [{
      id: 32, teacherId: 21, schoolId: 8, subjectId: 51, subjectName: 'Mathématiques', subjectSchoolId: 8,
    }];
    mockDatabaseState.assignments = [{
      id: 33, teacherId: 21, schoolId: 8, classId: 41, subjectId: 51, isActive: true,
    }];
    const response = await request(createTestApp())
      .post('/api/teacher-control/regularizations/unrecorded')
      .send({
        requestType: 'immediate_report',
        classId: 41,
        subjectId: 51,
        incidentType: 'gps_accuracy',
        reason: 'Précision insuffisante',
        description: 'Le démarrage a échoué.',
        latitude: 6.1375,
        longitude: 1.2123,
        accuracyMeters: 135,
        startedAt: '2026-10-31T08:00:00.000Z',
      });

    expect(response.status).toBe(400);
    const accepted = await request(createTestApp())
      .post('/api/teacher-control/regularizations/unrecorded')
      .send({
        requestType: 'immediate_report',
        classId: 41,
        subjectId: 51,
        incidentType: 'gps_accuracy',
        reason: 'Précision insuffisante',
        description: 'Le démarrage a échoué.',
        latitude: 6.1375,
        longitude: 1.2123,
        accuracyMeters: 135,
      });

    expect(accepted.status).toBe(200);
    expect(accepted.body.requestType).toBe('immediate_report');
    expect(accepted.body.sessionId).toBeNull();
    expect(accepted.body.referenceStartedAt).toBe(accepted.body.createdAt);
    expect(accepted.body.referenceStartedAt).not.toBe('2026-10-31T08:00:00.000Z');
    expect(accepted.body.proposedEndedAt).toBeNull();
    expect(accepted.body.gpsLatitude).toBe('6.137500');
    expect(accepted.body.gpsAccuracyMeters).toBe('135.00');
    expect(mockDatabaseState.sessions).toHaveLength(0);

    const duplicate = await request(createTestApp())
      .post('/api/teacher-control/regularizations/unrecorded')
      .send({
        requestType: 'immediate_report',
        classId: 41,
        subjectId: 51,
        incidentType: 'gps_accuracy',
        reason: 'Un second signalement',
      });
    expect(duplicate.status).toBe(409);
  });

  it('creates an immediate report without a prior session or GPS fix using the server timestamp', async () => {
    mockActor.role = 'teacher';
    mockDatabaseState.memberships = [{ userId: 501, schoolId: 8, role: 'teacher', isActive: true }];
    mockDatabaseState.schools = [{ id: 8, name: 'School Eight', isSuspended: false }];
    mockDatabaseState.teachers = [{ id: 21, userId: 501, schoolId: 8 }];
    mockDatabaseState.classTeacherAssociations = [{
      id: 31, teacherId: 21, schoolId: 8, classId: 41, className: '6e A', classSchoolId: 8,
    }];
    mockDatabaseState.teacherSubjectAssociations = [{
      id: 32, teacherId: 21, schoolId: 8, subjectId: 51, subjectName: 'Mathématiques', subjectSchoolId: 8,
    }];
    mockDatabaseState.assignments = [{
      id: 33, teacherId: 21, schoolId: 8, classId: 41, subjectId: 51, isActive: true,
    }];

    const response = await request(createTestApp())
      .post('/api/teacher-control/regularizations/unrecorded')
      .send({
        requestType: 'immediate_report',
        classId: 41,
        subjectId: 51,
        incidentType: 'application',
        reason: 'Le démarrage est impossible.',
      });

    expect(response.status).toBe(200);
    expect(response.body.requestType).toBe('immediate_report');
    expect(response.body.sessionId).toBeNull();
    expect(response.body.referenceStartedAt).toBe(response.body.createdAt);
    expect(response.body.proposedEndedAt).toBeNull();
    expect(response.body.gpsLatitude).toBeNull();
    expect(response.body.gpsLongitude).toBeNull();
    expect(response.body.gpsAccuracyMeters).toBeNull();
    expect(mockDatabaseState.sessions).toHaveLength(0);
    expect(mockDatabaseState.regularizationRequests).toHaveLength(1);
  });

  it('blocks GPS start while an immediate report is pending and its end time is unknown', async () => {
    const { app, startBody } = await configureGpsStart();
    const referenceStartedAt = new Date(Date.now() - 60_000);
    mockDatabaseState.regularizationRequests = [{
      id: 501,
      sessionId: null,
      schoolId: 8,
      teacherId: 21,
      requestType: 'immediate_report',
      referenceStartedAt,
      declaredStartedAt: null,
      proposedEndedAt: null,
      status: 'pending',
    }];

    const response = await request(app).post('/api/teacher-control/sessions/start').send(startBody);

    expect(response.status).toBe(409);
    expect(response.body.error).toContain('overlaps another pending regularization');
    expect(mockDatabaseState.sessions).toHaveLength(0);
    expect(mockDatabaseState.lockOrder).toEqual(['teacher']);
  });

  it('serializes a route-level immediate report against GPS start and blocks the start', async () => {
    const { app, startBody } = await configureGpsStart();
    const acquired = createDeferred();
    const waiting = createDeferred();
    const release = createDeferred();
    mockDatabaseState.skipConcurrentRollback = true;
    mockDatabaseState.teacherLockHooks = {
      onAcquired: acquired.resolve,
      onWaiting: waiting.resolve,
      hold: release.promise,
    };

    try {
      const reportPromise = request(app)
        .post('/api/teacher-control/regularizations/unrecorded')
        .send({
          requestType: 'immediate_report',
          classId: 31,
          subjectId: 41,
          incidentType: 'gps_unavailable',
          reason: 'GPS indisponible',
        }).then((response) => response);
      await acquired.promise;
      const startPromise = request(app)
        .post('/api/teacher-control/sessions/start')
        .send(startBody)
        .then((response) => response);
      await waiting.promise;
      release.resolve();

      const [report, start] = await Promise.all([reportPromise, startPromise]);
      expect(report.status).toBe(200);
      expect(start.status).toBe(409);
      expect(start.body.error).toContain('overlaps another pending regularization');
      expect(mockDatabaseState.sessions).toHaveLength(0);
      expect(mockDatabaseState.regularizationRequests).toHaveLength(1);
      expect(mockDatabaseState.regularizationRequests[0].proposedEndedAt).toBeNull();
      expect(mockDatabaseState.lockOrder).toEqual(['teacher', 'teacher']);
    } finally {
      release.resolve();
      mockDatabaseState.teacherLockHooks = null;
      mockDatabaseState.skipConcurrentRollback = false;
    }
  });

  it('serializes two route-level late declarations and rejects the overlapping second period', async () => {
    configureTeacherRegularization();
    const app = createTestApp();
    const startedAt = new Date(Date.now() - 3_600_000).toISOString();
    const proposedEndedAt = new Date(Date.now() - 1_800_000).toISOString();
    const body = {
      requestType: 'late_declaration',
      classId: 31,
      subjectId: 41,
      declaredStartedAt: startedAt,
      proposedEndedAt,
      reason: 'Oubli de saisie',
    };
    const acquired = createDeferred();
    const waiting = createDeferred();
    const release = createDeferred();
    mockDatabaseState.skipConcurrentRollback = true;
    mockDatabaseState.teacherLockHooks = {
      onAcquired: acquired.resolve,
      onWaiting: waiting.resolve,
      hold: release.promise,
    };

    try {
      const firstPromise = request(app)
        .post('/api/teacher-control/regularizations/unrecorded')
        .send(body)
        .then((response) => response);
      await acquired.promise;
      const secondPromise = request(app)
        .post('/api/teacher-control/regularizations/unrecorded')
        .send(body)
        .then((response) => response);
      await waiting.promise;
      release.resolve();

      const [first, second] = await Promise.all([firstPromise, secondPromise]);
      expect(first.status).toBe(200);
      expect(second.status).toBe(409);
      expect(mockDatabaseState.regularizationRequests).toHaveLength(1);
      expect(mockDatabaseState.sessions).toHaveLength(0);
      expect(mockDatabaseState.lockOrder).toEqual(['teacher', 'teacher']);
    } finally {
      release.resolve();
      mockDatabaseState.teacherLockHooks = null;
      mockDatabaseState.skipConcurrentRollback = false;
    }
  });

  it('serializes GPS closure against an administrative decision on the same route-level session', async () => {
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
    mockDatabaseState.sessions = [{
      id: 701,
      schoolId: 8,
      schoolNameSnapshot: 'School Eight',
      teacherId: 21,
      teacherUserId: 501,
      teacherNameSnapshot: 'Test actor',
      status: 'open',
      startedAt: new Date(Date.now() - 3_600_000),
      startSource: 'gps',
      startDistanceMeters: 0,
      startAccuracyMeters: 20,
      startGeofenceRadiusMeters: 200,
      validatedEndedAt: null,
      endSource: null,
      closedAt: null,
    }];
    mockDatabaseState.regularizationRequests = [{
      id: 702,
      sessionId: 701,
      schoolId: 8,
      schoolNameSnapshot: 'School Eight',
      teacherId: 21,
      teacherNameSnapshot: 'Test actor',
      requestType: 'incomplete_session',
      proposedEndedAt: new Date(Date.now() - 60_000),
      reason: 'Déclaration de fin',
      status: 'pending',
      submittedByUserId: 501,
      submittedByNameSnapshot: 'Test actor',
      createdAt: new Date(),
      updatedAt: new Date(),
    }];
    const app = createTestApp();
    const challenge = await request(app)
      .post('/api/teacher-control/gps-challenges')
      .send({ action: 'end_session', sessionId: 701 });
    expect(challenge.status).toBe(200);

    const acquired = createDeferred();
    const waiting = createDeferred();
    const release = createDeferred();
    mockDatabaseState.skipConcurrentRollback = true;
    mockDatabaseState.teacherLockHooks = {
      onAcquired: acquired.resolve,
      onWaiting: waiting.resolve,
      hold: release.promise,
    };

    try {
      const endPromise = request(app).post('/api/teacher-control/sessions/701/end').send({
        latitude: 6.1375,
        longitude: 1.2123,
        accuracyMeters: 500,
        gpsChallenge: challenge.body.challenge,
      }).then((response) => response);
      await acquired.promise;
      mockActor.role = 'school_admin';
      mockDatabaseState.memberships = [{ userId: 501, schoolId: 8, role: 'school_admin', isActive: true }];
      const decisionPromise = request(app)
        .post('/api/teacher-control/regularizations/702/decision')
        .send({ decision: 'accepted' })
        .then((response) => response);
      await waiting.promise;
      release.resolve();

      const [end, decision] = await Promise.all([endPromise, decisionPromise]);
      expect(end.status).toBe(200);
      expect(decision.status).toBe(409);
      expect(mockDatabaseState.sessions[0]).toMatchObject({ status: 'completed', endSource: 'gps' });
      expect(mockDatabaseState.regularizationRequests[0].status).toBe('pending');
      expect(mockDatabaseState.regularizationDecisions).toHaveLength(0);
      expect(mockDatabaseState.lockOrder).toEqual(['teacher', 'session', 'teacher', 'session']);
    } finally {
      release.resolve();
      mockDatabaseState.teacherLockHooks = null;
      mockDatabaseState.skipConcurrentRollback = false;
    }
  });

  it('serializes repeated route-level decisions and creates one accepted session', async () => {
    configureTeacherRegularization();
    mockActor.role = 'school_admin';
    mockDatabaseState.memberships = [{ userId: 501, schoolId: 8, role: 'school_admin', isActive: true }];
    mockDatabaseState.teachers = [{ id: 21, userId: 601, schoolId: 8 }];
    mockDatabaseState.regularizationRequests = [{
      id: 703,
      sessionId: null,
      schoolId: 8,
      schoolNameSnapshot: 'School Eight',
      teacherId: 21,
      teacherNameSnapshot: 'Teacher One',
      requestType: 'late_declaration',
      classId: 31,
      classNameSnapshot: '6e A',
      subjectId: 41,
      subjectNameSnapshot: 'Mathématiques',
      referenceStartedAt: null,
      declaredStartedAt: new Date(Date.now() - 3_600_000),
      proposedEndedAt: new Date(Date.now() - 1_800_000),
      reason: 'Oubli',
      status: 'pending',
      submittedByUserId: 601,
      submittedByNameSnapshot: 'Teacher One',
      createdAt: new Date(),
      updatedAt: new Date(),
    }];
    const app = createTestApp();
    const acquired = createDeferred();
    const waiting = createDeferred();
    const release = createDeferred();
    mockDatabaseState.skipConcurrentRollback = true;
    mockDatabaseState.teacherLockHooks = {
      onAcquired: acquired.resolve,
      onWaiting: waiting.resolve,
      hold: release.promise,
    };

    try {
      const firstPromise = request(app)
        .post('/api/teacher-control/regularizations/703/decision')
        .send({ decision: 'accepted' })
        .then((response) => response);
      await acquired.promise;
      const secondPromise = request(app)
        .post('/api/teacher-control/regularizations/703/decision')
        .send({ decision: 'rejected', reason: 'Décision concurrente' })
        .then((response) => response);
      await waiting.promise;
      release.resolve();

      const [first, second] = await Promise.all([firstPromise, secondPromise]);
      expect(first.status).toBe(200);
      expect(second.status).toBe(404);
      expect(mockDatabaseState.regularizationRequests[0].status).toBe('accepted');
      expect(mockDatabaseState.sessions).toHaveLength(1);
      expect(mockDatabaseState.sessions[0]).toMatchObject({
        regularizationRequestId: 703,
        startSource: 'regularization',
        endSource: 'regularization',
        status: 'completed',
      });
      expect(mockDatabaseState.regularizationDecisions).toHaveLength(1);
      expect(mockDatabaseState.lockOrder).toEqual(['teacher', 'request', 'teacher', 'request']);
    } finally {
      release.resolve();
      mockDatabaseState.teacherLockHooks = null;
      mockDatabaseState.skipConcurrentRollback = false;
    }
  });

  it('allows GPS start after a historical late declaration has ended', async () => {
    const { app, startBody } = await configureGpsStart();
    mockDatabaseState.regularizationRequests = [{
      id: 502,
      sessionId: null,
      schoolId: 8,
      teacherId: 21,
      requestType: 'late_declaration',
      referenceStartedAt: null,
      declaredStartedAt: new Date(Date.now() - 3_600_000),
      proposedEndedAt: new Date(Date.now() - 1_800_000),
      status: 'pending',
    }];

    const response = await request(app).post('/api/teacher-control/sessions/start').send(startBody);

    expect(response.status).toBe(200);
    expect(mockDatabaseState.sessions).toHaveLength(1);
    expect(mockDatabaseState.lockOrder).toEqual(['teacher']);
  });

  it('rejects GPS start when a pending late-declaration interval overlaps it', async () => {
    const { app, startBody } = await configureGpsStart();
    mockDatabaseState.regularizationRequests = [{
      id: 503,
      sessionId: null,
      schoolId: 8,
      teacherId: 21,
      requestType: 'late_declaration',
      referenceStartedAt: null,
      declaredStartedAt: new Date(Date.now() - 60_000),
      proposedEndedAt: new Date(Date.now() + 60_000),
      status: 'pending',
    }];

    const response = await request(app).post('/api/teacher-control/sessions/start').send(startBody);

    expect(response.status).toBe(409);
    expect(mockDatabaseState.sessions).toHaveLength(0);
    expect(mockDatabaseState.lockOrder).toEqual(['teacher']);
  });

  it('takes teacher then session locks and rejects an overlapping immediate report', async () => {
    mockDatabaseState.memberships = [{ userId: 501, schoolId: 8, role: 'teacher', isActive: true }];
    mockDatabaseState.teachers = [{ id: 21, userId: 501, schoolId: 8 }];
    const startedAt = new Date(Date.now() - 3_600_000);
    mockDatabaseState.sessions = [{
      id: 601,
      schoolId: 8,
      teacherId: 21,
      teacherUserId: 501,
      teacherNameSnapshot: 'Test actor',
      schoolNameSnapshot: 'School Eight',
      status: 'open',
      startedAt,
      validatedEndedAt: null,
      closedAt: null,
    }];
    mockDatabaseState.regularizationRequests = [{
      id: 602,
      sessionId: null,
      schoolId: 8,
      teacherId: 21,
      requestType: 'immediate_report',
      referenceStartedAt: new Date(Date.now() - 90_000),
      proposedEndedAt: null,
      status: 'pending',
    }];

    const response = await request(createTestApp())
      .post('/api/teacher-control/sessions/601/regularizations')
      .send({
        proposedEndedAt: new Date(Date.now() - 60_000).toISOString(),
        reason: 'Clôture manquée',
      });

    expect(response.status).toBe(409);
    expect(mockDatabaseState.regularizationRequests).toHaveLength(1);
    expect(mockDatabaseState.lockOrder).toEqual(['teacher', 'session']);
  });

  it('closes an incomplete session only after taking the teacher then session lock', async () => {
    mockActor.role = 'school_admin';
    mockDatabaseState.memberships = [{ userId: 501, schoolId: 8, role: 'school_admin', isActive: true }];
    mockDatabaseState.teachers = [{ id: 21, userId: 601, schoolId: 8 }];
    mockDatabaseState.sessions = [{
      id: 603,
      schoolId: 8,
      teacherId: 21,
      teacherUserId: 601,
      teacherNameSnapshot: 'Teacher One',
      schoolNameSnapshot: 'School Eight',
      status: 'open',
      startedAt: new Date(Date.now() - 3_600_000),
      validatedEndedAt: null,
      closedAt: null,
    }];

    const response = await request(createTestApp())
      .post('/api/teacher-control/sessions/603/close-incomplete')
      .send({ reason: 'Séance abandonnée' });

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('closed_without_end');
    expect(mockDatabaseState.lockOrder).toEqual(['teacher', 'session']);
  });

  it('creates a late declaration only from an authorized pedagogical pair and server submission time', async () => {
    mockActor.role = 'teacher';
    mockDatabaseState.memberships = [{ userId: 501, schoolId: 8, role: 'teacher', isActive: true }];
    mockDatabaseState.schools = [{ id: 8, name: 'School Eight', isSuspended: false }];
    mockDatabaseState.teachers = [{ id: 21, userId: 501, schoolId: 8 }];
    mockDatabaseState.classTeacherAssociations = [{
      id: 31, teacherId: 21, schoolId: 8, classId: 41, className: '6e A', classSchoolId: 8,
    }];
    mockDatabaseState.teacherSubjectAssociations = [{
      id: 32, teacherId: 21, schoolId: 8, subjectId: 51, subjectName: 'Mathématiques', subjectSchoolId: 8,
    }];
    mockDatabaseState.assignments = [{
      id: 33, teacherId: 21, schoolId: 8, classId: 41, subjectId: 51, isActive: true,
    }];
    const now = Date.now();
    const declaredStartedAt = new Date(now - 3_600_000).toISOString();
    const proposedEndedAt = new Date(now - 1_800_000).toISOString();
    const response = await request(createTestApp())
      .post('/api/teacher-control/regularizations/unrecorded')
      .send({
        requestType: 'late_declaration',
        classId: 41,
        subjectId: 51,
        declaredStartedAt,
        proposedEndedAt,
        reason: 'Oubli de démarrage et de clôture',
      });

    expect(response.status).toBe(200);
    expect(response.body.sessionId).toBeNull();
    expect(response.body.requestType).toBe('late_declaration');
    expect(response.body.declaredStartedAt).toBe(declaredStartedAt);
    expect(response.body.proposedEndedAt).toBe(proposedEndedAt);
    expect(response.body.createdAt).not.toBe(declaredStartedAt);
    expect(mockDatabaseState.sessions).toHaveLength(0);

    const unauthorizedPair = await request(createTestApp())
      .post('/api/teacher-control/regularizations/unrecorded')
      .send({
        requestType: 'late_declaration',
        classId: 999,
        subjectId: 51,
        declaredStartedAt,
        proposedEndedAt,
        reason: 'Paire non attribuée',
      });
    expect(unauthorizedPair.status).toBe(403);

    const futureDeclaration = await request(createTestApp())
      .post('/api/teacher-control/regularizations/unrecorded')
      .send({
        requestType: 'late_declaration',
        classId: 41,
        subjectId: 51,
        declaredStartedAt,
        proposedEndedAt: new Date(Date.now() + 60_000).toISOString(),
        reason: 'Heure future',
      });
    expect(futureDeclaration.status).toBe(400);
  });

  it('lets the teacher add an end declaration to an immediate report without changing its server reference time', async () => {
    mockActor.role = 'teacher';
    mockDatabaseState.memberships = [{ userId: 501, schoolId: 8, role: 'teacher', isActive: true }];
    mockDatabaseState.schools = [{ id: 8, name: 'School Eight', isSuspended: false }];
    mockDatabaseState.teachers = [{ id: 21, userId: 501, schoolId: 8 }];
    const referenceStartedAt = new Date(Date.now() - 3_600_000);
    mockDatabaseState.regularizationRequests = [{
      id: 9,
      sessionId: null,
      schoolId: 8,
      schoolNameSnapshot: 'School Eight',
      teacherId: 21,
      teacherNameSnapshot: 'Teacher One',
      requestType: 'immediate_report',
      classId: 41,
      classNameSnapshot: '6e A',
      subjectId: 51,
      subjectNameSnapshot: 'Mathématiques',
      referenceStartedAt,
      declaredStartedAt: null,
      proposedEndedAt: null,
      reason: 'GPS unavailable',
      description: null,
      incidentType: 'gps_unavailable',
      status: 'pending',
      submittedByUserId: 501,
      submittedByNameSnapshot: 'Teacher One',
      createdAt: referenceStartedAt,
      updatedAt: referenceStartedAt,
    }];
    const app = createTestApp();
    const invalidEnd = await request(app)
      .post('/api/teacher-control/regularizations/9/complete')
      .send({ proposedEndedAt: new Date(Date.now() + 60_000).toISOString() });
    expect(invalidEnd.status).toBe(400);

    const validEndAt = new Date(Date.now() - 1_800_000).toISOString();
    const response = await request(app)
      .post('/api/teacher-control/regularizations/9/complete')
      .send({ proposedEndedAt: validEndAt, description: 'Cours terminé.' });
    expect(response.status).toBe(200);
    expect(response.body.referenceStartedAt).toBe(referenceStartedAt.toISOString());
    expect(response.body.proposedEndedAt).toBe(validEndAt);
    expect(response.body.description).toBe('Cours terminé.');
    expect(response.body.sessionId).toBeNull();
  });

  it('validates a late declaration and creates an administratively accepted session without GPS values', async () => {
    mockActor.role = 'school_admin';
    mockActor.schoolId = 8;
    mockDatabaseState.memberships = [{ userId: 501, schoolId: 8, role: 'school_admin', isActive: true }];
    mockDatabaseState.schools = [{ id: 8, name: 'School Eight', isSuspended: false }];
    mockDatabaseState.teachers = [{ id: 21, userId: 601, schoolId: 8 }];
    mockDatabaseState.classTeacherAssociations = [{
      id: 31, teacherId: 21, schoolId: 8, classId: 41, className: '6e A', classSchoolId: 8,
    }];
    mockDatabaseState.teacherSubjectAssociations = [{
      id: 32, teacherId: 21, schoolId: 8, subjectId: 51, subjectName: 'Mathématiques', subjectSchoolId: 8,
    }];
    mockDatabaseState.assignments = [{
      id: 33, teacherId: 21, schoolId: 8, classId: 41, subjectId: 51, isActive: true,
    }];
    const startedAt = new Date(Date.now() - 3_600_000).toISOString();
    const endedAt = new Date(Date.now() - 1_800_000).toISOString();
    mockDatabaseState.regularizationRequests = [{
      id: 7,
      sessionId: null,
      schoolId: 8,
      schoolNameSnapshot: 'School Eight',
      teacherId: 21,
      teacherNameSnapshot: 'Teacher One',
      requestType: 'late_declaration',
      classId: 41,
      classNameSnapshot: '6e A',
      subjectId: 51,
      subjectNameSnapshot: 'Mathématiques',
      referenceStartedAt: null,
      declaredStartedAt: new Date(startedAt),
      proposedEndedAt: new Date(endedAt),
      reason: 'Oubli de saisie',
      description: null,
      incidentType: null,
      status: 'pending',
      submittedByUserId: 601,
      submittedByNameSnapshot: 'Teacher One',
      createdAt: new Date(),
      updatedAt: new Date(),
    }];

    const response = await request(createTestApp())
      .post('/api/teacher-control/regularizations/7/decision')
      .send({ decision: 'accepted' });

    expect(response.status).toBe(200);
    expect(response.body.session.startSource).toBe('regularization');
    expect(response.body.session.regularizationOrigin).toBe('late_declaration');
    expect(response.body.session.startedAt).toBe(startedAt);
    expect(response.body.session.validatedEndedAt).toBe(endedAt);
    expect(response.body.session.endSource).toBe('regularization');
    expect(response.body.session.startDistanceMeters).toBeNull();
    expect(response.body.session.startAccuracyMeters).toBeNull();
    expect(response.body.session.endDistanceMeters).toBeNull();
    expect(response.body.request.sessionId).toBe(response.body.session.id);
    expect(response.body.request.status).toBe('accepted');
    expect(mockDatabaseState.sessions).toHaveLength(1);
    expect(mockDatabaseState.auditEvents.some((event) => event.action === 'session_created_by_regularization')).toBe(true);
    expect(mockDatabaseState.lockOrder).toEqual(['teacher', 'request']);

    const repeatedDecision = await request(createTestApp())
      .post('/api/teacher-control/regularizations/7/decision')
      .send({ decision: 'accepted' });
    expect([404, 409]).toContain(repeatedDecision.status);
    expect(mockDatabaseState.sessions).toHaveLength(1);
  });

  it.each(['immediate_report', 'late_declaration'] as const)(
    'creates then accepts an unrecorded %s request with one server-completed session',
    async (requestType) => {
      configureUnrecordedTeacher();
      const submittedAt = Date.now();
      const lateStartedAt = new Date(submittedAt - 3_600_000);
      const lateEndedAt = new Date(submittedAt - 1_800_000);
      const createResponse = await request(createTestApp())
        .post('/api/teacher-control/regularizations/unrecorded')
        .send({
          requestType,
          classId: 41,
          subjectId: 51,
          incidentType: requestType === 'immediate_report' ? 'application' : undefined,
          declaredStartedAt: requestType === 'late_declaration' ? lateStartedAt.toISOString() : undefined,
          proposedEndedAt: requestType === 'late_declaration' ? lateEndedAt.toISOString() : undefined,
          reason: requestType === 'immediate_report' ? 'Panne technique' : 'Oubli de l’application',
        });

      expect(createResponse.status).toBe(200);
      expect(createResponse.body.status).toBe('pending');
      expect(createResponse.body.sessionId).toBeNull();
      expect(mockDatabaseState.sessions).toHaveLength(0);
      expect(createResponse.body.referenceStartedAt).toBe(
        requestType === 'immediate_report' ? createResponse.body.createdAt : null,
      );
      expect(createResponse.body.declaredStartedAt).toBe(
        requestType === 'late_declaration' ? lateStartedAt.toISOString() : null,
      );

      const pendingSessions = await request(createTestApp())
        .get('/api/teacher-control/sessions?limit=50');
      expect(pendingSessions.status).toBe(200);
      expect(pendingSessions.body.items).toHaveLength(0);

      if (requestType === 'immediate_report') {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        const completion = await request(createTestApp())
          .post(`/api/teacher-control/regularizations/${createResponse.body.id}/complete`)
          .send({ proposedEndedAt: new Date().toISOString() });
        expect(completion.status).toBe(200);
        expect(completion.body.referenceStartedAt).toBe(createResponse.body.referenceStartedAt);
      }

      configureUnrecordedAdmin();
      const decision = await request(createTestApp())
        .post(`/api/teacher-control/regularizations/${createResponse.body.id}/decision`)
        .send({ decision: 'accepted' });

      expect(decision.status).toBe(200);
      expect(decision.body.request).toMatchObject({
        status: 'accepted',
        sessionId: decision.body.session.id,
      });
      expect(decision.body.session).toMatchObject({
        status: 'completed',
        startSource: 'regularization',
        regularizationOrigin: requestType,
        regularizationRequestId: createResponse.body.id,
        endSource: 'regularization',
        startDistanceMeters: null,
        startAccuracyMeters: null,
        startGeofenceRadiusMeters: null,
        endDistanceMeters: null,
        endAccuracyMeters: null,
        endGeofenceRadiusMeters: null,
      });
      expect(decision.body.session.startedAt).toBe(
        requestType === 'immediate_report'
          ? createResponse.body.referenceStartedAt
          : lateStartedAt.toISOString(),
      );
      expect(mockDatabaseState.sessions).toHaveLength(1);
      expect(mockDatabaseState.sessions[0].regularizationRequestId).toBe(createResponse.body.id);
      expect(mockDatabaseState.regularizationRequests[0].sessionId).toBe(mockDatabaseState.sessions[0].id);

      const sessions = await request(createTestApp())
        .get('/api/teacher-control/sessions?limit=50');
      expect(sessions.status).toBe(200);
      expect(sessions.body.items).toHaveLength(1);
      const listedSession = sessions.body.items[0];
      const duration = new Date(listedSession.validatedEndedAt).getTime()
        - new Date(listedSession.startedAt).getTime();
      expect(listedSession.durationMilliseconds).toBe(duration);
      expect(listedSession.estimatedAmountXof).toBe(Math.round(3600 * duration / 3_600_000));

      const repeatedDecision = await request(createTestApp())
        .post(`/api/teacher-control/regularizations/${createResponse.body.id}/decision`)
        .send({ decision: 'accepted' });
      expect([404, 409]).toContain(repeatedDecision.status);
      expect(mockDatabaseState.sessions).toHaveLength(1);
    },
  );

  it('rolls back the accepted session, request link, decision and audit when transaction work fails', async () => {
    configureUnrecordedTeacher();
    const now = Date.now();
    const createResponse = await request(createTestApp())
      .post('/api/teacher-control/regularizations/unrecorded')
      .send({
        requestType: 'late_declaration',
        classId: 41,
        subjectId: 51,
        declaredStartedAt: new Date(now - 3_600_000).toISOString(),
        proposedEndedAt: new Date(now - 1_800_000).toISOString(),
        reason: 'Oubli de l’application',
      });
    expect(createResponse.status).toBe(200);
    configureUnrecordedAdmin();
    mockDatabaseState.failAuditInsert = true;
    const auditCountBeforeDecision = mockDatabaseState.auditEvents.length;
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      const response = await request(createTestApp())
        .post(`/api/teacher-control/regularizations/${createResponse.body.id}/decision`)
        .send({ decision: 'accepted' });

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Teacher-control operation failed' });
      expect(mockDatabaseState.sessions).toHaveLength(0);
      expect(mockDatabaseState.regularizationDecisions).toHaveLength(0);
      expect(mockDatabaseState.auditEvents).toHaveLength(auditCountBeforeDecision);
      expect(mockDatabaseState.regularizationRequests[0]).toMatchObject({
        status: 'pending',
        sessionId: null,
      });
      expect(errorLog).toHaveBeenCalled();
    } finally {
      errorLog.mockRestore();
    }
  });

  it('records both declared and administrator-retained times when correcting a late declaration', async () => {
    mockActor.role = 'school_admin';
    mockActor.schoolId = 8;
    mockDatabaseState.memberships = [{ userId: 501, schoolId: 8, role: 'school_admin', isActive: true }];
    mockDatabaseState.teachers = [{ id: 21, userId: 601, schoolId: 8 }];
    mockDatabaseState.classTeacherAssociations = [{
      id: 31, teacherId: 21, schoolId: 8, classId: 41, className: '6e A', classSchoolId: 8,
    }];
    mockDatabaseState.teacherSubjectAssociations = [{
      id: 32, teacherId: 21, schoolId: 8, subjectId: 51, subjectName: 'Mathématiques', subjectSchoolId: 8,
    }];
    mockDatabaseState.assignments = [{
      id: 33, teacherId: 21, schoolId: 8, classId: 41, subjectId: 51, isActive: true,
    }];
    const declaredStartedAt = new Date(Date.now() - 3_600_000);
    const declaredEndedAt = new Date(Date.now() - 1_800_000);
    const retainedStartedAt = new Date(declaredStartedAt.getTime() - 15 * 60_000);
    const retainedEndedAt = new Date(declaredEndedAt.getTime() + 10 * 60_000);
    mockDatabaseState.regularizationRequests = [{
      id: 17,
      sessionId: null,
      schoolId: 8,
      schoolNameSnapshot: 'School Eight',
      teacherId: 21,
      teacherNameSnapshot: 'Teacher One',
      requestType: 'late_declaration',
      classId: 41,
      classNameSnapshot: '6e A',
      subjectId: 51,
      subjectNameSnapshot: 'Mathématiques',
      referenceStartedAt: null,
      declaredStartedAt,
      proposedEndedAt: declaredEndedAt,
      reason: 'Oubli de saisie',
      description: null,
      incidentType: null,
      status: 'pending',
      submittedByUserId: 601,
      submittedByNameSnapshot: 'Teacher One',
      createdAt: new Date(),
      updatedAt: new Date(),
    }];

    const response = await request(createTestApp())
      .post('/api/teacher-control/regularizations/17/decision')
      .send({
        decision: 'modified_accepted',
        reason: 'Heures corrigées après vérification',
        proposedStartedAt: retainedStartedAt.toISOString(),
        proposedEndedAt: retainedEndedAt.toISOString(),
      });

    expect(response.status).toBe(200);
    expect(response.body.session.startedAt).toBe(retainedStartedAt.toISOString());
    expect(response.body.session.validatedEndedAt).toBe(retainedEndedAt.toISOString());
    expect(response.body.decision).toMatchObject({
      decision: 'modified_accepted',
      previousProposedStartedAt: declaredStartedAt.toISOString(),
      previousProposedEndedAt: declaredEndedAt.toISOString(),
      decidedStartedAt: retainedStartedAt.toISOString(),
      decidedEndedAt: retainedEndedAt.toISOString(),
    });
    expect(mockDatabaseState.regularizationDecisions).toHaveLength(1);
  });

  it.each(['immediate_report', 'late_declaration'] as const)(
    'rejects an unrecorded %s request without creating a session or retained times',
    async (requestType) => {
    mockActor.role = 'school_admin';
    mockActor.schoolId = 8;
    mockDatabaseState.memberships = [{ userId: 501, schoolId: 8, role: 'school_admin', isActive: true }];
    mockDatabaseState.teachers = [{ id: 21, userId: 601, schoolId: 8 }];
    const declaredStartedAt = new Date(Date.now() - 3_600_000);
    const proposedEndedAt = new Date(Date.now() - 1_800_000);
    const referenceStartedAt = new Date(Date.now() - 3_600_000);
    mockDatabaseState.regularizationRequests = [{
      id: 18,
      sessionId: null,
      schoolId: 8,
      schoolNameSnapshot: 'School Eight',
      teacherId: 21,
      teacherNameSnapshot: 'Teacher One',
      requestType,
      classId: 41,
      classNameSnapshot: '6e A',
      subjectId: 51,
      subjectNameSnapshot: 'Mathématiques',
      referenceStartedAt: requestType === 'immediate_report' ? referenceStartedAt : null,
      declaredStartedAt: requestType === 'late_declaration' ? declaredStartedAt : null,
      proposedEndedAt: requestType === 'late_declaration' ? proposedEndedAt : null,
      reason: 'Demande de test',
      description: null,
      incidentType: requestType === 'immediate_report' ? 'application' : null,
      status: 'pending',
      submittedByUserId: 601,
      submittedByNameSnapshot: 'Teacher One',
      createdAt: new Date(),
      updatedAt: new Date(),
    }];

    const response = await request(createTestApp())
      .post('/api/teacher-control/regularizations/18/decision')
      .send({ decision: 'rejected', reason: 'Éléments insuffisants' });

    expect(response.status).toBe(200);
    expect(response.body.session).toBeNull();
    expect(response.body.decision).toMatchObject({
      decision: 'rejected',
      previousProposedStartedAt: (requestType === 'immediate_report' ? referenceStartedAt : declaredStartedAt).toISOString(),
      previousProposedEndedAt: requestType === 'late_declaration' ? proposedEndedAt.toISOString() : null,
      decidedStartedAt: null,
      decidedEndedAt: null,
    });
    expect(mockDatabaseState.sessions).toHaveLength(0);
    expect(mockDatabaseState.regularizationRequests[0]).toMatchObject({
      status: 'rejected',
      sessionId: null,
    });
    },
  );

  it('preserves incomplete-session regularization, including rejection without closing the session', async () => {
    mockActor.role = 'school_admin';
    mockActor.schoolId = 8;
    mockDatabaseState.memberships = [{ userId: 501, schoolId: 8, role: 'school_admin', isActive: true }];
    mockDatabaseState.schools = [{ id: 8, name: 'School Eight', isSuspended: false }];
    mockDatabaseState.teachers = [{ id: 21, userId: 601, schoolId: 8 }];
    const startedAt = new Date(Date.now() - 3_600_000);
    const proposedEndedAt = new Date(Date.now() - 1_800_000);
    mockDatabaseState.sessions = [{
      id: 4,
      schoolId: 8,
      schoolNameSnapshot: 'School Eight',
      teacherId: 21,
      teacherUserId: 601,
      teacherNameSnapshot: 'Teacher One',
      classId: 41,
      classNameSnapshot: '6e A',
      subjectId: 51,
      subjectNameSnapshot: 'Mathématiques',
      status: 'open',
      startedAt,
      startSource: 'gps',
      startDistanceMeters: 10,
      startAccuracyMeters: 20,
      startGeofenceRadiusMeters: 200,
      validatedEndedAt: null,
      endSource: null,
      closedAt: null,
    }];
    mockDatabaseState.regularizationRequests = [{
      id: 12,
      sessionId: 4,
      schoolId: 8,
      schoolNameSnapshot: 'School Eight',
      teacherId: 21,
      teacherNameSnapshot: 'Teacher One',
      requestType: 'incomplete_session',
      proposedEndedAt,
      reason: 'Sortie urgente',
      status: 'pending',
      createdAt: new Date(),
      updatedAt: new Date(),
    }];

    const app = createTestApp();
    const rejected = await request(app)
      .post('/api/teacher-control/regularizations/12/decision')
      .send({ decision: 'rejected', reason: 'Informations insuffisantes' });
    expect(rejected.status).toBe(200);
    expect(mockDatabaseState.lockOrder).toEqual(['teacher', 'session', 'request']);
    expect(rejected.body.session.status).toBe('open');
    expect(mockDatabaseState.sessions[0].status).toBe('open');
    mockDatabaseState.regularizationRequests[0].status = 'pending';
    mockDatabaseState.lockOrder = [];

    const response = await request(app)
      .post('/api/teacher-control/regularizations/12/decision')
      .send({ decision: 'accepted' });
    expect(response.status).toBe(200);
    expect(mockDatabaseState.lockOrder).toEqual(['teacher', 'session', 'request']);
    expect(response.body.session.status).toBe('completed');
    expect(response.body.session.startedAt).toBe(startedAt.toISOString());
    expect(response.body.session.validatedEndedAt).toBe(proposedEndedAt.toISOString());
    expect(response.body.session.startSource).toBe('gps');
    expect(response.body.session.endSource).toBe('regularization');
    expect(mockDatabaseState.sessions[0].status).toBe('completed');
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
        startSource: 'gps',
        endSource: 'gps',
        startedAt: new Date('2026-10-31T08:00:00.000Z'),
        validatedEndedAt: new Date('2026-10-31T09:00:00.000Z'),
        hourlyRateXofSnapshot: 1800,
      },
      {
        id: 62,
        schoolId: 99,
        status: 'completed',
        startSource: 'gps',
        endSource: 'gps',
        startedAt: new Date('2026-10-31T08:00:00.000Z'),
        validatedEndedAt: new Date('2026-10-31T08:30:00.000Z'),
        hourlyRateXofSnapshot: null,
      },
      {
        id: 63,
        schoolId: 8,
        status: 'completed',
        startSource: 'regularization',
        regularizationOrigin: 'immediate_report',
        endSource: 'regularization',
        startedAt: new Date('2026-10-31T08:00:00.000Z'),
        validatedEndedAt: new Date('2026-10-31T08:30:00.000Z'),
        hourlyRateXofSnapshot: 1800,
      },
      {
        id: 64,
        schoolId: 8,
        status: 'completed',
        startSource: 'regularization',
        regularizationOrigin: 'late_declaration',
        endSource: 'regularization',
        startedAt: new Date('2026-10-31T09:00:00.000Z'),
        validatedEndedAt: new Date('2026-10-31T09:30:00.000Z'),
        hourlyRateXofSnapshot: 1800,
      },
      {
        id: 65,
        schoolId: 8,
        status: 'completed',
        startSource: 'regularization',
        regularizationOrigin: 'immediate_report',
        endSource: 'regularization',
        startedAt: new Date('2026-10-31T10:00:00.000Z'),
        validatedEndedAt: new Date('2026-10-31T10:30:00.000Z'),
        hourlyRateXofSnapshot: null,
      },
      {
        id: 66,
        schoolId: 8,
        status: 'completed',
        startSource: 'gps',
        endSource: 'regularization',
        startedAt: new Date('2026-10-31T11:00:00.000Z'),
        validatedEndedAt: new Date('2026-10-31T11:15:00.000Z'),
        hourlyRateXofSnapshot: 1800,
      },
    ];
    mockDatabaseState.regularizationRequests = [
      { id: 101, schoolId: 8, requestType: 'immediate_report', status: 'pending', teacherId: 21, classId: 41, subjectId: 51 },
      { id: 102, schoolId: 8, requestType: 'immediate_report', status: 'rejected', teacherId: 21, classId: 41, subjectId: 51 },
    ];

    const response = await request(createTestApp()).get('/api/teacher-control/statistics/global');

    expect(response.status).toBe(200);
    expect(response.body.totalSessions).toBe(6);
    expect(response.body.validatedDurationMilliseconds).toBe(11_700_000);
    expect(response.body.estimatedCompensationXof).toBe(4050);
    expect(response.body.schools).toEqual(expect.arrayContaining([
      expect.objectContaining({
        schoolId: 8,
        totalSessions: 5,
        completedSessions: 5,
        gpsCompletedSessions: 1,
        incompleteSessionRegularizations: 1,
        incompleteRegularizedDurationMilliseconds: 900_000,
        immediateRegularizedSessions: 2,
        immediateRegularizedDurationMilliseconds: 3_600_000,
        lateRegularizedSessions: 1,
        lateRegularizedDurationMilliseconds: 1_800_000,
        gpsDurationMilliseconds: 3_600_000,
        validatedDurationMilliseconds: 9_900_000,
        estimatedCompensationXof: 4050,
      }),
    ]));
    const schoolSummary = response.body.schools.find((school: { schoolId: number }) => school.schoolId === 8);
    expect(
      schoolSummary.gpsDurationMilliseconds
      + schoolSummary.incompleteRegularizedDurationMilliseconds
      + schoolSummary.immediateRegularizedDurationMilliseconds
      + schoolSummary.lateRegularizedDurationMilliseconds,
    ).toBe(schoolSummary.validatedDurationMilliseconds);
    const allSchoolDetailedDurations = response.body.schools.reduce((total: number, school: Record<string, number>) => (
      total
      + school.gpsDurationMilliseconds
      + school.incompleteRegularizedDurationMilliseconds
      + school.immediateRegularizedDurationMilliseconds
      + school.lateRegularizedDurationMilliseconds
    ), 0);
    expect(allSchoolDetailedDurations).toBe(response.body.validatedDurationMilliseconds);
    expect(response.body.schools).toEqual(expect.arrayContaining([
      expect.objectContaining({ schoolId: 8, schoolName: 'School Eight', totalSessions: 5 }),
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

  it('rejects a school-admin session query for another school and serves its own school when unscoped', async () => {
    mockActor.role = 'school_admin';
    mockDatabaseState.sessions = [
      { id: 71, schoolId: 8, startedAt: new Date('2026-10-31T08:00:00.000Z'), status: 'open' },
      { id: 72, schoolId: 9, startedAt: new Date('2026-10-31T08:00:00.000Z'), status: 'open' },
    ];

    const app = createTestApp();
    const forgedResponse = await request(app).get('/api/teacher-control/sessions?schoolId=9');
    expect(forgedResponse.status).toBe(403);

    const response = await request(app).get('/api/teacher-control/sessions');

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
    const app = createTestApp();
    const forgedResponse = await request(app)
      .put('/api/teacher-control/gps-settings')
      .send({
        schoolId: 999,
        isEnabled: true,
        latitude: 6.1375,
        longitude: 1.2123,
        geofenceRadiusMeters: 250,
      });

    expect(forgedResponse.status).toBe(403);
    expect(mockDatabaseState.gpsSettings[0].isEnabled).toBe(false);
    const response = await request(app)
      .put('/api/teacher-control/gps-settings')
      .send({
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

    const persistedSettings = await request(app).get('/api/teacher-control/gps-settings');
    expect(persistedSettings.status).toBe(200);
    expect(persistedSettings.body.geofenceRadiusMeters).toBe(250);

    const maximumRadiusUpdate = await request(app)
      .put('/api/teacher-control/gps-settings')
      .send({ isEnabled: true, latitude: 6.1375, longitude: 1.2123, geofenceRadiusMeters: 10_000 });
    expect(maximumRadiusUpdate.status).toBe(200);
    const maximumRadiusSettings = await request(app).get('/api/teacher-control/gps-settings');
    expect(maximumRadiusSettings.body.geofenceRadiusMeters).toBe(10_000);

    for (const invalidRadius of [0, 1.5, 10_001, true, '250']) {
      const invalidUpdate = await request(app)
        .put('/api/teacher-control/gps-settings')
        .send({ isEnabled: true, latitude: 6.1375, longitude: 1.2123, geofenceRadiusMeters: invalidRadius });
      expect(invalidUpdate.status).toBe(400);
      expect(mockDatabaseState.gpsSettings[0].geofenceRadiusMeters).toBe(10_000);
    }
    expect(mockDatabaseState.auditEvents).toHaveLength(2);

    mockActor.role = 'teacher';
    const teacherUpdate = await request(app)
      .put('/api/teacher-control/gps-settings')
      .send({ isEnabled: true, latitude: 6.1375, longitude: 1.2123, geofenceRadiusMeters: 300 });
    expect(teacherUpdate.status).toBe(403);
    expect(mockDatabaseState.gpsSettings[0].geofenceRadiusMeters).toBe(10_000);
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
      geofenceRadiusMeters: 250,
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
      longitude: 1.2143,
      accuracyMeters: 501,
      startedAt: '2099-12-31T23:59:59.999Z',
      gpsChallenge: challengeResponse.body.challenge,
    };

    const impreciseStartResponse = await request(app)
      .post('/api/teacher-control/sessions/start')
      .send(startBody);
    expect(impreciseStartResponse.status).toBe(400);

    startBody.accuracyMeters = 146;
    const requestStartedAt = Date.now();
    mockDatabaseState.lockOrder = [];
    const startResponse = await request(app).post('/api/teacher-control/sessions/start').send(startBody);
    const responseReceivedAt = Date.now();
    expect(startResponse.status).toBe(200);
    expect(startResponse.body).toMatchObject({
      schoolId: 8,
      teacherId: 21,
      classId: 31,
      subjectId: 41,
      status: 'open',
      startDistanceMeters: expect.any(Number),
      startAccuracyMeters: 146,
      startGeofenceRadiusMeters: 250,
    });
    expect(startResponse.body.startDistanceMeters).toBeGreaterThan(200);
    expect(startResponse.body.startDistanceMeters).toBeLessThanOrEqual(250);
    expect(Date.parse(startResponse.body.startedAt)).toBeGreaterThanOrEqual(requestStartedAt);
    expect(Date.parse(startResponse.body.startedAt)).toBeLessThanOrEqual(responseReceivedAt);
    expect(startResponse.body.startedAt).not.toBe(startBody.startedAt);
    expect(mockDatabaseState.lockOrder).toEqual(['teacher']);
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
    mockDatabaseState.lockOrder = [];
    const endResponse = await request(app)
      .post(`/api/teacher-control/sessions/${startResponse.body.id}/end`)
      .send({
        latitude: 6.1375,
        longitude: 1.2143,
        accuracyMeters: 500,
        validatedEndedAt: '2099-12-31T23:59:59.999Z',
        endedAt: '2099-12-31T23:59:59.999Z',
        gpsChallenge: endChallengeResponse.body.challenge,
      });
    const endResponseReceivedAt = Date.now();
    expect(endResponse.status).toBe(200);
    expect(endResponse.body).toMatchObject({ status: 'completed', endGeofenceRadiusMeters: 250 });
    expect(endResponse.body.endDistanceMeters).toBeGreaterThan(200);
    expect(endResponse.body.endDistanceMeters).toBeLessThanOrEqual(250);
    expect(Date.parse(endResponse.body.validatedEndedAt)).toBeGreaterThanOrEqual(endRequestStartedAt);
    expect(Date.parse(endResponse.body.validatedEndedAt)).toBeLessThanOrEqual(endResponseReceivedAt);
    expect(endResponse.body.validatedEndedAt).not.toBe('2099-12-31T23:59:59.999Z');
    expect(mockDatabaseState.lockOrder).toEqual(['teacher', 'session']);
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
    const impreciseEndValidation = await request(app)
      .post(`/api/teacher-control/sessions/${start.body.id}/validate-end`)
      .send({
        latitude: 6.1375,
        longitude: 1.2123,
        accuracyMeters: 501,
        gpsChallenge: endChallenge.body.challenge,
      });
    expect(impreciseEndValidation.status).toBe(400);
    expect(mockDatabaseState.sessions[0].status).toBe('open');
    expect(mockDatabaseState.challenges[1].consumedAt).toBeUndefined();

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

    mockDatabaseState.lockOrder = [];
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
    expect(mockDatabaseState.lockOrder).toEqual(['teacher', 'session']);

    mockDatabaseState.lockOrder = [];
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
    expect(mockDatabaseState.lockOrder).toEqual(['teacher', 'session']);
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
