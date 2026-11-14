export type AccountingScheduleItem = {
  label: string;
  dueDate: string;
} & (
  | { basisPoints: number; amount?: never }
  | { amount: number; basisPoints?: never }
);

export const STANDARD_ACCOUNTING_CATEGORY_LABELS = {
  tuition: 'Frais de scolarité',
  enrollment: "Frais d'inscription",
} as const;

export const ACCOUNTING_ENROLLMENT_KINDS = [
  { value: 'first_enrollment', label: 'Première inscription' },
  { value: 're_enrollment', label: 'Réinscription' },
  { value: 'ordinary', label: 'Inscription ordinaire' },
] as const;

export type AccountingEnrollmentKind = typeof ACCOUNTING_ENROLLMENT_KINDS[number]['value'];

export const isAccountingEnrollmentKind = (value: string): value is AccountingEnrollmentKind =>
  ACCOUNTING_ENROLLMENT_KINDS.some((kind) => kind.value === value);

const normalizeStandardCategoryLabel = (label: string) => label.trim()
  .normalize('NFKC')
  .replace(/[\u2018\u2019]/g, "'")
  .replace(/\s+/g, ' ')
  .toLocaleLowerCase('fr');

export const getAccountingCategoryDisplayLabel = (code: string, fallbackLabel: string) => {
  if (code === 'tuition') return STANDARD_ACCOUNTING_CATEGORY_LABELS.tuition;
  if (code === 'enrollment') return STANDARD_ACCOUNTING_CATEGORY_LABELS.enrollment;
  return fallbackLabel;
};

export const isStandardAccountingCategoryLabel = (label: string) =>
  Object.values(STANDARD_ACCOUNTING_CATEGORY_LABELS)
    .some((standardLabel) => normalizeStandardCategoryLabel(label) === normalizeStandardCategoryLabel(standardLabel));

export interface AccountingClassOrder {
  classId: number;
  className: string;
  levelOrder: number;
}

export const compareAccountingClassOrder = (left: AccountingClassOrder, right: AccountingClassOrder) => {
  if (left.levelOrder !== right.levelOrder) return left.levelOrder - right.levelOrder;
  if (left.className !== right.className) return left.className < right.className ? -1 : 1;
  return left.classId - right.classId;
};

export const isAccountingClassWithinRange = (
  target: AccountingClassOrder,
  start: AccountingClassOrder,
  end: AccountingClassOrder,
) => compareAccountingClassOrder(start, end) <= 0
  && compareAccountingClassOrder(start, target) <= 0
  && compareAccountingClassOrder(target, end) <= 0;

export const doAccountingClassRangesOverlap = (
  left: { start: AccountingClassOrder; end: AccountingClassOrder },
  right: { start: AccountingClassOrder; end: AccountingClassOrder },
) => compareAccountingClassOrder(left.start, right.end) <= 0
  && compareAccountingClassOrder(right.start, left.end) <= 0;

export interface InstallmentBalance {
  installmentId: number;
  obligationId: number;
  remaining: number;
}

export interface InstallmentAllocation {
  installmentId: number;
  obligationId: number;
  amount: number;
}

export type FeePaymentStatus = 'unconfigured' | 'unpaid' | 'partial' | 'paid';

export interface StudentFeeBalanceInput {
  studentId: number;
  categoryId: number;
  indicativeTariffAmount?: number | null;
  obligations: Array<{ id: number; amount: number; tariffId?: number | null }>;
  allocations: Array<{ obligationId: number; amount: number; adjustedAmount: number }>;
}

export interface StudentFeeBalance {
  studentId: number;
  categoryId: number;
  due: number;
  paid: number;
  remaining: number;
  status: FeePaymentStatus;
}

export type InstallmentPunctualityStatus =
  | 'overdue'
  | 'paid_late'
  | 'paid_on_time'
  | 'upcoming'
  | 'undetermined'
  | 'not_applicable';

export interface InstallmentPunctualityInput {
  amount: number;
  dueDate: string;
  remaining: number;
  today: string;
  hasUnallocatedPayment?: boolean;
  payments: Array<{
    amount: number;
    paidAtDate: string | null;
    status: 'posted' | 'cancelled';
  }>;
  refunds: Array<{
    amount: number;
    recordedAtDate: string | null;
  }>;
}

export interface InstallmentPunctuality {
  amount: number;
  dueDate: string;
  remaining: number;
  currentStatus: 'overdue' | 'upcoming' | 'settled' | 'undetermined';
  settledAt: string | null;
  status: InstallmentPunctualityStatus;
  reason: string | null;
}

const isValidAccountingDay = (value: string | null): value is string => {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};

export const calculateInstallmentPunctuality = ({
  amount,
  dueDate,
  remaining,
  today,
  hasUnallocatedPayment = false,
  payments,
  refunds,
}: InstallmentPunctualityInput): InstallmentPunctuality => {
  const currentStatus: InstallmentPunctuality['currentStatus'] = hasUnallocatedPayment
    ? 'undetermined'
    : remaining > 0
      ? dueDate < today ? 'overdue' : 'upcoming'
      : 'settled';
  const result = (
    status: InstallmentPunctualityStatus,
    settledAt: string | null = null,
    reason: string | null = null,
    resultCurrentStatus: InstallmentPunctuality['currentStatus'] = currentStatus,
  ): InstallmentPunctuality => ({
    amount,
    dueDate,
    remaining,
    currentStatus: resultCurrentStatus,
    settledAt,
    status,
    reason,
  });

  if (!isValidAccountingDay(dueDate) || !isValidAccountingDay(today)
    || !Number.isSafeInteger(amount) || amount <= 0
    || !Number.isSafeInteger(remaining) || remaining < 0) {
    return result('undetermined', null, 'Données d’échéance invalides.', 'undetermined');
  }
  if (hasUnallocatedPayment) {
    return result('undetermined', null, 'Un paiement de l’obligation n’est pas rattaché à une tranche.', 'undetermined');
  }
  if (remaining > 0 && dueDate >= today) return result('upcoming');

  const validPayments = payments.filter((payment) => payment.status === 'posted');
  if (validPayments.some((payment) => !isValidAccountingDay(payment.paidAtDate)
    || !Number.isSafeInteger(payment.amount) || payment.amount <= 0)) {
    return result(
      'undetermined',
      null,
      'La date comptable d’un paiement est absente ou invalide.',
    );
  }
  if (refunds.some((refund) => !isValidAccountingDay(refund.recordedAtDate)
    || !Number.isSafeInteger(refund.amount) || refund.amount <= 0)) {
    return result(
      'undetermined',
      null,
      'La date d’un remboursement est absente ou invalide.',
    );
  }
  if (validPayments.some((payment) => payment.paidAtDate! > today)
    || refunds.some((refund) => refund.recordedAtDate! > today)) {
    return result(
      'undetermined',
      null,
      'L’historique contient une date comptable future.',
    );
  }

  const events = [
    ...validPayments.map((payment) => ({
      day: payment.paidAtDate!,
      amount: payment.amount,
      kind: 'payment' as const,
    })),
    ...refunds.map((refund) => ({
      day: refund.recordedAtDate!,
      amount: -refund.amount,
      kind: 'refund' as const,
    })),
  ].sort((left, right) => left.day.localeCompare(right.day));

  const sameDayEvents = new Map<string, Set<'payment' | 'refund'>>();
  for (const event of events) {
    const kinds = sameDayEvents.get(event.day) ?? new Set<'payment' | 'refund'>();
    kinds.add(event.kind);
    sameDayEvents.set(event.day, kinds);
  }
  if ([...sameDayEvents.entries()].some(([day, kinds]) =>
    day <= dueDate && kinds.size > 1)) {
    return result(
      'undetermined',
      null,
      'L’ordre d’un paiement et d’un remboursement le même jour est ambigu.',
    );
  }

  let balance = 0;
  let settledAt: string | null = null;
  let settledByDueDate = false;
  for (const event of events) {
    balance += event.amount;
    if (balance < 0) {
      return result(
        'undetermined',
        null,
        'Les ajustements dépassent les paiements affectés à la tranche.',
      );
    }
    if (event.day <= dueDate) {
      settledAt = balance >= amount ? (settledAt ?? event.day) : null;
      settledByDueDate = balance >= amount;
      continue;
    }
    if (!settledByDueDate && balance >= amount) {
      settledAt = event.day;
      return result('paid_late', settledAt);
    }
  }
  if (settledByDueDate && settledAt) return result('paid_on_time', settledAt);
  if (settledAt) return result('paid_late', settledAt);
  if (currentStatus === 'overdue' && events.length) return result('overdue');
  return result('undetermined', null, 'L’historique ne permet pas de retrouver la date de règlement intégral.');
};

export const aggregateInstallmentPunctuality = (
  installments: Array<Pick<InstallmentPunctuality, 'dueDate' | 'status' | 'reason' | 'currentStatus'>>,
  today: string,
): { status: InstallmentPunctualityStatus; reason: string | null } => {
  if (!installments.length) return { status: 'not_applicable', reason: null };
  if (installments.some((item) => item.currentStatus === 'overdue')) return { status: 'overdue', reason: null };
  if (installments.some((item) => item.status === 'paid_late')) return { status: 'paid_late', reason: null };
  const uncertainExigible = installments.find((item) =>
    item.dueDate < today && item.status === 'undetermined');
  if (uncertainExigible) {
    return {
      status: 'undetermined',
      reason: uncertainExigible.reason ?? 'L’historique de paiement est incomplet.',
    };
  }
  if (installments.some((item) => item.dueDate < today)) return { status: 'paid_on_time', reason: null };
  return { status: 'upcoming', reason: null };
};

export const calculateStudentFeeBalance = ({
  studentId,
  categoryId,
  obligations,
  allocations,
}: StudentFeeBalanceInput): StudentFeeBalance => {
  const due = obligations.reduce((total, obligation) => total + obligation.amount, 0);
  const obligationIds = new Set(obligations.map((obligation) => obligation.id));
  const paid = allocations.reduce((total, allocation) => {
    if (!obligationIds.has(allocation.obligationId)) return total;
    return total + Math.max(0, allocation.amount - allocation.adjustedAmount);
  }, 0);
  const remaining = Math.max(0, due - paid);

  return {
    studentId,
    categoryId,
    due,
    paid,
    remaining,
    status: due === 0 ? 'unconfigured' : remaining === 0 ? 'paid' : paid === 0 ? 'unpaid' : 'partial',
  };
};

const isValidDate = (value: unknown): value is string => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};

export const validateAccountingSchedule = (
  value: unknown,
  expectedAmount?: number,
): AccountingScheduleItem[] | null => {
  if (!Array.isArray(value) || value.length < 1 || value.length > 12) return null;
  const items: AccountingScheduleItem[] = [];
  let amountMode: 'fixed' | 'basisPoints' | null = null;
  for (const item of value) {
    if (!item || typeof item !== 'object') return null;
    const candidate = item as Record<string, unknown>;
    const label = typeof candidate.label === 'string' ? candidate.label.trim() : '';
    const dueDate = candidate.dueDate;
    const hasFixedAmount = Object.prototype.hasOwnProperty.call(candidate, 'amount');
    const hasBasisPoints = Object.prototype.hasOwnProperty.call(candidate, 'basisPoints');
    if (hasFixedAmount === hasBasisPoints || !label || label.length > 80 || !isValidDate(dueDate)) return null;
    const itemMode = hasFixedAmount ? 'fixed' : 'basisPoints';
    if (amountMode != null && amountMode !== itemMode) return null;
    amountMode = itemMode;
    if (itemMode === 'fixed') {
      const amount = Number(candidate.amount);
      if (!Number.isSafeInteger(amount) || amount <= 0 || amount > 2147483647) return null;
      items.push({ label, dueDate, amount });
    } else {
      const basisPoints = Number(candidate.basisPoints);
      if (!Number.isInteger(basisPoints) || basisPoints <= 0) return null;
      items.push({ label, dueDate, basisPoints });
    }
  }
  if (amountMode === 'fixed') {
    if (expectedAmount != null && items.reduce((sum, item) => sum + ('amount' in item ? item.amount : 0), 0) !== expectedAmount) {
      return null;
    }
  } else if (items.reduce((sum, item) => sum + ('basisPoints' in item ? item.basisPoints : 0), 0) !== 10000) {
    return null;
  }
  if (items.some((item, index) => index > 0 && item.dueDate < items[index - 1].dueDate)) return null;
  return items;
};

export const splitAmountBySchedule = (
  amount: number,
  schedule: AccountingScheduleItem[],
) => {
  const validatedSchedule = validateAccountingSchedule(schedule, amount);
  if (!Number.isSafeInteger(amount) || amount <= 0 || !validatedSchedule) return null;
  if ('amount' in validatedSchedule[0]) {
    return validatedSchedule.map((item, index) => ({
      label: item.label,
      dueDate: item.dueDate,
      amount: 'amount' in item ? item.amount : 0,
      orderIndex: index + 1,
    }));
  }
  let allocated = 0;
  const installments = validatedSchedule.map((item, index) => {
    const installmentAmount = index === validatedSchedule.length - 1
      ? amount - allocated
      : Math.floor((amount * ('basisPoints' in item ? item.basisPoints : 0)) / 10000);
    allocated += installmentAmount;
    return {
      label: item.label,
      dueDate: item.dueDate,
      amount: installmentAmount,
      orderIndex: index + 1,
    };
  });
  return installments.every((item) => item.amount > 0) ? installments : null;
};

export const allocateToOldestInstallments = (
  amount: number,
  balances: InstallmentBalance[],
): InstallmentAllocation[] | null => {
  if (!Number.isSafeInteger(amount) || amount <= 0) return null;
  let remaining = amount;
  const allocations: InstallmentAllocation[] = [];
  for (const balance of balances) {
    if (remaining === 0) break;
    if (!Number.isSafeInteger(balance.remaining) || balance.remaining < 0) return null;
    const allocated = Math.min(balance.remaining, remaining);
    if (!allocated) continue;
    allocations.push({
      installmentId: balance.installmentId,
      obligationId: balance.obligationId,
      amount: allocated,
    });
    remaining -= allocated;
  }
  return remaining === 0 ? allocations : null;
};
