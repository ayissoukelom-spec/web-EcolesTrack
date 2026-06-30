import express from 'express';
import { afterEach, describe, expect, it } from 'vitest';
import { registerBulletinGenerateRoute } from './bulletinSnapshotService.ts';

let activeServer: any = null;

afterEach(async () => {
  if (activeServer) {
    await new Promise<void>((resolve) => activeServer.close(() => resolve()));
    activeServer = null;
  }
});

describe('registerBulletinGenerateRoute', () => {
  it('creates a bulletin snapshot via the generate endpoint', async () => {
    const app = express();
    app.use(express.json());

    const verifyMiddleware = (req: any, _res: any, next: any) => {
      req.user = { id: 1, uid: 'admin-1', role: 'super_admin', appRole: 'admin' };
      next();
    };

    registerBulletinGenerateRoute(app, {
      resolveActor: async (req) => ({ role: req.user?.role || 'admin' }),
      verifyMiddleware: verifyMiddleware as any,
      generateHandler: async (studentId, termId) => ({ id: 777, studentId, termId }),
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
});
