import { describe, expect, it } from 'vitest';
import {
  generateBulletinSnapshot,
  type BulletinLineSnapshotInput,
  type BulletinSnapshotContext,
  type BulletinSnapshotPersistence,
  type CreateBulletinInput,
} from './bulletinSnapshotService';
import type { BulletinEvaluationLike, BulletinGradeLike } from './bulletinService';

interface FakeState {
  students: Array<{ id: number; classId: number; schoolId: number; firstName: string; lastName: string }>;
  classes: Array<{ id: number; academicYearId: number }>;
  terms: Array<{ id: number; academicYearId: number }>;
  evaluations: BulletinEvaluationLike[];
  grades: BulletinGradeLike[];
  bulletins: Array<CreateBulletinInput & { id: number }>;
  bulletinLines: Array<BulletinLineSnapshotInput & { id: number; bulletinId: number }>;
}

const cloneState = (state: FakeState): FakeState => ({
  students: state.students.map((row) => ({ ...row })),
  classes: state.classes.map((row) => ({ ...row })),
  terms: state.terms.map((row) => ({ ...row })),
  evaluations: state.evaluations.map((row) => ({ ...row })),
  grades: state.grades.map((row) => ({ ...row })),
  bulletins: state.bulletins.map((row) => ({ ...row })),
  bulletinLines: state.bulletinLines.map((row) => ({ ...row })),
});

const createFakePersistence = (initial: FakeState, failOnInsertLines = false): { persistence: BulletinSnapshotPersistence; state: FakeState } => {
  const state = cloneState(initial);

  const persistence: BulletinSnapshotPersistence = {
    transaction: async <T>(run: (ctx: BulletinSnapshotContext) => Promise<T>) => {
      const draft = cloneState(state);

      const ctx: BulletinSnapshotContext = {
        async getStudentById(studentId) {
          return draft.students.find((row) => row.id === studentId) ?? null;
        },
        async getClassById(classId) {
          return draft.classes.find((row) => row.id === classId) ?? null;
        },
        async getTermById(termId) {
          return draft.terms.find((row) => row.id === termId) ?? null;
        },
        async getClassStudents(classId) {
          return draft.students.filter((row) => row.classId === classId);
        },
        async getClassTermEvaluations(classId, termId) {
          return draft.evaluations.filter((row) => row.classId === classId && row.termId === termId);
        },
        async getGradesForStudents(studentIds, evaluationIds) {
          return draft.grades.filter((row) => studentIds.includes(row.studentId) && evaluationIds.includes(row.evaluationId));
        },
        async insertBulletin(payload) {
          const id = draft.bulletins.length + 1;
          draft.bulletins.push({ ...payload, id });
          return { id };
        },
        async insertBulletinLines(bulletinId, lines) {
          if (failOnInsertLines) {
            throw new Error('line insertion failed');
          }
          lines.forEach((line) => {
            draft.bulletinLines.push({
              ...line,
              id: draft.bulletinLines.length + 1,
              bulletinId,
            });
          });
        },
      };

      const result = await run(ctx);
      Object.assign(state, draft);
      return result;
    },
  };

  return { persistence, state };
};

describe('generateBulletinSnapshot', () => {
  const baseState: FakeState = {
    students: [
      { id: 1, classId: 10, schoolId: 1, firstName: 'Alice', lastName: 'Dupont' },
      { id: 2, classId: 10, schoolId: 1, firstName: 'Bob', lastName: 'Martin' },
    ],
    classes: [{ id: 10, academicYearId: 100 }],
    terms: [{ id: 7, academicYearId: 100 }],
    evaluations: [
      { id: 1, classId: 10, termId: 7, subject: 'Math', title: 'DS 1', coefficient: 2, maxScore: 20, countInBulletin: true },
      { id: 2, classId: 10, termId: 7, subject: 'Français', title: 'DS 2', coefficient: 1, maxScore: 10, countInBulletin: true },
      { id: 3, classId: 10, termId: 7, subject: 'Histoire', title: 'DS 3', coefficient: 1, maxScore: 20, countInBulletin: false },
    ],
    grades: [
      { id: 1, evaluationId: 1, studentId: 1, score: '14' },
      { id: 2, evaluationId: 2, studentId: 1, score: '8' },
      { id: 3, evaluationId: 3, studentId: 1, score: '19' },
      { id: 4, evaluationId: 1, studentId: 2, score: '10' },
      { id: 5, evaluationId: 2, studentId: 2, score: '7' },
    ],
    bulletins: [],
    bulletinLines: [],
  };

  it('enregistre un bulletin et toutes ses lignes de matière', async () => {
    const { persistence, state } = createFakePersistence(baseState);

    const result = await generateBulletinSnapshot(1, 7, persistence);

    expect(result.bulletinId).toBe(1);
    expect(state.bulletins).toHaveLength(1);
    expect(state.bulletinLines.length).toBeGreaterThan(0);
    expect(state.bulletinLines.every((line) => line.bulletinId === 1)).toBe(true);
    expect(state.bulletinLines.map((line) => line.subjectName).sort()).toEqual(['Français', 'Math']);
  });

  it('n enregistre rien si une erreur survient pendant les lignes (transaction atomique)', async () => {
    const { persistence, state } = createFakePersistence(baseState, true);

    await expect(generateBulletinSnapshot(1, 7, persistence)).rejects.toThrow('line insertion failed');
    expect(state.bulletins).toHaveLength(0);
    expect(state.bulletinLines).toHaveLength(0);
  });
});
