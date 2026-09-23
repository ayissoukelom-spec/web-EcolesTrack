import { describe, expect, it } from 'vitest';
import { resolveExamPromotionDecision } from './examDecision';
import { selectPreferredClassExamConfiguration } from './classExamConfiguration';

const globalConfiguration = { id: 1, schoolId: null, examType: 'BEPC' };
const schoolOneConfiguration = { id: 2, schoolId: 1, examType: 'BEPC' };
const schoolTwoConfiguration = { id: 3, schoolId: 2, examType: 'BEPC' };

describe('class exam configuration scope', () => {
  it('selects a global configuration for a school', () => {
    expect(selectPreferredClassExamConfiguration([globalConfiguration], 1)).toEqual([globalConfiguration]);
  });

  it('keeps a school-specific configuration available', () => {
    expect(selectPreferredClassExamConfiguration([schoolOneConfiguration], 1)).toEqual([schoolOneConfiguration]);
  });

  it('allows the same global configuration for another school', () => {
    expect(selectPreferredClassExamConfiguration([globalConfiguration], 2)).toEqual([globalConfiguration]);
  });

  it('returns the school-specific and global configurations for that school', () => {
    expect(selectPreferredClassExamConfiguration([globalConfiguration, schoolOneConfiguration], 1))
      .toEqual([schoolOneConfiguration, globalConfiguration]);
  });

  it('prioritizes the school-specific configuration over the global one', () => {
    const [selected] = selectPreferredClassExamConfiguration([globalConfiguration, schoolOneConfiguration], 1);
    expect(selected).toBe(schoolOneConfiguration);
  });

  it('does not expose another school configuration', () => {
    expect(selectPreferredClassExamConfiguration([schoolTwoConfiguration], 1)).toEqual([]);
  });

  it('preserves an existing school-specific configuration when no global row exists', () => {
    expect(selectPreferredClassExamConfiguration([schoolOneConfiguration], 1)[0]).toBe(schoolOneConfiguration);
  });

  it('does not turn an absent result into a failed decision', () => {
    expect(resolveExamPromotionDecision({ examType: 'BEPC', resultStatus: null })).toBeNull();
    expect(resolveExamPromotionDecision({ examType: 'BEPC', resultStatus: 'ABSENT' })).toBeNull();
  });
});
