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

    expect(result.average).toBeNull();
    expect(result.totalCoefficients).toBe(0);
    expect(state.bulletinLines.map((line) => line.subjectName)).toEqual(['Math']);
    expect(state.bulletinLines[0]?.coefficient).toBeNull();
    expect(state.bulletinLines.some((line) => line.subjectName === 'Français')).toBe(false);
    expect(state.bulletinLines.some((line) => line.subjectName === 'Histoire')).toBe(false);
  });

  it('utilise le coefficient de la composition publiée pour la ligne matière', async () => {
    const { persistence, state } = createFakePersistence({
      ...baseState,
      evaluations: [
        { id: 10, classId: 10, teacherId: 1, termId: 7, subject: 'Math', title: 'Interro 1', type: 'interrogation', coefficient: 2, maxScore: 20, countInBulletin: true },
        { id: 11, classId: 10, teacherId: 1, termId: 7, subject: 'Math', title: 'Interro 2', type: 'interrogation', coefficient: 4, maxScore: 20, countInBulletin: true },
        { id: 12, classId: 10, teacherId: 1, termId: 7, subject: 'Math', title: 'Devoir', type: 'devoir', coefficient: 1, maxScore: 20, countInBulletin: true },
        { id: 13, classId: 10, teacherId: 1, termId: 7, subject: 'Math', title: 'Composition', type: 'composition', coefficient: 3, maxScore: 20, countInBulletin: true },
      ],
      grades: [
        { id: 10, evaluationId: 10, studentId: 1, score: '10' },
        { id: 11, evaluationId: 11, studentId: 1, score: '14' },
        { id: 12, evaluationId: 12, studentId: 1, score: '12' },
        { id: 13, evaluationId: 13, studentId: 1, score: '16' },
      ],
    });

    const result = await generateBulletinSnapshot(1, 7, persistence);
    const mathLine = state.bulletinLines.find((line) => line.subjectName === 'Math');

    expect(mathLine?.coefficient).toBe(3);
    expect(mathLine?.coefficient).not.toBe(10);
    expect(result.totalCoefficients).toBe(3);
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

  it('le rang par matière correspond à la moyenne affichée dans la colonne Moy. Général', async () => {
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

    // Alice: Moy. Clas 20/20 (rank 1), Moy. Général 20 because no composition exists
    expect(mathLine?.average).toBe(20);
    expect(mathLine?.rank).toBe(1);
  });

  it('calcule Moy. Clas comme la moyenne des moyennes Interro et Devoir', async () => {
    const { persistence, state } = createFakePersistence({
      ...baseState,
      students: [baseState.students[0]],
      evaluations: [
        { id: 10, classId: 10, teacherId: 1, termId: 7, subject: 'Math', title: 'Interro 1', type: 'interrogation', coefficient: 1, maxScore: 20, countInBulletin: true },
        { id: 11, classId: 10, teacherId: 1, termId: 7, subject: 'Math', title: 'Interro 2', type: 'interrogation', coefficient: 1, maxScore: 20, countInBulletin: true },
        { id: 12, classId: 10, teacherId: 1, termId: 7, subject: 'Math', title: 'Devoir 1', type: 'devoir', coefficient: 1, maxScore: 20, countInBulletin: true },
        { id: 13, classId: 10, teacherId: 1, termId: 7, subject: 'Math', title: 'Devoir 2', type: 'devoir', coefficient: 1, maxScore: 20, countInBulletin: true },
      ],
      grades: [
        { id: 10, evaluationId: 10, studentId: 1, score: '12' },
        { id: 11, evaluationId: 11, studentId: 1, score: '16' },
        { id: 12, evaluationId: 12, studentId: 1, score: '10' },
        { id: 13, evaluationId: 13, studentId: 1, score: '14' },
      ],
    });

    await generateBulletinSnapshot(1, 7, persistence);

    const mathLine = state.bulletinLines.find((line) => line.subjectName === 'Math');
    expect(mathLine?.interrogation).toBe(14);
    expect(mathLine?.devoir).toBe(12);
    expect(mathLine?.classAverage).toBe(13);
  });

  it('utilise uniquement la moyenne Interro si aucun Devoir n existe', async () => {
    const { persistence, state } = createFakePersistence({
      ...baseState,
      students: [baseState.students[0]],
      evaluations: [
        { id: 20, classId: 10, teacherId: 1, termId: 7, subject: 'Math', title: 'Interro', type: 'interrogation', coefficient: 1, maxScore: 20, countInBulletin: true },
      ],
      grades: [{ id: 20, evaluationId: 20, studentId: 1, score: '15' }],
    });

    await generateBulletinSnapshot(1, 7, persistence);

    expect(state.bulletinLines[0]?.classAverage).toBe(15);
  });

  it('utilise uniquement la moyenne Devoir si aucune Interro n existe', async () => {
    const { persistence, state } = createFakePersistence({
      ...baseState,
      students: [baseState.students[0]],
      evaluations: [
        { id: 30, classId: 10, teacherId: 1, termId: 7, subject: 'Math', title: 'Devoir', type: 'devoir', coefficient: 1, maxScore: 20, countInBulletin: true },
      ],
      grades: [{ id: 30, evaluationId: 30, studentId: 1, score: '13' }],
    });

    await generateBulletinSnapshot(1, 7, persistence);

    expect(state.bulletinLines[0]?.classAverage).toBe(13);
  });

  it('exclut les évaluations non retenues de Moy. Clas', async () => {
    const { persistence, state } = createFakePersistence({
      ...baseState,
      students: [baseState.students[0]],
      evaluations: [
        { id: 40, classId: 10, teacherId: 1, termId: 7, subject: 'Math', title: 'Interro retenue', type: 'interrogation', coefficient: 1, maxScore: 20, countInBulletin: true },
        { id: 41, classId: 10, teacherId: 1, termId: 7, subject: 'Math', title: 'Devoir non retenu', type: 'devoir', coefficient: 1, maxScore: 20, countInBulletin: false },
      ],
      grades: [
        { id: 40, evaluationId: 40, studentId: 1, score: '15' },
        { id: 41, evaluationId: 41, studentId: 1, score: '1' },
      ],
    });

    await generateBulletinSnapshot(1, 7, persistence);

    expect(state.bulletinLines[0]?.classAverage).toBe(15);
  });

  it('retourne null pour Moy. Clas sans Interro ni Devoir', async () => {
    const { persistence, state } = createFakePersistence({
      ...baseState,
      students: [baseState.students[0]],
      evaluations: [
        { id: 50, classId: 10, teacherId: 1, termId: 7, subject: 'Math', title: 'Composition', type: 'composition', coefficient: 1, maxScore: 20, countInBulletin: true },
      ],
      grades: [{ id: 50, evaluationId: 50, studentId: 1, score: '18' }],
    });

    await generateBulletinSnapshot(1, 7, persistence);

    expect(state.bulletinLines[0]?.classAverage).toBeNull();
  });

  it('calcule Moy. Clas indépendamment pour chaque matière', async () => {
    const { persistence, state } = createFakePersistence({
      ...baseState,
      students: [baseState.students[0]],
      evaluations: [
        { id: 60, classId: 10, teacherId: 1, termId: 7, subject: 'Math', title: 'Interro', type: 'interrogation', coefficient: 1, maxScore: 20, countInBulletin: true },
        { id: 61, classId: 10, teacherId: 1, termId: 7, subject: 'Math', title: 'Devoir', type: 'devoir', coefficient: 1, maxScore: 20, countInBulletin: true },
        { id: 62, classId: 10, teacherId: 1, termId: 7, subject: 'Français', title: 'Interro', type: 'interrogation', coefficient: 1, maxScore: 20, countInBulletin: true },
        { id: 63, classId: 10, teacherId: 1, termId: 7, subject: 'Français', title: 'Devoir', type: 'devoir', coefficient: 1, maxScore: 20, countInBulletin: true },
      ],
      grades: [
        { id: 60, evaluationId: 60, studentId: 1, score: '10' },
        { id: 61, evaluationId: 61, studentId: 1, score: '14' },
        { id: 62, evaluationId: 62, studentId: 1, score: '16' },
        { id: 63, evaluationId: 63, studentId: 1, score: '12' },
      ],
    });

    await generateBulletinSnapshot(1, 7, persistence);

    expect(state.bulletinLines.find((line) => line.subjectName === 'Math')?.classAverage).toBe(12);
    expect(state.bulletinLines.find((line) => line.subjectName === 'Français')?.classAverage).toBe(14);
  });

  it('calcule 11,50 comme Moy. Général et utilise cette valeur pour le rang et l appréciation', async () => {
    const { persistence, state } = createFakePersistence({
      ...baseState,
      students: [baseState.students[0]],
      evaluations: [
        { id: 70, classId: 10, teacherId: 1, termId: 7, subject: 'Math', title: 'Interro', type: 'interrogation', coefficient: 1, maxScore: 20, countInBulletin: true },
        { id: 71, classId: 10, teacherId: 1, termId: 7, subject: 'Math', title: 'Devoir', type: 'devoir', coefficient: 1, maxScore: 20, countInBulletin: true },
        { id: 72, classId: 10, teacherId: 1, termId: 7, subject: 'Math', title: 'Compo', type: 'composition', coefficient: 1, maxScore: 20, countInBulletin: true },
      ],
      grades: [
        { id: 70, evaluationId: 70, studentId: 1, score: '11.07' },
        { id: 71, evaluationId: 71, studentId: 1, score: '11.21' },
        { id: 72, evaluationId: 72, studentId: 1, score: '11.86' },
      ],
    });

    await generateBulletinSnapshot(1, 7, persistence);

    const mathLine = state.bulletinLines.find((line) => line.subjectName === 'Math');
    expect(mathLine?.interrogation).toBeCloseTo(11.07, 2);
    expect(mathLine?.devoir).toBeCloseTo(11.21, 2);
    expect(mathLine?.classAverage).toBeCloseTo(11.14, 2);
    expect(mathLine?.composition).toBeCloseTo(11.86, 2);
    expect(mathLine?.average).toBeCloseTo(11.5, 2);
    expect(mathLine?.rank).toBe(1);
    expect(mathLine?.teacherComment).toBe('Passable');
  });
});
