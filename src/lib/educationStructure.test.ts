import { describe, expect, it } from 'vitest';
import { getExpectedPeriodTypeForCycle, getPeriodTypeShortName, inferLevelCodeFromClassName, isTermCompatibleWithCycle, normalizeSchoolDate, resolveSchoolTermByDate } from './educationStructure';

describe('educationStructure', () => {
  it('maps each cycle to its expected period type', () => {
    expect(getExpectedPeriodTypeForCycle('college')).toBe('trimester');
    expect(getExpectedPeriodTypeForCycle('lycee')).toBe('semester');
    expect(getExpectedPeriodTypeForCycle(null)).toBeNull();
  });

  it('maps structured class levels to their canonical level codes', () => {
    expect(inferLevelCodeFromClassName('6ème A')).toBe('6e');
    expect(inferLevelCodeFromClassName('3ème B')).toBe('3e');
    expect(inferLevelCodeFromClassName('2nde A4')).toBe('2nde');
    expect(inferLevelCodeFromClassName('Tle D')).toBe('tle');
  });

  it('keeps historical terms compatible when they have no cycleId but match the right period type', () => {
    expect(isTermCompatibleWithCycle({ cycleId: null, periodType: 'trimester' }, { cycleId: 9, cycleCode: 'college' })).toBe(true);
    expect(isTermCompatibleWithCycle({ cycleId: null, periodType: 'semester' }, { cycleId: 9, cycleCode: 'lycee' })).toBe(true);
    expect(isTermCompatibleWithCycle({ cycleId: null, periodType: 'semester' }, { cycleId: 9, cycleCode: 'college' })).toBe(false);
    expect(isTermCompatibleWithCycle({ cycleId: 42, periodType: 'trimester' }, { cycleId: 9, cycleCode: 'college' })).toBe(false);
    expect(isTermCompatibleWithCycle({ cycleId: 9, periodType: 'semester' }, { cycleId: 9, cycleCode: 'college' })).toBe(false);
  });

  it('normalizes datetime-local values to their civil date without applying timezone offsets', () => {
    expect(normalizeSchoolDate('2026-09-25T14:30')).toBe('2026-09-25');
    expect(normalizeSchoolDate('2026-09-25T00:15:00+14:00')).toBe('2026-09-25');
    expect(normalizeSchoolDate('2026-02-31T14:30')).toBeNull();
  });

  it('selects the period inclusively on its final day when the evaluation has a time', () => {
    const semester = { id: 7, cycleId: 2, periodType: 'semester', startDate: '2026-09-23', endDate: '2026-09-25' };
    expect(resolveSchoolTermByDate([semester], '2026-09-25T14:30')).toEqual({ term: semester });
  });

  it('ignores college trimesters with identical dates for a lycee class', () => {
    const terms = [
      { id: 8, cycleId: 1, periodType: 'trimester', startDate: '2026-09-23', endDate: '2026-09-25' },
      { id: 7, cycleId: 2, periodType: 'semester', startDate: '2026-09-23', endDate: '2026-09-25' },
    ];
    const lyceeTerms = terms.filter((term) => isTermCompatibleWithCycle(term, { cycleId: 2, cycleCode: 'lycee' }));

    expect(lyceeTerms).toEqual([terms[1]]);
    expect(resolveSchoolTermByDate(lyceeTerms, '2026-09-25T14:30')).toEqual({ term: terms[1] });
  });

  it('selects trimester periods for a college class', () => {
    const terms = [
      { id: 8, cycleId: 1, periodType: 'trimester', startDate: '2026-09-23', endDate: '2026-09-25' },
      { id: 7, cycleId: 2, periodType: 'semester', startDate: '2026-09-23', endDate: '2026-09-25' },
    ];
    const collegeTerms = terms.filter((term) => isTermCompatibleWithCycle(term, { cycleId: 1, cycleCode: 'college' }));

    expect(collegeTerms).toEqual([terms[0]]);
    expect(resolveSchoolTermByDate(collegeTerms, '2026-09-25T14:30')).toEqual({ term: terms[0] });
  });

  it('reports a real overlap between periods of the same cycle', () => {
    const overlappingSemesters = [
      { id: 6, cycleId: 2, periodType: 'semester', startDate: '2026-09-23', endDate: '2026-09-25' },
      { id: 7, cycleId: 2, periodType: 'semester', startDate: '2026-09-25', endDate: '2026-09-27' },
    ];
    expect(resolveSchoolTermByDate(overlappingSemesters, '2026-09-25T14:30')).toEqual({
      error: 'Multiple active terms match the class cycle; select a term explicitly',
    });
  });

  it('returns an explicit error when no period contains the evaluation date', () => {
    const terms = [{ id: 7, startDate: '2026-09-23', endDate: '2026-09-25' }];
    expect(resolveSchoolTermByDate(terms, '2026-09-26T14:30')).toEqual({
      error: 'No school term matches the evaluation date',
    });
    expect(resolveSchoolTermByDate(terms, 'not-a-date')).toEqual({
      error: 'No school term matches the evaluation date',
    });
  });

  it('formats short labels from period metadata and legacy names', () => {
    expect(getPeriodTypeShortName('trimester', 2)).toBe('T2');
    expect(getPeriodTypeShortName('semester', 2)).toBe('S2');
    expect(getPeriodTypeShortName(null, 1, 'Trimestre 3')).toBe('T3');
    expect(getPeriodTypeShortName(null, 1, 'Semestre 2')).toBe('S2');
  });
});
