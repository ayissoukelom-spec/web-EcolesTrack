import { describe, expect, it } from 'vitest';
import {
  aggregateInstallmentPunctuality,
  allocateToOldestInstallments,
  compareAccountingClassOrder,
  calculateInstallmentPunctuality,
  calculateStudentFeeBalance,
  doAccountingClassRangesOverlap,
  getAccountingCategoryDisplayLabel,
  isAccountingClassWithinRange,
  isStandardAccountingCategoryLabel,
  splitAmountBySchedule,
  STANDARD_ACCOUNTING_CATEGORY_LABELS,
  validateAccountingSchedule,
} from './accountingRules.ts';

describe('accounting fee configuration rules', () => {
  it('uses fixed labels for standard categories and distinguishes custom labels by code', () => {
    expect(getAccountingCategoryDisplayLabel('tuition', 'Scolarité')).toBe('Frais de scolarité');
    expect(getAccountingCategoryDisplayLabel('enrollment', 'Inscription')).toBe("Frais d'inscription");
    expect(getAccountingCategoryDisplayLabel('custom:transport', 'Transport')).toBe('Transport');
    expect(isStandardAccountingCategoryLabel("Frais d’inscription")).toBe(true);
    expect(isStandardAccountingCategoryLabel('Frais de scolarité')).toBe(true);
    expect(isStandardAccountingCategoryLabel('Scolarité')).toBe(false);
    expect(Object.keys(STANDARD_ACCOUNTING_CATEGORY_LABELS)).toEqual(['tuition', 'enrollment']);
  });

  it('orders parallel classes consistently and treats range endpoints as inclusive', () => {
    const parallelA = { classId: 11, className: '6e A', levelOrder: 2 };
    const parallelB = { classId: 12, className: '6e B', levelOrder: 2 };
    const parallelC = { classId: 13, className: '6e C', levelOrder: 2 };

    expect(compareAccountingClassOrder(parallelA, parallelB)).toBeLessThan(0);
    expect(isAccountingClassWithinRange(parallelB, parallelA, parallelC)).toBe(true);
    expect(doAccountingClassRangesOverlap(
      { start: parallelA, end: parallelB },
      { start: parallelC, end: parallelC },
    )).toBe(false);
    expect(doAccountingClassRangesOverlap(
      { start: parallelA, end: parallelB },
      { start: parallelB, end: parallelC },
    )).toBe(true);
  });
});

describe('accounting schedule and allocation rules', () => {
  const punctuality = (overrides: Partial<Parameters<typeof calculateInstallmentPunctuality>[0]> = {}) =>
    calculateInstallmentPunctuality({
      amount: 100,
      dueDate: '2026-10-10',
      remaining: 0,
      today: '2026-10-20',
      payments: [],
      refunds: [],
      ...overrides,
    });

  it('classifies full payments before, on, and after the inclusive due date', () => {
    expect(punctuality({
      payments: [{ amount: 100, paidAtDate: '2026-10-09', status: 'posted' }],
    })).toMatchObject({ status: 'paid_on_time', settledAt: '2026-10-09' });
    expect(punctuality({
      payments: [{ amount: 100, paidAtDate: '2026-10-10', status: 'posted' }],
    })).toMatchObject({ status: 'paid_on_time', settledAt: '2026-10-10' });
    expect(punctuality({
      payments: [{ amount: 100, paidAtDate: '2026-10-11', status: 'posted' }],
    })).toMatchObject({ status: 'paid_late', settledAt: '2026-10-11' });
  });

  it('uses the date the valid partial-payment total reaches the installment amount', () => {
    expect(punctuality({
      payments: [
        { amount: 40, paidAtDate: '2026-10-08', status: 'posted' },
        { amount: 60, paidAtDate: '2026-10-10', status: 'posted' },
      ],
    })).toMatchObject({ status: 'paid_on_time', settledAt: '2026-10-10' });
    expect(punctuality({
      payments: [
        { amount: 40, paidAtDate: '2026-10-08', status: 'posted' },
        { amount: 60, paidAtDate: '2026-10-11', status: 'posted' },
      ],
    })).toMatchObject({ status: 'paid_late', settledAt: '2026-10-11' });
  });

  it('does not erase timely settlement for a later refund, but applies refunds before the due date', () => {
    expect(punctuality({
      payments: [{ amount: 100, paidAtDate: '2026-10-09', status: 'posted' }],
      refunds: [{ amount: 50, recordedAtDate: '2026-10-12' }],
      remaining: 50,
    })).toMatchObject({
      status: 'paid_on_time',
      settledAt: '2026-10-09',
      remaining: 50,
      currentStatus: 'overdue',
    });
    expect(punctuality({
      payments: [
        { amount: 100, paidAtDate: '2026-10-08', status: 'posted' },
        { amount: 100, paidAtDate: '2026-10-11', status: 'posted' },
      ],
      refunds: [{ amount: 100, recordedAtDate: '2026-10-09' }],
      remaining: 0,
    })).toMatchObject({ status: 'paid_late', settledAt: '2026-10-11' });
  });

  it('ignores cancelled payments and refuses to infer unlinked or ambiguous history', () => {
    expect(punctuality({
      remaining: 100,
      payments: [{ amount: 100, paidAtDate: '2026-10-08', status: 'cancelled' }],
    })).toMatchObject({ status: 'undetermined', currentStatus: 'overdue' });
    expect(punctuality({
      hasUnallocatedPayment: true,
      payments: [{ amount: 100, paidAtDate: '2026-10-08', status: 'posted' }],
    })).toMatchObject({ status: 'undetermined' });
    expect(punctuality({
      payments: [{ amount: 100, paidAtDate: 'not-a-date', status: 'posted' }],
    })).toMatchObject({ status: 'undetermined' });
    expect(punctuality({
      payments: [{ amount: 100, paidAtDate: '2026-10-09', status: 'posted' }],
      refunds: [{ amount: 20, recordedAtDate: '2026-10-09' }],
    })).toMatchObject({ status: 'undetermined' });
  });

  it('prioritizes current overdue and late installments and handles no schedule or only future installments', () => {
    expect(aggregateInstallmentPunctuality([], '2026-10-20')).toEqual({
      status: 'not_applicable',
      reason: null,
    });
    expect(aggregateInstallmentPunctuality([
      { dueDate: '2026-11-01', status: 'upcoming', reason: null, currentStatus: 'upcoming' },
    ], '2026-10-20')).toEqual({ status: 'upcoming', reason: null });
    expect(aggregateInstallmentPunctuality([
      { dueDate: '2026-10-01', status: 'paid_on_time', reason: null, currentStatus: 'settled' },
      { dueDate: '2026-10-15', status: 'paid_late', reason: null, currentStatus: 'settled' },
    ], '2026-10-20')).toEqual({ status: 'paid_late', reason: null });
    expect(aggregateInstallmentPunctuality([
      { dueDate: '2026-10-01', status: 'undetermined', reason: 'Lien absent.', currentStatus: 'undetermined' },
      { dueDate: '2026-10-15', status: 'overdue', reason: null, currentStatus: 'overdue' },
    ], '2026-10-20')).toEqual({ status: 'overdue', reason: null });
    expect(aggregateInstallmentPunctuality([
      { dueDate: '2026-10-01', status: 'undetermined', reason: 'Lien absent.', currentStatus: 'settled' },
    ], '2026-10-20')).toEqual({ status: 'undetermined', reason: 'Lien absent.' });
  });

  it('validates schedule shares and dates', () => {
    expect(validateAccountingSchedule([
      { label: 'T1', dueDate: '2026-10-01', basisPoints: 3333 },
      { label: 'T2', dueDate: '2027-01-01', basisPoints: 3333 },
      { label: 'T3', dueDate: '2027-04-01', basisPoints: 3334 },
    ])).not.toBeNull();
    expect(validateAccountingSchedule([
      { label: 'T1', dueDate: '2026-10-01', basisPoints: 5000 },
      { label: 'T2', dueDate: '2027-01-01', basisPoints: 4000 },
    ])).toBeNull();
    expect(validateAccountingSchedule([
      { label: 'T1', dueDate: '2026-02-30', basisPoints: 10000 },
    ])).toBeNull();
    expect(validateAccountingSchedule([
      { label: 'T2', dueDate: '2027-01-01', basisPoints: 5000 },
      { label: 'T1', dueDate: '2026-10-01', basisPoints: 5000 },
    ])).toBeNull();
  });

  it('validates fixed schedules against their exact total while retaining positive uneven tranches', () => {
    const fixedSchedule = [
      { label: 'T1', dueDate: '2026-10-01', amount: 36000 },
      { label: 'T2', dueDate: '2027-01-01', amount: 25000 },
      { label: 'T3', dueDate: '2027-04-01', amount: 10000 },
    ];

    expect(validateAccountingSchedule(fixedSchedule, 71000)).toEqual(fixedSchedule);
    expect(validateAccountingSchedule(fixedSchedule, 72000)).toBeNull();
    expect(validateAccountingSchedule([
      { label: 'T1', dueDate: '2026-10-01', amount: 71000 },
    ], 71000)).not.toBeNull();
    expect(validateAccountingSchedule([
      { label: 'T1', dueDate: '2026-10-01', amount: 71000 },
      { label: 'T2', dueDate: '2027-01-01', basisPoints: 0 },
    ], 71000)).toBeNull();
    expect(validateAccountingSchedule([
      { label: 'T1', dueDate: '2026-10-01', amount: 0 },
    ], 0)).toBeNull();
    expect(validateAccountingSchedule([
      { label: 'T1', dueDate: '2026-02-30', amount: 71000 },
    ], 71000)).toBeNull();
  });

  it('splits fixed schedules without changing their amounts or dates', () => {
    const fixedSchedule = [
      { label: 'T1', dueDate: '2026-10-01', amount: 36000 },
      { label: 'T2', dueDate: '2027-01-01', amount: 25000 },
      { label: 'T3', dueDate: '2027-04-01', amount: 10000 },
    ];

    expect(splitAmountBySchedule(71000, fixedSchedule)).toEqual([
      { label: 'T1', dueDate: '2026-10-01', amount: 36000, orderIndex: 1 },
      { label: 'T2', dueDate: '2027-01-01', amount: 25000, orderIndex: 2 },
      { label: 'T3', dueDate: '2027-04-01', amount: 10000, orderIndex: 3 },
    ]);
    expect(splitAmountBySchedule(72000, fixedSchedule)).toBeNull();
  });

  it('splits integer currency amounts without losing remainder', () => {
    const schedule = [
      { label: 'T1', dueDate: '2026-10-01', basisPoints: 3333 },
      { label: 'T2', dueDate: '2027-01-01', basisPoints: 3333 },
      { label: 'T3', dueDate: '2027-04-01', basisPoints: 3334 },
    ];
    const split = splitAmountBySchedule(400000, schedule);
    expect(split?.map((item) => item.amount)).toEqual([133320, 133320, 133360]);
    expect(split?.reduce((sum, item) => sum + item.amount, 0)).toBe(400000);
  });

  it('allocates payments to the oldest installments and rejects overpayment', () => {
    const balances = [
      { installmentId: 1, obligationId: 10, remaining: 100000 },
      { installmentId: 2, obligationId: 10, remaining: 100000 },
      { installmentId: 3, obligationId: 10, remaining: 100000 },
    ];
    expect(allocateToOldestInstallments(150000, balances)).toEqual([
      { installmentId: 1, obligationId: 10, amount: 100000 },
      { installmentId: 2, obligationId: 10, amount: 50000 },
    ]);
    expect(allocateToOldestInstallments(300001, balances)).toBeNull();
    expect(allocateToOldestInstallments(100000, balances.slice(1))).toEqual([
      { installmentId: 2, obligationId: 10, amount: 100000 },
    ]);
  });

  it('does not count an indicative tariff as a debt before an obligation exists', () => {
    expect(calculateStudentFeeBalance({
      studentId: 1,
      categoryId: 2,
      indicativeTariffAmount: 150000,
      obligations: [],
      allocations: [],
    })).toEqual({
      studentId: 1,
      categoryId: 2,
      due: 0,
      paid: 0,
      remaining: 0,
      status: 'unconfigured',
    });
  });

  it('preserves historical obligation totals, nets adjustments, and never returns a negative balance', () => {
    const historicalBalance = calculateStudentFeeBalance({
      studentId: 1,
      categoryId: 2,
      indicativeTariffAmount: 175000,
      obligations: [{ id: 10, amount: 120000 }],
      allocations: [
        { obligationId: 10, amount: 50000, adjustedAmount: 10000 },
        { obligationId: 99, amount: 20000, adjustedAmount: 0 },
      ],
    });
    expect(historicalBalance).toEqual({
      studentId: 1,
      categoryId: 2,
      due: 120000,
      paid: 40000,
      remaining: 80000,
      status: 'partial',
    });

    expect(calculateStudentFeeBalance({
      studentId: 1,
      categoryId: 2,
      indicativeTariffAmount: 1200,
      obligations: [{ id: 11, amount: 1000 }],
      allocations: [{ obligationId: 11, amount: 1200, adjustedAmount: 0 }],
    })).toMatchObject({ due: 1000, paid: 1200, remaining: 0, status: 'paid' });
  });

  it('uses the recorded amount of a tariff-linked obligation when the indicative tariff changes', () => {
    expect(calculateStudentFeeBalance({
      studentId: 1,
      categoryId: 2,
      indicativeTariffAmount: 120000,
      obligations: [{ id: 10, amount: 100000, tariffId: 3 }],
      allocations: [{ obligationId: 10, amount: 10000, adjustedAmount: 0 }],
    })).toEqual({
      studentId: 1,
      categoryId: 2,
      due: 100000,
      paid: 10000,
      remaining: 90000,
      status: 'partial',
    });
  });

  it('sums only recorded obligations when tariff-linked and other obligations coexist', () => {
    expect(calculateStudentFeeBalance({
      studentId: 1,
      categoryId: 2,
      indicativeTariffAmount: 100000,
      obligations: [
        { id: 10, amount: 50000, tariffId: 3 },
        { id: 11, amount: 15000, tariffId: null },
      ],
      allocations: [{ obligationId: 10, amount: 10000, adjustedAmount: 0 }],
    })).toMatchObject({ due: 65000, paid: 10000, remaining: 55000 });
  });
});
