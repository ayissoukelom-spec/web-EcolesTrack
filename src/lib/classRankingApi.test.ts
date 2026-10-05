import express from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../db/index.ts';
import {
  calculateOfficialClassResults,
} from './bulletinSnapshotService';
import type { BulletinEvaluationLike, BulletinGradeLike } from './bulletinService';
import { registerClassRankingRoute } from './classRankingApi';

vi.mock('../middleware/auth.ts', () => ({
  verifyToken: (_req: any, _res: any, next: any) => next(),
  requireRole: () => (_req: any, _res: any, next: any) => next(),
}));

vi.mock('./studentAccess', () => ({
  default: { getAuthorizedStudents: vi.fn() },
  isApprovedClassForSchool: vi.fn(),
}));

vi.mock('./educationStructure.ts', async (importOriginal) => ({
  ...await importOriginal<typeof import('./educationStructure.ts')>(),
  resolveSchoolTermForClass: vi.fn(),
}));

const makeEvaluation = (id: number, termId: number): BulletinEvaluationLike => ({
  id,
  classId: 5,
  termId,
  subjectId: 7,
  subject: 'Mathématiques',
  title: `Composition ${termId}`,
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

describe('calculateOfficialClassResults', () => {
  const students = [
    { id: 4, classId: 5, schoolId: 9, firstName: 'Sans', lastName: 'Note' },
    { id: 3, classId: 5, schoolId: 9, firstName: 'David', lastName: 'Akakpo' },
    { id: 1, classId: 5, schoolId: 9, firstName: 'Zoé', lastName: 'Éclair' },
    { id: 2, classId: 5, schoolId: 9, firstName: 'Alice', lastName: 'eclair' },
  ];

  it.each([
    { period: 'trimestre', termId: 1, termAverage: '18', otherAverage: '12' },
    { period: 'semestre', termId: 2, termAverage: '15', otherAverage: '9' },
  ])('calcule les résultats officiels pour un $period', ({ termId, termAverage, otherAverage }) => {
    const evaluations = [makeEvaluation(10 + termId, termId)];
    const grades = [
      makeGrade(1, evaluations[0].id, 1, termAverage),
      makeGrade(2, evaluations[0].id, 2, termAverage),
      makeGrade(3, evaluations[0].id, 3, otherAverage),
    ];

    const results = calculateOfficialClassResults(students, termId, evaluations, grades);

    expect(results.map(({ studentId, average, rank }) => ({ studentId, average, rank }))).toEqual([
      { studentId: 2, average: Number(termAverage), rank: 1 },
      { studentId: 1, average: Number(termAverage), rank: 1 },
      { studentId: 3, average: Number(otherAverage), rank: 3 },
      { studentId: 4, average: null, rank: null },
    ]);
  });

  it('ne mélange pas les notes de périodes différentes', () => {
    const trimesterEvaluation = makeEvaluation(11, 1);
    const semesterEvaluation = makeEvaluation(12, 2);
    const grades = [
      makeGrade(1, 11, 1, '18'),
      makeGrade(2, 12, 1, '11'),
    ];

    const trimester = calculateOfficialClassResults([students[2]], 1, [trimesterEvaluation], grades);
    const semester = calculateOfficialClassResults([students[2]], 2, [semesterEvaluation], grades);

    expect(trimester[0].average).toBe(18);
    expect(semester[0].average).toBe(11);
  });

  it('stabilise les ex æquo alphabétiquement et laisse les élèves sans moyenne en fin de liste', () => {
    const evaluation = makeEvaluation(11, 1);
    const results = calculateOfficialClassResults(students, 1, [evaluation], [
      makeGrade(1, 11, 1, '17'),
      makeGrade(2, 11, 2, '17'),
      makeGrade(3, 11, 3, '10'),
    ]);

    expect(results.map((result) => result.studentId)).toEqual([2, 1, 3, 4]);
    expect(results.map((result) => result.rank)).toEqual([1, 1, 3, null]);
    expect(results).toHaveLength(students.length);
    expect(new Set(results.map((result) => result.studentId)).size).toBe(students.length);
  });

  it('classe les élèves d’un semestre ou trimestre sans notes comme non classés', () => {
    const results = calculateOfficialClassResults(students, 2, [], []);
    expect(results).toHaveLength(students.length);
    expect(results.every((result) => result.average == null && result.rank == null)).toBe(true);
  });
});

describe('GET /api/results/class-ranking', () => {
  let studentAccessMock: any;
  let isApprovedClassForSchoolMock: any;
  let resolveAvailableTermMock: any;
  let activeServer: any = null;

  beforeEach(async () => {
    const accessModule = await import('./studentAccess');
    studentAccessMock = accessModule.default;
    studentAccessMock.getAuthorizedStudents.mockReset();
    isApprovedClassForSchoolMock = accessModule.isApprovedClassForSchool;
    isApprovedClassForSchoolMock.mockReset().mockResolvedValue(true);
    const structureModule = await import('./educationStructure.ts');
    resolveAvailableTermMock = structureModule.resolveSchoolTermForClass;
    resolveAvailableTermMock.mockReset().mockResolvedValue({
      term: { id: 21, name: 'Semestre 1', periodType: 'semester' },
      education: {},
    });
  });

  afterEach(async () => {
    if (activeServer) {
      await new Promise<void>((resolve) => activeServer.close(() => resolve()));
      activeServer = null;
    }
  });

  const listen = async (resolveActor: (req: any) => Promise<any>) => {
    const app = express();
    registerClassRankingRoute(app, {
      resolveActor,
      verifyMiddleware: ((_req: any, _res: any, next: any) => next()) as any,
      accessMiddleware: ((_req: any, _res: any, next: any) => next()) as any,
    });
    await new Promise<void>((resolve) => {
      activeServer = app.listen(0, () => resolve());
    });
    const address = activeServer.address();
    return `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
  };

  it('returns only the selected school/class results and performs no database writes', async () => {
    const queryResults = [
      [{ id: 5, name: '3ème A', schoolId: null, academicYearId: 4 }],
      [{ id: 9, name: 'École A' }],
      [makeEvaluation(11, 21)],
      [makeGrade(1, 11, 70, '16')],
    ];
    const selectSpy = vi.spyOn(db, 'select').mockImplementation(() => ({
      from: () => ({ where: () => Promise.resolve(queryResults.shift() ?? []) }),
    } as any));
    const insertSpy = vi.spyOn(db, 'insert');
    const updateSpy = vi.spyOn(db, 'update');
    const deleteSpy = vi.spyOn(db, 'delete');
    studentAccessMock.getAuthorizedStudents.mockResolvedValue([
      { id: 70, classId: 5, schoolId: 9, firstName: 'Alice', lastName: 'Akakpo' },
      { id: 71, classId: 5, schoolId: 10, firstName: 'Autre', lastName: 'École' },
      { id: 72, classId: 6, schoolId: 9, firstName: 'Autre', lastName: 'Classe' },
    ]);

    try {
      const baseUrl = await listen(async () => ({ id: 1, role: 'super_admin', schoolId: null }));
      const response = await fetch(`${baseUrl}/api/results/class-ranking?schoolId=9&classId=5&periodId=21`);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.students).toEqual([{
        studentId: 70,
        firstName: 'Alice',
        lastName: 'Akakpo',
        average: 16,
        rank: 1,
      }]);
      expect(studentAccessMock.getAuthorizedStudents).toHaveBeenCalledWith(
        { id: 1, role: 'super_admin', schoolId: null },
        { classIds: [5] },
      );
      expect(resolveAvailableTermMock).toHaveBeenCalledWith({
        classId: 5,
        academicYearId: 4,
        schoolId: 9,
        date: '',
        requestedTermId: 21,
      });
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

  it('allows a School Admin to read a class in their own school', async () => {
    const queryResults = [
      [{ id: 5, name: '3ème A', schoolId: 9, academicYearId: 4 }],
      [{ id: 9, name: 'École A' }],
      [makeEvaluation(11, 21)],
      [makeGrade(1, 11, 70, '16')],
    ];
    const selectSpy = vi.spyOn(db, 'select').mockImplementation(() => ({
      from: () => ({ where: () => Promise.resolve(queryResults.shift() ?? []) }),
    } as any));
    studentAccessMock.getAuthorizedStudents.mockResolvedValue([
      { id: 70, classId: 5, schoolId: 9, firstName: 'Alice', lastName: 'Akakpo' },
    ]);

    try {
      const actor = { id: 2, role: 'school_admin', schoolId: 9 };
      const baseUrl = await listen(async () => actor);
      const response = await fetch(`${baseUrl}/api/results/class-ranking?classId=5&periodId=21`);

      expect(response.status).toBe(200);
      expect(isApprovedClassForSchoolMock).toHaveBeenCalledWith(5, 9);
      expect(studentAccessMock.getAuthorizedStudents).toHaveBeenCalledWith(actor, { classIds: [5] });
      expect((await response.json()).students[0].studentId).toBe(70);
    } finally {
      selectSpy.mockRestore();
    }
  });

  it('refuses a School Admin request outside their school before loading results', async () => {
    const selectSpy = vi.spyOn(db, 'select');
    try {
      const baseUrl = await listen(async () => ({ id: 2, role: 'school_admin', schoolId: 9 }));
      const response = await fetch(`${baseUrl}/api/results/class-ranking?schoolId=10&classId=5&periodId=21`);

      expect(response.status).toBe(403);
      expect(selectSpy).not.toHaveBeenCalled();
      expect(studentAccessMock.getAuthorizedStudents).not.toHaveBeenCalled();
    } finally {
      selectSpy.mockRestore();
    }
  });

  it('refuses a class not assigned to the selected school', async () => {
    const selectSpy = vi.spyOn(db, 'select').mockImplementation(() => ({
      from: () => ({ where: () => Promise.resolve([{ id: 5, name: '3ème A', schoolId: 10, academicYearId: 4 }]) }),
    } as any));
    try {
      const baseUrl = await listen(async () => ({ id: 1, role: 'super_admin', schoolId: null }));
      const response = await fetch(`${baseUrl}/api/results/class-ranking?schoolId=9&classId=5&periodId=21`);

      expect(response.status).toBe(403);
      expect(isApprovedClassForSchoolMock).not.toHaveBeenCalled();
      expect(studentAccessMock.getAuthorizedStudents).not.toHaveBeenCalled();
    } finally {
      selectSpy.mockRestore();
    }
  });
});
