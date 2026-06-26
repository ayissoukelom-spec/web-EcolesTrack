import express from 'express';
import { afterEach, describe, expect, it } from 'vitest';
import {
  registerBulletinPdfRoute,
  type BulletinPdfActor,
  type BulletinPdfData,
  type BulletinPdfDataProvider,
} from './bulletinPdfApi';

const actor: BulletinPdfActor = {
  role: 'school_admin',
  schoolId: 1,
};

const snapshotData: BulletinPdfData = {
  id: 1,
  studentId: 10,
  studentName: 'Alice Dupont',
  classId: 3,
  className: '3ème A',
  schoolName: 'C.S LE SAVOIR',
  schoolYearId: 100,
  schoolYearName: '2025-2026',
  termId: 7,
  termName: 'Trimestre 1',
  average: 14.5,
  totalPoints: 58,
  totalCoefficients: 4,
  rank: 2,
  mention: 'SNAPSHOT_MENTION',
  appreciation: 'SNAPSHOT_APPRECIATION',
  generatedAt: '2026-06-26T08:00:00.000Z',
  lines: [
    {
      id: 1,
      bulletinId: 1,
      subjectId: null,
      subjectName: 'Mathématiques',
      coefficient: 2,
      average: 15,
      teacherComment: 'Bon niveau',
      rank: null,
    },
  ],
};

const createApp = (
  provider: BulletinPdfDataProvider,
  pdfGenerator?: (data: BulletinPdfData) => Promise<Uint8Array>,
  options?: { detailAccessAllowed?: boolean; actor?: BulletinPdfActor },
) => {
  const app = express();

  const detailAccessAllowed = options?.detailAccessAllowed ?? true;
  const currentActor = options?.actor ?? actor;

  registerBulletinPdfRoute(app, {
    verifyMiddleware: (req: any, _res, next) => {
      req.user = { uid: 'test-user' };
      next();
    },
    detailAccessMiddleware: (_req: any, res: any, next: any) => {
      if (!detailAccessAllowed) return res.status(403).json({ error: 'Forbidden' });
      return next();
    },
    resolveActor: async () => currentActor,
    dataProvider: provider,
    pdfGenerator,
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

describe('bulletin PDF API', () => {
  it('génère un PDF avec succès depuis un snapshot persistant', async () => {
    const provider: BulletinPdfDataProvider = {
      getById: async () => snapshotData,
    };

    const app = createApp(provider);
    const baseUrl = await withServer(app);

    const response = await fetch(`${baseUrl}/api/bulletins/1/pdf`);
    const buffer = new Uint8Array(await response.arrayBuffer());
    const header = new TextDecoder().decode(buffer.slice(0, 4));

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/pdf');
    expect(header).toBe('%PDF');
  });

  it('retourne 404 si le bulletin snapshot n existe pas', async () => {
    const provider: BulletinPdfDataProvider = {
      getById: async () => null,
    };

    const app = createApp(provider);
    const baseUrl = await withServer(app);

    const response = await fetch(`${baseUrl}/api/bulletins/999/pdf`);
    const payload = await response.json();

    expect(response.status).toBe(404);
    expect(payload.error).toBe('Bulletin not found');
  });

  it('utilise exclusivement les données snapshot injectées pour construire le PDF', async () => {
    const LIVE_MARKER = 'LIVE_RECALC_SHOULD_NOT_BE_USED';
    let capturedData: BulletinPdfData | null = null;

    const provider: BulletinPdfDataProvider = {
      getById: async () => snapshotData,
    };

    const customGenerator = async (data: BulletinPdfData) => {
      capturedData = data;
      const payload = `%PDF-1.4\n${JSON.stringify({
        mention: data.mention,
        appreciation: data.appreciation,
        average: data.average,
      })}`;
      return new TextEncoder().encode(payload);
    };

    const app = createApp(provider, customGenerator);
    const baseUrl = await withServer(app);

    const response = await fetch(`${baseUrl}/api/bulletins/1/pdf`);
    const bodyText = await response.text();

    expect(response.status).toBe(200);
    expect(capturedData?.mention).toBe('SNAPSHOT_MENTION');
    expect(capturedData?.appreciation).toBe('SNAPSHOT_APPRECIATION');
    expect(JSON.stringify(capturedData)).not.toContain(LIVE_MARKER);
    expect(bodyText).toContain('SNAPSHOT_MENTION');
    expect(bodyText).toContain('SNAPSHOT_APPRECIATION');
    expect(bodyText).not.toContain(LIVE_MARKER);
  });

  it('interdit l accès PDF pour un parent non owner', async () => {
    const provider: BulletinPdfDataProvider = {
      getById: async () => snapshotData,
    };

    const app = createApp(provider, undefined, {
      actor: { role: 'parent', schoolId: 1 },
      detailAccessAllowed: false,
    });
    const baseUrl = await withServer(app);

    const response = await fetch(`${baseUrl}/api/bulletins/1/pdf`);
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload.error).toBe('Forbidden');
  });
});
