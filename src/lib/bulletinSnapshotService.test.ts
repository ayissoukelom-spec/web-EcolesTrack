import { describe, expect, it } from 'vitest';
import {
  generateBulletinSnapshot,
  resolveSubjectTeacherName,
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
        async getTeacherNames(teacherIds) {
          // Fake implementation: return empty map for testing
          return new Map();
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
      { id: 1, classId: 10, teacherId: 1, termId: 7, subject: 'Math', title: 'DS 1', type: 'devoir', coefficient: 2, maxScore: 20, countInBulletin: true },
      { id: 2, classId: 10, teacherId: 2, termId: 7, subject: 'Français', title: 'DS 2', type: 'interrogation', coefficient: 1, maxScore: 10, countInBulletin: true },
      { id: 3, classId: 10, teacherId: 1, termId: 7, subject: 'Histoire', title: 'DS 3', type: 'composition', coefficient: 1, maxScore: 20, countInBulletin: false },
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

  it('ne prend en compte que les évaluations validées et ignore les notes absentes', async () => {
    const { persistence, state } = createFakePersistence({
      ...baseState,
      evaluations: baseState.evaluations.map((evaluation) => ({
        ...evaluation,
        countInBulletin: evaluation.id === 1,
      })),
    });

    const result = await generateBulletinSnapshot(1, 7, persistence);

    expect(result.average).toBe(14);
    expect(result.totalCoefficients).toBe(2);
    expect(state.bulletinLines.map((line) => line.subjectName)).toEqual(['Math']);
    expect(state.bulletinLines.some((line) => line.subjectName === 'Français')).toBe(false);
    expect(state.bulletinLines.some((line) => line.subjectName === 'Histoire')).toBe(false);
  });

  it('n enregistre rien si une erreur survient pendant les lignes (transaction atomique)', async () => {
    const { persistence, state } = createFakePersistence(baseState, true);

    await expect(generateBulletinSnapshot(1, 7, persistence)).rejects.toThrow('line insertion failed');
    expect(state.bulletins).toHaveLength(0);
    expect(state.bulletinLines).toHaveLength(0);
  });

  it('calcule le rang par matière avec trois élèves et trois moyennes différentes', async () => {
    const { persistence, state } = createFakePersistence({
      ...baseState,
      students: [
        { id: 1, classId: 10, schoolId: 1, firstName: 'Alice', lastName: 'Dupont' },
        { id: 2, classId: 10, schoolId: 1, firstName: 'Bob', lastName: 'Martin' },
        { id: 3, classId: 10, schoolId: 1, firstName: 'Charlie', lastName: 'Durand' },
      ],
      grades: [
        // Math: Alice 18, Bob 15, Charlie 12
        { id: 1, evaluationId: 1, studentId: 1, score: '18' },
        { id: 2, evaluationId: 1, studentId: 2, score: '15' },
        { id: 3, evaluationId: 1, studentId: 3, score: '12' },
        // Français: Alice 14, Bob 16, Charlie 18
        { id: 4, evaluationId: 2, studentId: 1, score: '8' },  // 8/10 = 16/20
        { id: 5, evaluationId: 2, studentId: 2, score: '9.5' }, // 9.5/10 = 19/20
        { id: 6, evaluationId: 2, studentId: 3, score: '10' }, // 10/10 = 20/20
      ],
    });

    const result = await generateBulletinSnapshot(1, 7, persistence);

    const mathLine = state.bulletinLines.find((line) => line.subjectName === 'Math');
    const frenchLine = state.bulletinLines.find((line) => line.subjectName === 'Français');

    // Alice should rank 1st in Math (18 is highest)
    expect(mathLine?.rank).toBe(1);
    // Alice should rank 3rd in French (16/20 is lowest)
    expect(frenchLine?.rank).toBe(3);
  });

  it('attribue le même rang à deux élèves ex æquo (tie-breaking rule)', async () => {
    const { persistence, state } = createFakePersistence({
      ...baseState,
      students: [
        { id: 1, classId: 10, schoolId: 1, firstName: 'Alice', lastName: 'Dupont' },
        { id: 2, classId: 10, schoolId: 1, firstName: 'Bob', lastName: 'Martin' },
        { id: 3, classId: 10, schoolId: 1, firstName: 'Charlie', lastName: 'Durand' },
      ],
      grades: [
        // Math: All three students have 15 (tie), except Charlie has 13
        { id: 1, evaluationId: 1, studentId: 1, score: '15' },
        { id: 2, evaluationId: 1, studentId: 2, score: '15' },
        { id: 3, evaluationId: 1, studentId: 3, score: '13' },
      ],
    });

    const result = await generateBulletinSnapshot(1, 7, persistence);

    const mathLine = state.bulletinLines.find((line) => line.subjectName === 'Math');

    // Alice is tied at 15, so rank 1
    expect(mathLine?.rank).toBe(1);
  });

  it('calcule les rangs indépendamment pour chaque matière', async () => {
    const { persistence, state } = createFakePersistence({
      ...baseState,
      students: [
        { id: 1, classId: 10, schoolId: 1, firstName: 'Alice', lastName: 'Dupont' },
        { id: 2, classId: 10, schoolId: 1, firstName: 'Bob', lastName: 'Martin' },
      ],
      grades: [
        // Math: Alice 16, Bob 12
        { id: 1, evaluationId: 1, studentId: 1, score: '16' },
        { id: 2, evaluationId: 1, studentId: 2, score: '12' },
        // Français: Alice 10, Bob 16
        { id: 3, evaluationId: 2, studentId: 1, score: '5' }, // 5/10 = 10/20
        { id: 4, evaluationId: 2, studentId: 2, score: '8' }, // 8/10 = 16/20
      ],
    });

    const result = await generateBulletinSnapshot(1, 7, persistence);

    const mathLine = state.bulletinLines.find((line) => line.subjectName === 'Math');
    const frenchLine = state.bulletinLines.find((line) => line.subjectName === 'Français');

    // Alice is 1st in Math, 2nd in French
    expect(mathLine?.rank).toBe(1);
    expect(frenchLine?.rank).toBe(2);
  });

  it('choisit l enseignant principal d une matière par fréquence d affectation et non par la dernière occurrence', () => {
    expect(resolveSubjectTeacherName([7, 8, 7, 9], new Map([
      [7, 'Mme Aline'],
      [8, 'M. Benoit'],
      [9, 'Mme Celine'],
    ]))).toBe('Mme Aline');
  });

  it('retourne null pour le rang si aucune moyenne valide n\'existe', async () => {
    const { persistence, state } = createFakePersistence({
      ...baseState,
      grades: [
        // Only Bob has a grade in Math; Alice has none
        { id: 1, evaluationId: 1, studentId: 2, score: '15' },
      ],
    });

    const result = await generateBulletinSnapshot(1, 7, persistence);

    const mathLine = state.bulletinLines.find((line) => line.subjectName === 'Math');

    // Alice has no grade in Math, so rank should be null
    expect(mathLine?.rank).toBeNull();
  });

  it('le rang par matière correspond à la moyenne affichée dans la colonne Note /20', async () => {
    const { persistence, state } = createFakePersistence({
      ...baseState,
      students: [
        { id: 1, classId: 10, schoolId: 1, firstName: 'Alice', lastName: 'Dupont' },
        { id: 2, classId: 10, schoolId: 1, firstName: 'Bob', lastName: 'Martin' },
        { id: 3, classId: 10, schoolId: 1, firstName: 'Charlie', lastName: 'Durand' },
      ],
      grades: [
        // Math: Alice 20, Bob 10, Charlie 15
        { id: 1, evaluationId: 1, studentId: 1, score: '20' },
        { id: 2, evaluationId: 1, studentId: 2, score: '10' },
        { id: 3, evaluationId: 1, studentId: 3, score: '15' },
      ],
    });

    const result = await generateBulletinSnapshot(1, 7, persistence);

    const mathLine = state.bulletinLines.find((line) => line.subjectName === 'Math');

    // Alice: 20/20 (rank 1), average 20
    expect(mathLine?.average).toBe(20);
    expect(mathLine?.rank).toBe(1);
  });
});
