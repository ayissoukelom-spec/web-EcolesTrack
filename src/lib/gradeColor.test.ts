import { describe, expect, it } from 'vitest';
import { getGradeAppreciation } from './gradeColor';

describe('getGradeAppreciation', () => {
  it.each([
    [5.99, 'Très insuffisant'],
    [6, 'Insuffisant'],
    [9.99, 'Insuffisant'],
    [10, 'Passable'],
    [12, 'Assez bien'],
    [14, 'Bien'],
    [16, 'Très bien'],
    [18, 'Excellent'],
    [20, 'Excellent'],
  ])('returns %s as %s for the /20 scale', (value, expected) => {
    expect(getGradeAppreciation(value)).toBe(expected);
  });

  it('returns null for null and invalid values', () => {
    expect(getGradeAppreciation(null)).toBeNull();
    expect(getGradeAppreciation(undefined)).toBeNull();
    expect(getGradeAppreciation(Number.NaN)).toBeNull();
    expect(getGradeAppreciation('abc')).toBeNull();
  });
});
