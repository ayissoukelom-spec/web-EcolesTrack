import { describe, expect, it, vi } from 'vitest';
import {
  getAccountingTuitionProgressCandidates,
  type AccountingTuitionProgressAdjustment,
  type AccountingTuitionProgressAllocation,
  type AccountingTuitionProgressInput,
  type AccountingTuitionProgressObligation,
} from './accountingTuitionProgress.ts';
import type { TuitionProgressPeriod } from './tuitionProgress.ts';

const input: AccountingTuitionProgressInput = {
  schoolId: 7,
  academicYearId: 23,
  cycleId: 4,
  assessmentDate: '2027-02-20',
};

const periods = [
  {
    schoolId: 7,
    academicYearId: 23,
    cycleId: 4,
    periodType: 'trimester',
    orderIndex: 1,
    startDate: '2026-09-14',
    endDate: '2026-11-30',
    isActive: true,
  },
  {
    schoolId: 7,
    academicYearId: 23,
    cycleId: 4,
    periodType: 'trimester',
    orderIndex: 2,
    startDate: '2026-12-01',
    endDate: '2027-02-28',
    isActive: true,
  },
  {
    schoolId: 7,
    academicYearId: 23,
    cycleId: 4,
    periodType: 'trimester',
    orderIndex: 3,
    startDate: '2027-03-01',
    endDate: '2027-07-16',
    isActive: true,
  },
] as const;

const obligation = (
  overrides: Partial<AccountingTuitionProgressObligation> = {},
): AccountingTuitionProgressObligation => ({
  id: 101,
  studentId: 33,
  schoolId: 7,
  academicYearId: 23,
  classId: 16,
  categoryId: 2,
  amount: 1000,
  currency: 'XOF',
  studentSchoolId: 7,
  firstName: 'Afi',
  lastName: 'Doe',
  matricule: 'A33',
  classSchoolId: 7,
  classAcademicYearId: 23,
  className: '3e A',
  cycleId: 4,
  ...overrides,
});

const allocation = (
  overrides: Partial<AccountingTuitionProgressAllocation> = {},
): AccountingTuitionProgressAllocation => ({
  id: 51,
  obligationId: 101,
  installmentId: null,
  installmentObligationId: null,
  amount: 600,
  paymentId: 71,
  paymentSchoolId: 7,
  paymentStudentId: 33,
  paymentAcademicYearId: 23,
  paymentStatus: 'posted',
  paidAtDate: '2027-01-15',
  ...overrides,
});

const adjustment = (
  overrides: Partial<AccountingTuitionProgressAdjustment> = {},
): AccountingTuitionProgressAdjustment => ({
  adjustmentId: 91,
  paymentAllocationId: 51,
  adjustmentPaymentId: 71,
  amount: 100,
  kind: 'refund',
  recordedAtDate: '2027-02-01',
  ...overrides,
});

const dataSource = ({
  periods: periodRows = periods,
  obligations = [obligation()],
  allocations = [allocation()],
  adjustments = [],
  academicYear = { id: 23, schoolId: 7 },
}: {
  periods?: readonly TuitionProgressPeriod[];
  obligations?: readonly AccountingTuitionProgressObligation[];
  allocations?: readonly AccountingTuitionProgressAllocation[];
  adjustments?: readonly AccountingTuitionProgressAdjustment[];
  academicYear?: { id: number; schoolId: number | null } | null;
} = {}) => ({
  loadAcademicYear: vi.fn(async () => academicYear),
  loadPeriods: vi.fn(async () => periodRows),
  loadTuitionObligations: vi.fn(async () => obligations),
  loadPaymentAllocations: vi.fn(async () => allocations),
  loadPaymentAdjustments: vi.fn(async () => adjustments),
});

describe('accounting tuition progress candidates', () => {
  it('uses the reduced annual obligation and counts an allocation without an installment', async () => {
    const source = dataSource({
      obligations: [obligation({ amount: 800 })],
      allocations: [allocation({ amount: 500 })],
    });

    const result = await getAccountingTuitionProgressCandidates(input, source);

    expect(result.status).toBe('ready');
    if (result.status !== 'ready') return;
    expect(result.students[0]).toMatchObject({
      annualNetAmount: 800,
      netPaidAmount: 500,
      status: 'up_to_date',
    });
    expect(source.loadTuitionObligations).toHaveBeenCalledWith(7, 23);
    expect(source.loadPaymentAllocations).toHaveBeenCalledWith(7, 23, [101]);
  });

  it('treats a payment advance as covering the current target', async () => {
    const result = await getAccountingTuitionProgressCandidates(input, dataSource({
      allocations: [allocation({ amount: 600 })],
    }));

    expect(result.status).toBe('ready');
    if (result.status !== 'ready') return;
    expect(result.students[0]).toMatchObject({
      netPaidAmount: 600,
      status: 'up_to_date',
      shortfallAmount: 0,
    });
  });

  it('does not count payments recorded after the control date', async () => {
    const result = await getAccountingTuitionProgressCandidates(input, dataSource({
      allocations: [allocation({ paidAtDate: '2027-02-21' })],
    }));

    expect(result.status).toBe('ready');
    if (result.status !== 'ready') return;
    expect(result.students[0]).toMatchObject({
      netPaidAmount: 0,
      status: 'below_target',
    });
  });

  it('subtracts refunds once from posted payment allocations', async () => {
    const result = await getAccountingTuitionProgressCandidates(input, dataSource({
      adjustments: [adjustment()],
    }));

    expect(result.status).toBe('ready');
    if (result.status !== 'ready') return;
    expect(result.students[0]).toMatchObject({
      netPaidAmount: 500,
      status: 'below_target',
    });
  });

  it('does not apply refunds recorded after the control date', async () => {
    const result = await getAccountingTuitionProgressCandidates(input, dataSource({
      adjustments: [adjustment({ recordedAtDate: '2027-02-21' })],
    }));

    expect(result.status).toBe('ready');
    if (result.status !== 'ready') return;
    expect(result.students[0]).toMatchObject({
      netPaidAmount: 600,
      status: 'up_to_date',
    });
  });

  it('excludes cancelled payments without subtracting their cancellation twice', async () => {
    const result = await getAccountingTuitionProgressCandidates(input, dataSource({
      allocations: [allocation({ paymentStatus: 'cancelled' })],
      adjustments: [adjustment({ kind: 'cancellation', amount: 600 })],
    }));

    expect(result.status).toBe('ready');
    if (result.status !== 'ready') return;
    expect(result.students[0]).toMatchObject({
      netPaidAmount: 0,
      status: 'below_target',
    });
  });

  it('excludes a student when an allocation crosses school boundaries', async () => {
    const result = await getAccountingTuitionProgressCandidates(input, dataSource({
      allocations: [allocation({ paymentSchoolId: 8 })],
    }));

    expect(result.status).toBe('ready');
    if (result.status !== 'ready') return;
    expect(result.students[0]).toMatchObject({
      status: 'excluded_ambiguous',
      reasonCode: 'payment_data_ambiguous',
    });
  });

  it.each([
    ['student', { paymentStudentId: 34 }],
    ['academic year', { paymentAcademicYearId: 24 }],
  ] as Array<[string, Partial<AccountingTuitionProgressAllocation>]>)(
    'excludes an allocation linked to a different %s',
    async (_scope, allocationScope) => {
      const result = await getAccountingTuitionProgressCandidates(input, dataSource({
        allocations: [allocation(allocationScope)],
      }));

      expect(result.status).toBe('ready');
      if (result.status !== 'ready') return;
      expect(result.students[0]).toMatchObject({
        status: 'excluded_ambiguous',
        reasonCode: 'payment_data_ambiguous',
      });
    },
  );

  it('does not include obligations belonging to another cycle', async () => {
    const source = dataSource({
      obligations: [obligation({ cycleId: 5 })],
    });

    const result = await getAccountingTuitionProgressCandidates(input, source);

    expect(result.status).toBe('ready');
    if (result.status !== 'ready') return;
    expect(result.students).toEqual([]);
    expect(source.loadPaymentAllocations).not.toHaveBeenCalled();
  });

  it('excludes an allocation whose refunds exceed the posted amount', async () => {
    const result = await getAccountingTuitionProgressCandidates(input, dataSource({
      adjustments: [adjustment({ amount: 601 })],
    }));

    expect(result.status).toBe('ready');
    if (result.status !== 'ready') return;
    expect(result.students[0]).toMatchObject({
      status: 'excluded_ambiguous',
      reasonCode: 'payment_data_ambiguous',
    });
  });

  it('excludes multiple active tuition obligations instead of double-counting them', async () => {
    const source = dataSource({
      obligations: [obligation(), obligation({ id: 102, amount: 200 })],
    });
    const result = await getAccountingTuitionProgressCandidates(input, source);

    expect(result.status).toBe('ready');
    if (result.status !== 'ready') return;
    expect(result.students[0]).toMatchObject({
      status: 'excluded_ambiguous',
      reasonCode: 'multiple_active_tuition_obligations',
    });
    expect(source.loadPaymentAllocations).not.toHaveBeenCalled();
  });

  it('returns an invalid calendar without loading financial records', async () => {
    const source = dataSource({ periods: periods.slice(0, 2) });

    const result = await getAccountingTuitionProgressCandidates(input, source);

    expect(result.status).toBe('calendar_invalid');
    expect(source.loadTuitionObligations).not.toHaveBeenCalled();
  });

  it('accepts a semester calendar spanning the same school-year dates', async () => {
    const semesterPeriods: TuitionProgressPeriod[] = [
      {
        ...periods[0],
        periodType: 'semester',
        orderIndex: 1,
        endDate: '2027-01-31',
      },
      {
        ...periods[2],
        periodType: 'semester',
        orderIndex: 2,
        startDate: '2027-02-01',
      },
    ];
    const result = await getAccountingTuitionProgressCandidates(input, dataSource({
      periods: semesterPeriods,
    }));

    expect(result.status).toBe('ready');
    if (result.status !== 'ready') return;
    expect(result.calendar).toMatchObject({
      system: 'semester',
      startDate: '2026-09-14',
      endDate: '2027-07-16',
    });
  });

  it('calculates progress using a shared academic year and shared periods', async () => {
    const result = await getAccountingTuitionProgressCandidates(input, dataSource({
      academicYear: { id: 23, schoolId: null },
      periods: periods.map((period) => ({ ...period, schoolId: null })),
    }));

    expect(result.status).toBe('ready');
    if (result.status !== 'ready') return;
    expect(result.calendar).toMatchObject({
      startDate: '2026-09-14',
      endDate: '2027-07-16',
    });
    expect(result.students[0]).toMatchObject({
      studentId: 33,
      status: 'up_to_date',
    });
  });

  it('does not create an assessment after the school-year end date', async () => {
    const result = await getAccountingTuitionProgressCandidates({
      ...input,
      assessmentDate: '2027-07-17',
    }, dataSource());

    expect(result.status).toBe('ready');
    if (result.status !== 'ready') return;
    expect(result.students[0]).toMatchObject({
      status: 'outside_school_year',
      expectedCumulativeAmount: null,
      shortfallAmount: 0,
    });
  });

  it('rejects a cancellation adjustment still attached to a posted payment', async () => {
    const result = await getAccountingTuitionProgressCandidates(input, dataSource({
      adjustments: [adjustment({ kind: 'cancellation' })],
    }));

    expect(result.status).toBe('ready');
    if (result.status !== 'ready') return;
    expect(result.students[0]).toMatchObject({
      status: 'excluded_ambiguous',
      reasonCode: 'payment_data_ambiguous',
    });
  });
});
