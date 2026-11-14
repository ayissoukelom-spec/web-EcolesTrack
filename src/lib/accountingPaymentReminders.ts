import { createHash } from 'node:crypto';

export type AccountingReminderStatus = 'upcoming' | 'today' | 'overdue';
export type AccountingReminderStatusFilter = AccountingReminderStatus | 'all';

export interface AccountingReminderInstallmentSource {
  id: number;
  obligationId: number;
  categoryLabel: string;
  feeLabel: string;
  label: string;
  dueDate: string;
  amount: number;
}

export interface AccountingReminderAllocationSource {
  obligationId: number;
  installmentId: number | null;
  amount: number;
  adjustedAmount: number;
  valid?: boolean;
}

export interface AccountingReminderInstallmentLine extends AccountingReminderInstallmentSource {
  paid: number;
  remaining: number;
  status: AccountingReminderStatus;
}

export interface AmbiguousAccountingReminderInstallment extends AccountingReminderInstallmentSource {
  reason: string;
  status: AccountingReminderStatus | null;
}

export interface AccountingReminderInstallmentResult {
  eligible: AccountingReminderInstallmentLine[];
  ambiguous: AmbiguousAccountingReminderInstallment[];
  matchedCount: number;
  settledCount: number;
}

const isValidAccountingDay = (value: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};

const getStatusForDate = (dueDate: string, today: string): AccountingReminderStatus | null => {
  if (!isValidAccountingDay(dueDate) || !isValidAccountingDay(today)) return null;
  if (dueDate < today) return 'overdue';
  if (dueDate === today) return 'today';

  const limit = new Date(`${today}T00:00:00.000Z`);
  limit.setUTCDate(limit.getUTCDate() + 7);
  return dueDate <= limit.toISOString().slice(0, 10) ? 'upcoming' : null;
};

const matchesFilter = (
  status: AccountingReminderStatus | null,
  filter: AccountingReminderStatusFilter,
) => filter === 'all' || status === filter;

export function calculateAccountingReminderInstallments(
  installments: AccountingReminderInstallmentSource[],
  allocations: AccountingReminderAllocationSource[],
  today: string,
  filter: AccountingReminderStatusFilter,
): AccountingReminderInstallmentResult {
  const installmentById = new Map(installments.map((installment) => [installment.id, installment]));
  const paidByInstallment = new Map<number, number>();
  const unallocatedByObligation = new Map<number, number>();
  const invalidObligations = new Set<number>();

  for (const allocation of allocations) {
    if (allocation.valid === false) {
      invalidObligations.add(allocation.obligationId);
      continue;
    }
    if (!Number.isSafeInteger(allocation.amount) || allocation.amount <= 0
      || !Number.isSafeInteger(allocation.adjustedAmount) || allocation.adjustedAmount < 0) {
      invalidObligations.add(allocation.obligationId);
      continue;
    }

    const netAmount = allocation.amount - allocation.adjustedAmount;
    if (netAmount < 0) {
      invalidObligations.add(allocation.obligationId);
      continue;
    }
    if (netAmount === 0) continue;

    if (allocation.installmentId == null) {
      unallocatedByObligation.set(
        allocation.obligationId,
        (unallocatedByObligation.get(allocation.obligationId) ?? 0) + netAmount,
      );
      continue;
    }

    const installment = installmentById.get(allocation.installmentId);
    if (!installment || installment.obligationId !== allocation.obligationId) {
      invalidObligations.add(allocation.obligationId);
      continue;
    }
    paidByInstallment.set(
      installment.id,
      (paidByInstallment.get(installment.id) ?? 0) + netAmount,
    );
  }

  const result: AccountingReminderInstallmentResult = {
    eligible: [],
    ambiguous: [],
    matchedCount: 0,
    settledCount: 0,
  };

  for (const installment of installments) {
    const status = getStatusForDate(installment.dueDate, today);
    const invalidDate = status == null && !isValidAccountingDay(installment.dueDate);
    if (status == null && !(filter === 'all' && invalidDate)) continue;
    if (!matchesFilter(status, filter) && !(filter === 'all' && invalidDate)) continue;
    result.matchedCount += 1;

    if (!Number.isSafeInteger(installment.amount) || installment.amount <= 0) {
      result.ambiguous.push({
        ...installment,
        reason: 'Le montant de l’échéance est invalide.',
        status,
      });
      continue;
    }
    if (invalidDate) {
      result.ambiguous.push({
        ...installment,
        reason: 'La date limite de l’échéance est invalide.',
        status: null,
      });
      continue;
    }
    if (!status) continue;

    const paidAmount = paidByInstallment.get(installment.id) ?? 0;
    const remaining = Math.max(0, installment.amount - paidAmount);
    if (invalidObligations.has(installment.obligationId)) {
      result.ambiguous.push({
        ...installment,
        reason: 'Les allocations comptables de cette obligation sont incohérentes.',
        status,
      });
      continue;
    }
    if (remaining === 0) {
      result.settledCount += 1;
      continue;
    }
    if ((unallocatedByObligation.get(installment.obligationId) ?? 0) > 0) {
      result.ambiguous.push({
        ...installment,
        reason: 'Un paiement de l’obligation n’est pas rattaché à une tranche.',
        status,
      });
      continue;
    }

    result.eligible.push({
      ...installment,
      paid: Math.min(installment.amount, paidAmount),
      remaining,
      status,
    });
  }

  return result;
}

const formatReminderDate = (value: string) => {
  if (!isValidAccountingDay(value)) return value;
  return new Intl.DateTimeFormat('fr-FR', { timeZone: 'UTC' }).format(new Date(`${value}T00:00:00.000Z`));
};

const formatReminderAmount = (value: number) => value
  .toLocaleString('fr-FR')
  .replace(/[\u00a0\u202f]/g, ' ');

const statusLabels: Record<AccountingReminderStatus, string> = {
  upcoming: 'À venir',
  today: 'À régler aujourd’hui',
  overdue: 'En retard',
};

export function buildAccountingPaymentReminderMessage(input: {
  schoolName: string;
  yearName: string;
  studentName: string;
  installments: AccountingReminderInstallmentLine[];
}): string {
  const lines = [...input.installments]
    .sort((left, right) => left.dueDate.localeCompare(right.dueDate) || left.id - right.id)
    .map((installment) => (
      `- ${installment.categoryLabel} — ${installment.feeLabel} — ${installment.label} — ${statusLabels[installment.status]} `
      + `(${formatReminderDate(installment.dueDate)}) — Reste : ${formatReminderAmount(installment.remaining)} FCFA`
    ));
  const total = input.installments.reduce((sum, installment) => sum + installment.remaining, 0);

  return [
    `Rappel de paiement — ${input.schoolName}`,
    '',
    'Bonjour,',
    '',
    `Nous vous informons que les échéances suivantes concernant ${input.studentName} `
      + `pour l’année scolaire ${input.yearName} présentent encore un montant à régler :`,
    ...lines,
    `Total restant pour les échéances rappelées : ${formatReminderAmount(total)} FCFA.`,
    '',
    'Merci de vous rapprocher de l’établissement pour toute précision.',
  ].join('\n');
}

export function getAccountingReminderDedupeKey(input: {
  schoolId: number;
  academicYearId: number;
  studentId: number;
  installmentIds: number[];
}): string {
  const installmentSetHash = createHash('sha256')
    .update([...input.installmentIds].sort((left, right) => left - right).join(','))
    .digest('hex');
  return `accounting-manual-reminder-v1-${input.schoolId}-${input.academicYearId}-${input.studentId}-${installmentSetHash}`;
}

export function getAccountingReminderPreviewFingerprint(input: {
  schoolId: number;
  academicYearId: number;
  classId: number | null;
  status: AccountingReminderStatusFilter;
  selectedStudentIds: number[];
  candidates: Array<{
    studentId: number;
    recipientUserId: number | null;
    canSend: boolean;
    dedupeKey: string | null;
    message: string | null;
    installments: AccountingReminderInstallmentLine[];
    ambiguousInstallments: AmbiguousAccountingReminderInstallment[];
    reason: string | null;
  }>;
}): string {
  const stableCandidates = [...input.candidates]
    .sort((left, right) => left.studentId - right.studentId)
    .map((candidate) => ({
      ...candidate,
      installments: [...candidate.installments].sort((left, right) => left.id - right.id),
      ambiguousInstallments: [...candidate.ambiguousInstallments].sort((left, right) => left.id - right.id),
    }));
  return createHash('sha256')
    .update(JSON.stringify({
      schoolId: input.schoolId,
      academicYearId: input.academicYearId,
      classId: input.classId,
      status: input.status,
      selectedStudentIds: [...input.selectedStudentIds].sort((left, right) => left - right),
      candidates: stableCandidates,
    }))
    .digest('hex');
}
