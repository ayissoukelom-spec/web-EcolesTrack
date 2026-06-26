import express from 'express';
import { afterEach, describe, expect, it } from 'vitest';
import {
  registerBulletinReadRoutes,
  type BulletinDetailResponse,
  type BulletinListResponse,
  type BulletinReadActor,
  type BulletinReadService,
} from './bulletinReadApi';

const baseActor: BulletinReadActor = {
  role: 'school_admin',
  schoolId: 1,
};

const baseListResponse: BulletinListResponse = {
  page: 1,
  pageSize: 20,
  total: 1,
  items: [
    {
      id: 1,
      studentId: 10,
      studentName: 'Alice Dupont',
      classId: 3,
      className: '3ème A',
      schoolYearId: 100,
      schoolYearName: '2025-2026',
      termId: 7,
      termName: 'Trimestre 1',
      average: 14.5,
      rank: 2,
      mention: 'Bien',
      appreciation: 'Très bon trimestre',
      generatedAt: '2026-06-26T08:00:00.000Z',
      createdAt: '2026-06-26T08:00:00.000Z',
      updatedAt: '2026-06-26T08:00:00.000Z',
    },
  ],
};

const baseDetailResponse: BulletinDetailResponse = {
  id: 1,
  studentId: 10,
  studentName: 'Alice Dupont',
  classId: 3,
  className: '3ème A',
  schoolYearId: 100,
  schoolYearName: '2025-2026',
  termId: 7,
  termName: 'Trimestre 1',
  average: 14.5,
  totalPoints: 58,
  totalCoefficients: 4,
  rank: 2,
  mention: 'Bien',
  appreciation: 'Très bon trimestre',
  generatedAt: '2026-06-26T08:00:00.000Z',
  createdAt: '2026-06-26T08:00:00.000Z',
  updatedAt: '2026-06-26T08:00:00.000Z',
  lines: [
    {
      id: 1,
      bulletinId: 1,
      subjectId: null,
      subjectName: 'Mathématiques',
      coefficient: 2,
      average: 15,
      teacherComment: null,
      rank: null,
      createdAt: '2026-06-26T08:00:00.000Z',
    },
  ],
};

const createApp = (
  service: BulletinReadService,
  options?: {
    actor?: BulletinReadActor;
    listAccessAllowed?: boolean;
    detailAccessAllowed?: boolean;
  },
) => {
  const app = express();

  const actor = options?.actor ?? baseActor;
  const listAccessAllowed = options?.listAccessAllowed ?? true;
  const detailAccessAllowed = options?.detailAccessAllowed ?? true;

  registerBulletinReadRoutes(app, {
    verifyMiddleware: (req: any, _res, next) => {
      req.user = { uid: 'test-user' };
      next();
    },
    listAccessMiddleware: (_req: any, res: any, next: any) => {
      if (!listAccessAllowed) return res.status(403).json({ error: 'Forbidden' });
      return next();
    },
    detailAccessMiddleware: (_req: any, res: any, next: any) => {
      if (!detailAccessAllowed) return res.status(403).json({ error: 'Forbidden' });
      return next();
    },
    resolveActor: async () => actor,
    readService: service,
  });

  return app;
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

describe('bulletin read API routes', () => {
  it('récupère la liste paginée des bulletins persistés', async () => {
    const service: BulletinReadService = {
      list: async () => baseListResponse,
      getById: async () => baseDetailResponse,
    };

    const app = createApp(service);
    const baseUrl = await withServer(app);

    const response = await fetch(`${baseUrl}/api/bulletins?page=1&pageSize=20&termId=7`);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.total).toBe(1);
    expect(payload.items[0].id).toBe(1);
    expect(payload.items[0].termId).toBe(7);
  });

  it('récupère un bulletin complet avec ses lignes', async () => {
    const service: BulletinReadService = {
      list: async () => baseListResponse,
      getById: async (actor, id) => (actor.schoolId === 1 && id === 1 ? baseDetailResponse : null),
    };

    const app = createApp(service);
    const baseUrl = await withServer(app);

    const response = await fetch(`${baseUrl}/api/bulletins/1`);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.id).toBe(1);
    expect(payload.lines).toHaveLength(1);
    expect(payload.lines[0].subjectName).toBe('Mathématiques');
  });

  it('retourne 404 si le bulletin n existe pas', async () => {
    const service: BulletinReadService = {
      list: async () => baseListResponse,
      getById: async () => null,
    };

    const app = createApp(service);
    const baseUrl = await withServer(app);

    const response = await fetch(`${baseUrl}/api/bulletins/99999`);
    const payload = await response.json();

    expect(response.status).toBe(404);
    expect(payload.error).toBe('Bulletin not found');
  });

  it('refuse la liste quand le rôle n est pas autorisé', async () => {
    const service: BulletinReadService = {
      list: async () => baseListResponse,
      getById: async () => null,
    };

    const app = createApp(service, {
      actor: { role: 'parent', schoolId: 1 },
      listAccessAllowed: false,
    });
    const baseUrl = await withServer(app);

    const response = await fetch(`${baseUrl}/api/bulletins`);
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload.error).toBe('Forbidden');
  });

  it('autorise la lecture détail pour owner', async () => {
    const service: BulletinReadService = {
      list: async () => baseListResponse,
      getById: async () => baseDetailResponse,
    };

    const app = createApp(service, {
      actor: { role: 'parent', schoolId: 1 },
      detailAccessAllowed: true,
    });
    const baseUrl = await withServer(app);

    const response = await fetch(`${baseUrl}/api/bulletins/1`);
    expect(response.status).toBe(200);
  });

  it('interdit la lecture détail d un bulletin autre élève', async () => {
    const service: BulletinReadService = {
      list: async () => baseListResponse,
      getById: async () => baseDetailResponse,
    };

    const app = createApp(service, {
      actor: { role: 'parent', schoolId: 1 },
      detailAccessAllowed: false,
    });
    const baseUrl = await withServer(app);

    const response = await fetch(`${baseUrl}/api/bulletins/1`);
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload.error).toBe('Forbidden');
  });
});
