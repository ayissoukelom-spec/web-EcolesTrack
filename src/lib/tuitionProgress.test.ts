import { describe, expect, it } from 'vitest';
import {
  calculateTuitionProgress,
  type TuitionProgressInput,
  type TuitionProgressPeriod,
} from './tuitionProgress.ts';

const quarterlyPeriods: TuitionProgressPeriod[] = [
  {
    schoolId: null,
    academicYearId: 2025,
    cycleId: 2,
    periodType: 'trimester',
    orderIndex: 1,
    startDate: '2026-09-14',
    endDate: '2026-12-20',
    isActive: true,
  },
  {
    schoolId: null,
    academicYearId: 2025,
    cycleId: 2,
    periodType: 'trimester',
    orderIndex: 2,
    startDate: '2027-01-05',
    endDate: '2027-03-20',
    isActive: true,
  },
  {
    schoolId: null,
    academicYearId: 2025,
    cycleId: 2,
    periodType: 'trimester',
    orderIndex: 3,
    startDate: '2027-04-01',
    endDate: '2027-07-16',
    isActive: true,
  },
];

const tuitionProgress = (
  overrides: Partial<TuitionProgressInput> = {},
): TuitionProgressInput => ({
  schoolId: 7,
  academicYearId: 2025,
  academicYearSchoolId: 7,
  cycleId: 2,
  periods: quarterlyPeriods,
  annualNetAmount: 1000,
  netPaidAmount: 0,
  assessmentDate: '2027-02-20',
  ...overrides,
});

describe('tuition progress calendar', () => {
  it('derives daily progression from trimester dates across eleven calendar months', () => {
    const result = calculateTuitionProgress(tuitionProgress());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.system).toBe('trimester');
    expect(result.startDate).toBe('2026-09-14');
    expect(result.endDate).toBe('2027-07-16');
    expect(result.durationDays).toBe(306);
    expect(result.startMonth).toBe('2026-09');
    expect(result.endMonth).toBe('2027-07');
    expect(result.checkpoints.map((checkpoint) => checkpoint.month)).toEqual([
      '2026-09', '2026-10', '2026-11', '2026-12', '2027-01', '2027-02',
      '2027-03', '2027-04', '2027-05', '2027-06', '2027-07',
    ]);
    expect(result.checkpoints).toHaveLength(11);
    expect(result.checkpoints[0].checkDate).toBe('2026-09-30');
    expect(result.checkpoints[10]).toMatchObject({
      checkDate: '2027-07-16',
      elapsedDays: 306,
      expectedCumulativeAmount: 1000,
    });
    expect(result.currentAssessment).toMatchObject({
      assessmentDate: '2027-02-20',
      elapsedDays: 160,
      expectedCumulativeAmount: 523,
    });
  });

  it('derives the same actual school-year dates from two semesters', () => {
    const semesters: TuitionProgressPeriod[] = [
      {
        schoolId: 7,
        academicYearId: 2025,
        cycleId: 3,
        periodType: 'semester',
        orderIndex: 1,
        startDate: '2026-09-14',
        endDate: '2027-01-15',
        isActive: true,
      },
      {
        schoolId: 7,
        academicYearId: 2025,
        cycleId: 3,
        periodType: 'semester',
        orderIndex: 2,
        startDate: '2027-01-16',
        endDate: '2027-07-16',
        isActive: true,
      },
    ];
    const result = calculateTuitionProgress(tuitionProgress({
      cycleId: 3,
      periods: semesters,
      assessmentDate: '2027-02-20',
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.system).toBe('semester');
    expect(result.startDate).toBe('2026-09-14');
    expect(result.endDate).toBe('2027-07-16');
    expect(result.durationDays).toBe(306);
    expect(result.checkpoints).toHaveLength(11);
    expect(result.currentAssessment?.month).toBe('2027-02');
  });

  it('orders shared semesters chronologically when their historical order indexes are equal', () => {
    const semesters: TuitionProgressPeriod[] = [
      {
        schoolId: null,
        academicYearId: 2,
        cycleId: 2,
        periodType: 'semester',
        orderIndex: 1,
        startDate: '2027-01-05',
        endDate: '2027-03-30',
        isActive: true,
      },
      {
        schoolId: null,
        academicYearId: 2,
        cycleId: 2,
        periodType: 'semester',
        orderIndex: 1,
        startDate: '2026-09-14',
        endDate: '2026-12-23',
        isActive: true,
      },
    ];

    const result = calculateTuitionProgress(tuitionProgress({
      academicYearId: 2,
      academicYearSchoolId: null,
      cycleId: 2,
      periods: semesters,
      assessmentDate: '2026-11-30',
    }));

    expect(result).toMatchObject({
      ok: true,
      system: 'semester',
      startDate: '2026-09-14',
      endDate: '2027-03-30',
      currentAssessment: { month: '2026-11', assessmentDate: '2026-11-30' },
    });
  });

  it('accepts a shared academic year with shared periods for a school', () => {
    const sharedPeriods = quarterlyPeriods.map((period) => ({ ...period, schoolId: null }));
    const result = calculateTuitionProgress(tuitionProgress({
      academicYearSchoolId: null,
      periods: sharedPeriods,
    }));

    expect(result).toMatchObject({
      ok: true,
      schoolId: 7,
      academicYearId: 2025,
      startDate: '2026-09-14',
      endDate: '2027-07-16',
    });
  });

  it('accepts an October-to-June calendar and evaluates its actual duration', () => {
    const octoberToJune: TuitionProgressPeriod[] = [
      { ...quarterlyPeriods[0], startDate: '2026-10-01', endDate: '2026-12-20' },
      { ...quarterlyPeriods[1], startDate: '2027-01-05', endDate: '2027-03-20' },
      { ...quarterlyPeriods[2], startDate: '2027-04-01', endDate: '2027-06-30' },
    ];
    const result = calculateTuitionProgress(tuitionProgress({
      periods: octoberToJune,
      assessmentDate: '2027-06-30',
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.startMonth).toBe('2026-10');
    expect(result.endMonth).toBe('2027-06');
    expect(result.checkpoints).toHaveLength(9);
    expect(result.currentAssessment?.expectedCumulativeAmount).toBe(1000);
  });

  it('uses the reduced annual net amount and reaches it exactly at the school-year end', () => {
    const result = calculateTuitionProgress(tuitionProgress({
      annualNetAmount: 875,
      assessmentDate: '2027-07-16',
      netPaidAmount: 875,
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.checkpoints[10].expectedCumulativeAmount).toBe(875);
    expect(result.currentAssessment).toMatchObject({
      expectedCumulativeAmount: 875,
      shortfallAmount: 0,
      reminderJustified: false,
    });
  });

  it('does not assess a reminder after the school-year end', () => {
    const result = calculateTuitionProgress(tuitionProgress({
      assessmentDate: '2027-07-30',
      netPaidAmount: 900,
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.currentAssessment).toBeNull();
  });

  it('rounds proportional FCFA targets to integers without exceeding the annual amount', () => {
    const result = calculateTuitionProgress(tuitionProgress({
      annualNetAmount: 153,
      assessmentDate: '2026-09-30',
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.currentAssessment?.expectedCumulativeAmount).toBe(9);
    expect(result.checkpoints[result.checkpoints.length - 1].expectedCumulativeAmount).toBe(153);
    expect(result.checkpoints.every((checkpoint) => checkpoint.expectedCumulativeAmount <= 153)).toBe(true);
    expect(result.checkpoints.every((checkpoint, index) =>
      index === 0 || checkpoint.expectedCumulativeAmount >= result.checkpoints[index - 1].expectedCumulativeAmount))
      .toBe(true);
  });

  it('calculates the penultimate-day and final-day objectives separately', () => {
    const penultimateDay = calculateTuitionProgress(tuitionProgress({
      assessmentDate: '2026-09-29',
    }));
    const finalDay = calculateTuitionProgress(tuitionProgress({
      assessmentDate: '2026-09-30',
    }));

    expect(penultimateDay.ok && penultimateDay.currentAssessment).toMatchObject({
      elapsedDays: 16,
      expectedCumulativeAmount: 52,
    });
    expect(finalDay.ok && finalDay.currentAssessment).toMatchObject({
      elapsedDays: 17,
      expectedCumulativeAmount: 56,
    });
  });

  it('counts advance payments toward future months and only justifies a reminder for a shortfall', () => {
    const covered = calculateTuitionProgress(tuitionProgress({
      assessmentDate: '2027-01-20',
      netPaidAmount: 500,
    }));
    const short = calculateTuitionProgress(tuitionProgress({
      assessmentDate: '2027-02-20',
      netPaidAmount: 400,
    }));

    expect(covered.ok && covered.currentAssessment).toMatchObject({
      month: '2027-01',
      expectedCumulativeAmount: 422,
      reminderJustified: false,
    });
    expect(short.ok && short.currentAssessment).toMatchObject({
      month: '2027-02',
      expectedCumulativeAmount: 523,
      shortfallAmount: 123,
      reminderJustified: true,
    });
  });

  it('does not assess months outside the configured calendar', () => {
    const result = calculateTuitionProgress(tuitionProgress({
      assessmentDate: '2026-09-13',
      netPaidAmount: 0,
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.currentAssessment).toBeNull();
  });
});

describe('tuition progress validation', () => {
  it('rejects periods attached to another school or academic year', () => {
    const wrongSchool = quarterlyPeriods.map((period, index) =>
      index === 1 ? { ...period, schoolId: 9 } : period);
    expect(calculateTuitionProgress(tuitionProgress({ periods: wrongSchool })))
      .toMatchObject({ ok: false, error: { code: 'period_scope_mismatch' } });

    const wrongYear = quarterlyPeriods.map((period, index) =>
      index === 1 ? { ...period, academicYearId: 2024 } : period);
    expect(calculateTuitionProgress(tuitionProgress({ periods: wrongYear })))
      .toMatchObject({ ok: false, error: { code: 'periods_incomplete' } });

    expect(calculateTuitionProgress(tuitionProgress({ academicYearSchoolId: 9 })))
      .toMatchObject({ ok: false, error: { code: 'invalid_context' } });
  });

  it('rejects incomplete, mixed, or incorrectly ordered period sets', () => {
    expect(calculateTuitionProgress(tuitionProgress({ periods: quarterlyPeriods.slice(0, 2) })))
      .toMatchObject({ ok: false, error: { code: 'periods_incomplete' } });

    const mixedPeriods = quarterlyPeriods.map((period, index) =>
      index === 2 ? { ...period, periodType: 'semester' } : period);
    expect(calculateTuitionProgress(tuitionProgress({ periods: mixedPeriods })))
      .toMatchObject({ ok: false, error: { code: 'period_type_ambiguous' } });

    const unorderedPeriods = quarterlyPeriods.map((period, index) =>
      index === 1 ? { ...period, startDate: '2026-12-15' } : period);
    expect(calculateTuitionProgress(tuitionProgress({ periods: unorderedPeriods })))
      .toMatchObject({ ok: false, error: { code: 'period_order_invalid' } });
  });

  it('rejects missing or invalid dates', () => {
    const missingDate = quarterlyPeriods.map((period, index) =>
      index === 0 ? { ...period, startDate: null } : period);
    expect(calculateTuitionProgress(tuitionProgress({ periods: missingDate })))
      .toMatchObject({ ok: false, error: { code: 'period_dates_invalid' } });

    const invalidDate = quarterlyPeriods.map((period, index) =>
      index === 2 ? { ...period, endDate: '2027-02-30' } : period);
    expect(calculateTuitionProgress(tuitionProgress({ periods: invalidDate })))
      .toMatchObject({ ok: false, error: { code: 'period_dates_invalid' } });
  });

  it('rejects invalid assessment dates and non-integer financial amounts', () => {
    expect(calculateTuitionProgress(tuitionProgress({ assessmentDate: '2026-02-30' })))
      .toMatchObject({ ok: false, error: { code: 'invalid_assessment_date' } });
    expect(calculateTuitionProgress(tuitionProgress({ annualNetAmount: 1000.5 })))
      .toMatchObject({ ok: false, error: { code: 'invalid_amounts' } });
  });
});
