import { describe, expect, it } from 'vitest';
import {
  getEligibleGradesForEvaluation,
  getEligibleStudentsForEvaluation,
  getEligibleStudentsForEvaluationWithGrades,
  getFullyGradedEvaluations,
  isEvaluationFullyGraded,
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

  it('considère l évaluation terminée quand tous les élèves éligibles ont une note', () => {
    const relevantGrades: Grade[] = [grades[0]];
    expect(isEvaluationFullyGraded(evaluation, students, relevantGrades)).toBe(true);
  });

  it('ne considère pas l évaluation terminée si un élève éligible manque une note', () => {
    const missingGrades: Grade[] = [];
    expect(isEvaluationFullyGraded(evaluation, students, missingGrades)).toBe(false);
  });

  it('ne considère pas l évaluation terminée si un élève inéligible a une note mais pas l élève éligible', () => {
    const ineligibleGrades: Grade[] = [
      { id: 3, evaluationId: 1, studentId: 2, score: '12', remarks: 'OK' },
    ];
    expect(isEvaluationFullyGraded(evaluation, students, ineligibleGrades)).toBe(false);
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
