import { describe, expect, it } from 'vitest';
import { filterAvailableSchoolTerms, getExpectedPeriodTypeForCycle, getPeriodTypeShortName, inferLevelCodeFromClassName, isTermCompatibleWithCycle, normalizeSchoolDate, resolveSchoolPeriodTypeStates, resolveSchoolTermByDate } from './educationStructure';

describe('educationStructure', () => {
  it('maps each cycle to its expected period type', () => {
    expect(getExpectedPeriodTypeForCycle('college')).toBe('trimester');
    expect(getExpectedPeriodTypeForCycle('primaire')).toBe('trimester');
    expect(getExpectedPeriodTypeForCycle('lycee')).toBe('semester');
    expect(getExpectedPeriodTypeForCycle(null)).toBeNull();
  });

  it('only makes a period type available when its cycle is active and its school approval is approved', () => {
    const cegOnly = resolveSchoolPeriodTypeStates(
      [{ id: 1, code: 'college' }],
      [
        { periodType: 'trimester', status: 'approved' },
        { periodType: 'semester', status: 'rejected' },
      ],
    );
    expect(cegOnly.map((state) => state.available)).toEqual([true, false]);

    const primaireOnly = resolveSchoolPeriodTypeStates(
      [{ id: 3, code: 'primaire' }],
      [
        { periodType: 'trimester', status: 'approved' },
        { periodType: 'semester', status: 'rejected' },
      ],
    );
    expect(primaireOnly.map((state) => state.available)).toEqual([true, false]);

    const lyceeOnly = resolveSchoolPeriodTypeStates(
      [{ id: 2, code: 'lycee' }],
      [
        { periodType: 'trimester', status: 'rejected' },
        { periodType: 'semester', status: 'approved' },
      ],
    );
    expect(lyceeOnly.map((state) => state.available)).toEqual([false, true]);

    const mixed = resolveSchoolPeriodTypeStates(
      [{ id: 1, code: 'college' }, { id: 2, code: 'lycee' }],
      [
        { periodType: 'trimester', status: 'approved' },
        { periodType: 'semester', status: 'approved' },
      ],
    );
    expect(mixed.map((state) => state.available)).toEqual([true, true]);
  });

  it('filters periods by school approval, active flag and class cycle', () => {
    const mixedStates = resolveSchoolPeriodTypeStates(
      [{ id: 1, code: 'college' }, { id: 2, code: 'lycee' }],
      [
        { periodType: 'trimester', status: 'approved' },
        { periodType: 'semester', status: 'approved' },
      ],
    );
    const terms = [
      { id: 1, cycleId: 1, periodType: 'trimester', isActive: true },
      { id: 2, cycleId: 2, periodType: 'semester', isActive: true },
      { id: 3, cycleId: 2, periodType: 'semester', isActive: false },
    ];

    expect(filterAvailableSchoolTerms(terms, mixedStates, { cycleId: 1, cycleCode: 'college' }).map((term) => term.id)).toEqual([1]);
    expect(filterAvailableSchoolTerms(terms, mixedStates, { cycleId: 2, cycleCode: 'lycee' }).map((term) => term.id)).toEqual([2]);

    const cegStates = resolveSchoolPeriodTypeStates(
      [{ id: 1, code: 'college' }],
      [{ periodType: 'trimester', status: 'approved' }, { periodType: 'semester', status: 'rejected' }],
    );
    expect(filterAvailableSchoolTerms(terms, cegStates).map((term) => term.id)).toEqual([1]);
  });

  it('filters shared trimester approvals by each active class cycle, regardless of cycle order', () => {
    const terms = [
      { id: 1, cycleId: 1, periodType: 'trimester', isActive: true },
      { id: 2, cycleId: 2, periodType: 'trimester', isActive: true },
      { id: 3, cycleId: 3, periodType: 'trimester', isActive: true },
      { id: 4, cycleId: 2, periodType: 'trimester', isActive: false },
    ];
    const approvals = [{ periodType: 'trimester', status: 'approved' }];
    const activeCycles = [{ id: 1, code: 'college' }, { id: 2, code: 'primaire' }];
    const reversedCycles = [...activeCycles].reverse();

    for (const cycles of [activeCycles, reversedCycles]) {
      const states = resolveSchoolPeriodTypeStates(cycles, approvals);
      expect(filterAvailableSchoolTerms(terms, states, { cycleId: 1, cycleCode: 'college' }).map((term) => term.id)).toEqual([1]);
      expect(filterAvailableSchoolTerms(terms, states, { cycleId: 2, cycleCode: 'primaire' }).map((term) => term.id)).toEqual([2]);
    }
  });

  it.each([
    ['absent', []],
    ['pending', [{ periodType: 'trimester', status: 'pending' }]],
    ['rejected', [{ periodType: 'trimester', status: 'rejected' }]],
  ])('does not make shared trimesters available when approval is %s', (_label, approvals) => {
    const states = resolveSchoolPeriodTypeStates(
      [{ id: 2, code: 'primaire' }],
      approvals,
    );
    expect(filterAvailableSchoolTerms(
      [{ id: 2, cycleId: 2, periodType: 'trimester', isActive: true }],
      states,
      { cycleId: 2, cycleCode: 'primaire' },
    )).toEqual([]);
  });

  it('keeps all three approved college trimesters and lycée semesters available to their own cycles', () => {
    const activeCycles = [{ id: 1, code: 'college' }, { id: 2, code: 'primaire' }, { id: 3, code: 'lycee' }];
    const states = resolveSchoolPeriodTypeStates(activeCycles, [
      { periodType: 'trimester', status: 'approved' },
      { periodType: 'semester', status: 'approved' },
    ]);
    const terms = [
      { id: 1, cycleId: 1, periodType: 'trimester', isActive: true },
      { id: 2, cycleId: 1, periodType: 'trimester', isActive: true },
      { id: 3, cycleId: 1, periodType: 'trimester', isActive: true },
      { id: 4, cycleId: 3, periodType: 'semester', isActive: true },
      { id: 5, cycleId: 3, periodType: 'semester', isActive: true },
    ];

    expect(filterAvailableSchoolTerms(terms, states, { cycleId: 1, cycleCode: 'college' }).map((term) => term.id)).toEqual([1, 2, 3]);
    expect(filterAvailableSchoolTerms(terms, states, { cycleId: 3, cycleCode: 'lycee' }).map((term) => term.id)).toEqual([4, 5]);
  });

  it('keeps legacy terms without a cycleId compatible only for active cycles with approved period types', () => {
    const terms = [{ id: 1, cycleId: null, periodType: 'trimester', isActive: true }];
    const approvedStates = resolveSchoolPeriodTypeStates(
      [{ id: 1, code: 'college' }, { id: 2, code: 'primaire' }],
      [{ periodType: 'trimester', status: 'approved' }],
    );
    const primaryOnlyStates = resolveSchoolPeriodTypeStates(
      [{ id: 1, code: 'college' }],
      [{ periodType: 'trimester', status: 'approved' }],
    );
    const pendingStates = resolveSchoolPeriodTypeStates(
      [{ id: 1, code: 'college' }, { id: 2, code: 'primaire' }],
      [],
    );

    expect(filterAvailableSchoolTerms(terms, approvedStates, { cycleId: 2, cycleCode: 'primaire' })).toEqual(terms);
    expect(filterAvailableSchoolTerms(terms, primaryOnlyStates, { cycleId: 2, cycleCode: 'primaire' })).toEqual([]);
    expect(filterAvailableSchoolTerms(terms, pendingStates, { cycleId: 2, cycleCode: 'primaire' })).toEqual([]);
  });

  it('maps structured class levels to their canonical level codes', () => {
    expect(inferLevelCodeFromClassName('6ème A')).toBe('6e');
    expect(inferLevelCodeFromClassName('3ème B')).toBe('3e');
    expect(inferLevelCodeFromClassName('Maternelle 1 A')).toBe('maternelle1');
    expect(inferLevelCodeFromClassName('CP1 A')).toBe('cp1');
    expect(inferLevelCodeFromClassName('CM2 B')).toBe('cm2');
    expect(inferLevelCodeFromClassName('2nde A4')).toBe('2nde');
    expect(inferLevelCodeFromClassName('Tle D')).toBe('tle');
  });

  it('keeps historical terms compatible when they have no cycleId but match the right period type', () => {
    expect(isTermCompatibleWithCycle({ cycleId: null, periodType: 'trimester' }, { cycleId: 9, cycleCode: 'college' })).toBe(true);
    expect(isTermCompatibleWithCycle({ cycleId: null, periodType: 'trimester' }, { cycleId: 9, cycleCode: 'primaire' })).toBe(true);
    expect(isTermCompatibleWithCycle({ cycleId: null, periodType: 'semester' }, { cycleId: 9, cycleCode: 'lycee' })).toBe(true);
    expect(isTermCompatibleWithCycle({ cycleId: null, periodType: 'semester' }, { cycleId: 9, cycleCode: 'college' })).toBe(false);
    expect(isTermCompatibleWithCycle({ cycleId: 42, periodType: 'trimester' }, { cycleId: 9, cycleCode: 'college' })).toBe(false);
    expect(isTermCompatibleWithCycle({ cycleId: 9, periodType: 'semester' }, { cycleId: 9, cycleCode: 'college' })).toBe(false);
  });

  it('rejects period use when the class cycle cannot be resolved', () => {
    expect(isTermCompatibleWithCycle({ periodType: 'trimester' }, { cycleId: null, cycleCode: null })).toBe(false);
    expect(isTermCompatibleWithCycle(
      { cycleId: null, periodType: 'trimester' },
      { cycleId: 99, cycleCode: 'unknown-cycle' },
    )).toBe(false);
    const states = resolveSchoolPeriodTypeStates(
      [{ id: 1, code: 'college' }],
      [{ periodType: 'trimester', status: 'approved' }],
    );
    expect(filterAvailableSchoolTerms(
      [{ id: 1, periodType: 'trimester', isActive: true }],
      states,
      { cycleId: null, cycleCode: null },
    )).toEqual([]);
    expect(filterAvailableSchoolTerms(
      [{ id: 1, periodType: 'trimester', isActive: true }],
      states,
      { cycleId: 99, cycleCode: 'unknown-cycle' },
    )).toEqual([]);
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
