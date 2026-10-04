import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { schools, academicYears, users, subjects, classes, schoolClasses, schoolSubjects, schoolTerms, cycles, schoolCycles, schoolPeriodTypeApprovals } from '../src/db/schema.ts';

const schoolLogoS3 = vi.hoisted(() => ({
  send: vi.fn(),
  objects: new Map<string, Buffer>(),
}));

const mockState = {
  users: [
    { id: 1, uid: 'sim-admin', email: 'admin@example.com', role: 'super_admin', schoolId: null },
  ],
  academicYears: [
    { id: 1, name: '2024-2025', isActive: true, schoolId: null },
  ],
  schools: [] as Array<{ id: number; name: string; address?: string; phone?: string; ministryName?: string | null; principalName?: string | null; principalGender?: string | null; logoPath?: string | null; promotionThreshold?: string | number | null }>,
  lastSchoolUpdate: null as Record<string, any> | null,
  schoolUpdateError: null as Error | null,
  classes: [] as Array<{ id: number; name: string; schoolId: number | null; academicYearId: number | null; cycleId?: number | null; cycleCode?: string | null }>,
  schoolClasses: [] as Array<{ id: number; schoolId: number; classId: number; status: string }>,
  schoolSubjects: [] as Array<{ id: number; schoolId: number; subjectId: number; status: string }>,
  schoolTerms: [] as Array<Record<string, any>>,
  cycles: [
    { id: 1, code: 'college', isActive: true },
    { id: 2, code: 'lycee', isActive: true },
  ],
  schoolCycles: [] as Array<{ id: number; schoolId: number; cycleId: number; isActive: boolean }>,
  periodApprovals: [] as Array<{ id: number; schoolId: number; periodType: string; status: string }>,
  subjects: [] as Array<{ id: number; name: string; schoolId: number | null }>,
  createdClasses: [] as Array<{ id: number; name: string; schoolId: number | null; academicYearId: number | null }>,
};

const normalizeColumnName = (value: string) => value.replace(/_([a-z])/g, (_match, letter: string) => letter.toUpperCase());

const extractConditionPairs = (condition: any, pairs: Array<{ column: string; value: any }> = []): Array<{ column: string; value: any }> => {
  if (!condition || typeof condition !== 'object') {
    return pairs;
  }

  const queryChunks = condition.queryChunks ?? [];
  for (let index = 0; index < queryChunks.length; index += 1) {
    const chunk = queryChunks[index];

    if (chunk?.config?.name && queryChunks[index + 1]?.value?.[0] === ' = ') {
      const param = queryChunks[index + 2];
      pairs.push({ column: normalizeColumnName(chunk.config.name), value: param?.value ?? param });
      continue;
    }

    if (chunk?.queryChunks) {
      extractConditionPairs(chunk, pairs);
    }
  }

  return pairs;
};

const conditionContainsOr = (condition: any): boolean => (condition?.queryChunks ?? []).some((chunk: any) => (
  chunk?.value?.some?.((part: any) => typeof part === 'string' && part.includes(' or '))
  || conditionContainsOr(chunk)
));

const createBuilder = () => {
  const builder: any = {
    table: null as any,
    joins: [] as any[],
    conditions: [] as any[],
    from(table: any) {
      builder.table = table;
      return builder;
    },
    innerJoin(table: any) {
      builder.joins.push(table);
      return builder;
    },
    leftJoin(table: any) {
      builder.joins.push(table);
      return builder;
    },
    where(...conditions: any[]) {
      builder.conditions = conditions;
      return builder;
    },
    limit() {
      return builder;
    },
    orderBy() {
      return builder;
    },
    then(resolve: (value: any) => void) {
      if (builder.table === users) {
        return Promise.resolve(mockState.users).then(resolve);
      }
      if (builder.table === academicYears) {
        return Promise.resolve(mockState.academicYears).then(resolve);
      }
      if (builder.table === schools) {
        return Promise.resolve(mockState.schools).then(resolve);
      }
      if (builder.table === classes) {
        const conditions = builder.conditions.flatMap((condition) => extractConditionPairs(condition));
        const rows = mockState.classes.filter((row) => conditions.every((entry) => row[entry.column as keyof typeof row] === entry.value));
        return Promise.resolve(rows).then(resolve);
      }
      if (builder.table === schoolClasses) {
        let rows = mockState.schoolClasses;
        if (builder.conditions.length > 0) {
          const conditions = builder.conditions.flatMap((condition) => extractConditionPairs(condition));
          rows = rows.filter((row) => conditions.every((entry) => row[entry.column as keyof typeof row] === entry.value));
        }
        return Promise.resolve(rows).then(resolve);
      }
      if (builder.table === schoolTerms || builder.table === schoolPeriodTypeApprovals || builder.table === cycles) {
        const rows = builder.table === schoolTerms
          ? mockState.schoolTerms
          : builder.table === schoolPeriodTypeApprovals
            ? mockState.periodApprovals
            : mockState.cycles;
        const conditions = builder.conditions.flatMap((condition: any) => extractConditionPairs(condition));
        const hasOrCondition = builder.conditions.some(conditionContainsOr);
        return Promise.resolve(rows.filter((row: any) => {
          const schoolCondition = builder.table === schoolTerms
            ? conditions.find((entry: any) => entry.column === 'schoolId')
            : undefined;
          return conditions
            .filter((entry: any) => entry !== schoolCondition)
            .every((entry: any) => row[entry.column] === entry.value)
            && (!schoolCondition
              || (hasOrCondition
                ? row.schoolId == null || row.schoolId === schoolCondition.value
                : row.schoolId === schoolCondition.value));
        })).then(resolve);
      }
      if (builder.table === schoolCycles) {
        const conditions = builder.conditions.flatMap((condition: any) => extractConditionPairs(condition));
        const assignments = mockState.schoolCycles.filter((row) => conditions
          .filter((entry: any) => entry.column in row)
          .every((entry: any) => row[entry.column as keyof typeof row] === entry.value));
        if (builder.joins.includes(cycles)) {
          const rows = assignments.flatMap((assignment) => {
            const cycle = mockState.cycles.find((item) => item.id === assignment.cycleId && item.isActive);
            return cycle ? [{ id: cycle.id, code: cycle.code }] : [];
          });
          return Promise.resolve(rows).then(resolve);
        }
        return Promise.resolve(assignments).then(resolve);
      }
      if (builder.table === subjects || builder.table === schoolSubjects) {
        const sourceRows = builder.table === subjects ? mockState.subjects : mockState.schoolSubjects;
        const conditions = builder.conditions.flatMap((condition) => extractConditionPairs(condition));
        const rows = sourceRows.filter((row) => conditions.every((entry) => row[entry.column as keyof typeof row] === entry.value));
        return Promise.resolve(rows).then(resolve);
      }
      return Promise.resolve([]).then(resolve);
    },
    catch(reject: (reason?: any) => void) {
      return Promise.resolve([]).catch(reject);
    },
    finally(cb: () => void) {
      return Promise.resolve([]).finally(cb);
    },
  };
  return builder;
};

const mockDb = {
  select: () => createBuilder(),
  insert: (table: any) => ({
    values: (values: any) => {
      if (table === schools) {
        const id = mockState.schools.length + 1;
        const schoolRow = { id, ...values };
        mockState.schools.push(schoolRow);
        return {
          returning: async () => [schoolRow],
        };
      }
      if (table === classes) {
        const id = mockState.classes.length + 100;
        const classRow = { id, ...values };
        mockState.classes.push(classRow);
        mockState.createdClasses.push(classRow);
        return {
          returning: async () => [classRow],
        };
      }
      if (table === schoolClasses) {
        const id = mockState.schoolClasses.length + 1;
        const schoolClassRow = { id, ...values };
        mockState.schoolClasses.push(schoolClassRow);
        return {
          returning: async () => [schoolClassRow],
        };
      }
      if (table === schoolSubjects) {
        const id = mockState.schoolSubjects.length + 1;
        const schoolSubjectRow = { id, ...values };
        mockState.schoolSubjects.push(schoolSubjectRow);
        return {
          returning: async () => [schoolSubjectRow],
        };
      }
      if (table === subjects) {
        const id = mockState.subjects.length + 1;
        const subjectRow = { id, ...values };
        mockState.subjects.push(subjectRow);
        return {
          returning: async () => [subjectRow],
        };
      }
      if (table === schoolTerms) {
        const term = { id: mockState.schoolTerms.length + 100, ...values };
        mockState.schoolTerms.push(term);
        return { returning: async () => [term] };
      }
      if (table === schoolPeriodTypeApprovals) {
        return {
          onConflictDoUpdate: async () => {
            const current = mockState.periodApprovals.find((item) => item.schoolId === values.schoolId && item.periodType === values.periodType);
            if (current) Object.assign(current, values);
            else mockState.periodApprovals.push({ id: mockState.periodApprovals.length + 1, ...values });
            return [];
          },
        };
      }
      return {
        returning: async () => [{ id: 1 }],
      };
    },
  }),
  update: (table: any) => ({
    set: (values: any) => ({
      where: (...conditions: any[]) => {
        if (table === schoolTerms) {
          const pairs = conditions.flatMap((condition) => extractConditionPairs(condition));
          const updatedRows: Array<Record<string, any>> = [];
          mockState.schoolTerms = mockState.schoolTerms.map((item) => {
            const matches = pairs.every((entry) => item[entry.column] === entry.value);
            if (!matches) return item;
            const updated = { ...item, ...values };
            updatedRows.push(updated);
            return updated;
          });
          return {
            then(resolve: (value: any) => void) { return Promise.resolve(updatedRows).then(resolve); },
            returning: async () => updatedRows,
          };
        }
        if (table === classes) {
          mockState.classes = mockState.classes.map((item) => (item.id === values.id ? { ...item, ...values } : item));
        }
        if (table === schools) {
          mockState.lastSchoolUpdate = values;
          if (!mockState.schoolUpdateError) {
            mockState.schools = mockState.schools.map((item) => (item.id === values.id || (values.id == null && item.id === 1) ? { ...item, ...values } : item));
          }
        }
        const result = [{ id: 1, ...values }];
        return {
          then(resolve: (value: any) => void) {
            return Promise.resolve(result).then(resolve);
          },
          returning: async () => {
            if (table === schools && mockState.schoolUpdateError) throw mockState.schoolUpdateError;
            return result;
          },
        };
      },
    }),
  }),
  delete: (table: any) => ({
    where: async (...conditions: any[]) => {
      if (table === schoolTerms) {
        const pairs = conditions.flatMap((condition) => extractConditionPairs(condition));
        mockState.schoolTerms = mockState.schoolTerms.filter((row) => !pairs.every((entry) => row[entry.column] === entry.value));
      }
      if (table === schoolCycles) mockState.schoolCycles = [];
      return [];
    },
  }),
  execute: async (_sql: any) => [],
};

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: class {
    send(command: any) {
      return schoolLogoS3.send(command);
    }
  },
  DeleteObjectCommand: class { constructor(public input: any) {} },
  GetObjectCommand: class { constructor(public input: any) {} },
  PutObjectCommand: class { constructor(public input: any) {} },
}));

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
        uid: 'sim-admin',
        email: 'admin@example.com',
        role: mockState.users[0]?.role ?? 'super_admin',
        schoolId: mockState.users[0]?.schoolId ?? null,
        id: 1,
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
        uid: 'sim-admin',
        email: 'admin@example.com',
        role: mockState.users[0]?.role ?? 'super_admin',
        schoolId: mockState.users[0]?.schoolId ?? null,
        id: 1,
        simulated: true,
      };
      next();
    },
  };
});

describe('POST /api/schools', () => {
  let app: any;
  const storageEnvKeys = ['NODE_ENV', 'FILE_STORAGE_PROVIDER', 'UPLOADS_DIR', 'S3_BUCKET', 'S3_REGION', 'S3_ENDPOINT', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'] as const;
  const originalStorageEnv = Object.fromEntries(storageEnvKeys.map((key) => [key, process.env[key]]));

  beforeAll(async () => {
    const serverModule = await import('../server.ts');
    app = await serverModule.createApp();
  });

  beforeEach(() => {
    for (const key of storageEnvKeys) {
      const original = originalStorageEnv[key];
      if (original === undefined) delete process.env[key];
      else process.env[key] = original;
    }
    process.env.NODE_ENV = 'test';
    schoolLogoS3.objects.clear();
    schoolLogoS3.send.mockReset();
    schoolLogoS3.send.mockImplementation(async (command: any) => {
      const commandName = command.constructor.name;
      const { Bucket, Key, Body } = command.input;
      const objectKey = `${Bucket}/${Key}`;
      if (commandName === 'PutObjectCommand') {
        schoolLogoS3.objects.set(objectKey, Buffer.from(Body));
        return {};
      }
      if (commandName === 'GetObjectCommand') {
        const body = schoolLogoS3.objects.get(objectKey);
        if (!body) throw Object.assign(new Error('missing object'), { name: 'NoSuchKey', $metadata: { httpStatusCode: 404 } });
        return { Body: { transformToByteArray: async () => new Uint8Array(body) }, ContentType: 'image/png' };
      }
      if (commandName === 'DeleteObjectCommand') {
        schoolLogoS3.objects.delete(objectKey);
        return {};
      }
      throw new Error(`Unexpected S3 command: ${commandName}`);
    });
    mockState.users = [
      { id: 1, uid: 'sim-admin', email: 'admin@example.com', role: 'super_admin', schoolId: null },
    ];
    mockState.academicYears = [
      { id: 1, name: '2024-2025', isActive: true, schoolId: null },
    ];
    mockState.schools = [];
    mockState.lastSchoolUpdate = null;
    mockState.schoolUpdateError = null;
    mockState.classes = [];
    mockState.schoolClasses = [];
    mockState.schoolSubjects = [];
    mockState.schoolTerms = [];
    mockState.cycles = [
      { id: 1, code: 'college', isActive: true },
      { id: 2, code: 'lycee', isActive: true },
    ];
    mockState.schoolCycles = [];
    mockState.periodApprovals = [];
    mockState.subjects = [];
    mockState.createdClasses = [];
  });

  it('rejects creating a school without classNames', async () => {
    const res = await request(app)
      .post('/api/schools')
      .send({ name: 'École du Lac', address: '', phone: '+228 90000000', subjectNames: ['Mathématiques'] })
      .expect(400);

    expect(res.body.error).toContain('classNames must be a non-empty array');
  });

  it('rejects creating a school without subjectNames', async () => {
    const res = await request(app)
      .post('/api/schools')
      .send({ name: 'École du Lac', address: '', phone: '+228 90000000', classNames: ['6ème'] })
      .expect(400);

    expect(res.body.error).toContain('subjectNames must be a non-empty array');
  });

  it('creates a school when classNames and subjectNames are provided', async () => {
    const res = await request(app)
      .post('/api/schools')
      .send({ name: 'École du Lac', address: '', phone: '+228 90000000', ministryName: 'Ministère du Togo', principalName: 'Kossi AYISSOU', principalGender: 'M', classNames: ['6ème'], subjectNames: ['Mathématiques'] })
      .expect(201);

    expect(res.body).toMatchObject({ id: 1, ministryName: 'Ministère du Togo', principalName: 'Kossi AYISSOU', principalGender: 'M', promotionThreshold: '10.00' });
    expect((await request(app).get('/api/schools').expect(200)).body[0]).toMatchObject({ ministryName: 'Ministère du Togo', principalName: 'Kossi AYISSOU', principalGender: 'M' });
  });

  it('enregistre et modifie le seuil de passage de l école', async () => {
    const created = await request(app)
      .post('/api/schools')
      .send({ name: 'École du Seuil', address: '', phone: '+228 90000000', promotionThreshold: 9, classNames: ['6ème'], subjectNames: ['Mathématiques'] })
      .expect(201);

    expect(created.body.promotionThreshold).toBe('9.00');

    await request(app)
      .put('/api/schools/1')
      .send({ name: 'École du Seuil', address: '', phone: '+228 90000000', promotionThreshold: 9.5 })
      .expect(200);

    expect(mockState.schools[0].promotionThreshold).toBe('9.50');
  });

  it('transmet ministryName lors de la modification d une école', async () => {
    mockState.schools = [{ id: 1, name: 'École du Lac', phone: '+228 90000000', ministryName: null }];

    await request(app)
      .put('/api/schools/1')
      .send({ name: 'École du Lac', address: '', phone: '+228 90000000', ministryName: 'Ministère modifié' })
      .expect(200);

    expect(mockState.lastSchoolUpdate).toMatchObject({ ministryName: 'Ministère modifié' });
  });

  it('transmet principalName lors de la modification d une école', async () => {
    mockState.schools = [{ id: 1, name: 'École du Lac', phone: '+228 90000000', principalName: null }];

    await request(app)
      .put('/api/schools/1')
      .send({ name: 'École du Lac', address: '', phone: '+228 90000000', principalName: 'Kossi AYISSOU' })
      .expect(200);

    expect(mockState.lastSchoolUpdate).toMatchObject({ principalName: 'Kossi AYISSOU' });
  });

  it('enregistre le genre explicite du responsable lors de la modification d une école', async () => {
    mockState.schools = [{ id: 1, name: 'École du Lac', phone: '+228 90000000', principalName: 'Kossi AYISSOU', principalGender: 'M' }];

    await request(app)
      .put('/api/schools/1')
      .send({ name: 'École du Lac', address: '', phone: '+228 90000000', principalGender: 'F' })
      .expect(200);

    expect(mockState.lastSchoolUpdate).toMatchObject({ principalGender: 'F' });
  });

  it('preserves the current logoPath unless a new explicit logoPath is supplied', async () => {
    mockState.schools = [{ id: 1, name: 'École du Lac', phone: '+228 90000000', logoPath: 'school-logos/old-logo.png' }];

    await request(app)
      .put('/api/schools/1')
      .send({ name: 'École du Lac', address: '', phone: '+228 90000000', principalName: 'Kossi AYISSOU' })
      .expect(200);

    expect(mockState.schools[0].logoPath).toBe('school-logos/old-logo.png');

    await request(app)
      .put('/api/schools/1')
      .send({ name: 'École du Lac', address: '', phone: '+228 90000000', logoPath: 'school-logos/new-logo.png' })
      .expect(200);

    expect(mockState.schools[0].logoPath).toBe('school-logos/new-logo.png');
  });

  it('uploads, reads, and replaces school logos in S3 without losing the old reference before replacement', async () => {
    process.env.FILE_STORAGE_PROVIDER = 's3';
    process.env.S3_BUCKET = 'school-logo-test';
    process.env.S3_REGION = 'eu-west-1';
    mockState.schools = [{ id: 1, name: 'École du Lac', logoPath: 'school-logos/old-logo.png' }];
    schoolLogoS3.objects.set('school-logo-test/school-logos/old-logo.png', Buffer.from('old logo'));

    const firstUpload = await request(app)
      .post('/api/schools/1/logo')
      .attach('logo', Buffer.from('first png logo'), { filename: 'logo.png', contentType: 'image/png' })
      .expect(200);

    expect(firstUpload.body.logoPath).toMatch(/^school-logos\/\d+-[a-f0-9]{16}-logo\.png$/);
    const firstReference = firstUpload.body.logoPath;
    expect(mockState.schools[0].logoPath).toBe(firstReference);
    expect(schoolLogoS3.objects.has(`school-logo-test/${firstReference}`)).toBe(true);
    expect(schoolLogoS3.objects.has('school-logo-test/school-logos/old-logo.png')).toBe(false);

    const logoResponse = await request(app).get('/api/schools/1/logo').expect(200);
    expect(logoResponse.headers['content-type']).toContain('image/png');
    expect(logoResponse.headers['cache-control']).toBe('private, no-cache');
    expect(logoResponse.body).toEqual(Buffer.from('first png logo'));

    const secondUpload = await request(app)
      .post('/api/schools/1/logo')
      .attach('logo', Buffer.from('replacement logo'), { filename: 'replacement.png', contentType: 'image/png' })
      .expect(200);

    expect(mockState.schools[0].logoPath).toBe(secondUpload.body.logoPath);
    expect(schoolLogoS3.objects.has(`school-logo-test/${firstReference}`)).toBe(false);
    expect(schoolLogoS3.objects.has(`school-logo-test/${secondUpload.body.logoPath}`)).toBe(true);
  });

  it('leaves the existing school logo reference intact when the S3 upload fails', async () => {
    process.env.FILE_STORAGE_PROVIDER = 's3';
    process.env.S3_BUCKET = 'school-logo-test';
    process.env.S3_REGION = 'eu-west-1';
    mockState.schools = [{ id: 1, name: 'École du Lac', logoPath: 'school-logos/old-logo.png' }];
    schoolLogoS3.send.mockRejectedValueOnce(new Error('S3 unavailable'));

    await request(app)
      .post('/api/schools/1/logo')
      .attach('logo', Buffer.from('new logo'), { filename: 'logo.png', contentType: 'image/png' })
      .expect(500);

    expect(mockState.schools[0].logoPath).toBe('school-logos/old-logo.png');
    expect(schoolLogoS3.objects.has('school-logo-test/school-logos/old-logo.png')).toBe(false);
  });

  it('cleans the newly uploaded S3 logo and preserves the DB reference when the school update fails', async () => {
    process.env.FILE_STORAGE_PROVIDER = 's3';
    process.env.S3_BUCKET = 'school-logo-test';
    process.env.S3_REGION = 'eu-west-1';
    mockState.schools = [{ id: 1, name: 'École du Lac', logoPath: 'school-logos/old-logo.png' }];
    mockState.schoolUpdateError = new Error('Database unavailable');

    await request(app)
      .post('/api/schools/1/logo')
      .attach('logo', Buffer.from('new logo'), { filename: 'logo.png', contentType: 'image/png' })
      .expect(500);

    expect(mockState.schools[0].logoPath).toBe('school-logos/old-logo.png');
    expect(schoolLogoS3.objects.size).toBe(0);
  });

  it('keeps local logo storage and access control behavior', async () => {
    const localRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ecoletrack-school-logo-'));
    process.env.FILE_STORAGE_PROVIDER = 'local';
    process.env.UPLOADS_DIR = localRoot;
    mockState.schools = [{ id: 1, name: 'École du Lac', logoPath: null }];

    try {
      const upload = await request(app)
        .post('/api/schools/1/logo')
        .attach('logo', Buffer.from('local logo'), { filename: 'logo.png', contentType: 'image/png' })
        .expect(200);
      expect(upload.body.logoPath).toMatch(/^school-logos\/\d+-[a-f0-9]{16}-logo\.png$/);
      expect(await fs.readFile(path.join(localRoot, upload.body.logoPath), 'utf8')).toBe('local logo');
      expect((await request(app).get('/api/schools/1/logo').expect(200)).body).toEqual(Buffer.from('local logo'));

      mockState.users[0] = { id: 1, uid: 'sim-admin', email: 'admin@example.com', role: 'school_admin', schoolId: 2 };
      await request(app).get('/api/schools/1/logo').expect(403);
    } finally {
      await fs.rm(localRoot, { recursive: true, force: true });
    }
  });

  it('reuses an existing global class instead of creating a duplicate class row', async () => {
    mockState.classes = [{ id: 10, name: '6ème', schoolId: null, academicYearId: 1 }];

    const res = await request(app)
      .post('/api/schools')
      .send({ name: 'École du Lac', address: '', phone: '+228 90000000', classNames: ['6ème'], subjectNames: ['Mathématiques'] })
      .expect(201);

    expect(res.body).toMatchObject({ id: 1 });
    expect(mockState.createdClasses).toHaveLength(0);
    expect(mockState.schoolClasses).toContainEqual(expect.objectContaining({ schoolId: 1, classId: 10 }));
  });

  it('creates a single global class and two school-class links for two schools', async () => {
    await request(app)
      .post('/api/schools')
      .send({ name: 'École A', address: '', phone: '+228 90000001', classNames: ['Tle A4 D 4'], subjectNames: ['Mathématiques'] })
      .expect(201);

    await request(app)
      .post('/api/schools')
      .send({ name: 'École B', address: '', phone: '+228 90000002', classNames: ['Tle A4 D 4'], subjectNames: ['Mathématiques'] })
      .expect(201);

    await request(app)
      .post('/api/classes')
      .send({ name: 'Tle A4 D 4', academicYearId: 1, schoolId: 1 })
      .expect(201);

    await request(app)
      .post('/api/classes')
      .send({ name: 'Tle A4 D 4', academicYearId: 1, schoolId: 2 })
      .expect(201);

    const globalClasses = mockState.classes.filter((item) => item.schoolId === null);
    const schoolClassLinks = mockState.schoolClasses.filter((item) => item.classId === globalClasses[0]?.id);

    expect(globalClasses).toHaveLength(1);
    expect(schoolClassLinks).toHaveLength(2);
  });

  it('adds new classes and subjects without removing existing school associations', async () => {
    mockState.schools = [{ id: 1, name: 'École A', phone: '+228 90000001' }];
    mockState.classes = [
      { id: 10, name: '4ème', schoolId: null, academicYearId: 1 },
      { id: 11, name: '5ème', schoolId: null, academicYearId: 1 },
      { id: 12, name: '3ème', schoolId: null, academicYearId: 1 },
    ];
    mockState.schoolClasses = [
      { id: 1, schoolId: 1, classId: 10, status: 'approved' },
      { id: 2, schoolId: 1, classId: 11, status: 'approved' },
    ];
    mockState.subjects = [
      { id: 20, name: 'Mathématiques', schoolId: null },
      { id: 21, name: 'Français', schoolId: null },
      { id: 22, name: 'Sciences', schoolId: null },
    ];
    mockState.schoolSubjects = [
      { id: 1, schoolId: 1, subjectId: 20, status: 'approved' },
      { id: 2, schoolId: 1, subjectId: 21, status: 'approved' },
    ];

    await request(app)
      .put('/api/schools/1')
      .send({ name: 'École A', classNames: ['3ème'], subjectNames: ['Sciences'] })
      .expect(200);

    expect(mockState.schoolClasses.map((row) => row.classId).sort()).toEqual([10, 11, 12]);
    expect(mockState.schoolSubjects.map((row) => row.subjectId).sort()).toEqual([20, 21, 22]);
  });

  describe('school-term catalogue permissions', () => {
    it('lists global and selected-school periods for the super admin, excluding other schools and years', async () => {
      mockState.classes = [{
        id: 10,
        name: '6e A',
        schoolId: 1,
        academicYearId: 1,
        cycleId: 1,
        cycleCode: 'college',
      }];
      mockState.schoolTerms = [
        { id: 20, schoolId: null, academicYearId: 1, name: 'Trimestre global', periodType: 'trimester', isActive: true },
        { id: 21, schoolId: 1, academicYearId: 1, name: 'Trimestre école A', periodType: 'trimester', isActive: true },
        { id: 22, schoolId: 2, academicYearId: 1, name: 'Trimestre école B', periodType: 'trimester', isActive: true },
        { id: 23, schoolId: null, academicYearId: 2, name: 'Trimestre année suivante', periodType: 'trimester', isActive: true },
      ];
      mockState.schoolCycles = [{ id: 1, schoolId: 1, cycleId: 1, isActive: true }];
      mockState.periodApprovals = [{ id: 1, schoolId: 1, periodType: 'trimester', status: 'approved' }];

      const response = await request(app)
        .get('/api/school-terms?schoolId=1&classId=10&academicYearId=1&availableOnly=true')
        .expect(200);

      expect(response.body.map((term: any) => term.id)).toEqual([20, 21]);
    });

    it('keeps school-admin available periods limited to their school and global periods', async () => {
      mockState.users[0].role = 'school_admin';
      mockState.users[0].schoolId = 1;
      mockState.classes = [{
        id: 10,
        name: '6e A',
        schoolId: 1,
        academicYearId: 1,
        cycleId: 1,
        cycleCode: 'college',
      }];
      mockState.schoolTerms = [
        { id: 20, schoolId: null, academicYearId: 1, name: 'Trimestre global', periodType: 'trimester', isActive: true },
        { id: 21, schoolId: 1, academicYearId: 1, name: 'Trimestre école A', periodType: 'trimester', isActive: true },
        { id: 22, schoolId: 2, academicYearId: 1, name: 'Trimestre école B', periodType: 'trimester', isActive: true },
      ];
      mockState.schoolCycles = [{ id: 1, schoolId: 1, cycleId: 1, isActive: true }];
      mockState.periodApprovals = [{ id: 1, schoolId: 1, periodType: 'trimester', status: 'approved' }];

      const response = await request(app)
        .get('/api/school-terms?schoolId=2&classId=10&academicYearId=1&availableOnly=true')
        .expect(200);

      expect(response.body.map((term: any) => term.id)).toEqual([20, 21]);
    });

    it('allows only the Super Admin to create a global period', async () => {
      mockState.users[0].role = 'school_admin';
      mockState.users[0].schoolId = 1;
      await request(app)
        .post('/api/school-terms')
        .send({ academicYearId: 1, name: 'Trimestre 1' })
        .expect(403);
      expect(mockState.schoolTerms).toHaveLength(0);

      mockState.users[0].role = 'super_admin';
      const created = await request(app)
        .post('/api/school-terms')
        .send({ academicYearId: 1, name: 'Trimestre 1', schoolId: 1 })
        .expect(201);

      expect(created.body.schoolId).toBeNull();
      expect(mockState.schoolTerms[0].schoolId).toBeNull();
    });

    it('allows only the Super Admin to modify a period', async () => {
      mockState.schoolTerms = [{ id: 10, schoolId: null, academicYearId: 1, name: 'Trimestre 1', startDate: null, endDate: null, cycleId: null }];
      mockState.users[0].role = 'school_admin';
      mockState.users[0].schoolId = 1;
      await request(app).put('/api/school-terms/10').send({ name: 'Trimestre modifié' }).expect(403);

      mockState.users[0].role = 'super_admin';
      const updated = await request(app).put('/api/school-terms/10').send({ name: 'Trimestre modifié' }).expect(200);
      expect(updated.body.name).toBe('Trimestre modifié');
    });

    it('allows only the Super Admin to delete a period', async () => {
      mockState.schoolTerms = [{ id: 10, schoolId: null, academicYearId: 1, name: 'Trimestre 1' }];
      mockState.users[0].role = 'school_admin';
      mockState.users[0].schoolId = 1;
      await request(app).delete('/api/school-terms/10').expect(403);
      expect(mockState.schoolTerms).toHaveLength(1);

      mockState.users[0].role = 'super_admin';
      await request(app).delete('/api/school-terms/10').expect(200);
      expect(mockState.schoolTerms).toHaveLength(0);
    });
  });

  describe('school period-type approvals', () => {
    it('allows a CEG school to approve trimesters and reject semesters', async () => {
      mockState.users[0].role = 'school_admin';
      mockState.users[0].schoolId = 1;
      mockState.schoolCycles = [{ id: 1, schoolId: 1, cycleId: 1, isActive: true }];

      const initial = await request(app).get('/api/schools/1/period-type-approvals').expect(200);
      expect(initial.body).toEqual(expect.arrayContaining([
        expect.objectContaining({ periodType: 'trimester', status: 'pending', cycleActive: true, available: false }),
        expect.objectContaining({ periodType: 'semester', status: 'pending', cycleActive: false, available: false }),
      ]));
      await request(app).post('/api/schools/1/period-types/trimester/approve').expect(200);
      const rejected = await request(app).post('/api/schools/1/period-types/semester/reject').expect(200);
      expect(rejected.body).toMatchObject({ periodType: 'semester', status: 'rejected', cycleActive: false, available: false });
    });

    it('allows a lycée school to approve semesters and reject trimesters', async () => {
      mockState.users[0].role = 'school_admin';
      mockState.users[0].schoolId = 1;
      mockState.schoolCycles = [{ id: 1, schoolId: 1, cycleId: 2, isActive: true }];

      await request(app).post('/api/schools/1/period-types/semester/approve').expect(200);
      const rejected = await request(app).post('/api/schools/1/period-types/trimester/reject').expect(200);
      expect(rejected.body).toMatchObject({ periodType: 'trimester', status: 'rejected', cycleActive: false, available: false });
    });

    it('blocks approval without the matching active cycle but still permits rejection', async () => {
      mockState.users[0].role = 'school_admin';
      mockState.users[0].schoolId = 1;
      await request(app).post('/api/schools/1/period-types/semester/approve').expect(409);

      const rejected = await request(app).post('/api/schools/1/period-types/semester/reject').expect(200);
      expect(rejected.body).toMatchObject({ periodType: 'semester', status: 'rejected', cycleActive: false, available: false });
    });

    it('keeps school-admin approval changes scoped to their own school', async () => {
      mockState.users[0].role = 'school_admin';
      mockState.users[0].schoolId = 1;
      await request(app).post('/api/schools/2/period-types/trimester/reject').expect(403);
      await request(app).get('/api/schools/2/period-type-approvals').expect(403);
    });
  });
});
