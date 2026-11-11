import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PgDialect } from 'drizzle-orm/pg-core';
import { absenceJustifications, absences, auditEvents, classes, notifications, parents, schools, students, userSchools, users } from '../src/db/schema.ts';
import { reexamineAbsenceJustification } from '../src/lib/absenceJustificationApi.ts';

const mockState = {
  users: [{ id: 7, uid: 'test-user', email: 'parent@example.com', name: 'Parent Test', role: 'parent', schoolId: 1, isDeleted: false }],
  schools: [{ id: 1 }],
  parents: [{ id: 2, userId: 7, studentId: 20, schoolId: 1 }],
  userSchools: [
    { id: 1, userId: 7, schoolId: 1, role: 'parent', isActive: true },
    { id: 2, userId: 7, schoolId: 1, role: 'school_admin', isActive: true },
    { id: 3, userId: 7, schoolId: 1, role: 'teacher', isActive: true },
  ],
  students: [{ id: 20, schoolId: 1, classId: 10, firstName: 'Awa', parentId: 2 }],
  classes: [{ id: 10, schoolId: 1 }],
  absence: {
    id: 30,
    studentId: 20,
    classId: 10,
    justificationStatus: null as string | null,
    justificationReason: null as string | null,
    rejectionReason: null as string | null,
    isJustified: false,
  },
  insertedJustification: null as any,
  auditEvents: [] as any[],
  notifications: [] as any[],
  rowLocks: [] as string[],
};

const createSelectBuilder = () => {
  const builder: any = {
    table: null as any,
    condition: null as any,
    from(table: any) {
      builder.table = table;
      return builder;
    },
    where(condition: any) {
      builder.condition = condition;
      return builder;
    },
    innerJoin() {
      return builder;
    },
    leftJoin() {
      return builder;
    },
    orderBy() {
      return builder;
    },
    limit() {
      return builder;
    },
    for(lockMode: string) {
      if (builder.table === absences) mockState.rowLocks.push(lockMode);
      return builder;
    },
    then(resolve: (value: any) => void, reject: (reason?: any) => void) {
      const rows = builder.table === users
        ? mockState.users
        : builder.table === schools
        ? mockState.schools
        : builder.table === parents
          ? mockState.parents
          : builder.table === userSchools
            ? mockState.userSchools
          : builder.table === students
            ? mockState.students
            : builder.table === classes
              ? mockState.classes
              : builder.table === absences
                ? [mockState.absence]
                : [];
      const query = builder.condition ? new PgDialect().sqlToQuery(builder.condition) : { sql: '', params: [] };
      const conditions = Array.from(query.sql.matchAll(/"[^"]+"\."([^"]+)"\s*=\s*\$(\d+)/g), (match: any) => ({
        key: match[1].replace(/_([a-z])/g, (_: string, letter: string) => letter.toUpperCase()),
        value: query.params[Number(match[2]) - 1],
      }));
      const filteredRows = rows.filter((row: any) => (
        conditions.every(({ key, value }: any) => !(key in row) || row[key] === value)
        && (builder.table !== userSchools || row.isActive !== false)
      ));
      return Promise.resolve(filteredRows).then(resolve, reject);
    },
    catch(reject: (reason?: any) => void) {
      return Promise.resolve([]).catch(reject);
    },
    finally(callback: () => void) {
      return Promise.resolve([]).finally(callback);
    },
  };
  return builder;
};

let transactionTail: Promise<void> = Promise.resolve();
const mockDb = {
  select: () => createSelectBuilder(),
  execute: async () => [],
  update: (table: any) => ({
    set: (values: Record<string, any>) => ({
      where: (condition: any) => ({
        returning: async () => {
          const query = condition ? new PgDialect().sqlToQuery(condition) : { sql: '', params: [] };
          const conditions = Array.from(query.sql.matchAll(/"[^"]+"\."([^"]+)"\s*=\s*\$(\d+)/g), (match: any) => ({
            key: match[1].replace(/_([a-z])/g, (_: string, letter: string) => letter.toUpperCase()),
            value: query.params[Number(match[2]) - 1],
          }));
          if (table === absences && conditions.every(({ key, value }: any) => mockState.absence[key] === value)) {
            Object.assign(mockState.absence, values);
            return [mockState.absence];
          }
          return [];
        },
      }),
    }),
  }),
  insert: (table: any) => ({
    values: (values: any) => {
      if (table === absenceJustifications) mockState.insertedJustification = values;
      if (table === auditEvents) mockState.auditEvents.push({ id: mockState.auditEvents.length + 1, ...values });
      if (table === notifications) mockState.notifications.push(values);
      return {
        returning: async () => [{ id: 1, ...values }],
      };
    },
  }),
  transaction: async (callback: (tx: any) => Promise<any>) => {
    const previousTransaction = transactionTail;
    let releaseTransaction!: () => void;
    transactionTail = new Promise<void>((resolve) => {
      releaseTransaction = resolve;
    });
    await previousTransaction;
    const absenceSnapshot = { ...mockState.absence };
    const auditSnapshot = mockState.auditEvents.slice();
    const notificationSnapshot = mockState.notifications.slice();
    try {
      return await callback(mockDb);
    } catch (error) {
      Object.assign(mockState.absence, absenceSnapshot);
      mockState.auditEvents.splice(0, mockState.auditEvents.length, ...auditSnapshot);
      mockState.notifications.splice(0, mockState.notifications.length, ...notificationSnapshot);
      throw error;
    } finally {
      releaseTransaction();
    }
  },
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
      const role = req.headers['x-test-role'] || req.headers['x-simulated-role'] || 'parent';
      req.user = {
        uid: `sim-${role}`,
        email: 'parent@example.com',
        role,
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
      const role = req.headers['x-test-role'] || 'parent';
      req.user = {
        uid: `sim-${role}`,
        email: 'parent@example.com',
        role,
        schoolId: 1,
        id: 7,
        simulated: true,
      };
      next();
    },
  };
});

describe('absence justification routes', () => {
  let app: any;
  let uploadRoot: string;
  let originalUploadsDir: string | undefined;
  let originalInternalSecret: string | undefined;

  beforeAll(async () => {
    originalUploadsDir = process.env.UPLOADS_DIR;
    originalInternalSecret = process.env.INTERNAL_SECRET;
    uploadRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'absence-justification-route-'));
    process.env.UPLOADS_DIR = uploadRoot;
    process.env.INTERNAL_SECRET = 'absence-justification-test-secret';
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true })));
    const serverModule = await import('../server.ts');
    app = await serverModule.createApp();
  });

  beforeEach(() => {
    transactionTail = Promise.resolve();
    mockState.users = [{ id: 7, uid: 'test-user', email: 'parent@example.com', name: 'Parent Test', role: 'parent', schoolId: 1, isDeleted: false }];
    mockState.schools = [{ id: 1 }];
    mockState.parents = [{ id: 2, userId: 7, studentId: 20, schoolId: 1 }];
    mockState.userSchools = [
      { id: 1, userId: 7, schoolId: 1, role: 'parent', isActive: true },
      { id: 2, userId: 7, schoolId: 1, role: 'school_admin', isActive: true },
      { id: 3, userId: 7, schoolId: 1, role: 'teacher', isActive: true },
      { id: 4, userId: 7, schoolId: 1, role: 'surveillant', isActive: true },
    ];
    mockState.students = [{ id: 20, schoolId: 1, classId: 10, firstName: 'Awa', parentId: 2 }];
    mockState.classes = [{ id: 10, schoolId: 1 }];
    mockState.absence = {
      id: 30,
      studentId: 20,
      classId: 10,
      justificationStatus: null,
      justificationReason: null,
      rejectionReason: null,
      isJustified: false,
    };
    mockState.insertedJustification = null;
    mockState.auditEvents = [];
    mockState.notifications = [];
    mockState.rowLocks = [];
    vi.mocked(globalThis.fetch).mockClear();
  });

  afterAll(() => {
    if (originalUploadsDir === undefined) delete process.env.UPLOADS_DIR;
    else process.env.UPLOADS_DIR = originalUploadsDir;
    if (originalInternalSecret === undefined) delete process.env.INTERNAL_SECRET;
    else process.env.INTERNAL_SECRET = originalInternalSecret;
    vi.unstubAllGlobals();
    fs.rmSync(uploadRoot, { recursive: true, force: true });
  });

  it('rejects every non-parent role before processing text or uploaded files', async () => {
    const file = Buffer.from('test justification');
    const roles = ['school_admin', 'super_admin', 'teacher', 'surveillant', 'student'];

    for (const role of roles) {
      const textOnly = await request(app)
        .put('/api/absences/30/justify')
        .set('x-test-role', role)
        .send({ justificationReason: 'Maladie' })
        .expect(403);
      expect(textOnly.body.code).toBe('JUSTIFICATION_PARENT_ONLY');

      const fileOnly = await request(app)
        .post('/api/absences/30/justifications')
        .set('x-test-role', role)
        .attach('files', file, { filename: 'certificat.pdf', contentType: 'application/pdf' })
        .expect(403);
      expect(fileOnly.body.code).toBe('JUSTIFICATION_PARENT_ONLY');

      const textAndFile = await request(app)
        .post('/api/absences/30/justifications')
        .set('x-test-role', role)
        .field('justificationReason', 'Maladie')
        .attach('files', file, { filename: 'certificat.pdf', contentType: 'application/pdf' })
        .expect(403);
      expect(textAndFile.body.code).toBe('JUSTIFICATION_PARENT_ONLY');
    }
  });

  it('accepts parent text-only submissions as PENDING', async () => {
    const response = await request(app)
      .put('/api/absences/30/justify')
      .set('x-test-role', 'parent')
      .send({ justificationReason: 'Maladie' })
      .expect(200);

    expect(response.body.justificationStatus).toBe('PENDING');
    expect(response.body.isJustified).toBe(false);
  });

  it('accepts parent text and file submissions as PENDING', async () => {
    const response = await request(app)
      .post('/api/absences/30/justifications')
      .set('x-test-role', 'parent')
      .field('justificationReason', 'Maladie')
      .attach('files', Buffer.from('test justification'), { filename: 'certificat.pdf', contentType: 'application/pdf' })
      .expect(201);

    expect(response.body.justificationStatus).toBe('PENDING');
    expect(response.body.isJustified).toBe(false);
    expect(response.body.justificationFilesCount).toBe(1);
  });

  it('returns an explicit zero pending count when a parent has no students', async () => {
    mockState.parents = [];

    const response = await request(app)
      .get('/api/dashboard/summary')
      .set('x-test-role', 'parent')
      .expect(200);

    expect(response.body.absenceStatusCounts).toEqual({ justified: 0, unjustified: 0, pending: 0, declared: 0 });
  });

  it('returns an explicit zero pending count when a teacher has no classes', async () => {
    const response = await request(app)
      .get('/api/dashboard/summary')
      .set('x-test-role', 'teacher')
      .expect(200);

    expect(response.body.absenceStatusCounts).toEqual({ justified: 0, unjustified: 0, pending: 0, declared: 0 });
  });

  it('keeps administrator approval and rejection available', async () => {
    const approved = await request(app)
      .put('/api/absences/30/justification/review')
      .set('x-test-role', 'school_admin')
      .send({ status: 'APPROVED' })
      .expect(200);
    expect(approved.body.justificationStatus).toBe('APPROVED');
    expect(approved.body.isJustified).toBe(true);

    const rejected = await request(app)
      .put('/api/absences/30/justification/review')
      .set('x-test-role', 'school_admin')
      .send({ status: 'REJECTED', rejectionReason: 'Document illisible' })
      .expect(200);
    expect(rejected.body.justificationStatus).toBe('REJECTED');
    expect(rejected.body.isJustified).toBe(false);
    expect(mockState.notifications.map(({ title }) => title)).toEqual([
      "Justification d'absence validée",
      "Justification d'absence rejetée",
    ]);
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(vi.mocked(globalThis.fetch).mock.calls[1][1]?.body))).toMatchObject({
      metadata: { status: 'REJECTED', rejectionReason: 'Document illisible' },
      dedupeKey: expect.stringContaining('-REJECTED-'),
    });
  });

  it('reexamines a rejected justification, keeps the original refusal in audit, and notifies the parent', async () => {
    const originalReviewedAt = new Date('2026-09-04T10:30:00.000Z');
    mockState.users[0] = {
      ...mockState.users[0],
      name: 'Administratrice',
      role: 'school_admin',
    };
    mockState.absence = {
      ...mockState.absence,
      justificationStatus: 'REJECTED',
      rejectionReason: 'Document illisible',
      reviewedBy: 7,
      reviewedAt: originalReviewedAt,
    };
    vi.mocked(globalThis.fetch).mockClear();

    const response = await request(app)
      .put('/api/absences/30/justification/reexamine')
      .set('x-test-role', 'school_admin')
      .send({})
      .expect(200);

    expect(response.body.justificationStatus).toBe('APPROVED');
    expect(response.body.isJustified).toBe(true);
    expect(response.body.rejectionReason).toBeNull();
    expect(response.body.reviewedBy).toBe(7);
    expect(response.body.reviewedAt).toBeTruthy();
    expect(mockState.absence.id).toBe(30);
    expect(mockState.absence.justificationStatus).toBe('APPROVED');
    expect(mockState.rowLocks).toEqual(['update']);
    expect(mockState.auditEvents).toHaveLength(2);
    expect(mockState.auditEvents[0]).toMatchObject({
      actorUserId: 7,
      actorRole: 'school_admin',
      actorName: 'Administratrice',
      actorEmail: 'parent@example.com',
      action: 'preserve_rejected_justification_decision',
      resourceType: 'absence_justification',
      resourceId: 30,
    });
    expect(mockState.auditEvents[0].description).toContain('Document illisible');
    expect(mockState.auditEvents[0].description).toContain(originalReviewedAt.toISOString());
    expect(mockState.auditEvents[0].description).toContain('"reviewerName":"Administratrice"');
    expect(mockState.auditEvents[0].description).toContain('"reviewerEmail":"parent@example.com"');
    expect(mockState.auditEvents[0].description).toContain('"reviewerRole":"school_admin"');
    expect(mockState.auditEvents[1]).toMatchObject({
      actorUserId: 7,
      actorRole: 'school_admin',
      action: 'approve_rejected_justification_after_reexamination',
      resourceType: 'absence_justification',
      resourceId: 30,
    });
    expect(mockState.auditEvents[1].createdAt).toBeInstanceOf(Date);
    expect(mockState.notifications).toHaveLength(1);
    expect(mockState.notifications[0]).toMatchObject({
      userId: 7,
      title: "Justification d'absence validée après réexamen",
    });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(vi.mocked(globalThis.fetch).mock.calls[0][1]?.body))).toMatchObject({
      metadata: { absenceId: 30, status: 'APPROVED', reexamined: true },
      dedupeKey: 'absence-justification-reexamination-30',
    });
  });

  it('sends the App reexamination request through apiFetch to the registered route', async () => {
    mockState.users[0] = {
      ...mockState.users[0],
      name: 'Administratrice',
      role: 'school_admin',
    };
    mockState.absence = {
      ...mockState.absence,
      justificationStatus: 'REJECTED',
      rejectionReason: 'Document illisible',
      reviewedBy: 7,
      reviewedAt: new Date('2026-09-04T10:30:00.000Z'),
    };
    const originalStorageDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    const storage = new Map<string, string>();
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, String(value)),
        removeItem: (key: string) => storage.delete(key),
      },
    });
    localStorage.setItem('ecoletrack_simulated_role', 'school_admin');
    localStorage.setItem('ecoletrack_simulated_user', JSON.stringify({
      uid: 'sim-school-admin',
      email: 'parent@example.com',
      name: 'Administratrice',
      role: 'school_admin',
      id: 7,
      schoolId: 1,
    }));
    localStorage.setItem('ecoletrack_active_school_id', '1');
    localStorage.removeItem('ecoletrack_jwt_access');

    const originalFetch = globalThis.fetch;
    const requests: Array<{ method: string; path: string; body: string | undefined }> = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url);
      if (url.pathname === '/api/internal/absence-notification') {
        return { ok: true, status: 200, json: async () => ({}) } as Response;
      }

      requests.push({
        method: init?.method ?? 'GET',
        path: url.pathname,
        body: typeof init?.body === 'string' ? init.body : undefined,
      });
      const response = await request(app)
        .put(url.pathname)
        .set(Object.fromEntries(new Headers(init?.headers).entries()))
        .send(init?.body as string | undefined);
      return {
        ok: response.ok,
        status: response.status,
        json: async () => response.body,
      } as Response;
    }) as typeof fetch;

    try {
      await reexamineAbsenceJustification(30);
    } finally {
      globalThis.fetch = originalFetch;
      if (originalStorageDescriptor) {
        Object.defineProperty(globalThis, 'localStorage', originalStorageDescriptor);
      } else {
        delete (globalThis as typeof globalThis & { localStorage?: Storage }).localStorage;
      }
    }

    expect(requests).toEqual([{
      method: 'PUT',
      path: '/api/absences/30/justification/reexamine',
      body: '{}',
    }]);
    expect(mockState.absence.justificationStatus).toBe('APPROVED');
    expect(mockState.absence.isJustified).toBe(true);
    expect(mockState.auditEvents).toHaveLength(2);
    expect(mockState.notifications).toHaveLength(1);
  });

  it('returns different HTTP errors for a missing route and a missing absence', async () => {
    const missingAbsence = await request(app)
      .put('/api/absences/999/justification/reexamine')
      .set('x-test-role', 'school_admin')
      .send({})
      .expect(404);
    expect(missingAbsence.body.error).toBe('Absence not found');

    const missingRoute = await request(app)
      .post('/api/absences/30/justification/reexamine')
      .set('x-test-role', 'school_admin')
      .send({})
      .expect(404);
    expect(missingRoute.text).toContain('Cannot POST /api/absences/30/justification/reexamine');
  });

  it.each(['PENDING', 'APPROVED'] as const)(
    'does not reexamine a justification in status %s',
    async (status) => {
      mockState.absence = {
        ...mockState.absence,
        justificationStatus: status,
        isJustified: status === 'APPROVED',
      };

      const response = await request(app)
        .put('/api/absences/30/justification/reexamine')
        .set('x-test-role', 'school_admin')
        .send({})
        .expect(409);

      expect(response.body.code).toBe('JUSTIFICATION_NOT_REJECTED');
      expect(mockState.absence.justificationStatus).toBe(status);
      expect(mockState.auditEvents).toHaveLength(0);
      expect(mockState.notifications).toHaveLength(0);
      expect(globalThis.fetch).not.toHaveBeenCalled();
    },
  );

  it.each(['surveillant', 'super_admin'] as const)(
    'allows %s to reexamine a rejected justification',
    async (role) => {
      mockState.absence.justificationStatus = 'REJECTED';

      const response = await request(app)
        .put('/api/absences/30/justification/reexamine')
        .set('x-test-role', role)
        .send({})
        .expect(200);

      expect(response.body.justificationStatus).toBe('APPROVED');
      expect(mockState.auditEvents).toHaveLength(2);
      expect(mockState.notifications).toHaveLength(1);
    },
  );

  it('allows only one concurrent reexamination and rejects repeats without duplicate notifications', async () => {
    mockState.absence = {
      ...mockState.absence,
      justificationStatus: 'REJECTED',
      rejectionReason: 'Certificat à vérifier',
      reviewedBy: 7,
      reviewedAt: new Date('2026-09-04T10:30:00.000Z'),
    };
    vi.mocked(globalThis.fetch).mockClear();

    const responses = await Promise.all([
      request(app).put('/api/absences/30/justification/reexamine').set('x-test-role', 'school_admin').send({}),
      request(app).put('/api/absences/30/justification/reexamine').set('x-test-role', 'school_admin').send({}),
    ]);

    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    expect(mockState.absence.justificationStatus).toBe('APPROVED');
    expect(mockState.auditEvents).toHaveLength(2);
    expect(mockState.notifications).toHaveLength(1);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);

    await request(app)
      .put('/api/absences/30/justification/reexamine')
      .set('x-test-role', 'school_admin')
      .send({})
      .expect(409);
    expect(mockState.auditEvents).toHaveLength(2);
    expect(mockState.notifications).toHaveLength(1);
  });

  it.each(['parent', 'teacher', 'student'])('denies %s from reexamining rejected justifications', async (role) => {
    mockState.absence.justificationStatus = 'REJECTED';

    await request(app)
      .put('/api/absences/30/justification/reexamine')
      .set('x-test-role', role)
      .send({})
      .expect(403);

    expect(mockState.absence.justificationStatus).toBe('REJECTED');
    expect(mockState.auditEvents).toHaveLength(0);
  });

  it('requires an active school membership and the student class to be in the actor scope', async () => {
    mockState.absence.justificationStatus = 'REJECTED';
    mockState.userSchools = mockState.userSchools.filter((membership) => membership.role !== 'school_admin');
    await request(app)
      .put('/api/absences/30/justification/reexamine')
      .set('x-test-role', 'school_admin')
      .send({})
      .expect(403);

    mockState.userSchools.push({ id: 5, userId: 7, schoolId: 1, role: 'school_admin', isActive: true });
    mockState.students[0].schoolId = 2;
    mockState.classes[0].schoolId = 2;
    await request(app)
      .put('/api/absences/30/justification/reexamine')
      .set('x-test-role', 'school_admin')
      .send({})
      .expect(403);

    mockState.students[0].schoolId = 1;
    mockState.classes[0].schoolId = 2;
    await request(app)
      .put('/api/absences/30/justification/reexamine')
      .set('x-test-role', 'school_admin')
      .send({})
      .expect(403);
    expect(mockState.absence.justificationStatus).toBe('REJECTED');
    expect(mockState.auditEvents).toHaveLength(0);
  });

  it('continues to block a parent resubmission after REJECTED', async () => {
    mockState.absence.justificationStatus = 'REJECTED';

    const response = await request(app)
      .put('/api/absences/30/justify')
      .set('x-test-role', 'parent')
      .send({ justificationReason: 'Nouvelle demande' })
      .expect(409);

    expect(response.body.code).toBe('JUSTIFICATION_ALREADY_REJECTED');
  });

  it('accepts a parent APK relay authenticated with the internal HMAC', async () => {
    const file = Buffer.from('relay justification');
    const payload = {
      absenceId: '30',
      parentId: '7',
      justificationReason: 'Maladie',
      fileName: 'certificat.pdf',
      fileMimeType: 'application/pdf',
      fileSize: String(file.length),
      fileSha256: crypto.createHash('sha256').update(file).digest('hex'),
    };
    const timestamp = Date.now().toString();
    const signature = crypto
      .createHmac('sha256', process.env.INTERNAL_SECRET!)
      .update(`${JSON.stringify(payload)}${timestamp}`)
      .digest('hex');

    const response = await request(app)
      .post('/api/internal/absence-justification')
      .set('X-Internal-Signature', signature)
      .set('X-Internal-Timestamp', timestamp)
      .field('absenceId', payload.absenceId)
      .field('parentId', payload.parentId)
      .field('justificationReason', payload.justificationReason)
      .field('fileName', payload.fileName)
      .field('fileMimeType', payload.fileMimeType)
      .field('fileSize', payload.fileSize)
      .field('fileSha256', payload.fileSha256)
      .attach('file', file, { filename: payload.fileName, contentType: payload.fileMimeType })
      .expect(201);

    expect(response.body.justificationStatus).toBe('PENDING');
    expect(response.body.isJustified).toBe(false);
  });

  it('rejects a signed internal submission whose asserted account is not a parent', async () => {
    mockState.users[0].role = 'teacher';
    const file = Buffer.from('relay justification');
    const payload = {
      absenceId: '30',
      parentId: '7',
      justificationReason: 'Maladie',
      fileName: 'certificat.pdf',
      fileMimeType: 'application/pdf',
      fileSize: String(file.length),
      fileSha256: crypto.createHash('sha256').update(file).digest('hex'),
    };
    const timestamp = Date.now().toString();
    const signature = crypto
      .createHmac('sha256', process.env.INTERNAL_SECRET!)
      .update(`${JSON.stringify(payload)}${timestamp}`)
      .digest('hex');

    const response = await request(app)
      .post('/api/internal/absence-justification')
      .set('X-Internal-Signature', signature)
      .set('X-Internal-Timestamp', timestamp)
      .field('absenceId', payload.absenceId)
      .field('parentId', payload.parentId)
      .field('justificationReason', payload.justificationReason)
      .field('fileName', payload.fileName)
      .field('fileMimeType', payload.fileMimeType)
      .field('fileSize', payload.fileSize)
      .field('fileSha256', payload.fileSha256)
      .attach('file', file, { filename: payload.fileName, contentType: payload.fileMimeType })
      .expect(403);

    expect(response.body.code).toBe('JUSTIFICATION_PARENT_ONLY');
  });
});