import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { schools, academicYears, users, subjects, classes, schoolClasses } from '../src/db/schema.ts';

const mockState = {
  users: [
    { id: 1, uid: 'sim-admin', email: 'admin@example.com', role: 'super_admin', schoolId: null },
  ],
  academicYears: [
    { id: 1, name: '2024-2025', isActive: true, schoolId: null },
  ],
  schools: [] as Array<{ id: number; name: string; address?: string; phone?: string }>,
  classes: [] as Array<{ id: number; name: string; schoolId: number | null; academicYearId: number | null }>,
  schoolClasses: [] as Array<{ id: number; schoolId: number; classId: number; status: string }>,
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

const createBuilder = () => {
  const builder: any = {
    table: null as any,
    conditions: [] as any[],
    from(table: any) {
      builder.table = table;
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
        return Promise.resolve(mockState.classes).then(resolve);
      }
      if (builder.table === schoolClasses) {
        let rows = mockState.schoolClasses;
        if (builder.conditions.length > 0) {
          const conditions = builder.conditions.flatMap((condition) => extractConditionPairs(condition));
          rows = rows.filter((row) => conditions.every((entry) => row[entry.column as keyof typeof row] === entry.value));
        }
        return Promise.resolve(rows).then(resolve);
      }
      if (builder.table === subjects) {
        return Promise.resolve(mockState.subjects).then(resolve);
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
      if (table === subjects) {
        const id = mockState.subjects.length + 1;
        const subjectRow = { id, ...values };
        mockState.subjects.push(subjectRow);
        return {
          returning: async () => [subjectRow],
        };
      }
      return {
        returning: async () => [{ id: 1 }],
      };
    },
  }),
  update: (table: any) => ({
    set: (values: any) => ({
      where: async () => {
        if (table === classes) {
          mockState.classes = mockState.classes.map((item) => (item.id === values.id ? { ...item, ...values } : item));
        }
        if (table === schools) {
          mockState.schools = mockState.schools.map((item) => (item.id === values.id ? { ...item, ...values } : item));
        }
        return [{ id: 1 }];
      },
    }),
  }),
  delete: () => ({ where: async () => [] }),
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
        uid: 'sim-admin',
        email: 'admin@example.com',
        role: 'super_admin',
        schoolId: null,
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
        role: 'super_admin',
        schoolId: null,
        id: 1,
        simulated: true,
      };
      next();
    },
  };
});

describe('POST /api/schools', () => {
  let app: any;

  beforeAll(async () => {
    const serverModule = await import('../server.ts');
    app = await serverModule.createApp();
  });

  beforeEach(() => {
    mockState.users = [
      { id: 1, uid: 'sim-admin', email: 'admin@example.com', role: 'super_admin', schoolId: null },
    ];
    mockState.academicYears = [
      { id: 1, name: '2024-2025', isActive: true, schoolId: null },
    ];
    mockState.schools = [];
    mockState.classes = [];
    mockState.schoolClasses = [];
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
      .send({ name: 'École du Lac', address: '', phone: '+228 90000000', classNames: ['6ème'], subjectNames: ['Mathématiques'] })
      .expect(201);

    expect(res.body).toMatchObject({ id: 1 });
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
});
