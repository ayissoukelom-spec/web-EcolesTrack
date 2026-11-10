import express from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../db/index.ts';
import {
  calculateOfficialClassResults,
} from './bulletinSnapshotService';
import type { BulletinEvaluationLike, BulletinGradeLike } from './bulletinService';
import { calculateSelectedEvaluationResults, registerClassRankingRoute } from './classRankingApi';

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

  it('inclut les évaluations mensuelles dans la moyenne de devoir du classement officiel', () => {
    const evaluations: BulletinEvaluationLike[] = [
      {
        ...makeEvaluation(31, 1),
        title: 'Évaluation mensuelle',
        type: 'evaluation_mensuelle',
        coefficient: 2,
        maxScore: 40,
      },
      { ...makeEvaluation(32, 1), title: 'Composition', type: 'composition' },
    ];
    const grades = [
      makeGrade(31, 31, 1, '30'),
      makeGrade(32, 31, 2, '20'),
      makeGrade(33, 32, 1, '10'),
      makeGrade(34, 32, 2, '10'),
    ];

    const rankedStudents = students.filter((student) => student.id === 1 || student.id === 2);
    const results = calculateOfficialClassResults(rankedStudents, 1, evaluations, grades);

    expect(results.map(({ studentId, average, rank }) => ({ studentId, average, rank }))).toEqual([
      { studentId: 1, average: 12.5, rank: 1 },
      { studentId: 2, average: 10, rank: 2 },
    ]);
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

describe('calculateSelectedEvaluationResults', () => {
  const customStudents = [
    { id: 1, classId: 5, schoolId: 9, firstName: 'Alice', lastName: 'Akakpo', matricule: 'E001' },
    { id: 2, classId: 5, schoolId: 9, firstName: 'Benoît', lastName: 'Zinsou', matricule: 'E002' },
    { id: 3, classId: 5, schoolId: 9, firstName: 'Sans', lastName: 'Note', matricule: 'E003' },
  ];
  const customEvaluation = (
    id: number,
    subjectId: number,
    subject: string,
    coefficient = 1,
    maxScore = 20,
    type = 'devoir',
  ) => ({
    id,
    subjectId,
    subject,
    title: `Évaluation ${id}`,
    type,
    coefficient,
    maxScore,
  });
  const customGrade = (
    id: number,
    evaluationId: number,
    studentId: number,
    score: string,
    createdAt?: string,
    updatedAt?: string,
  ) => ({ id, evaluationId, studentId, score, createdAt, updatedAt });

  it('calcule un classement sans composition et donne le même poids à chaque matière', () => {
    const evaluations = [
      customEvaluation(11, 7, 'Mathématiques'),
      customEvaluation(12, 7, 'Mathématiques'),
      customEvaluation(13, 8, 'Français'),
    ];
    const results = calculateSelectedEvaluationResults(customStudents.slice(0, 1), evaluations, [
      customGrade(1, 11, 1, '16'),
      customGrade(2, 12, 1, '12'),
      customGrade(3, 13, 1, '10'),
    ]);

    expect(results[0].subjectAverages.map(({ subjectName, average }) => ({ subjectName, average }))).toEqual([
      { subjectName: 'Mathématiques', average: 14 },
      { subjectName: 'Français', average: 10 },
    ]);
    expect(results[0].average).toBe(12);
  });

  it('applique les coefficients des évaluations et normalise chaque barème sur 20', () => {
    const evaluations = [
      customEvaluation(11, 7, 'Mathématiques', 2, 40),
      customEvaluation(12, 7, 'Mathématiques', 1, 10),
    ];
    const results = calculateSelectedEvaluationResults(customStudents.slice(0, 1), evaluations, [
      customGrade(1, 11, 1, '30'),
      customGrade(2, 12, 1, '5'),
    ]);

    expect(results[0].subjectAverages[0].average).toBe(40 / 3);
    expect(results[0].average).toBe(40 / 3);
  });

  it('calcule un classement à partir d’une seule composition', () => {
    const evaluation = customEvaluation(11, 7, 'Mathématiques', 1, 20, 'composition');
    const results = calculateSelectedEvaluationResults(customStudents.slice(0, 2), [evaluation], [
      customGrade(1, 11, 1, '18'),
      customGrade(2, 11, 2, '12'),
    ]);

    expect(results.map(({ studentId, average, rank }) => ({ studentId, average, rank }))).toEqual([
      { studentId: 1, average: 18, rank: 1 },
      { studentId: 2, average: 12, rank: 2 },
    ]);
  });

  it('calcule plusieurs compositions de matières différentes avec un poids égal par matière', () => {
    const evaluations = [
      customEvaluation(11, 7, 'Mathématiques', 1, 20, 'composition'),
      customEvaluation(12, 8, 'Français', 1, 20, 'composition'),
    ];
    const results = calculateSelectedEvaluationResults(customStudents.slice(0, 2), evaluations, [
      customGrade(1, 11, 1, '18'),
      customGrade(2, 12, 1, '10'),
      customGrade(3, 11, 2, '14'),
      customGrade(4, 12, 2, '12'),
    ]);

    expect(results.map(({ studentId, average, rank }) => ({ studentId, average, rank }))).toEqual([
      { studentId: 1, average: 14, rank: 1 },
      { studentId: 2, average: 13, rank: 2 },
    ]);
  });

  it('mélange devoirs et compositions dans le même classement', () => {
    const evaluations = [
      customEvaluation(11, 7, 'Mathématiques', 1, 20, 'composition'),
      customEvaluation(12, 7, 'Mathématiques', 1, 20, 'devoir'),
      customEvaluation(13, 8, 'Français', 1, 20, 'interrogation'),
    ];
    const results = calculateSelectedEvaluationResults(customStudents.slice(0, 2), evaluations, [
      customGrade(1, 11, 1, '18'),
      customGrade(2, 12, 1, '14'),
      customGrade(3, 13, 1, '10'),
      customGrade(4, 11, 2, '14'),
      customGrade(5, 12, 2, '12'),
      customGrade(6, 13, 2, '12'),
    ]);

    expect(results.map(({ studentId, average, rank }) => ({ studentId, average, rank }))).toEqual([
      { studentId: 1, average: 13, rank: 1 },
      { studentId: 2, average: 12.5, rank: 2 },
    ]);
  });

  it('ignore les notes absentes et Abs, mais prend en compte une note égale à zéro', () => {
    const evaluations = [
      customEvaluation(11, 7, 'Mathématiques'),
      customEvaluation(12, 8, 'Français'),
    ];
    const results = calculateSelectedEvaluationResults(customStudents, evaluations, [
      customGrade(1, 11, 1, '0'),
      customGrade(2, 12, 1, 'Abs'),
      customGrade(3, 12, 2, 'Abs'),
    ]);

    expect(results.find((student) => student.studentId === 1)).toMatchObject({
      average: 0,
      rank: 1,
      missingSubjects: ['Français'],
      missingEvaluations: ['Français — Évaluation 12'],
    });
    expect(results.find((student) => student.studentId === 2)).toMatchObject({
      average: null,
      rank: null,
      missingSubjects: ['Mathématiques', 'Français'],
      missingEvaluations: ['Mathématiques — Évaluation 11', 'Français — Évaluation 12'],
    });
    expect(results.find((student) => student.studentId === 3)?.rank).toBeNull();
  });

  it('gives tied averages a shared competition rank and stabilizes display order alphabetically', () => {
    const evaluations = [customEvaluation(11, 7, 'Mathématiques')];
    const results = calculateSelectedEvaluationResults(customStudents, evaluations, [
      customGrade(1, 11, 1, '15'),
      customGrade(2, 11, 2, '15'),
    ]);

    expect(results.map(({ studentId, rank }) => ({ studentId, rank }))).toEqual([
      { studentId: 1, rank: 1 },
      { studentId: 2, rank: 1 },
      { studentId: 3, rank: null },
    ]);
  });

  it('chooses a deterministic latest grade when legacy duplicates exist', () => {
    const evaluations = [customEvaluation(11, 7, 'Mathématiques')];
    const results = calculateSelectedEvaluationResults(customStudents.slice(0, 1), evaluations, [
      customGrade(1, 11, 1, '8', '2026-09-01T10:00:00.000Z'),
      customGrade(2, 11, 1, '14', '2026-09-02T10:00:00.000Z'),
      customGrade(3, 11, 1, '16', '2026-09-02T10:00:00.000Z'),
    ]);

    expect(results[0].average).toBe(16);
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
      term: {
        id: 21,
        name: 'Semestre 1',
        periodType: 'semester',
        startDate: '2026-10-01',
        endDate: '2026-12-31',
      },
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
    app.use(express.json());
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
      [{ id: 70, matricule: 'E070' }],
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
        matricule: 'E070',
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
      [{ id: 70, matricule: 'E070' }],
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

  it.each([
    {
      label: 'Super Admin with an explicit school',
      actor: { id: 1, role: 'super_admin', schoolId: null },
      query: 'schoolId=9&',
    },
    {
      label: 'School Admin in their active school',
      actor: { id: 2, role: 'school_admin', schoolId: 9 },
      query: '',
    },
  ])('lists all selectable evaluation types for $label', async ({ actor, query }) => {
    const queryResults = [
      [{ id: 5, name: '3ème A', schoolId: 9, academicYearId: 4 }],
      [{ id: 9, name: 'École A' }],
      [
        { ...makeEvaluation(11, 21), schoolId: 9, subjectId: 7, type: 'devoir', countInBulletin: false, date: '2026-10-10' },
        { ...makeEvaluation(12, 21), schoolId: 9, subjectId: 8, type: 'composition', date: '2026-10-11' },
        { ...makeEvaluation(13, 21), schoolId: 9, termId: null, subjectId: 9, type: 'evaluation_mensuelle', date: '2026-10-12' },
        { ...makeEvaluation(14, 21), schoolId: 9, subjectId: 10, type: 'interrogation', date: '2026-10-13' },
      ],
    ];
    const selectSpy = vi.spyOn(db, 'select').mockImplementation(() => ({
      from: () => ({ where: () => Promise.resolve(queryResults.shift() ?? []) }),
    } as any));
    try {
      const baseUrl = await listen(async () => actor);
      const response = await fetch(`${baseUrl}/api/results/class-ranking/available-evaluations?${query}classId=5&periodId=21`);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toHaveLength(4);
      expect(body[0]).toMatchObject({ id: 11, countInBulletin: false, subjectId: 7 });
      expect(body[1]).toMatchObject({ id: 12, type: 'composition' });
      expect(body[2]).toMatchObject({ id: 13, type: 'evaluation_mensuelle' });
      expect(body[3]).toMatchObject({ id: 14, type: 'interrogation' });
      expect(isApprovedClassForSchoolMock).toHaveBeenCalledWith(5, 9);
    } finally {
      selectSpy.mockRestore();
    }
  });

  it('calculates a custom ranking from one composition for a School Admin without writing data', async () => {
    const selectedEvaluation = {
      ...makeEvaluation(11, 21),
      schoolId: 9,
      subjectId: 7,
      subject: 'Mathématiques',
      type: 'composition',
      coefficient: 2,
      maxScore: 40,
      countInBulletin: false,
      date: '2026-10-10',
    };
    const queryResults = [
      [{ id: 5, name: '3ème A', schoolId: 9, academicYearId: 4 }],
      [{ id: 9, name: 'École A' }],
      [selectedEvaluation],
      [{ id: 70, matricule: 'E070' }],
      [{ id: 1, evaluationId: 11, studentId: 70, score: '30' }],
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
    ]);

    try {
      const actor = { id: 2, role: 'school_admin', schoolId: 9 };
      const baseUrl = await listen(async () => actor);
      const response = await fetch(`${baseUrl}/api/results/class-ranking/custom`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ classId: 5, periodId: 21, evaluationIds: [11] }),
      });
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.rankedStudentCount).toBe(1);
      expect(body.evaluations).toEqual([expect.objectContaining({ id: 11, type: 'composition' })]);
      expect(body.students).toEqual([expect.objectContaining({
        studentId: 70,
        matricule: 'E070',
        average: 15,
        rank: 1,
      })]);
      expect(studentAccessMock.getAuthorizedStudents).toHaveBeenCalledWith(actor, { classIds: [5] });
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

  it.each([
    {
      description: 'an evaluation outside the selected period',
      evaluationIds: [12],
      evaluationRows: [{ ...makeEvaluation(11, 21), schoolId: 9 }],
    },
    {
      description: 'an evaluation from another school',
      evaluationIds: [11],
      evaluationRows: [{ ...makeEvaluation(11, 21), schoolId: 10, date: '2026-10-10' }],
    },
    {
      description: 'an evaluation from another class',
      evaluationIds: [11],
      evaluationRows: [{ ...makeEvaluation(11, 21), schoolId: 9, classId: 6, date: '2026-10-10' }],
    },
    {
      description: 'an evaluation from another period',
      evaluationIds: [11],
      evaluationRows: [{ ...makeEvaluation(11, 22), schoolId: 9, date: '2026-10-10' }],
    },
  ])('rejects a custom selection containing $description', async ({ evaluationIds, evaluationRows }) => {
    const queryResults = [
      [{ id: 5, name: '3ème A', schoolId: 9, academicYearId: 4 }],
      [{ id: 9, name: 'École A' }],
      evaluationRows,
    ];
    const selectSpy = vi.spyOn(db, 'select').mockImplementation(() => ({
      from: () => ({ where: () => Promise.resolve(queryResults.shift() ?? []) }),
    } as any));
    try {
      const baseUrl = await listen(async () => ({ id: 1, role: 'super_admin', schoolId: null }));
      const response = await fetch(`${baseUrl}/api/results/class-ranking/custom`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ schoolId: 9, classId: 5, periodId: 21, evaluationIds }),
      });

      expect(response.status).toBe(400);
      expect(studentAccessMock.getAuthorizedStudents).not.toHaveBeenCalled();
    } finally {
      selectSpy.mockRestore();
    }
  });

  it('rejects invalid and duplicate evaluation identifiers before loading evaluation rows', async () => {
    const queryResults = [
      [{ id: 5, name: '3ème A', schoolId: 9, academicYearId: 4 }],
      [{ id: 9, name: 'École A' }],
    ];
    const selectSpy = vi.spyOn(db, 'select').mockImplementation(() => ({
      from: () => ({ where: () => Promise.resolve(queryResults.shift() ?? []) }),
    } as any));
    try {
      const baseUrl = await listen(async () => ({ id: 1, role: 'super_admin', schoolId: null }));
      const response = await fetch(`${baseUrl}/api/results/class-ranking/custom`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ schoolId: 9, classId: 5, periodId: 21, evaluationIds: [11, 11] }),
      });

      expect(response.status).toBe(400);
      expect(selectSpy).toHaveBeenCalledTimes(2);
    } finally {
      selectSpy.mockRestore();
    }
  });

  it('requires a school selection for Super Admin custom ranking', async () => {
    const selectSpy = vi.spyOn(db, 'select');
    try {
      const baseUrl = await listen(async () => ({ id: 1, role: 'super_admin', schoolId: null }));
      const response = await fetch(`${baseUrl}/api/results/class-ranking/available-evaluations?classId=5&periodId=21`);

      expect(response.status).toBe(400);
      expect(selectSpy).not.toHaveBeenCalled();
    } finally {
      selectSpy.mockRestore();
    }
  });
});
