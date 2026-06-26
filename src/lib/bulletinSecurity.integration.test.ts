import express from 'express';
import { afterEach, describe, expect, it } from 'vitest';
import {
  registerBulletinReadRoutes,
  type BulletinDetailResponse,
  type BulletinListResponse,
  type BulletinReadActor,
  type BulletinReadService,
} from './bulletinReadApi';
import {
  registerBulletinPdfRoute,
  type BulletinPdfActor,
  type BulletinPdfData,
  type BulletinPdfDataProvider,
} from './bulletinPdfApi';
import { requireOwnership, requireRole, type AppRole, type AuthRequest } from '../middleware/auth';

type TestUser = {
  id: number;
  uid: string;
  appRole: AppRole;
  role: string;
  schoolId: number;
};

const USERS: Record<string, TestUser> = {
  adminToken: { id: 1, uid: 'admin-uid', appRole: 'admin', role: 'school_admin', schoolId: 1 },
  teacherToken: { id: 2, uid: 'teacher-uid', appRole: 'teacher', role: 'teacher', schoolId: 1 },
  parentOwnToken: { id: 10, uid: 'parent-own-uid', appRole: 'parent', role: 'parent', schoolId: 1 },
  parentOtherToken: { id: 11, uid: 'parent-other-uid', appRole: 'parent', role: 'parent', schoolId: 1 },
  studentOwnToken: { id: 20, uid: 'student-own-uid', appRole: 'student', role: 'student', schoolId: 1 },
};

const BULLETIN_OWNERS: Record<number, { parentUserId: number; studentUserId: number }> = {
  1: { parentUserId: 10, studentUserId: 20 },
  2: { parentUserId: 11, studentUserId: 21 },
};

const baseListResponse: BulletinListResponse = {
  page: 1,
  pageSize: 20,
  total: 2,
  items: [
    {
      id: 1,
      studentId: 100,
      studentName: 'Alice Dupont',
      classId: 3,
      className: '3eme A',
      schoolYearId: 100,
      schoolYearName: '2025-2026',
      termId: 7,
      termName: 'Trimestre 1',
      average: 14.5,
      rank: 2,
      mention: 'Bien',
      appreciation: 'Tres bon trimestre',
      generatedAt: '2026-06-26T08:00:00.000Z',
      createdAt: '2026-06-26T08:00:00.000Z',
      updatedAt: '2026-06-26T08:00:00.000Z',
    },
    {
      id: 2,
      studentId: 101,
      studentName: 'Bob Martin',
      classId: 3,
      className: '3eme A',
      schoolYearId: 100,
      schoolYearName: '2025-2026',
      termId: 7,
      termName: 'Trimestre 1',
      average: 11.25,
      rank: 14,
      mention: 'Passable',
      appreciation: 'Peut mieux faire',
      generatedAt: '2026-06-26T08:00:00.000Z',
      createdAt: '2026-06-26T08:00:00.000Z',
      updatedAt: '2026-06-26T08:00:00.000Z',
    },
  ],
};

const detailById: Record<number, BulletinDetailResponse> = {
  1: {
    id: 1,
    studentId: 100,
    studentName: 'Alice Dupont',
    classId: 3,
    className: '3eme A',
    schoolYearId: 100,
    schoolYearName: '2025-2026',
    termId: 7,
    termName: 'Trimestre 1',
    average: 14.5,
    totalPoints: 58,
    totalCoefficients: 4,
    rank: 2,
    mention: 'SNAPSHOT_MENTION_1',
    appreciation: 'SNAPSHOT_APPRECIATION_1',
    generatedAt: '2026-06-26T08:00:00.000Z',
    createdAt: '2026-06-26T08:00:00.000Z',
    updatedAt: '2026-06-26T08:00:00.000Z',
    lines: [
      {
        id: 1,
        bulletinId: 1,
        subjectId: null,
        subjectName: 'Mathematiques',
        coefficient: 2,
        average: 15,
        teacherComment: 'Bon niveau',
        rank: null,
        createdAt: '2026-06-26T08:00:00.000Z',
      },
    ],
  },
  2: {
    id: 2,
    studentId: 101,
    studentName: 'Bob Martin',
    classId: 3,
    className: '3eme A',
    schoolYearId: 100,
    schoolYearName: '2025-2026',
    termId: 7,
    termName: 'Trimestre 1',
    average: 11.25,
    totalPoints: 45,
    totalCoefficients: 4,
    rank: 14,
    mention: 'SNAPSHOT_MENTION_2',
    appreciation: 'SNAPSHOT_APPRECIATION_2',
    generatedAt: '2026-06-26T08:00:00.000Z',
    createdAt: '2026-06-26T08:00:00.000Z',
    updatedAt: '2026-06-26T08:00:00.000Z',
    lines: [
      {
        id: 2,
        bulletinId: 2,
        subjectId: null,
        subjectName: 'Francais',
        coefficient: 2,
        average: 10,
        teacherComment: 'Effort insuffisant',
        rank: null,
        createdAt: '2026-06-26T08:00:00.000Z',
      },
    ],
  },
};

const pdfById: Record<number, BulletinPdfData> = {
  1: {
    id: 1,
    studentId: 100,
    studentName: 'Alice Dupont',
    classId: 3,
    className: '3eme A',
    schoolName: 'C.S LE SAVOIR',
    schoolYearId: 100,
    schoolYearName: '2025-2026',
    termId: 7,
    termName: 'Trimestre 1',
    average: 14.5,
    totalPoints: 58,
    totalCoefficients: 4,
    rank: 2,
    mention: 'SNAPSHOT_MENTION_1',
    appreciation: 'SNAPSHOT_APPRECIATION_1',
    generatedAt: '2026-06-26T08:00:00.000Z',
    lines: [
      {
        id: 1,
        bulletinId: 1,
        subjectId: null,
        subjectName: 'Mathematiques',
        coefficient: 2,
        average: 15,
        teacherComment: 'Bon niveau',
        rank: null,
      },
    ],
  },
  2: {
    id: 2,
    studentId: 101,
    studentName: 'Bob Martin',
    classId: 3,
    className: '3eme A',
    schoolName: 'C.S LE SAVOIR',
    schoolYearId: 100,
    schoolYearName: '2025-2026',
    termId: 7,
    termName: 'Trimestre 1',
    average: 11.25,
    totalPoints: 45,
    totalCoefficients: 4,
    rank: 14,
    mention: 'SNAPSHOT_MENTION_2',
    appreciation: 'SNAPSHOT_APPRECIATION_2',
    generatedAt: '2026-06-26T08:00:00.000Z',
    lines: [
      {
        id: 2,
        bulletinId: 2,
        subjectId: null,
        subjectName: 'Francais',
        coefficient: 2,
        average: 10,
        teacherComment: 'Effort insuffisant',
        rank: null,
      },
    ],
  },
};

const createAuthMiddleware = (): express.RequestHandler => (req: AuthRequest, res, next) => {
  const authorizationHeader = req.headers.authorization;
  if (!authorizationHeader || !authorizationHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: Missing token' });
  }

  const token = authorizationHeader.slice('Bearer '.length).trim();
  const user = USERS[token];
  if (!user) {
    return res.status(401).json({ error: 'Unauthorized: Invalid token' });
  }

  req.user = {
    id: user.id,
    uid: user.uid,
    role: user.role,
    appRole: user.appRole,
    schoolId: user.schoolId,
  };

  return next();
};

const resolveActor = async (req: AuthRequest): Promise<BulletinReadActor & BulletinPdfActor | null> => {
  if (!req.user) return null;
  return {
    role: req.user.role || 'unknown',
    schoolId: req.user.schoolId ?? null,
  };
};

const ownershipResolver = async (req: AuthRequest): Promise<boolean> => {
  const role = req.user?.appRole;
  const userId = req.user?.id;
  const bulletinId = Number((req.params as any)?.id);

  if (!role || !userId || !Number.isInteger(bulletinId) || bulletinId <= 0) {
    return false;
  }

  const owner = BULLETIN_OWNERS[bulletinId];
  if (!owner) {
    return false;
  }

  if (role === 'parent') return owner.parentUserId === userId;
  if (role === 'student') return owner.studentUserId === userId;
  return false;
};

const authHeader = (token?: string) => (token ? { Authorization: `Bearer ${token}` } : {});

const createIntegrationApp = () => {
  const app = express();
  app.use(express.json());

  let generateCalls = 0;
  let readListCalls = 0;
  let readDetailCalls = 0;
  let pdfDataCalls = 0;

  const verifyMiddleware = createAuthMiddleware();
  const listAccessMiddleware = requireRole(['admin', 'teacher']);
  const detailAccessMiddleware = requireOwnership(ownershipResolver, { bypassRoles: ['admin', 'teacher'] });

  const readService: BulletinReadService = {
    list: async () => {
      readListCalls += 1;
      return baseListResponse;
    },
    getById: async (_actor, id) => {
      readDetailCalls += 1;
      return detailById[id] || null;
    },
  };

  const dataProvider: BulletinPdfDataProvider = {
    getById: async (_actor, id) => {
      pdfDataCalls += 1;
      return pdfById[id] || null;
    },
  };

  registerBulletinReadRoutes(app, {
    resolveActor,
    readService,
    verifyMiddleware,
    listAccessMiddleware,
    detailAccessMiddleware,
  });

  registerBulletinPdfRoute(app, {
    resolveActor,
    dataProvider,
    verifyMiddleware,
    detailAccessMiddleware,
    pdfGenerator: async (data) => new TextEncoder().encode(`%PDF-1.4\nSNAPSHOT_ONLY:${data.id}:${data.mention ?? ''}`),
  });

  app.post('/api/bulletins/generate', verifyMiddleware, requireRole(['admin']), async (_req, res) => {
    generateCalls += 1;
    return res.status(201).json({ id: 9001, source: 'snapshot' });
  });

  return {
    app,
    counters: {
      get generateCalls() {
        return generateCalls;
      },
      get readListCalls() {
        return readListCalls;
      },
      get readDetailCalls() {
        return readDetailCalls;
      },
      get pdfDataCalls() {
        return pdfDataCalls;
      },
    },
  };
};

let activeServer: any = null;

afterEach(async () => {
  if (activeServer) {
    await new Promise<void>((resolve) => activeServer.close(() => resolve()));
    activeServer = null;
  }
});

const withServer = async (app: express.Express): Promise<string> => {
  await new Promise<void>((resolve) => {
    activeServer = app.listen(0, () => resolve());
  });
  const address = activeServer.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return `http://127.0.0.1:${port}`;
};

describe('Phase 6.5 bulletin security integration', () => {
  it('admin has full access', async () => {
    const integration = createIntegrationApp();
    const baseUrl = await withServer(integration.app);

    const generateResponse = await fetch(`${baseUrl}/api/bulletins/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeader('adminToken'),
      },
      body: JSON.stringify({ studentId: 100, termId: 7 }),
    });
    const listResponse = await fetch(`${baseUrl}/api/bulletins`, { headers: authHeader('adminToken') });
    const detailResponse = await fetch(`${baseUrl}/api/bulletins/1`, { headers: authHeader('adminToken') });
    const pdfResponse = await fetch(`${baseUrl}/api/bulletins/1/pdf`, { headers: authHeader('adminToken') });

    expect(generateResponse.status).toBe(201);
    expect(listResponse.status).toBe(200);
    expect(detailResponse.status).toBe(200);
    expect(pdfResponse.status).toBe(200);
    expect(integration.counters.generateCalls).toBe(1);
  });

  it('teacher can read but cannot generate', async () => {
    const integration = createIntegrationApp();
    const baseUrl = await withServer(integration.app);

    const generateResponse = await fetch(`${baseUrl}/api/bulletins/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeader('teacherToken'),
      },
      body: JSON.stringify({ studentId: 100, termId: 7 }),
    });
    const listResponse = await fetch(`${baseUrl}/api/bulletins`, { headers: authHeader('teacherToken') });
    const detailResponse = await fetch(`${baseUrl}/api/bulletins/1`, { headers: authHeader('teacherToken') });
    const pdfResponse = await fetch(`${baseUrl}/api/bulletins/1/pdf`, { headers: authHeader('teacherToken') });

    expect(generateResponse.status).toBe(403);
    expect(listResponse.status).toBe(200);
    expect(detailResponse.status).toBe(200);
    expect(pdfResponse.status).toBe(200);
    expect(integration.counters.generateCalls).toBe(0);
  });

  it('parent can only access own bulletin resources', async () => {
    const integration = createIntegrationApp();
    const baseUrl = await withServer(integration.app);

    const ownDetail = await fetch(`${baseUrl}/api/bulletins/1`, { headers: authHeader('parentOwnToken') });
    const ownPdf = await fetch(`${baseUrl}/api/bulletins/1/pdf`, { headers: authHeader('parentOwnToken') });
    const listResponse = await fetch(`${baseUrl}/api/bulletins`, { headers: authHeader('parentOwnToken') });

    expect(ownDetail.status).toBe(200);
    expect(ownPdf.status).toBe(200);
    expect(listResponse.status).toBe(403);

    const pdfText = await ownPdf.text();
    expect(pdfText).toContain('SNAPSHOT_ONLY:1:SNAPSHOT_MENTION_1');
  });

  it('parent cannot access another student bulletin', async () => {
    const integration = createIntegrationApp();
    const baseUrl = await withServer(integration.app);

    const detailResponse = await fetch(`${baseUrl}/api/bulletins/2`, { headers: authHeader('parentOwnToken') });
    const pdfResponse = await fetch(`${baseUrl}/api/bulletins/2/pdf`, { headers: authHeader('parentOwnToken') });

    expect(detailResponse.status).toBe(403);
    expect(pdfResponse.status).toBe(403);
    expect(integration.counters.readDetailCalls).toBe(0);
    expect(integration.counters.pdfDataCalls).toBe(0);
  });

  it('student can only access own bulletin resources', async () => {
    const integration = createIntegrationApp();
    const baseUrl = await withServer(integration.app);

    const ownDetail = await fetch(`${baseUrl}/api/bulletins/1`, { headers: authHeader('studentOwnToken') });
    const foreignDetail = await fetch(`${baseUrl}/api/bulletins/2`, { headers: authHeader('studentOwnToken') });
    const listResponse = await fetch(`${baseUrl}/api/bulletins`, { headers: authHeader('studentOwnToken') });

    expect(ownDetail.status).toBe(200);
    expect(foreignDetail.status).toBe(403);
    expect(listResponse.status).toBe(403);
  });

  it('no bypass via ownership circumvention or query params', async () => {
    const integration = createIntegrationApp();
    const baseUrl = await withServer(integration.app);

    const bypassAttempt = await fetch(`${baseUrl}/api/bulletins/2?studentId=101&asAdmin=true`, {
      headers: authHeader('parentOwnToken'),
    });

    expect(bypassAttempt.status).toBe(403);
    expect(integration.counters.readDetailCalls).toBe(0);
  });

  it('no access without valid token', async () => {
    const integration = createIntegrationApp();
    const baseUrl = await withServer(integration.app);

    const noTokenList = await fetch(`${baseUrl}/api/bulletins`);
    const invalidTokenDetail = await fetch(`${baseUrl}/api/bulletins/1`, { headers: authHeader('wrong-token') });
    const noTokenPdf = await fetch(`${baseUrl}/api/bulletins/1/pdf`);
    const invalidTokenGenerate = await fetch(`${baseUrl}/api/bulletins/generate`, {
      method: 'POST',
      headers: {
        ...authHeader('wrong-token'),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ studentId: 100, termId: 7 }),
    });

    expect(noTokenList.status).toBe(401);
    expect(invalidTokenDetail.status).toBe(401);
    expect(noTokenPdf.status).toBe(401);
    expect(invalidTokenGenerate.status).toBe(401);
  });

  it('enumeration protection for ID guess', async () => {
    const integration = createIntegrationApp();
    const baseUrl = await withServer(integration.app);

    const knownForeign = await fetch(`${baseUrl}/api/bulletins/2`, { headers: authHeader('parentOwnToken') });
    const unknownGuessed = await fetch(`${baseUrl}/api/bulletins/999999`, { headers: authHeader('parentOwnToken') });

    expect(knownForeign.status).toBe(403);
    expect(unknownGuessed.status).toBe(403);
    expect(integration.counters.readDetailCalls).toBe(0);
  });

  it('read and pdf routes use persisted snapshots only and do not trigger generation', async () => {
    const integration = createIntegrationApp();
    const baseUrl = await withServer(integration.app);

    const listResponse = await fetch(`${baseUrl}/api/bulletins`, { headers: authHeader('teacherToken') });
    const detailResponse = await fetch(`${baseUrl}/api/bulletins/1`, { headers: authHeader('teacherToken') });
    const pdfResponse = await fetch(`${baseUrl}/api/bulletins/1/pdf`, { headers: authHeader('teacherToken') });

    expect(listResponse.status).toBe(200);
    expect(detailResponse.status).toBe(200);
    expect(pdfResponse.status).toBe(200);

    const detailPayload = await detailResponse.json();
    const pdfBody = await pdfResponse.text();

    expect(detailPayload.mention).toBe('SNAPSHOT_MENTION_1');
    expect(detailPayload.appreciation).toBe('SNAPSHOT_APPRECIATION_1');
    expect(pdfBody).toContain('SNAPSHOT_ONLY:1:SNAPSHOT_MENTION_1');
    expect(pdfBody).not.toContain('LIVE_RECALC_SHOULD_NOT_BE_USED');
    expect(integration.counters.generateCalls).toBe(0);
    expect(integration.counters.readListCalls).toBe(1);
    expect(integration.counters.readDetailCalls).toBe(1);
    expect(integration.counters.pdfDataCalls).toBe(1);
  });
});
