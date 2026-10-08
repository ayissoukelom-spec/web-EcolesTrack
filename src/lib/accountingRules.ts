export interface AccountingScheduleItem {
  label: string;
  dueDate: string;
  basisPoints: number;
}

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

export type FeePaymentStatus = 'unpaid' | 'partial' | 'paid';

export interface StudentFeeBalanceInput {
  studentId: number;
  categoryId: number;
  tariffAmount: number | null;
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

export const calculateStudentFeeBalance = ({
  studentId,
  categoryId,
  tariffAmount,
  obligations,
  allocations,
}: StudentFeeBalanceInput): StudentFeeBalance => {
  const tariffLinkedObligations = obligations.filter((obligation) => obligation.tariffId != null);
  const historicalDue = obligations
    .filter((obligation) => obligation.tariffId == null)
    .reduce((total, obligation) => total + obligation.amount, 0);
  const due = tariffLinkedObligations.length
    ? historicalDue + Math.max(0, tariffAmount ?? tariffLinkedObligations.reduce((total, obligation) => total + obligation.amount, 0))
    : obligations.length
      ? obligations.reduce((total, obligation) => total + obligation.amount, 0)
      : Math.max(0, tariffAmount ?? 0);
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
    status: remaining === 0 ? 'paid' : paid === 0 ? 'unpaid' : 'partial',
  };
};

const isValidDate = (value: unknown): value is string => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};

export const validateAccountingSchedule = (value: unknown): AccountingScheduleItem[] | null => {
  if (!Array.isArray(value) || value.length < 1 || value.length > 12) return null;
  const items: AccountingScheduleItem[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') return null;
    const candidate = item as Record<string, unknown>;
    const label = typeof candidate.label === 'string' ? candidate.label.trim() : '';
    const dueDate = candidate.dueDate;
    const basisPoints = Number(candidate.basisPoints);
    if (!label || label.length > 80 || !isValidDate(dueDate)
      || !Number.isInteger(basisPoints) || basisPoints <= 0) return null;
    items.push({ label, dueDate, basisPoints });
  }
  if (items.reduce((sum, item) => sum + item.basisPoints, 0) !== 10000) return null;
  if (items.some((item, index) => index > 0 && item.dueDate < items[index - 1].dueDate)) return null;
  return items;
};

export const splitAmountBySchedule = (
  amount: number,
  schedule: AccountingScheduleItem[],
) => {
  if (!Number.isSafeInteger(amount) || amount <= 0 || !validateAccountingSchedule(schedule)) return null;
  let allocated = 0;
  const installments = schedule.map((item, index) => {
    const installmentAmount = index === schedule.length - 1
      ? amount - allocated
      : Math.floor((amount * item.basisPoints) / 10000);
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
