import { describe, it, expect } from 'vitest';
import { validateGradeScore } from './gradeValidation';

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
});
