import { describe, expect, it } from 'vitest';
import {
  buildAccountingPaymentReminderMessage,
  calculateAccountingReminderInstallments,
  getAccountingReminderDedupeKey,
  getAccountingReminderPreviewFingerprint,
  type AccountingReminderInstallmentLine,
} from './accountingPaymentReminders.ts';

const installment = (overrides: Partial<{
  id: number;
  obligationId: number;
  categoryLabel: string;
  feeLabel: string;
  label: string;
  dueDate: string;
  amount: number;
}> = {}) => ({
  id: 1,
  obligationId: 10,
  categoryLabel: 'Scolarité',
  feeLabel: 'Frais de scolarité',
  label: 'Tranche 1',
  dueDate: '2026-11-13',
  amount: 10000,
  ...overrides,
});

describe('accounting payment reminder rules', () => {
  it('distinguishes upcoming, due-today, and overdue installments without including later dates', () => {
    const result = calculateAccountingReminderInstallments([
      installment({ id: 1, dueDate: '2026-11-13' }),
      installment({ id: 2, dueDate: '2026-11-14' }),
      installment({ id: 3, dueDate: '2026-11-20' }),
      installment({ id: 4, dueDate: '2026-11-21' }),
    ], [], '2026-11-13', 'all');

    expect(result.eligible.map((item) => item.status)).toEqual([
      'today',
      'upcoming',
      'upcoming',
    ]);
    expect(result.matchedCount).toBe(3);
  });

  it('subtracts refunds once and excludes a tranche that is fully paid net', () => {
    const result = calculateAccountingReminderInstallments([
      installment({ id: 1, amount: 10000 }),
      installment({ id: 2, amount: 5000, dueDate: '2026-11-12' }),
    ], [
      { obligationId: 10, installmentId: 1, amount: 8000, adjustedAmount: 3000 },
      { obligationId: 10, installmentId: 2, amount: 5000, adjustedAmount: 0 },
    ], '2026-11-13', 'all');

    expect(result.eligible).toMatchObject([{
      id: 1,
      paid: 5000,
      remaining: 5000,
      status: 'today',
    }]);
    expect(result.settledCount).toBe(1);
  });

  it('marks installments ambiguous when an obligation has a positive unallocated payment', () => {
    const result = calculateAccountingReminderInstallments([
      installment({ id: 1, amount: 10000 }),
      installment({ id: 2, amount: 20000, dueDate: '2026-11-12' }),
    ], [
      { obligationId: 10, installmentId: null, amount: 5000, adjustedAmount: 0 },
    ], '2026-11-13', 'all');

    expect(result.eligible).toEqual([]);
    expect(result.ambiguous).toHaveLength(2);
    expect(result.ambiguous.every((item) => item.reason.includes('pas rattaché'))).toBe(true);
    expect(result.ambiguous[0]).not.toHaveProperty('remaining');
  });

  it('does not classify invalid dates or inconsistent payment links as certain balances', () => {
    const result = calculateAccountingReminderInstallments([
      installment({ id: 1, dueDate: '2026-02-31' }),
      installment({ id: 2, dueDate: '2026-11-13' }),
    ], [
      { obligationId: 10, installmentId: 999, amount: 1000, adjustedAmount: 0 },
    ], '2026-11-13', 'all');

    expect(result.eligible).toEqual([]);
    expect(result.ambiguous.map((item) => item.reason)).toEqual([
      'La date limite de l’échéance est invalide.',
      'Les allocations comptables de cette obligation sont incohérentes.',
    ]);
  });

  it('builds one student-specific message whose total only covers included installments', () => {
    const lines: AccountingReminderInstallmentLine[] = [
      {
        ...installment({ id: 1, amount: 10000 }),
        paid: 2000,
        remaining: 8000,
        status: 'today',
      },
      {
        ...installment({ id: 2, amount: 15000, label: 'Tranche 2', dueDate: '2026-11-12' }),
        paid: 0,
        remaining: 15000,
        status: 'overdue',
      },
    ];
    const message = buildAccountingPaymentReminderMessage({
      schoolName: 'École test',
      yearName: '2026-2027',
      studentName: 'Afi Doe',
      installments: lines,
    });

    expect(message).toContain('Afi Doe');
    expect(message).toContain('À régler aujourd’hui');
    expect(message).toContain('En retard');
    expect(message).toContain('Total restant pour les échéances rappelées : 23 000 FCFA.');
    expect(message).not.toContain('25 000 FCFA');
  });

  it('uses a stable idempotency key for the same student and installment set', () => {
    const first = getAccountingReminderDedupeKey({
      schoolId: 1,
      academicYearId: 4,
      studentId: 10,
      installmentIds: [31, 32],
    });
    const reordered = getAccountingReminderDedupeKey({
      schoolId: 1,
      academicYearId: 4,
      studentId: 10,
      installmentIds: [32, 31],
    });

    expect(reordered).toBe(first);
    expect(getAccountingReminderDedupeKey({
      schoolId: 1,
      academicYearId: 4,
      studentId: 11,
      installmentIds: [31, 32],
    })).not.toBe(first);
  });

  it('invalidates a preview when a balance or recipient changes', () => {
    const baseCandidate = {
      studentId: 10,
      recipientUserId: 25,
      canSend: true,
      dedupeKey: 'key',
      message: 'reste 5 000',
      installments: [{
        ...installment(),
        paid: 5000,
        remaining: 5000,
        status: 'today' as const,
      }],
      ambiguousInstallments: [],
      reason: null,
    };
    const previewInput = {
      schoolId: 1,
      academicYearId: 4,
      classId: null,
      status: 'all' as const,
      selectedStudentIds: [10],
    };
    const original = getAccountingReminderPreviewFingerprint({
      ...previewInput,
      candidates: [baseCandidate],
    });

    expect(getAccountingReminderPreviewFingerprint({
      ...previewInput,
      candidates: [{
        ...baseCandidate,
        recipientUserId: 26,
      }],
    })).not.toBe(original);
    expect(getAccountingReminderPreviewFingerprint({
      ...previewInput,
      candidates: [{
        ...baseCandidate,
        installments: [{ ...baseCandidate.installments[0], remaining: 4000 }],
      }],
    })).not.toBe(original);
  });
});
