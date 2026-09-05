import { describe, it, expect } from 'vitest';
import { calculateEvaluationScoreBounds, validateGradeScore } from './gradeValidation';

describe('validateGradeScore', () => {
  it('accepts numeric score within maxScore', () => {
    expect(validateGradeScore('15.5', 20)).toEqual({ isValid: true });
  });

  it('rejects alphabetical input', () => {
    expect(validateGradeScore('abc', 20)).toEqual({
      isValid: false,
      error: 'La note doit être un nombre valide',
    });
  });

  it('rejects absence shorthand', () => {
    expect(validateGradeScore('Abs', 20)).toEqual({
      isValid: false,
      error: 'La note doit être un nombre valide',
    });
  });

  it('rejects scores above maxScore', () => {
    expect(validateGradeScore('25', 20)).toEqual({
      isValid: false,
      error: 'La note ne peut pas dépasser 20',
    });
  });

  it('rejects negative values', () => {
    expect(validateGradeScore('-1', 20)).toEqual({
      isValid: false,
      error: 'La note ne peut pas être négative',
    });
  });

  it('calculates separate normalized bounds and ignores Abs', () => {
    const bounds = calculateEvaluationScoreBounds([
      { evaluationId: 1, score: '14', maxScore: 20 },
      { evaluationId: 1, score: '19', maxScore: 20 },
      { evaluationId: 1, score: '19', maxScore: 20 },
      { evaluationId: 1, score: '7', maxScore: 20 },
      { evaluationId: 1, score: '7', maxScore: 20 },
      { evaluationId: 1, score: 'Abs', maxScore: 20 },
      { evaluationId: 2, score: '8', maxScore: 10 },
      { evaluationId: 2, score: '15', maxScore: 20 },
      { evaluationId: 3, score: '12', maxScore: 20 },
      { evaluationId: 4, score: '20', maxScore: 20, countInBulletin: false },
    ]);

    expect(bounds.get(1)).toEqual({ minimum: 7, maximum: 19 });
    expect(bounds.get(2)).toEqual({ minimum: 15, maximum: 16 });
    expect(bounds.get(3)).toEqual({ minimum: 12, maximum: 12 });
    expect(bounds.get(4)).toEqual({ minimum: 20, maximum: 20 });
  });
});
