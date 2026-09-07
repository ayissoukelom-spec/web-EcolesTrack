import { describe, expect, it } from 'vitest';
import { getExpectedPeriodTypeForCycle, getPeriodTypeShortName, inferLevelCodeFromClassName, isTermCompatibleWithCycle } from './educationStructure';

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
  });

  it('formats short labels from period metadata and legacy names', () => {
    expect(getPeriodTypeShortName('trimester', 2)).toBe('T2');
    expect(getPeriodTypeShortName('semester', 2)).toBe('S2');
    expect(getPeriodTypeShortName(null, 1, 'Trimestre 3')).toBe('T3');
    expect(getPeriodTypeShortName(null, 1, 'Semestre 2')).toBe('S2');
  });
});
