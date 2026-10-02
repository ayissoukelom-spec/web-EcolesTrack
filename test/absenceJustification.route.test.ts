import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { absenceJustifications, absences, classes, notifications, parents, students, users } from '../src/db/schema.ts';

const mockState = {
  users: [{ id: 7, uid: 'test-user', email: 'parent@example.com', name: 'Parent Test', role: 'parent', schoolId: 1, isDeleted: false }],
  parents: [{ id: 2, userId: 7, studentId: 20, schoolId: 1 }],
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
};

const createSelectBuilder = () => {
  const builder: any = {
    table: null as any,
    from(table: any) {
      builder.table = table;
      return builder;
    },
    where() {
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
    then(resolve: (value: any) => void, reject: (reason?: any) => void) {
      const rows = builder.table === users
        ? mockState.users
        : builder.table === parents
          ? mockState.parents
          : builder.table === students
            ? mockState.students
            : builder.table === classes
              ? mockState.classes
              : builder.table === absences
                ? [mockState.absence]
                : [];
      return Promise.resolve(rows).then(resolve, reject);
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

const mockDb = {
  select: () => createSelectBuilder(),
  execute: async () => [],
  update: (table: any) => ({
    set: (values: Record<string, any>) => ({
      where: () => ({
        returning: async () => {
          if (table === absences) Object.assign(mockState.absence, values);
          return [mockState.absence];
        },
      }),
    }),
  }),
  insert: (table: any) => ({
    values: (values: any) => {
      if (table === absenceJustifications) mockState.insertedJustification = values;
      return {
        returning: async () => [{ id: 1, ...values }],
      };
    },
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
      req.user = {
        uid: `sim-${role}`,
        email: `${role}@example.com`,
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
        email: `${role}@example.com`,
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
    mockState.users = [{ id: 7, uid: 'test-user', email: 'parent@example.com', name: 'Parent Test', role: 'parent', schoolId: 1, isDeleted: false }];
    mockState.parents = [{ id: 2, userId: 7, studentId: 20, schoolId: 1 }];
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