import { describe, expect, it } from 'vitest';
import {
  getEligibleGradesForEvaluation,
  getEligibleStudentsForEvaluation,
  getEligibleStudentsForEvaluationWithGrades,
  getFullyGradedEvaluations,
  getOverdueEvaluations,
  isEvaluationArchivedForSchoolAdminByAge,
  isEvaluationArchived,
  isEvaluationFullyGraded,
  isEvaluationCompleted,
  isStudentEligibleForEvaluation,
} from './evaluationUtils';
import type { Evaluation, Grade, Student } from '../types.ts';

describe('evaluation eligibility and grading rules', () => {
  const evaluation: Evaluation = {
    id: 1,
    classId: 10,
    teacherId: 100,
    subject: 'Mathématiques',
    title: 'Devoir 1',
    coefficient: 2,
    maxScore: 20,
    date: '2026-06-26',
    createdAt: '2026-06-25T09:00:00Z',
  };

  const students: Student[] = [
    { id: 1, schoolId: 1, classId: 10, className: '3ème A', firstName: 'Alice', lastName: 'Dupont', enrolledAt: '2026-06-24T08:00:00Z' },
    { id: 2, schoolId: 1, classId: 10, className: '3ème A', firstName: 'Bob', lastName: 'Martin', enrolledAt: '2026-06-25T10:00:00Z' },
    { id: 3, schoolId: 1, classId: 10, className: '3ème A', firstName: 'Clara', lastName: 'Ndiaye', enrolledAt: '2026-06-25T09:30:00Z' },
  ];

  const grades: Grade[] = [
    { id: 1, evaluationId: 1, studentId: 1, score: '15', remarks: 'Bien' },
    { id: 2, evaluationId: 1, studentId: 3, score: '14', remarks: 'OK' },
  ];

  it('autorise un élève inscrit avant la création de l évaluation', () => {
    expect(isStudentEligibleForEvaluation(students[0], evaluation)).toBe(true);
  });

  it('refuse un élève inscrit après la création de l évaluation', () => {
    expect(isStudentEligibleForEvaluation(students[1], evaluation)).toBe(false);
  });

  it('refuse un élève inscrit le même jour mais après l heure de création', () => {
    expect(isStudentEligibleForEvaluation(students[2], evaluation)).toBe(false);
  });

  it('compte uniquement les élèves éligibles pour Total copies saisies', () => {
    const eligibleStudents = getEligibleStudentsForEvaluation(evaluation, students);
    expect(eligibleStudents.map((st) => st.id)).toEqual([1]);
  });

  it('compte uniquement les notes des élèves éligibles pour Total copies saisies', () => {
    const allGrades: Grade[] = [
      { id: 1, evaluationId: 1, studentId: 1, score: '15', remarks: 'Bien' },
      { id: 2, evaluationId: 1, studentId: 2, score: '12', remarks: 'OK' },
      { id: 3, evaluationId: 1, studentId: 3, score: '14', remarks: 'OK' },
    ];
    const eligibleGrades = getEligibleGradesForEvaluation(evaluation, students, allGrades);
    expect(eligibleGrades.map((grade) => grade.studentId)).toEqual([1]);
  });

  it('ne considère pas l évaluation terminée si un élève éligible manque une note, même si un élève inéligible en a une', () => {
    const ineligibleGrades: Grade[] = [
      { id: 1, evaluationId: 1, studentId: 2, score: '12', remarks: 'OK' },
    ];
    expect(isEvaluationFullyGraded(evaluation, students, ineligibleGrades)).toBe(false);
  });

  it('considère l évaluation terminée dès qu au moins une note existe pour l évaluation', () => {
    const partialGrades: Grade[] = [grades[0]];
    expect(isEvaluationFullyGraded(evaluation, students, partialGrades)).toBe(true);
  });

  it('ne considère pas l évaluation terminée si aucune note n existe', () => {
    const missingGrades: Grade[] = [];
    expect(isEvaluationFullyGraded(evaluation, students, missingGrades)).toBe(false);
  });

  it('ne considère pas l évaluation terminée si un élève inéligible a une note mais pas l élève éligible', () => {
    const ineligibleGrades: Grade[] = [
      { id: 3, evaluationId: 1, studentId: 2, score: '12', remarks: 'OK' },
    ];
    expect(isEvaluationFullyGraded(evaluation, students, ineligibleGrades)).toBe(false);
  });

  it('détecte un devoir en retard quand seul createdAt est renseigné', () => {
    const evaluationWithoutDate: Evaluation = {
      ...evaluation,
      id: 2,
      date: undefined,
      createdAt: '2026-06-01T09:00:00Z',
    } as Evaluation;

    const eligibleStudents: Student[] = [
      { id: 1, schoolId: 1, classId: 10, className: '3ème A', firstName: 'Alice', lastName: 'Dupont', enrolledAt: '2026-05-31T08:00:00Z' },
    ];

    const overdue = getOverdueEvaluations(
      [evaluationWithoutDate],
      eligibleStudents,
      [],
      'school_admin',
      undefined,
      { overdueDays: 7, nowMs: new Date('2026-07-10T00:00:00Z').getTime() },
    );

    expect(overdue.map((ev) => ev.id)).toEqual([2]);
  });

  it('ignore les élèves d une autre école avec le même classId pour le calcul des overdue', () => {
    const evaluationDifferentSchool = {
      ...evaluation,
      id: 99,
      classId: 20,
      date: '2024-01-01',
      createdAt: '2024-01-01T09:00:00Z',
      schoolId: 10,
    } as Evaluation & { schoolId: number };

    const allStudents: Student[] = [
      { id: 1, schoolId: 10, classId: 20, className: '3ème A', firstName: 'Alice', lastName: 'Dupont', enrolledAt: '2023-12-01T08:00:00Z' },
      { id: 2, schoolId: 10, classId: 20, className: '3ème A', firstName: 'Bob', lastName: 'Martin', enrolledAt: '2023-12-01T08:00:00Z' },
      { id: 3, schoolId: 20, classId: 20, className: '3ème A', firstName: 'Other', lastName: 'Student', enrolledAt: '2023-12-01T08:00:00Z' },
    ];

    const grades: Grade[] = [
      { id: 1, evaluationId: 99, studentId: 1, score: '15', remarks: 'Bien' },
      { id: 2, evaluationId: 99, studentId: 2, score: '14', remarks: 'OK' },
    ];

    const overdue = getOverdueEvaluations(
      [evaluationDifferentSchool],
      allStudents,
      grades,
      'super_admin',
      undefined,
      { overdueDays: 7, nowMs: new Date('2024-02-15T00:00:00Z').getTime() },
    );

    expect(overdue).toHaveLength(0);
  });

  it('garde valide un élève historique déjà noté sur une ancienne évaluation', () => {
    const legacyEvaluation: Evaluation = {
      ...evaluation,
      id: 2,
      title: 'Devoir historique',
      createdAt: undefined,
      date: '2026-06-20',
    } as Evaluation;

    const legacyGrades: Grade[] = [
      { id: 4, evaluationId: 2, studentId: 3, score: '14', remarks: 'OK' },
    ];

    const eligibleStudents = getEligibleStudentsForEvaluationWithGrades(legacyEvaluation, students, legacyGrades);
    expect(eligibleStudents.map((st) => st.id)).toEqual([3]);
    expect(isEvaluationFullyGraded(legacyEvaluation, students, [
      { id: 4, evaluationId: 2, studentId: 3, score: '14', remarks: 'OK' },
    ])).toBe(true);
  });

  it('utilise un critère partagé pour la page Notes et la page Archive', () => {
    const secondEvaluation: Evaluation = {
      ...evaluation,
      id: 2,
      classId: 10,
      title: 'Devoir 2',
      createdAt: '2026-06-24T08:00:00Z',
    };
    const evaluations = [evaluation, secondEvaluation];
    const gradesForBoth: Grade[] = [
      { id: 1, evaluationId: 1, studentId: 1, score: '15', remarks: 'Bien' },
      { id: 2, evaluationId: 2, studentId: 1, score: '16', remarks: 'Très bien' },
    ];

    const finishedEvaluations = getFullyGradedEvaluations(evaluations, students, gradesForBoth);
    expect(finishedEvaluations.map((ev) => ev.id)).toEqual([1, 2]);

    const notesPageArchived = evaluations.filter((ev) => isEvaluationFullyGraded(ev, students, gradesForBoth));
    expect(notesPageArchived.map((ev) => ev.id)).toEqual(finishedEvaluations.map((ev) => ev.id));
  });
});

describe('evaluation completion status (new business rule)', () => {
  const evaluation: Evaluation = {
    id: 1,
    classId: 10,
    teacherId: 100,
    subject: 'Mathématiques',
    title: 'Devoir 1',
    coefficient: 2,
    maxScore: 20,
    date: '2026-06-26',
    createdAt: '2026-06-25T09:00:00Z',
  };

  const students: Student[] = [
    { id: 1, schoolId: 1, classId: 10, className: '3ème A', firstName: 'Alice', lastName: 'Dupont', enrolledAt: '2026-06-24T08:00:00Z' },
    { id: 2, schoolId: 1, classId: 10, className: '3ème A', firstName: 'Bob', lastName: 'Martin', enrolledAt: '2026-06-25T10:00:00Z' },
    { id: 3, schoolId: 1, classId: 10, className: '3ème A', firstName: 'Clara', lastName: 'Ndiaye', enrolledAt: '2026-06-25T09:30:00Z' },
  ];

  it('considère l évaluation NON complète si aucune note n existe', () => {
    const noGrades: Grade[] = [];
    expect(isEvaluationCompleted(evaluation, students, noGrades)).toBe(false);
  });

  it('considère l évaluation complète si seulement l élève éligible Alice a une note', () => {
    const partialGrades: Grade[] = [
      { id: 1, evaluationId: 1, studentId: 1, score: '15', remarks: 'Bien' },
    ];
    expect(isEvaluationCompleted(evaluation, students, partialGrades)).toBe(true);
  });

  it('ignore les notes des élèves inéligibles (inscrits après création)', () => {
    const ineligibleGrades: Grade[] = [
      { id: 2, evaluationId: 1, studentId: 2, score: '12', remarks: 'OK' },
      { id: 3, evaluationId: 1, studentId: 3, score: '14', remarks: 'OK' },
    ];
    expect(isEvaluationCompleted(evaluation, students, ineligibleGrades)).toBe(false);
  });

  it('scénario réel: 30 élèves, 1 note = NON complète (partielle)', () => {
    const thirtyStudents = Array.from({ length: 30 }, (_, i) => ({
      id: i + 1,
      schoolId: 1,
      classId: 10,
      className: '3ème A',
      firstName: `Élève${i + 1}`,
      lastName: 'Test',
      enrolledAt: '2026-06-24T08:00:00Z',
    })) as Student[];

    const oneGrade: Grade[] = [
      { id: 1, evaluationId: 1, studentId: 1, score: '15', remarks: 'Bien' },
    ];
    expect(isEvaluationCompleted(evaluation, thirtyStudents, oneGrade)).toBe(false);
  });

  it('scénario réel: 30 élèves, toutes les 30 notes = complète (archive)', () => {
    const thirtyStudents = Array.from({ length: 30 }, (_, i) => ({
      id: i + 1,
      schoolId: 1,
      classId: 10,
      className: '3ème A',
      firstName: `Élève${i + 1}`,
      lastName: 'Test',
      enrolledAt: '2026-06-24T08:00:00Z',
    })) as Student[];

    const thirtyGrades: Grade[] = Array.from({ length: 30 }, (_, i) => ({
      id: i + 1,
      evaluationId: 1,
      studentId: i + 1,
      score: String(10 + Math.random() * 10),
      remarks: 'OK',
    })) as Grade[];
    expect(isEvaluationCompleted(evaluation, thirtyStudents, thirtyGrades)).toBe(true);
  });

  it('considère l évaluation archivée uniquement lorsque toutes les notes éligibles sont présentes', () => {
    const ineligibleGrades: Grade[] = [
      { id: 2, evaluationId: 1, studentId: 2, score: '12', remarks: 'OK' },
    ];
    expect(isEvaluationArchived(evaluation, students, ineligibleGrades)).toBe(false);

    const fullGrades: Grade[] = [
      { id: 1, evaluationId: 1, studentId: 1, score: '15', remarks: 'Bien' },
    ];
    expect(isEvaluationArchived(evaluation, students, fullGrades)).toBe(true);
  });
});

describe('school admin archival age rule', () => {
  const evaluation: Evaluation = {
    id: 1,
    classId: 10,
    teacherId: 100,
    subject: 'Mathématiques',
    title: 'Devoir 1',
    coefficient: 2,
    maxScore: 20,
    date: '2026-05-01',
    createdAt: '2026-05-01T09:00:00Z',
  };

  const students: Student[] = [
    { id: 1, schoolId: 1, classId: 10, className: '3ème A', firstName: 'Alice', lastName: 'Dupont', enrolledAt: '2026-04-20T08:00:00Z' },
  ];

  it('archive une évaluation school_admin si une note existe depuis plus de 30 jours', () => {
    const oldGrade: Grade[] = [
      { id: 1, evaluationId: 1, studentId: 1, score: '15', remarks: 'Bien', createdAt: '2026-05-01T10:00:00Z', updatedAt: '2026-05-01T10:00:00Z' },
    ];

    const now = new Date('2026-06-05T00:00:00Z').getTime();
    const originalDateNow = Date.now;
    Date.now = () => now;
    try {
      expect(isEvaluationArchivedForSchoolAdminByAge(evaluation, students, oldGrade)).toBe(true);
    } finally {
      Date.now = originalDateNow;
    }
  });

  it('ne place pas en archive une évaluation school_admin si la note a été modifiée récemment', () => {
    const recentGrade: Grade[] = [
      { id: 1, evaluationId: 1, studentId: 1, score: '15', remarks: 'Bien', createdAt: '2026-06-01T10:00:00Z', updatedAt: '2026-06-01T10:00:00Z' },
    ];

    const now = new Date('2026-06-05T00:00:00Z').getTime();
    const originalDateNow = Date.now;
    Date.now = () => now;
    try {
      expect(isEvaluationArchivedForSchoolAdminByAge(evaluation, students, recentGrade)).toBe(false);
    } finally {
      Date.now = originalDateNow;
    }
  });
});
