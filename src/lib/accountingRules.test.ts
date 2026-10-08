import { describe, expect, it } from 'vitest';
import {
  allocateToOldestInstallments,
  calculateStudentFeeBalance,
  splitAmountBySchedule,
  validateAccountingSchedule,
} from './accountingRules.ts';

describe('accounting schedule and allocation rules', () => {
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

  it('uses the configured tariff when no historical obligation exists', () => {
    expect(calculateStudentFeeBalance({
      studentId: 1,
      categoryId: 2,
      tariffAmount: 150000,
      obligations: [],
      allocations: [],
    })).toEqual({
      studentId: 1,
      categoryId: 2,
      due: 150000,
      paid: 0,
      remaining: 150000,
      status: 'unpaid',
    });
  });

  it('preserves historical obligation totals, nets adjustments, and never returns a negative balance', () => {
    const historicalBalance = calculateStudentFeeBalance({
      studentId: 1,
      categoryId: 2,
      tariffAmount: 175000,
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
      tariffAmount: 1000,
      obligations: [{ id: 11, amount: 1000 }],
      allocations: [{ obligationId: 11, amount: 1200, adjustedAmount: 0 }],
    })).toMatchObject({ due: 1000, paid: 1200, remaining: 0, status: 'paid' });
  });

  it('recalculates tariff-linked obligations from the current tariff without changing historical payments', () => {
    expect(calculateStudentFeeBalance({
      studentId: 1,
      categoryId: 2,
      tariffAmount: 100000,
      obligations: [{ id: 10, amount: 50000, tariffId: 3 }],
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

  it('preserves non-tariff historical obligation amounts alongside a current tariff', () => {
    expect(calculateStudentFeeBalance({
      studentId: 1,
      categoryId: 2,
      tariffAmount: 100000,
      obligations: [
        { id: 10, amount: 50000, tariffId: 3 },
        { id: 11, amount: 15000, tariffId: null },
      ],
      allocations: [{ obligationId: 10, amount: 10000, adjustedAmount: 0 }],
    })).toMatchObject({ due: 115000, paid: 10000, remaining: 105000 });
  });
});
