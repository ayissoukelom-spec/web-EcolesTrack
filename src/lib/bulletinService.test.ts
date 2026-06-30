import { describe, expect, it } from 'vitest';
import {
  calculateStudentTermAverage,
  selectBulletinEvaluationsForTerm,
} from './bulletinService';
import type { Evaluation, Grade, SchoolTerm, Student } from '../types';

const term: SchoolTerm = {
  id: 7,
  academicYearId: 1,
  name: 'Trimestre 1',
  orderIndex: 1,
  isActive: true,
};

const student: Student = {
  id: 1,
  schoolId: 1,
  classId: 10,
  className: '3ème A',
  firstName: 'Alice',
  lastName: 'Dupont',
  enrolledAt: '2026-06-01T08:00:00Z',
};

describe('bulletinService', () => {
  it('sélectionne uniquement les évaluations du trimestre comptabilisées dans le bulletin', () => {
    const evaluations: Evaluation[] = [
      { id: 1, classId: 10, teacherId: 2, termId: 7, subject: 'Math', title: 'DS 1', coefficient: 1, maxScore: 20, countInBulletin: true, date: '2026-06-10' },
      { id: 2, classId: 10, teacherId: 2, termId: 7, subject: 'Math', title: 'Bonus', coefficient: 1, maxScore: 20, countInBulletin: false, date: '2026-06-11' },
      { id: 3, classId: 10, teacherId: 2, termId: 8, subject: 'Math', title: 'Autre trimestre', coefficient: 1, maxScore: 20, countInBulletin: true, date: '2026-06-12' },
    ];

    expect(selectBulletinEvaluationsForTerm(7, evaluations).map((evaluation) => evaluation.id)).toEqual([1]);
  });

  it('calcule une moyenne simple', () => {
    const evaluations: Evaluation[] = [
      { id: 1, classId: 10, teacherId: 2, termId: 7, subject: 'Math', title: 'DS 1', coefficient: 1, maxScore: 20, countInBulletin: true, date: '2026-06-10' },
      { id: 2, classId: 10, teacherId: 2, termId: 7, subject: 'Français', title: 'DS 2', coefficient: 1, maxScore: 20, countInBulletin: true, date: '2026-06-11' },
    ];
    const grades: Grade[] = [
      { id: 1, evaluationId: 1, studentId: 1, score: '12' },
      { id: 2, evaluationId: 2, studentId: 1, score: '16' },
    ];

    const result = calculateStudentTermAverage({ term, student, evaluations, grades });

    expect(result.average).toBe(14);
    expect(result.totalCoefficient).toBe(2);
    expect(result.snapshots.filter((snapshot) => snapshot.countedInAverage).length).toBe(2);
  });

  it('applique plusieurs coefficients', () => {
    const evaluations: Evaluation[] = [
      { id: 1, classId: 10, teacherId: 2, termId: 7, subject: 'Math', title: 'DS 1', coefficient: 2, maxScore: 20, countInBulletin: true, date: '2026-06-10' },
      { id: 2, classId: 10, teacherId: 2, termId: 7, subject: 'Français', title: 'DS 2', coefficient: 1, maxScore: 20, countInBulletin: true, date: '2026-06-11' },
    ];
    const grades: Grade[] = [
      { id: 1, evaluationId: 1, studentId: 1, score: '10' },
      { id: 2, evaluationId: 2, studentId: 1, score: '16' },
    ];

    const result = calculateStudentTermAverage({ term, student, evaluations, grades });

    expect(result.average).toBeCloseTo(12, 5);
    expect(result.totalCoefficient).toBe(3);
    expect(result.totalWeightedScore).toBeCloseTo(36, 5);
  });

  it('normalise des barèmes différents', () => {
    const evaluations: Evaluation[] = [
      { id: 1, classId: 10, teacherId: 2, termId: 7, subject: 'Math', title: 'DS 1', coefficient: 1, maxScore: 20, countInBulletin: true, date: '2026-06-10' },
      { id: 2, classId: 10, teacherId: 2, termId: 7, subject: 'Français', title: 'DS 2', coefficient: 1, maxScore: 10, countInBulletin: true, date: '2026-06-11' },
    ];
    const grades: Grade[] = [
      { id: 1, evaluationId: 1, studentId: 1, score: '10' },
      { id: 2, evaluationId: 2, studentId: 1, score: '5' },
    ];

    const result = calculateStudentTermAverage({ term, student, evaluations, grades });

    expect(result.average).toBe(10);
    expect(result.snapshots[0].normalizedScore).toBe(10);
    expect(result.snapshots[1].normalizedScore).toBe(10);
  });

  it('ignore une évaluation exclue du bulletin', () => {
    const evaluations: Evaluation[] = [
      { id: 1, classId: 10, teacherId: 2, termId: 7, subject: 'Math', title: 'DS 1', coefficient: 1, maxScore: 20, countInBulletin: true, date: '2026-06-10' },
      { id: 2, classId: 10, teacherId: 2, termId: 7, subject: 'Français', title: 'DS 2', coefficient: 1, maxScore: 20, countInBulletin: false, date: '2026-06-11' },
    ];
    const grades: Grade[] = [
      { id: 1, evaluationId: 1, studentId: 1, score: '12' },
      { id: 2, evaluationId: 2, studentId: 1, score: '18' },
    ];

    const result = calculateStudentTermAverage({ term, student, evaluations, grades });

    expect(result.average).toBe(12);
    expect(result.selectedEvaluations.map((evaluation) => evaluation.id)).toEqual([1]);
  });

  it('inclut une évaluation sans termId dans le bulletin du trimestre demandé', () => {
    const evaluations: Evaluation[] = [
      { id: 1, classId: 10, teacherId: 2, termId: null, subject: 'Math', title: 'DS 1', coefficient: 1, maxScore: 20, countInBulletin: true, date: '2026-06-10' },
      { id: 2, classId: 10, teacherId: 2, termId: 7, subject: 'Français', title: 'DS 2', coefficient: 1, maxScore: 20, countInBulletin: true, date: '2026-06-11' },
    ];
    const grades: Grade[] = [
      { id: 1, evaluationId: 1, studentId: 1, score: '14' },
      { id: 2, evaluationId: 2, studentId: 1, score: '16' },
    ];

    const result = calculateStudentTermAverage({ term, student, evaluations, grades });

    expect(result.selectedEvaluations.map((evaluation) => evaluation.id)).toEqual([1, 2]);
    expect(result.average).toBe(15);
  });

  it('ignore une évaluation avec studentId différent de l élève', () => {
    const evaluations: Evaluation[] = [
      { id: 1, classId: 10, teacherId: 2, termId: 7, studentId: 2, subject: 'Math', title: 'DS privé', coefficient: 1, maxScore: 20, countInBulletin: true, date: '2026-06-10' },
      { id: 2, classId: 10, teacherId: 2, termId: 7, subject: 'Math', title: 'DS commun', coefficient: 1, maxScore: 20, countInBulletin: true, date: '2026-06-11' },
    ];
    const grades: Grade[] = [
      { id: 1, evaluationId: 1, studentId: 2, score: '18' },
      { id: 2, evaluationId: 2, studentId: 1, score: '14' },
    ];

    const result = calculateStudentTermAverage({ term, student, evaluations, grades });

    expect(result.average).toBe(14);
    expect(result.selectedEvaluations.map((evaluation) => evaluation.id)).toEqual([2]);
    expect(result.snapshots.some((snapshot) => snapshot.evaluationId === 1)).toBe(false);
  });

  it('retourne une moyenne nulle quand l élève n a pas de note', () => {
    const evaluations: Evaluation[] = [
      { id: 1, classId: 10, teacherId: 2, termId: 7, subject: 'Math', title: 'DS 1', coefficient: 1, maxScore: 20, countInBulletin: true, date: '2026-06-10' },
    ];

    const result = calculateStudentTermAverage({ term, student, evaluations, grades: [] });

    expect(result.average).toBeNull();
    expect(result.snapshots[0].countedInAverage).toBe(false);
    expect(result.snapshots[0].excludedReason).toBe('missing-grade');
  });

  it('valide un cas réaliste complet avec coefficients, barèmes différents, exclusion et note absente', () => {
    const evaluations: Evaluation[] = [
      { id: 1, classId: 10, teacherId: 2, termId: 7, subject: 'Math', title: 'Interro 1', coefficient: 2, maxScore: 20, countInBulletin: true, date: '2026-06-10' },
      { id: 2, classId: 10, teacherId: 2, termId: 7, subject: 'Français', title: 'Dictée', coefficient: 3, maxScore: 10, countInBulletin: true, date: '2026-06-11' },
      { id: 3, classId: 10, teacherId: 2, termId: 7, subject: 'SVT', title: 'TP', coefficient: 1, maxScore: 40, countInBulletin: true, date: '2026-06-12' },
      { id: 4, classId: 10, teacherId: 2, termId: 7, subject: 'Histoire', title: 'Exposé', coefficient: 2, maxScore: 20, countInBulletin: false, date: '2026-06-13' },
      { id: 5, classId: 10, teacherId: 2, termId: 7, subject: 'Anglais', title: 'Oral', coefficient: 4, maxScore: 20, countInBulletin: true, date: '2026-06-14' },
    ];

    const grades: Grade[] = [
      { id: 1, evaluationId: 1, studentId: 1, score: '14' },
      { id: 2, evaluationId: 2, studentId: 1, score: '8' },
      { id: 3, evaluationId: 3, studentId: 1, score: '30' },
      { id: 4, evaluationId: 4, studentId: 1, score: '20' },
      // Pas de note pour l'évaluation 5 (absente)
    ];

    const result = calculateStudentTermAverage({ term, student, evaluations, grades });

    expect(result.selectedEvaluations.map((evaluation) => evaluation.id)).toEqual([1, 2, 3, 5]);
    expect(result.totalWeightedScore).toBeCloseTo(91, 5);
    expect(result.totalCoefficient).toBe(6);
    expect(result.average).toBeCloseTo(15.1666666667, 5);

    const missingSnapshot = result.snapshots.find((snapshot) => snapshot.evaluationId === 5);
    expect(missingSnapshot?.countedInAverage).toBe(false);
    expect(missingSnapshot?.excludedReason).toBe('missing-grade');
  });
});