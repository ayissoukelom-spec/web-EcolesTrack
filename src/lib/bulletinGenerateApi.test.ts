import express from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../db/index.ts';
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

  it('returns 400 with a specific code when the student has no current class', async () => {
    const app = express();
    app.use(express.json());

    const verifyMiddleware = (req: any, _res: any, next: any) => {
      req.user = { id: 1, uid: 'admin-1', role: 'super_admin', appRole: 'admin' };
      next();
    };

    registerBulletinGenerateRoute(app, {
      resolveActor: async () => ({ id: 1, role: 'super_admin', schoolId: null }),
      verifyMiddleware: verifyMiddleware as any,
      generateHandler: async () => {
        throw new Error('Student does not have a current class');
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

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: 'Student does not have a current class',
      code: 'STUDENT_WITHOUT_CURRENT_CLASS',
    });
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

  it('refuses individual generation for a student outside the school_admin school', async () => {
    const app = express();
    app.use(express.json());

    const verifyMiddleware = (req: any, _res: any, next: any) => {
      req.user = { id: 8, uid: 'school-admin-1', role: 'school_admin', appRole: 'admin', schoolId: 1 };
      next();
    };
    const selectSpy = vi.spyOn(db, 'select').mockReturnValue({
      from: () => ({
        where: vi.fn().mockResolvedValue([{ classId: 80, schoolId: 2 }]),
      }),
    } as any);
    const generateHandler = vi.fn();

    try {
      registerBulletinGenerateRoute(app, {
        resolveActor: async () => ({ id: 8, role: 'school_admin', schoolId: 1 }),
        verifyMiddleware: verifyMiddleware as any,
        generateHandler,
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
      expect(generateHandler).not.toHaveBeenCalled();
    } finally {
      selectSpy.mockRestore();
    }
  });

  it('bloque la génération de classe avant toute création si plusieurs matières sélectionnées manquent de composition', async () => {
    const app = express();
    app.use(express.json());

    const verifyMiddleware = (req: any, _res: any, next: any) => {
      req.user = { id: 1, uid: 'admin-1', role: 'super_admin', appRole: 'admin' };
      next();
    };
    const queryResults = [
      [{ id: 80, academicYearId: 2 }],
      [{ id: 2, academicYearId: 2 }],
      [
        { id: 1, classId: 80, termId: 2, subject: 'Mathématiques', type: 'devoir', coefficient: 2, maxScore: 20, countInBulletin: true },
        { id: 2, classId: 80, termId: 2, subject: 'Dessin', type: 'interrogation', coefficient: 1, maxScore: 20, countInBulletin: true },
        { id: 3, classId: 80, termId: 2, subject: 'Histoire', type: 'devoir', coefficient: 1, maxScore: 20, countInBulletin: false },
      ],
    ];
    let queryIndex = 0;
    const selectSpy = vi.spyOn(db, 'select').mockImplementation(() => ({
      from: () => ({ where: vi.fn().mockResolvedValue(queryResults[queryIndex++]) }),
    } as any));
    const insertSpy = vi.spyOn(db, 'insert');
    studentAccessMock.getAuthorizedStudents.mockResolvedValue([
      { id: 101, classId: 80, schoolId: 10, firstName: 'Alice', lastName: 'Smith' },
    ]);

    try {
      registerBulletinGenerateRoute(app, {
        resolveActor: async () => ({ id: 1, role: 'super_admin', schoolId: null }),
        verifyMiddleware: verifyMiddleware as any,
      });

      await new Promise<void>((resolve) => {
        activeServer = app.listen(0, () => resolve());
      });
      const address = activeServer.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      const response = await fetch(`http://127.0.0.1:${port}/api/bulletins/generate-class`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ classId: 80, termId: 2 }),
      });
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body).toEqual(expect.objectContaining({
        code: 'MISSING_VALID_COMPOSITION',
        subjects: ['Mathématiques', 'Dessin'],
        error: expect.stringContaining('Mathématiques, Dessin'),
      }));
      expect(body.error).toContain('Veuillez créer et valider une composition');
      expect(insertSpy).not.toHaveBeenCalled();
      expect(studentAccessMock.getAuthorizedStudents).toHaveBeenCalled();
    } finally {
      selectSpy.mockRestore();
      insertSpy.mockRestore();
    }
  });

  it('bloque la génération individuelle avant toute création si une matière sélectionnée manque de composition', async () => {
    const app = express();
    app.use(express.json());

    const verifyMiddleware = (req: any, _res: any, next: any) => {
      req.user = { id: 1, uid: 'admin-1', role: 'super_admin', appRole: 'admin' };
      next();
    };
    const queryResults = [
      [{ classId: 80, schoolId: 10 }],
      [{ id: 80, academicYearId: 2 }],
      [{ id: 2, academicYearId: 2 }],
      [{ id: 1, classId: 80, termId: 2, subject: 'Dessin', type: 'devoir', coefficient: 1, maxScore: 20, countInBulletin: true }],
    ];
    let queryIndex = 0;
    const selectSpy = vi.spyOn(db, 'select').mockImplementation(() => ({
      from: () => ({ where: vi.fn().mockResolvedValue(queryResults[queryIndex++]) }),
    } as any));
    const insertSpy = vi.spyOn(db, 'insert');
    const generateHandler = vi.fn();

    try {
      registerBulletinGenerateRoute(app, {
        resolveActor: async () => ({ id: 1, role: 'super_admin', schoolId: null }),
        verifyMiddleware: verifyMiddleware as any,
        generateHandler,
      });

      await new Promise<void>((resolve) => {
        activeServer = app.listen(0, () => resolve());
      });
      const address = activeServer.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      const response = await fetch(`http://127.0.0.1:${port}/api/bulletins/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentId: 101, termId: 2 }),
      });
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body).toEqual(expect.objectContaining({
        code: 'MISSING_VALID_COMPOSITION',
        subjects: ['Dessin'],
        error: expect.stringContaining('Dessin'),
      }));
      expect(insertSpy).not.toHaveBeenCalled();
      expect(generateHandler).not.toHaveBeenCalled();
    } finally {
      selectSpy.mockRestore();
      insertSpy.mockRestore();
    }
  });
});
