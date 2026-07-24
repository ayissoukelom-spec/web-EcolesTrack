import express from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerBulletinGenerateRoute } from './bulletinSnapshotService.ts';

vi.mock('./studentAccess', () => ({
  default: {
    getAuthorizedStudents: vi.fn(),
  },
}));

let studentAccessMock: any;
let activeServer: any = null;

afterEach(async () => {
  if (activeServer) {
    await new Promise<void>((resolve) => activeServer.close(() => resolve()));
    activeServer = null;
  }
});

describe('registerBulletinGenerateRoute', () => {
  beforeEach(async () => {
    const module = await import('./studentAccess');
    studentAccessMock = module.default;
    studentAccessMock.getAuthorizedStudents.mockReset();
  });

  it('creates a bulletin snapshot via the generate endpoint', async () => {
    const app = express();
    app.use(express.json());

    const verifyMiddleware = (req: any, _res: any, next: any) => {
      req.user = { id: 1, uid: 'admin-1', role: 'super_admin', appRole: 'admin' };
      next();
    };

    registerBulletinGenerateRoute(app, {
      resolveActor: async (req) => ({ role: req.user?.role || 'admin', schoolId: req.user?.schoolId ?? null }),
      verifyMiddleware: verifyMiddleware as any,
      generateHandler: async (studentId, termId, persistence) => ({ id: 777, studentId, termId } as any),
    });

    await new Promise<void>((resolve) => {
      activeServer = app.listen(0, () => resolve());
    });

    const address = activeServer.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    const baseUrl = `http://127.0.0.1:${port}`;

    const response = await fetch(`${baseUrl}/api/bulletins/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ studentId: 10, termId: 2 }),
    });

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ id: 777, studentId: 10, termId: 2 });
  });

  it('uses studentAccess to load authorized class students when an actor is present', async () => {
    const app = express();
    app.use(express.json());

    const verifyMiddleware = (req: any, _res: any, next: any) => {
      req.user = { id: 3, uid: 'teacher-1', role: 'teacher', appRole: 'teacher', schoolId: 10 };
      next();
    };

    studentAccessMock.getAuthorizedStudents.mockResolvedValue([{ id: 101, classId: 80, schoolId: 10, firstName: 'Alice', lastName: 'Smith' }]);

    let loadedStudents: any = null;
    registerBulletinGenerateRoute(app, {
      resolveActor: async () => ({ id: 3, role: 'teacher', schoolId: 10 }),
      verifyMiddleware: verifyMiddleware as any,
      accessMiddleware: (_req, _res, next) => next(),
      generateHandler: async (_studentId, _termId, persistence) => {
        const rows = await persistence.transaction(async (ctx) => ctx.getClassStudents(80));
        loadedStudents = rows;
        return {
          bulletinId: 999,
          studentId: 1,
          termId: 2,
          average: 0,
          totalPoints: 0,
          totalCoefficients: 0,
          rank: null,
          mention: null,
          appreciation: null,
          linesCount: 0,
        };
      },
    });

    await new Promise<void>((resolve) => {
      activeServer = app.listen(0, () => resolve());
    });
    const address = activeServer.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    const baseUrl = `http://127.0.0.1:${port}`;

    const response = await fetch(`${baseUrl}/api/bulletins/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ studentId: 10, termId: 2 }),
    });

    expect(response.status).toBe(201);
    expect(loadedStudents).toEqual([{ id: 101, classId: 80, schoolId: 10, firstName: 'Alice', lastName: 'Smith' }]);
    expect(studentAccessMock.getAuthorizedStudents).toHaveBeenCalledWith({ id: 3, role: 'teacher', schoolId: 10 }, { classIds: [80] });
  });

  it('returns 403 when studentAccess authorization fails during bulletin generation', async () => {
    const app = express();
    app.use(express.json());

    const verifyMiddleware = (req: any, _res: any, next: any) => {
      req.user = { id: 3, uid: 'teacher-1', role: 'teacher', appRole: 'teacher', schoolId: 10 };
      next();
    };

    studentAccessMock.getAuthorizedStudents.mockRejectedValue(new Error('not allowed'));

    registerBulletinGenerateRoute(app, {
      resolveActor: async () => ({ id: 3, role: 'teacher', schoolId: 10 }),
      verifyMiddleware: verifyMiddleware as any,
      accessMiddleware: (_req, _res, next) => next(),
      generateHandler: async (_studentId, _termId, persistence) => {
        await persistence.transaction(async (ctx) => ctx.getClassStudents(80));
        return {
          bulletinId: 999,
          studentId: 1,
          termId: 2,
          average: 0,
          totalPoints: 0,
          totalCoefficients: 0,
          rank: null,
          mention: null,
          appreciation: null,
          linesCount: 0,
        };
      },
    });

    await new Promise<void>((resolve) => {
      activeServer = app.listen(0, () => resolve());
    });
    const address = activeServer.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    const baseUrl = `http://127.0.0.1:${port}`;

    const response = await fetch(`${baseUrl}/api/bulletins/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ studentId: 10, termId: 2 }),
    });

    expect(response.status).toBe(403);
    expect(studentAccessMock.getAuthorizedStudents).toHaveBeenCalled();
  });
});
