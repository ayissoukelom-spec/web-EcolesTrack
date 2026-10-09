import express from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../db/index.ts';
import { registerClassSubjectPivotRoute } from './classSubjectPivotApi';
import type { BulletinEvaluationLike, BulletinGradeLike } from './bulletinService';

vi.mock('../middleware/auth.ts', () => ({
  verifyToken: (_req: any, _res: any, next: any) => next(),
  requireRole: () => (_req: any, _res: any, next: any) => next(),
}));

vi.mock('./studentAccess', () => ({
  default: { getAuthorizedStudents: vi.fn() },
}));

vi.mock('./educationStructure.ts', async (importOriginal) => ({
  ...await importOriginal<typeof import('./educationStructure.ts')>(),
  getSchoolPeriodTypeStates: vi.fn(),
  validateSchoolCycle: vi.fn(),
}));

const makeEvaluation = (id: number, classId: number): BulletinEvaluationLike => ({
  id,
  classId,
  termId: 21,
  subjectId: 7,
  subject: 'Mathématiques',
  title: 'Composition',
  type: 'composition',
  coefficient: 1,
  maxScore: 20,
  countInBulletin: true,
});

const makeGrade = (id: number, evaluationId: number, studentId: number, score: string): BulletinGradeLike => ({
  id,
  evaluationId,
  studentId,
  score,
});

describe('GET /api/results/class-subject-pivot', () => {
  let studentAccessMock: any;
  let getSchoolPeriodTypeStatesMock: any;
  let validateSchoolCycleMock: any;
  let activeServer: any = null;

  beforeEach(async () => {
    const accessModule = await import('./studentAccess');
    studentAccessMock = accessModule.default;
    studentAccessMock.getAuthorizedStudents.mockReset();
    const structureModule = await import('./educationStructure.ts');
    getSchoolPeriodTypeStatesMock = structureModule.getSchoolPeriodTypeStates;
    getSchoolPeriodTypeStatesMock.mockReset().mockResolvedValue([{
      periodType: 'trimester',
      cycleCode: 'college',
      cycleId: 4,
      activeCycleIds: [4],
      cycleActive: true,
      status: 'approved',
      available: true,
    }]);
    validateSchoolCycleMock = structureModule.validateSchoolCycle;
    validateSchoolCycleMock.mockReset().mockResolvedValue(true);
  });

  afterEach(async () => {
    if (activeServer) {
      await new Promise<void>((resolve) => activeServer.close(() => resolve()));
      activeServer = null;
    }
  });

  const listen = async () => {
    const app = express();
    registerClassSubjectPivotRoute(app, {
      resolveActor: async () => ({ id: 1, role: 'super_admin', schoolId: null }),
      verifyMiddleware: ((_req: any, _res: any, next: any) => next()) as any,
      accessMiddleware: ((_req: any, _res: any, next: any) => next()) as any,
    });
    await new Promise<void>((resolve) => {
      activeServer = app.listen(0, () => resolve());
    });
    const address = activeServer.address();
    return `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
  };

  it('returns official current subject averages and result coverage without database writes', async () => {
    const queryResults = [
      [{ id: 9, name: 'École A' }],
      [{
        id: 5,
        name: '3ème A',
        schoolId: 9,
        academicYearId: 4,
        yearName: '2025-2026',
        levelId: 2,
        levelName: '3ème',
        cycleId: 4,
        cycleCode: 'college',
      }],
      [{ id: 21, name: 'Trimestre 1', schoolId: null, academicYearId: 4, periodType: 'trimester', cycleId: 4, isActive: true }],
      [
        makeEvaluation(11, 5),
        { ...makeEvaluation(12, 5), subjectId: 8, subject: 'Physique', countInBulletin: false },
      ],
      [
        makeGrade(1, 11, 70, '16'),
        makeGrade(2, 11, 71, 'Abs'),
        makeGrade(3, 12, 70, '19'),
      ],
    ];
    const selectSpy = vi.spyOn(db, 'select').mockImplementation(() => {
      const query: any = {
        from: () => query,
        leftJoin: () => query,
        where: () => Promise.resolve(queryResults.shift() ?? []),
      };
      return query;
    });
    const insertSpy = vi.spyOn(db, 'insert');
    const updateSpy = vi.spyOn(db, 'update');
    const deleteSpy = vi.spyOn(db, 'delete');
    studentAccessMock.getAuthorizedStudents.mockResolvedValue([
      { id: 70, classId: 5, schoolId: 9, firstName: 'Alice', lastName: 'Akakpo' },
      { id: 71, classId: 5, schoolId: 9, firstName: 'David', lastName: 'Akakpo' },
    ]);

    try {
      const baseUrl = await listen();
      const response = await fetch(`${baseUrl}/api/results/class-subject-pivot?schoolId=9&academicYearId=4&periodId=21`);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.classes).toEqual([{ id: 5, name: '3ème A', levelId: 2, levelName: '3ème' }]);
      expect(body.subjects).toEqual([{ id: 7, name: 'Mathématiques' }]);
      expect(body.cells).toEqual([{
        classId: 5,
        subjectId: 7,
        average: 16,
        studentsWithResult: 1,
        studentsWithoutResult: 1,
      }]);
      expect(studentAccessMock.getAuthorizedStudents).toHaveBeenCalledWith(
        { id: 1, role: 'super_admin', schoolId: null },
        { classIds: [5] },
      );
      expect(insertSpy).not.toHaveBeenCalled();
      expect(updateSpy).not.toHaveBeenCalled();
      expect(deleteSpy).not.toHaveBeenCalled();
    } finally {
      selectSpy.mockRestore();
      insertSpy.mockRestore();
      updateSpy.mockRestore();
      deleteSpy.mockRestore();
    }
  });

  it('refuses school admins outside their school before querying data', async () => {
    const selectSpy = vi.spyOn(db, 'select');
    const app = express();
    registerClassSubjectPivotRoute(app, {
      resolveActor: async () => ({ id: 2, role: 'school_admin', schoolId: 9 }),
      verifyMiddleware: ((_req: any, _res: any, next: any) => next()) as any,
      accessMiddleware: ((_req: any, _res: any, next: any) => next()) as any,
    });
    await new Promise<void>((resolve) => {
      activeServer = app.listen(0, () => resolve());
    });
    const address = activeServer.address();

    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/api/results/class-subject-pivot?schoolId=10&academicYearId=4&periodId=21`);
      expect(response.status).toBe(403);
      expect(selectSpy).not.toHaveBeenCalled();
      expect(studentAccessMock.getAuthorizedStudents).not.toHaveBeenCalled();
    } finally {
      selectSpy.mockRestore();
    }
  });
});
