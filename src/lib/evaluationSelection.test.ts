import { describe, expect, it } from 'vitest';
import { resolveSelectedEvaluationId } from './evaluationSelection';
import type { Evaluation } from '../types';

describe('resolveSelectedEvaluationId', () => {
  const evaluations: Evaluation[] = [
    { id: 10, classId: 2, teacherId: 1, subject: 'Math', title: 'Devoir 1', coefficient: 1, maxScore: 20, date: '2026-06-01' },
    { id: 11, classId: 2, teacherId: 1, subject: 'Math', title: 'Devoir 2', coefficient: 1, maxScore: 20, date: '2026-06-08' },
  ];

  it('conserve la sélection si l’évaluation choisie appartient bien à la classe', () => {
    expect(resolveSelectedEvaluationId({ selectedClassId: '2', selectedEvalId: '11', classEvaluations: evaluations })).toBe('11');
  });

  it('revient à la première évaluation de la classe si la sélection actuelle n’y appartient plus', () => {
    expect(resolveSelectedEvaluationId({ selectedClassId: '2', selectedEvalId: '99', classEvaluations: evaluations })).toBe('10');
  });
});
