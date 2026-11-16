import type express from 'express';
import { createHash } from 'node:crypto';
import { and, asc, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { db as defaultDb } from '../db/index.ts';
import {
  appendAuditEvent,
  createAuditSnapshot,
  type AuditEventExecutor,
  type AuditSnapshot,
} from './auditEvents.ts';
import {
  accountingCategories,
  accountingFeeDefinitions,
  accountingScheduleTemplates,
  accountingTariffs,
  academicYears,
  classes,
  financialAdjustmentAllocations,
  financialAdjustments,
  financialAdjustmentRequests,
  financialInstallments,
  financialObligations,
  financialPaymentAllocations,
  financialPayments,
  financialReceipts,
  levels,
  notifications,
  notificationAttachments,
  parents,
  schools,
  schoolTerms,
  schoolClasses,
  students,
  userSchools,
  users,
} from '../db/schema.ts';
import { deleteStoredFile, persistUploadedFile, readStoredFile } from './fileStorage.ts';
import { assertSchoolActiveInTransaction, SchoolSuspendedError } from './schoolSuspension.ts';
import {
  buildAccountingPaymentReminderMessage,
  calculateAccountingReminderInstallments,
  getAccountingReminderDedupeKey,
  getAccountingReminderPreviewFingerprint,
  type AccountingReminderStatus,
  type AccountingReminderStatusFilter,
  type AmbiguousAccountingReminderInstallment,
  type AccountingReminderInstallmentLine,
} from './accountingPaymentReminders.ts';
import {
  allocateToOldestInstallments,
  aggregateInstallmentPunctuality,
  calculateInstallmentPunctuality,
  calculateStudentFeeBalance,
  compareAccountingClassOrder,
  doAccountingClassRangesOverlap,
  getAccountingCategoryDisplayLabel,
  isAccountingEnrollmentKind,
  isAccountingClassWithinRange,
  isStandardAccountingCategoryLabel,
  splitAmountBySchedule,
  type AccountingEnrollmentKind,
  type AccountingClassOrder,
  type InstallmentPunctualityStatus,
  STANDARD_ACCOUNTING_CATEGORY_LABELS,
  validateAccountingSchedule,
} from './accountingRules.ts';
import {
  getAccountingTuitionProgressCandidates,
  type AccountingTuitionProgressDataSource,
  type AccountingTuitionProgressInput,
  type AccountingTuitionProgressResult,
} from './accountingTuitionProgress.ts';

type AccountingActor = {
  id?: number | null;
  role: string;
  schoolId?: number | null;
  academicYearId?: number | null;
  email?: string | null;
  name?: string | null;
};

type AccountingPermission =
  | 'read'
  | 'configure'
  | 'generate_obligations'
  | 'collect_payment'
  | 'manual_reminder'
  | 'adjustment'
  | 'request_adjustment'
  | 'review_adjustment'
  | 'confirm_refund';

const ACCOUNTING_ROLE_PERMISSIONS: Readonly<Record<string, readonly AccountingPermission[]>> = {
  super_admin: ['read', 'configure', 'generate_obligations', 'collect_payment', 'manual_reminder', 'adjustment'],
  school_admin: ['read', 'configure', 'generate_obligations', 'manual_reminder', 'review_adjustment'],
  school_accountant: ['read', 'collect_payment', 'manual_reminder', 'request_adjustment', 'confirm_refund'],
};

type PaymentAllocationState = {
  id: number;
  obligationId: number;
  installmentId: number | null;
  amount: number;
};

type AdjustmentAllocationState = { paymentAllocationId: number; amount: number };

type ObligationGenerationSelection = Record<string, number[]>;
type TuitionReduction = { discountAmount: number; reason: string };
type TuitionReductionsByTariffId = Record<string, Record<string, TuitionReduction>>;
type TuitionInstallmentAmountsByTariffId = Record<string, Record<string, number[]>>;

type ObligationGenerationRow = {
  key: string;
  studentId: number;
  studentName: string;
  classId: number;
  className: string;
  categoryId: number;
  categoryCode: string;
  categoryLabel: string | null;
  tariffId: number | null;
  referenceAmount: number | null;
  discountAmount: number;
  individualizationReason: string | null;
  canIndividualize: boolean;
  amount: number | null;
  state: 'eligible' | 'existing' | 'excluded';
  selected: boolean;
  reason: string | null;
  installments: Array<{ label: string; dueDate: string; amount: number; orderIndex: number }>;
};

type AccountingReminderCandidate = {
  studentId: number;
  firstName: string;
  lastName: string;
  className: string | null;
  obligationClassNames: string[];
  installments: AccountingReminderInstallmentLine[];
  ambiguousInstallments: AmbiguousAccountingReminderInstallment[];
  matchedInstallmentCount: number;
  settledInstallmentCount: number;
  totalRemaining: number;
  earliestDueDate: string | null;
  status: AccountingReminderStatus | 'mixed' | 'undetermined' | 'settled' | 'none';
  canSend: boolean;
  alreadyNotified: boolean;
  reason: string | null;
  message: string | null;
  dedupeKey: string | null;
  recipientUserId: number | null;
};

type AccountingReminderScope = {
  schoolId: number;
  academicYearId: number;
  classId: number | null;
  status: AccountingReminderStatusFilter;
};

const asPositiveInt = (value: unknown): number | null => {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
};

const asReminderStatusFilter = (value: unknown): AccountingReminderStatusFilter | null =>
  value === 'all' || value === 'upcoming' || value === 'today' || value === 'overdue'
    ? value
    : null;

const asStudentIdList = (value: unknown): number[] | null => {
  if (!Array.isArray(value) || value.length === 0) return null;
  const parsed = value.map(asPositiveInt);
  if (parsed.some((id) => id == null) || new Set(parsed).size !== parsed.length) return null;
  return parsed.filter((id): id is number => id != null);
};

const asMoney = (value: unknown): number | null => {
  const amount = Number(value);
  return Number.isSafeInteger(amount) && amount > 0 && amount <= 2147483647 ? amount : null;
};

const asNonNegativeMoney = (value: unknown): number | null => {
  const amount = Number(value);
  return Number.isSafeInteger(amount) && amount >= 0 && amount <= 2147483647 ? amount : null;
};

const parsePositiveIdArray = (value: unknown): number[] | null => {
  if (!Array.isArray(value) || value.length === 0 || value.length > 500) return null;
  const parsed = value.map(asPositiveInt);
  if (parsed.some((id) => id == null)) return null;
  return [...new Set(parsed as number[])].sort((left, right) => left - right);
};

const hashObligationGenerationSnapshot = (snapshot: unknown) =>
  createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');

const parseInitialTuitionInput = (body: Record<string, unknown>) => {
  const amountValue = body.initialTuitionAmount;
  const hasAmount = amountValue != null && amountValue !== '';
  const justificationValue = body.initialTuitionJustification;
  const hasJustification = justificationValue != null && justificationValue !== '';
  if (!hasAmount) {
    if (hasJustification) {
      throw Object.assign(new Error('A tuition amount is required with its justification'), { statusCode: 400 });
    }
    return { amount: null, justification: null };
  }
  const amount = asMoney(amountValue);
  if (!amount) {
    throw Object.assign(new Error('Initial tuition amount must be a positive whole number'), { statusCode: 400 });
  }
  if (justificationValue != null && typeof justificationValue !== 'string') {
    throw Object.assign(new Error('Tuition justification must be text'), { statusCode: 400 });
  }
  const justification = typeof justificationValue === 'string' ? justificationValue.trim() : '';
  if (justification.length > 1000) {
    throw Object.assign(new Error('Tuition justification must not exceed 1000 characters'), { statusCode: 400 });
  }
  return { amount, justification: justification || null };
};

const resolveInitialTuitionAmount = (
  categoryCode: string,
  referenceAmount: number,
  initialAmount: number | null,
  justification: string | null,
) => {
  if (initialAmount == null) return { amount: referenceAmount, individualized: false };
  if (categoryCode !== 'tuition') {
    throw Object.assign(new Error('An individualized initial amount is only available for tuition'), { statusCode: 400 });
  }
  if (initialAmount >= referenceAmount) {
    throw Object.assign(new Error('Initial individualized tuition must be lower than the class tariff'), { statusCode: 400 });
  }
  if (!justification) {
    throw Object.assign(new Error('A justification is required for reduced initial tuition'), { statusCode: 400 });
  }
  return { amount: initialAmount, individualized: true };
};

const asDate = (value: unknown): string | null => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : value;
};

const todayUtc = () => new Date().toISOString().slice(0, 10);

const normalizeAccountingLabel = (label: string) => label.trim().normalize('NFKC').replace(/\s+/g, ' ').toLocaleLowerCase('fr');

const getAdjustmentTotals = (allocations: PaymentAllocationState[], adjustments: AdjustmentAllocationState[]) => {
  const adjustedByAllocationId = new Map<number, number>();
  for (const adjustment of adjustments) {
    adjustedByAllocationId.set(
      adjustment.paymentAllocationId,
      (adjustedByAllocationId.get(adjustment.paymentAllocationId) ?? 0) + adjustment.amount,
    );
  }
  return adjustedByAllocationId;
};

const getSchoolId = async (
  actor: AccountingActor,
  requestedSchoolId: unknown,
  res: express.Response,
): Promise<number | null> => {
  if (actor.role === 'school_admin' || actor.role === 'school_accountant') {
    if (!actor.schoolId) {
      res.status(403).json({ error: 'School context is required' });
      return null;
    }
    return actor.schoolId;
  }
  if (actor.role !== 'super_admin') {
    res.status(403).json({ error: 'Forbidden' });
    return null;
  }
  const schoolId = asPositiveInt(requestedSchoolId);
  if (!schoolId) {
    res.status(400).json({ error: 'schoolId is required for a super admin request' });
    return null;
  }
  const [school] = await defaultDb.select({ id: schools.id }).from(schools).where(eq(schools.id, schoolId));
  if (!school) {
    res.status(404).json({ error: 'School not found' });
    return null;
  }
  return school.id;
};

const addAudit = async (
  tx: AuditEventExecutor,
  actor: AccountingActor,
  schoolId: number,
  action: string,
  resourceType: string,
  resourceId: number | null,
  description: string,
  beforeValues?: AuditSnapshot | null,
  afterValues?: AuditSnapshot | null,
  reason?: string | null,
) => {
  await appendAuditEvent(tx, {
    actor: {
      userId: actor.id ?? null,
      role: actor.role,
      email: actor.email ?? null,
      name: actor.name ?? null,
      activeFunction: {
        id: actor.role,
        name: actor.role === 'school_accountant'
          ? 'Secrétaire comptable'
          : actor.role === 'school_admin'
            ? 'Administrateur d’établissement'
            : actor.role === 'super_admin'
              ? 'Super administrateur'
              : actor.role,
      },
      activeSchool: actor.schoolId == null ? null : { id: actor.schoolId },
    },
    targetSchool: { id: schoolId },
    module: 'accounting',
    action,
    resourceType,
    resourceId,
    beforeValues,
    afterValues,
    result: 'success',
    source: 'web',
    reason: reason ?? null,
    description,
  });
};

const getOrCreateAccountingCategory = async (
  tx: Parameters<Parameters<typeof defaultDb.transaction>[0]>[0],
  schoolId: number,
  label: string,
  actor: AccountingActor,
) => {
  const normalizedLabel = normalizeAccountingLabel(label);
  const categories = await tx.select().from(accountingCategories)
    .where(eq(accountingCategories.schoolId, schoolId));
  const existing = categories.find((category) => category.code !== 'enrollment' && category.code !== 'tuition'
    && normalizeAccountingLabel(category.label) === normalizedLabel);
  if (existing) {
    if (!existing.isEnabled) {
      const [enabled] = await tx.update(accountingCategories).set({
        isEnabled: true,
        updatedAt: new Date(),
      }).where(and(eq(accountingCategories.id, existing.id), eq(accountingCategories.schoolId, schoolId))).returning();
      if (enabled) {
        await addAudit(tx, actor, schoolId, 'enable', 'accounting_category', enabled.id,
          'Accounting category enabled.',
          createAuditSnapshot(existing, ['label', 'code', 'isEnabled']),
          createAuditSnapshot(enabled, ['label', 'code', 'isEnabled']));
      }
      return enabled ?? { ...existing, isEnabled: true };
    }
    return existing;
  }

  const code = `custom:${normalizedLabel}`;
  const [created] = await tx.insert(accountingCategories).values({
    schoolId,
    code,
    label: label.trim(),
    isEnabled: true,
  }).onConflictDoNothing().returning();
  if (created) {
    await addAudit(tx, actor, schoolId, 'create', 'accounting_category', created.id,
      'Accounting category created.',
      null,
      createAuditSnapshot(created, ['label', 'code', 'isEnabled']));
    return created;
  }

  const [raced] = await tx.select().from(accountingCategories).where(and(
    eq(accountingCategories.schoolId, schoolId),
    eq(accountingCategories.code, code),
  ));
  if (!raced) throw new Error('Accounting fee category could not be created');
  return raced;
};

const loadOutstandingInstallments = async (
  executor: Parameters<Parameters<typeof defaultDb.transaction>[0]>[0],
  schoolId: number,
  studentId: number,
  academicYearId: number,
  filter?: { obligationId?: number | null; categoryId?: number | null },
) => {
  const obligationRows = await executor.select({
    id: financialObligations.id,
    categoryId: financialObligations.categoryId,
    classId: financialObligations.classId,
    tariffId: financialObligations.tariffId,
    feeDefinitionId: financialObligations.feeDefinitionId,
    enrollmentKind: financialObligations.enrollmentKind,
    classNameSnapshot: financialObligations.classNameSnapshot,
    label: financialObligations.label,
    amount: financialObligations.amount,
    createdAt: financialObligations.createdAt,
  }).from(financialObligations).where(and(
    eq(financialObligations.schoolId, schoolId),
    eq(financialObligations.studentId, studentId),
    eq(financialObligations.academicYearId, academicYearId),
    eq(financialObligations.status, 'active'),
    ...(filter?.obligationId ? [eq(financialObligations.id, filter.obligationId)] : []),
    ...(filter?.categoryId ? [eq(financialObligations.categoryId, filter.categoryId)] : []),
  )).orderBy(asc(financialObligations.createdAt), asc(financialObligations.id));

  if (!obligationRows.length) return {
    obligations: [],
    installments: [],
    balances: new Map<number, number>(),
    paidByObligation: new Map<number, number>(),
  };
  const obligationIds = obligationRows.map((row) => row.id);
  const installmentRows = await executor.select().from(financialInstallments)
    .where(inArray(financialInstallments.obligationId, obligationIds))
    .orderBy(asc(financialInstallments.dueDate), asc(financialInstallments.id));
  const allocationRows = await executor.select({
    id: financialPaymentAllocations.id,
    obligationId: financialPaymentAllocations.obligationId,
    installmentId: financialPaymentAllocations.installmentId,
    amount: financialPaymentAllocations.amount,
  }).from(financialPaymentAllocations)
    .innerJoin(financialPayments, eq(financialPayments.id, financialPaymentAllocations.paymentId))
    .where(and(inArray(financialPaymentAllocations.obligationId, obligationIds), eq(financialPayments.status, 'posted')));
  const allocationIds = allocationRows.map((row) => row.id);
  const adjustmentRows = allocationIds.length
    ? await executor.select({
      paymentAllocationId: financialAdjustmentAllocations.paymentAllocationId,
      amount: sql<number>`sum(${financialAdjustmentAllocations.amount})::int`,
    }).from(financialAdjustmentAllocations)
      .innerJoin(financialAdjustments, eq(financialAdjustments.id, financialAdjustmentAllocations.adjustmentId))
      .where(inArray(financialAdjustmentAllocations.paymentAllocationId, allocationIds))
      .groupBy(financialAdjustmentAllocations.paymentAllocationId)
    : [];
  const adjustedById = getAdjustmentTotals(allocationRows, adjustmentRows);
  const paidByInstallment = new Map<number, number>();
  const paidByObligation = new Map<number, number>();
  for (const allocation of allocationRows) {
    const net = allocation.amount - (adjustedById.get(allocation.id) ?? 0);
    paidByObligation.set(allocation.obligationId, (paidByObligation.get(allocation.obligationId) ?? 0) + net);
    if (allocation.installmentId != null) {
      paidByInstallment.set(allocation.installmentId, (paidByInstallment.get(allocation.installmentId) ?? 0) + net);
    }
  }
  const balances = new Map<number, number>();
  for (const installment of installmentRows) {
    balances.set(installment.id, Math.max(0, installment.amount - (paidByInstallment.get(installment.id) ?? 0)));
  }
  return { obligations: obligationRows, installments: installmentRows, balances, paidByObligation };
};

type ClassSituationInstallmentDetail = {
  studentId: number;
  obligationId: number;
  className: string | null;
  categoryLabel: string;
  label: string | null;
  dueDate: string | null;
  amount: number | null;
  paid: number | null;
  remaining: number | null;
  currentStatus: 'paid' | 'partial' | 'overdue' | 'pending' | 'not_applicable';
  punctualityStatus: InstallmentPunctualityStatus;
  settledAt: string | null;
  punctualityReason: string | null;
};

type ClassInstallmentSummary = {
  overdueInstallmentCount: number;
  overdueInstallmentAmount: number;
  nextInstallment: { label: string; dueDate: string; remaining: number } | null;
  punctualityStatus: InstallmentPunctualityStatus;
  punctualityReason: string | null;
  installmentDetails?: ClassSituationInstallmentDetail[];
};

const loadClassInstallmentSummaries = async (
  executor: Pick<typeof defaultDb, 'select'>,
  schoolId: number,
  academicYearId: number,
  studentIds: number[],
  includeInstallmentDetails = false,
) => {
  const summaries = new Map<number, ClassInstallmentSummary>(studentIds.map((studentId) => [studentId, {
    overdueInstallmentCount: 0,
    overdueInstallmentAmount: 0,
    nextInstallment: null as { label: string; dueDate: string; remaining: number } | null,
    punctualityStatus: 'not_applicable' as InstallmentPunctualityStatus,
    punctualityReason: null as string | null,
    ...(includeInstallmentDetails ? { installmentDetails: [] } : {}),
  }]));
  if (!studentIds.length) return summaries;

  const obligations = await executor.select({
    id: financialObligations.id,
    studentId: financialObligations.studentId,
    className: financialObligations.classNameSnapshot,
    label: financialObligations.label,
    categoryId: financialObligations.categoryId,
  }).from(financialObligations).where(and(
      eq(financialObligations.schoolId, schoolId),
      eq(financialObligations.academicYearId, academicYearId),
      eq(financialObligations.status, 'active'),
      inArray(financialObligations.studentId, studentIds),
    ));
  if (!obligations.length) return summaries;

  const categoriesById = new Map<number, string>();
  if (includeInstallmentDetails) {
    const categoryIds = [...new Set(obligations.map((obligation) => obligation.categoryId))];
    const categoryRows = categoryIds.length
      ? await executor.select({
        id: accountingCategories.id,
        label: accountingCategories.label,
      }).from(accountingCategories).where(inArray(accountingCategories.id, categoryIds))
      : [];
    for (const category of categoryRows) categoriesById.set(category.id, category.label);
  }
  const obligationIds = obligations.map((obligation) => obligation.id);
  const installments = await executor.select({
    id: financialInstallments.id,
    obligationId: financialInstallments.obligationId,
    label: financialInstallments.label,
    dueDate: financialInstallments.dueDate,
    amount: financialInstallments.amount,
  }).from(financialInstallments)
    .where(inArray(financialInstallments.obligationId, obligationIds))
    .orderBy(asc(financialInstallments.dueDate), asc(financialInstallments.id));
  const installmentsByObligation = new Map<number, typeof installments>();
  for (const installment of installments) {
    const obligationInstallments = installmentsByObligation.get(installment.obligationId) ?? [];
    obligationInstallments.push(installment);
    installmentsByObligation.set(installment.obligationId, obligationInstallments);
  }
  if (includeInstallmentDetails) {
    for (const obligation of obligations) {
      if (installmentsByObligation.has(obligation.id)) continue;
      summaries.get(obligation.studentId)?.installmentDetails?.push({
        studentId: obligation.studentId,
        obligationId: obligation.id,
        className: obligation.className,
        categoryLabel: obligation.label ?? categoriesById.get(obligation.categoryId) ?? null,
        label: null,
        dueDate: null,
        amount: null,
        paid: null,
        remaining: null,
        currentStatus: 'not_applicable',
        punctualityStatus: 'not_applicable',
        settledAt: null,
        punctualityReason: null,
      });
    }
  }
  if (!installments.length) return summaries;

  const allocations = await executor.select({
    id: financialPaymentAllocations.id,
    obligationId: financialPaymentAllocations.obligationId,
    installmentId: financialPaymentAllocations.installmentId,
    amount: financialPaymentAllocations.amount,
    paymentStatus: financialPayments.status,
    // Keep the stored calendar day; pg's Date parser would apply the process-local timezone.
    paidAtDate: sql<string>`to_char(${financialPayments.paidAt}, 'YYYY-MM-DD')`,
  }).from(financialPaymentAllocations)
    .innerJoin(financialPayments, eq(financialPayments.id, financialPaymentAllocations.paymentId))
    .where(and(
      inArray(financialPaymentAllocations.obligationId, obligationIds),
      eq(financialPayments.schoolId, schoolId),
      eq(financialPayments.academicYearId, academicYearId),
    ));
  const allocationIds = allocations.map((allocation) => allocation.id);
  const adjustments = allocationIds.length
    ? await executor.select({
      paymentAllocationId: financialAdjustmentAllocations.paymentAllocationId,
      amount: financialAdjustmentAllocations.amount,
      kind: financialAdjustments.kind,
      recordedAtDate: sql<string>`to_char(${financialAdjustments.createdAt}, 'YYYY-MM-DD')`,
    }).from(financialAdjustmentAllocations)
      .innerJoin(financialAdjustments, eq(financialAdjustments.id, financialAdjustmentAllocations.adjustmentId))
      .where(inArray(financialAdjustmentAllocations.paymentAllocationId, allocationIds))
    : [];
  const postedAllocations = allocations.filter((allocation) => allocation.paymentStatus === 'posted');
  const postedAllocationIds = new Set(postedAllocations.map((allocation) => allocation.id));
  const adjustmentsForPostedPayments = adjustments.filter((adjustment) => (
    postedAllocationIds.has(adjustment.paymentAllocationId)
  ));
  const adjustedById = getAdjustmentTotals(postedAllocations, adjustmentsForPostedPayments);
  const paidByInstallment = new Map<number, number>();
  const allocationsByInstallment = new Map<number, typeof postedAllocations>();
  const refundsByAllocation = new Map<number, typeof adjustmentsForPostedPayments>();
  const hasUnallocatedPaymentByObligation = new Set<number>();
  const obligationById = new Map(obligations.map((obligation) => [obligation.id, obligation]));
  for (const allocation of postedAllocations) {
    if (allocation.installmentId == null) continue;
    const net = allocation.amount - (adjustedById.get(allocation.id) ?? 0);
    paidByInstallment.set(
      allocation.installmentId,
      (paidByInstallment.get(allocation.installmentId) ?? 0) + net,
    );
    const installmentAllocations = allocationsByInstallment.get(allocation.installmentId) ?? [];
    installmentAllocations.push(allocation);
    allocationsByInstallment.set(allocation.installmentId, installmentAllocations);
  }
  for (const allocation of postedAllocations) {
    if (allocation.installmentId == null) hasUnallocatedPaymentByObligation.add(allocation.obligationId);
  }
  for (const adjustment of adjustmentsForPostedPayments) {
    if (adjustment.kind !== 'refund') continue;
    const allocationAdjustments = refundsByAllocation.get(adjustment.paymentAllocationId) ?? [];
    allocationAdjustments.push(adjustment);
    refundsByAllocation.set(adjustment.paymentAllocationId, allocationAdjustments);
  }

  const today = todayUtc();
  const punctualityByStudent = new Map<number, Array<{
    dueDate: string;
    status: InstallmentPunctualityStatus;
    reason: string | null;
    currentStatus: 'overdue' | 'upcoming' | 'settled' | 'undetermined';
  }>>();
  for (const installment of installments) {
    const remaining = Math.max(0, installment.amount - (paidByInstallment.get(installment.id) ?? 0));
    const obligation = obligationById.get(installment.obligationId);
    const studentId = obligation?.studentId;
    const summary = studentId == null ? null : summaries.get(studentId);
    if (!summary) continue;
    const installmentAllocations = allocationsByInstallment.get(installment.id) ?? [];
    const installmentRefunds = installmentAllocations.flatMap((allocation) =>
      (refundsByAllocation.get(allocation.id) ?? []).map((adjustment) => ({
        amount: adjustment.amount,
        recordedAtDate: adjustment.recordedAtDate,
      })),
    );
    const punctuality = calculateInstallmentPunctuality({
      amount: installment.amount,
      dueDate: installment.dueDate,
      remaining,
      today,
      hasUnallocatedPayment: hasUnallocatedPaymentByObligation.has(installment.obligationId),
      payments: installmentAllocations.map((allocation) => ({
        amount: allocation.amount,
        paidAtDate: allocation.paidAtDate,
        status: 'posted',
      })),
      refunds: installmentRefunds,
    });
    const paid = paidByInstallment.get(installment.id) ?? 0;
    const currentStatus = remaining === 0 ? 'paid'
      : punctuality.currentStatus === 'overdue' ? 'overdue'
      : paid > 0 ? 'partial'
        : installment.dueDate < today ? 'overdue' : 'pending';
    if (includeInstallmentDetails && obligation) {
      summary.installmentDetails?.push({
        studentId,
        obligationId: obligation.id,
        className: obligation.className,
        categoryLabel: obligation.label ?? categoriesById.get(obligation.categoryId) ?? null,
        label: installment.label,
        dueDate: installment.dueDate,
        amount: installment.amount,
        paid,
        remaining,
        currentStatus,
        punctualityStatus: punctuality.status,
        settledAt: punctuality.settledAt,
        punctualityReason: punctuality.reason,
      });
    }
    const studentInstallments = punctualityByStudent.get(studentId) ?? [];
    studentInstallments.push({
      dueDate: installment.dueDate,
      status: punctuality.status,
      reason: punctuality.reason,
      currentStatus: punctuality.currentStatus,
    });
    punctualityByStudent.set(studentId, studentInstallments);

    if (punctuality.currentStatus === 'overdue') {
      summary.overdueInstallmentCount += 1;
      summary.overdueInstallmentAmount += remaining;
    }
    if (remaining <= 0 || installment.dueDate < today) continue;
    const next = summary.nextInstallment;
    if (!next || installment.dueDate < next.dueDate) {
      summary.nextInstallment = {
        label: installment.label,
        dueDate: installment.dueDate,
        remaining,
      };
    }
  }
  for (const [studentId, studentInstallments] of punctualityByStudent) {
    const summary = summaries.get(studentId);
    if (!summary) continue;
    const punctuality = aggregateInstallmentPunctuality(studentInstallments, today);
    summary.punctualityStatus = punctuality.status;
    summary.punctualityReason = punctuality.reason;
  }
  return summaries;
};

const getApplicableTariffs = async (
  executor: Pick<typeof defaultDb, 'select'>,
  {
    schoolId,
    academicYearId,
    classId,
    categoryId,
    tariffId,
  }: {
    schoolId: number;
    academicYearId: number;
    classId: number;
    categoryId?: number;
    tariffId?: number;
  },
) => {
  const candidates = await executor.select().from(accountingTariffs).where(and(
    eq(accountingTariffs.schoolId, schoolId),
    eq(accountingTariffs.academicYearId, academicYearId),
    eq(accountingTariffs.isEnabled, true),
    ...(categoryId ? [eq(accountingTariffs.categoryId, categoryId)] : []),
  ));
  const requestedTariff = tariffId == null ? null : candidates.find((tariff) => tariff.id === tariffId);
  if (tariffId != null && !requestedTariff) return [];
  if (requestedTariff && categoryId != null && requestedTariff.categoryId !== categoryId) return [];
  const selectedCategoryId = requestedTariff?.categoryId ?? categoryId;
  const scopedCandidates = selectedCategoryId == null
    ? candidates
    : candidates.filter((tariff) => tariff.categoryId === selectedCategoryId);
  const exact = scopedCandidates.filter((tariff) => tariff.classId === classId);
  const scopedRanges = scopedCandidates.filter((tariff) => tariff.classId == null
    && tariff.classFromId != null && tariff.classToId != null);
  if (!scopedRanges.length) return exact;
  const classIds = [...new Set([
    classId,
    ...scopedRanges.flatMap((tariff) => [tariff.classFromId!, tariff.classToId!]),
  ])];
  const classOrders = await executor.select({
    classId: classes.id,
    className: classes.name,
    academicYearId: classes.academicYearId,
    levelOrder: levels.orderIndex,
  }).from(classes).innerJoin(levels, eq(levels.id, classes.levelId))
    .where(inArray(classes.id, classIds));
  const orderByClassId = new Map<number, AccountingClassOrder>(classOrders
    .filter((row) => row.academicYearId === academicYearId)
    .map((row) => [row.classId, {
      classId: row.classId,
      className: row.className,
      levelOrder: row.levelOrder,
    }]));
  const studentOrder = orderByClassId.get(classId);
  if (studentOrder == null) return exact;
  const exactCategories = new Set(exact.map((tariff) => tariff.categoryId));
  const matchingRanges = scopedRanges.filter((tariff) => {
    if (exactCategories.has(tariff.categoryId)) return false;
    const startOrder = tariff.classFromId == null ? undefined : orderByClassId.get(tariff.classFromId);
    const endOrder = tariff.classToId == null ? undefined : orderByClassId.get(tariff.classToId);
    return startOrder != null && endOrder != null
      && isAccountingClassWithinRange(studentOrder, startOrder, endOrder);
  });
  const rangeByCategory = new Map<number, (typeof matchingRanges)[number]>();
  for (const tariff of matchingRanges) {
    if (!rangeByCategory.has(tariff.categoryId)) rangeByCategory.set(tariff.categoryId, tariff);
  }
  if (requestedTariff) {
    if (exact.length) return exact;
    return matchingRanges.filter((tariff) => tariff.id === requestedTariff.id);
  }
  const resolved = [...exact, ...rangeByCategory.values()];
  return resolved;
};

const findEquivalentTariffObligation = (
  obligations: Array<{
    id: number;
    classId: number;
    tariffId: number | null;
    feeDefinitionId: number | null;
    enrollmentKind: string | null;
  }>,
  {
    classId,
    enrollmentKind,
    ambiguityMessage,
  }: {
    classId: number;
    enrollmentKind: string | null;
    ambiguityMessage?: string;
  },
) => {
  const sameScopeAndNature = obligations.filter((obligation) =>
    obligation.classId === classId && obligation.enrollmentKind === enrollmentKind);
  const unidentified = sameScopeAndNature.some((obligation) =>
    obligation.tariffId == null && obligation.feeDefinitionId == null);
  const conflictingSource = sameScopeAndNature.some((obligation) =>
    obligation.tariffId != null && obligation.feeDefinitionId != null);
  const tariffObligations = sameScopeAndNature.filter((obligation) =>
    obligation.tariffId != null && obligation.feeDefinitionId == null);

  if (unidentified || conflictingSource || tariffObligations.length > 1) {
    throw Object.assign(
      new Error(ambiguityMessage
        ?? 'An existing obligation matches this fee and class ambiguously; no new obligation or payment was recorded'),
      { statusCode: 409 },
    );
  }

  return tariffObligations[0] ?? null;
};

const findExistingEnrollmentTariffObligation = (
  obligations: Array<{
    id: number;
    classId: number;
    tariffId: number | null;
    feeDefinitionId: number | null;
    enrollmentKind: string | null;
  }>,
  { classId, tariffId }: { classId: number; tariffId?: number },
) => {
  const sameClass = obligations.filter((obligation) => obligation.classId === classId);
  const unidentified = sameClass.some((obligation) =>
    obligation.tariffId == null && obligation.feeDefinitionId == null);
  const conflictingSource = sameClass.some((obligation) =>
    obligation.tariffId != null && obligation.feeDefinitionId != null);
  const tariffObligations = sameClass.filter((obligation) =>
    obligation.tariffId != null
      && obligation.feeDefinitionId == null
      && (tariffId == null || obligation.tariffId === tariffId));

  if (unidentified || conflictingSource || tariffObligations.length > 1) {
    throw Object.assign(
      new Error('Plusieurs obligations d’inscription correspondent à ce paiement; aucune opération n’a été enregistrée.'),
      { statusCode: 409 },
    );
  }

  return tariffObligations[0] ?? null;
};

const findExistingTuitionObligation = (
  obligations: Array<{
    id: number;
    classId: number;
    tariffId: number | null;
    feeDefinitionId: number | null;
    enrollmentKind: string | null;
  }>,
) => {
  const tuitionObligations = obligations.filter((obligation) =>
    obligation.feeDefinitionId == null && obligation.enrollmentKind == null);
  if (tuitionObligations.length > 1) {
    throw Object.assign(
      new Error('Multiple active tuition obligations match ambiguously for this student and year; no new obligation or payment was recorded'),
      { statusCode: 409 },
    );
  }
  return tuitionObligations[0] ?? null;
};

const ensureTariffObligation = async (
  executor: Parameters<Parameters<typeof defaultDb.transaction>[0]>[0],
  {
    actor,
    schoolId,
    studentId,
    academicYearId,
    classId,
    className,
    categoryId,
    tariffId,
    enrollmentKind,
    initialTuitionAmount,
    initialTuitionJustification,
  }: {
    actor: AccountingActor;
    schoolId: number;
    studentId: number;
    academicYearId: number;
    classId: number;
    className: string;
    categoryId: number;
    tariffId?: number;
    enrollmentKind?: AccountingEnrollmentKind | null;
    initialTuitionAmount?: number | null;
    initialTuitionJustification?: string | null;
  },
) => {
  const existing = await executor.select({
    id: financialObligations.id,
    classId: financialObligations.classId,
    tariffId: financialObligations.tariffId,
    feeDefinitionId: financialObligations.feeDefinitionId,
    enrollmentKind: financialObligations.enrollmentKind,
  }).from(financialObligations).where(and(
    eq(financialObligations.schoolId, schoolId),
    eq(financialObligations.studentId, studentId),
    eq(financialObligations.academicYearId, academicYearId),
    eq(financialObligations.categoryId, categoryId),
    eq(financialObligations.status, 'active'),
  ));
  const [category] = await executor.select().from(accountingCategories).where(and(
    eq(accountingCategories.id, categoryId),
    eq(accountingCategories.schoolId, schoolId),
  ));
  if (!category) {
    throw Object.assign(new Error('No configured amount is available for this fee and class'), { statusCode: 409 });
  }
  if (category.code === 'tuition') {
    if (initialTuitionAmount != null) {
      const [priorTuitionObligation] = await executor.select({
        id: financialObligations.id,
      }).from(financialObligations).where(and(
        eq(financialObligations.schoolId, schoolId),
        eq(financialObligations.studentId, studentId),
        eq(financialObligations.academicYearId, academicYearId),
        eq(financialObligations.categoryId, categoryId),
      ));
      if (priorTuitionObligation) {
        throw Object.assign(new Error('Initial tuition can only be individualized before any tuition obligation has been constituted'), { statusCode: 409 });
      }
    } else {
      const existingTuition = findExistingTuitionObligation(existing);
      if (existingTuition) return existingTuition;
    }
  }
  if (category.code === 'enrollment' && enrollmentKind == null) {
    const existingEnrollment = findExistingEnrollmentTariffObligation(existing, { classId, tariffId });
    if (existingEnrollment) return existingEnrollment;
  }
  const tariff = (await getApplicableTariffs(executor, {
    schoolId,
    academicYearId,
    classId,
    categoryId,
    tariffId,
  }))[0];
  const effectiveEnrollmentKind = category.code === 'enrollment' ? enrollmentKind ?? null : null;
  const equivalent = findEquivalentTariffObligation(existing, {
    classId,
    enrollmentKind: effectiveEnrollmentKind,
    ...(category.code === 'enrollment'
      ? { ambiguityMessage: 'Plusieurs obligations d’inscription correspondent à ce type et à cette classe.' }
      : {}),
  });
  if (equivalent) return equivalent;
  if (!tariff && existing.length && category.code !== 'enrollment') return null;
  if (!tariff) {
    throw Object.assign(new Error(category.code === 'enrollment'
      ? 'Aucun tarif d’inscription configuré n’est disponible pour cet élève et cette classe.'
      : 'No configured amount is available for this fee and class'), { statusCode: 409 });
  }
  if (category.code === 'enrollment' && enrollmentKind == null) {
    throw Object.assign(
      new Error('Sélectionnez un type d’inscription avant d’enregistrer ce paiement.'),
      { statusCode: 400 },
    );
  }

  const initialTerms = resolveInitialTuitionAmount(
    category.code,
    tariff.amount,
    initialTuitionAmount ?? null,
    initialTuitionJustification ?? null,
  );
  const sourceKey = `tariff-${tariff.id}-student-${studentId}`;
  const [duplicate] = await executor.select().from(financialObligations).where(and(
    eq(financialObligations.schoolId, schoolId),
    eq(financialObligations.sourceKey, sourceKey),
  ));
  if (duplicate) {
    if (duplicate.status === 'active' && duplicate.classId === classId
      && duplicate.categoryId === categoryId && duplicate.feeDefinitionId == null
      && duplicate.enrollmentKind === effectiveEnrollmentKind) {
      return duplicate;
    }
    if (duplicate.status === 'active') {
      throw Object.assign(new Error(category.code === 'enrollment'
        ? 'Une obligation d’inscription existe déjà pour une autre classe ou un autre type.'
        : 'The configured charge already exists for a different class or fee nature'), { statusCode: 409 });
    }
    throw Object.assign(new Error(category.code === 'enrollment'
      ? 'Cette obligation d’inscription a déjà été annulée.'
      : 'The configured charge has already been cancelled'), { statusCode: 409 });
  }

  let planned: Array<{ label: string; dueDate: string; amount: number; orderIndex: number }>;
  if (category.code === 'tuition') {
    const [scheduleRow] = await executor.select().from(accountingScheduleTemplates).where(and(
      eq(accountingScheduleTemplates.schoolId, schoolId),
      eq(accountingScheduleTemplates.academicYearId, academicYearId),
      eq(accountingScheduleTemplates.classId, classId),
      eq(accountingScheduleTemplates.categoryId, categoryId),
    ));
    const schedule = validateAccountingSchedule(scheduleRow?.installments);
    planned = schedule
      ? splitAmountBySchedule(initialTerms.amount, schedule) ?? [{
        label: 'Paiement unique',
        dueDate: todayUtc(),
        amount: initialTerms.amount,
        orderIndex: 1,
      }]
      : [{
        label: 'Paiement unique',
        dueDate: todayUtc(),
        amount: initialTerms.amount,
        orderIndex: 1,
      }];
  } else {
    planned = [{
      label: category.label,
      dueDate: todayUtc(),
      amount: initialTerms.amount,
      orderIndex: 1,
    }];
  }

  const [created] = await executor.insert(financialObligations).values({
    schoolId,
    studentId,
    academicYearId,
    classId,
    categoryId,
    tariffId: tariff.id,
    feeDefinitionId: null,
    label: tariff.label,
    amount: initialTerms.amount,
    currency: 'XOF',
    classNameSnapshot: className,
    enrollmentKind: effectiveEnrollmentKind,
    sourceKey,
    createdBy: actor.id ?? null,
  }).onConflictDoNothing().returning();
  if (!created) {
    const [raced] = await executor.select().from(financialObligations).where(and(
      eq(financialObligations.schoolId, schoolId),
      eq(financialObligations.sourceKey, sourceKey),
    ));
    if (raced?.status === 'active'
      && raced.classId === classId
      && raced.categoryId === categoryId
      && raced.feeDefinitionId == null
      && raced.enrollmentKind === effectiveEnrollmentKind) return raced;
    throw Object.assign(new Error('The configured charge could not be created for this payment'), { statusCode: 409 });
  }
  await executor.insert(financialInstallments).values(planned.map((item) => ({
    obligationId: created.id,
    label: item.label,
    orderIndex: item.orderIndex,
    amount: item.amount,
    dueDate: item.dueDate,
  })));
  await addAudit(
    executor,
    actor,
    schoolId,
    'create',
    'financial_obligation',
    created.id,
    'Charge created from configured tariff.',
    null,
    createAuditSnapshot(created, [
      'studentId', 'academicYearId', 'classId', 'categoryId', 'tariffId', 'feeDefinitionId',
      'label', 'amount', 'currency', 'classNameSnapshot', 'enrollmentKind', 'status',
    ]),
  );
  return created;
};

const createReceiptSnapshot = async ({
  database,
  schoolId,
  payment,
  receiptNumber,
  student,
  schoolYearName,
  allocations,
  paidBeforePayment,
  totalDue,
  remainingAfterPayment,
  actor,
}: {
  database: typeof defaultDb;
  schoolId: number;
  payment: { id: number; amount: number; currency: string; method: string; reference: string | null; paidAt: Date };
  receiptNumber: string;
  student: { id: number; firstName: string; lastName: string; matricule: string; className: string };
  schoolYearName: string;
  allocations: Array<{ category: string; label: string; amount: number; installmentLabel?: string; dueDate?: string }>;
  paidBeforePayment: number;
  totalDue: number;
  remainingAfterPayment: number;
  actor: AccountingActor;
}) => {
  const [school] = await database.select().from(schools).where(eq(schools.id, schoolId));
  if (!school) throw new Error('School not found while creating receipt');
  let logoData: string | null = null;
  let logoMimeType: string | null = null;
  if (school.logoPath) {
    const logoBytes = await readStoredFile('school-logos', school.logoPath);
    if (logoBytes) {
      logoData = logoBytes.toString('base64');
      logoMimeType = /\.png$/i.test(school.logoPath) ? 'image/png' : 'image/jpeg';
    }
  }
  return {
    school: {
      name: school.officialName || school.name,
      address: school.address,
      phone: school.phone,
      phone2: school.phone2,
      email: school.email,
      city: school.city,
      region: school.region,
      logoData,
      logoMimeType,
    },
    payment: {
      id: payment.id,
      amount: payment.amount,
      currency: payment.currency,
      method: payment.method,
      reference: payment.reference,
      paidAt: payment.paidAt.toISOString(),
    },
    receiptNumber,
    student,
    academicYearName: schoolYearName,
    allocations,
    paidBeforePayment,
    totalDue,
    remainingAfterPayment,
    recordedBy: actor.name || actor.email || 'Utilisateur',
  };
};

export interface RegisterAccountingApiOptions {
  resolveActor: (req: any) => Promise<AccountingActor | null>;
  isApprovedClassForSchool: (classId: number, schoolId: number | null) => Promise<boolean>;
  dispatchPaymentNotification: (payload: {
    parentId: string;
    title: string;
    message: string;
    category: 'info';
    metadata: {
      target: 'payment';
      paymentId: string;
      notificationId?: number;
      attachmentCount?: number;
      attachments?: Array<{
        attachmentId: number;
        fileName: string;
        mimeType: string;
        fileSize: number;
      }>;
    };
    dedupeKey: string;
  }) => Promise<number>;
  database?: typeof defaultDb;
}

export type AccountingTuitionProgressExecutor = Parameters<Parameters<typeof defaultDb.transaction>[0]>[0];

const createAccountingTuitionProgressDataSource = (
  executor: AccountingTuitionProgressExecutor,
): AccountingTuitionProgressDataSource => ({
  loadAcademicYear: async (_schoolId, academicYearId) => {
    const [year] = await executor.select({
      id: academicYears.id,
      schoolId: academicYears.schoolId,
    }).from(academicYears).where(eq(academicYears.id, academicYearId));
    return year ?? null;
  },
  loadPeriods: async (schoolId, academicYearId, cycleId) =>
    executor.select({
      schoolId: schoolTerms.schoolId,
      academicYearId: schoolTerms.academicYearId,
      cycleId: schoolTerms.cycleId,
      periodType: schoolTerms.periodType,
      orderIndex: schoolTerms.orderIndex,
      startDate: schoolTerms.startDate,
      endDate: schoolTerms.endDate,
      isActive: schoolTerms.isActive,
    }).from(schoolTerms).where(and(
      eq(schoolTerms.academicYearId, academicYearId),
      eq(schoolTerms.cycleId, cycleId),
      or(isNull(schoolTerms.schoolId), eq(schoolTerms.schoolId, schoolId)),
    )),
  loadTuitionObligations: async (schoolId, academicYearId) =>
    executor.select({
      id: financialObligations.id,
      studentId: financialObligations.studentId,
      schoolId: financialObligations.schoolId,
      academicYearId: financialObligations.academicYearId,
      classId: financialObligations.classId,
      categoryId: financialObligations.categoryId,
      amount: financialObligations.amount,
      currency: financialObligations.currency,
      studentSchoolId: students.schoolId,
      firstName: students.firstName,
      lastName: students.lastName,
      matricule: students.matricule,
      classSchoolId: classes.schoolId,
      classAcademicYearId: classes.academicYearId,
      className: financialObligations.classNameSnapshot,
      cycleId: levels.cycleId,
    }).from(financialObligations)
      .innerJoin(accountingCategories, eq(accountingCategories.id, financialObligations.categoryId))
      .leftJoin(students, eq(students.id, financialObligations.studentId))
      .leftJoin(classes, eq(classes.id, financialObligations.classId))
      .leftJoin(levels, eq(levels.id, classes.levelId))
      .where(and(
        eq(financialObligations.schoolId, schoolId),
        eq(financialObligations.academicYearId, academicYearId),
        eq(financialObligations.status, 'active'),
        eq(accountingCategories.schoolId, schoolId),
        eq(accountingCategories.code, 'tuition'),
      ))
      .orderBy(asc(financialObligations.studentId), asc(financialObligations.id)),
  loadPaymentAllocations: async (_schoolId, _academicYearId, obligationIds) =>
    obligationIds.length
      ? executor.select({
        id: financialPaymentAllocations.id,
        obligationId: financialPaymentAllocations.obligationId,
        installmentId: financialPaymentAllocations.installmentId,
        installmentObligationId: financialInstallments.obligationId,
        amount: financialPaymentAllocations.amount,
        paymentId: financialPayments.id,
        paymentSchoolId: financialPayments.schoolId,
        paymentStudentId: financialPayments.studentId,
        paymentAcademicYearId: financialPayments.academicYearId,
        paymentStatus: financialPayments.status,
        paidAtDate: sql<string>`to_char(${financialPayments.paidAt}, 'YYYY-MM-DD')`,
      }).from(financialPaymentAllocations)
        .innerJoin(financialPayments, eq(financialPayments.id, financialPaymentAllocations.paymentId))
        .leftJoin(financialInstallments, eq(financialInstallments.id, financialPaymentAllocations.installmentId))
        .where(inArray(financialPaymentAllocations.obligationId, [...obligationIds]))
      : [],
  loadPaymentAdjustments: async (paymentAllocationIds) =>
    paymentAllocationIds.length
      ? executor.select({
        adjustmentId: financialAdjustments.id,
        paymentAllocationId: financialAdjustmentAllocations.paymentAllocationId,
        adjustmentPaymentId: financialAdjustments.paymentId,
        amount: financialAdjustmentAllocations.amount,
        kind: financialAdjustments.kind,
        recordedAtDate: sql<string>`to_char(${financialAdjustments.createdAt}, 'YYYY-MM-DD')`,
      }).from(financialAdjustmentAllocations)
        .innerJoin(financialAdjustments, eq(financialAdjustments.id, financialAdjustmentAllocations.adjustmentId))
        .where(inArray(financialAdjustmentAllocations.paymentAllocationId, [...paymentAllocationIds]))
      : [],
});

export const loadAccountingTuitionProgressCandidatesInTransaction = (
  input: AccountingTuitionProgressInput,
  executor: AccountingTuitionProgressExecutor,
): Promise<AccountingTuitionProgressResult> =>
  getAccountingTuitionProgressCandidates(input, createAccountingTuitionProgressDataSource(executor));

export const loadAccountingTuitionProgressCandidates = (
  input: AccountingTuitionProgressInput,
  database: typeof defaultDb = defaultDb,
) => database.transaction((executor) =>
  loadAccountingTuitionProgressCandidatesInTransaction(input, executor));

export const registerAccountingRoutes = (app: express.Express, options: RegisterAccountingApiOptions) => {
  const db = options.database ?? defaultDb;
  const tariffVersioningUnavailable = {
    error: 'Tariff versioning is unavailable until its schema is installed and activation is explicitly authorized',
    code: 'ACCOUNTING_TARIFF_VERSIONING_UNAVAILABLE',
  };
  const actorFor = async (
    req: any,
    res: express.Response,
    permission: AccountingPermission = 'read',
  ) => {
    const actor = await options.resolveActor(req);
    if (!actor) {
      res.status(404).json({ error: 'User not found' });
      return null;
    }
    if (!ACCOUNTING_ROLE_PERMISSIONS[actor.role]?.includes(permission)) {
      res.status(403).json({ error: 'Forbidden' });
      return null;
    }
    return actor;
  };

  const respondTariffVersioningUnavailable = async (
    req: any,
    res: express.Response,
    requestedSchoolId: unknown,
    ids: unknown[],
    permission: AccountingPermission,
    invalidIdMessage = 'Valid tariff id is required',
  ) => {
    try {
      const actor = await actorFor(req, res, permission);
      if (!actor) return;
      const schoolId = await getSchoolId(actor, requestedSchoolId, res);
      if (!schoolId) return;
      if (ids.some((id) => !asPositiveInt(id))) {
        return res.status(400).json({ error: invalidIdMessage });
      }
      return res.status(503).json(tariffVersioningUnavailable);
    } catch (error) {
      console.error('Failed to resolve accounting tariff version request:', error);
      return res.status(500).json({ error: 'Failed to resolve accounting tariff version request' });
    }
  };

  app.get('/api/accounting/tariffs/:tariffId/versions', async (req, res) => {
    return respondTariffVersioningUnavailable(req, res, req.query.schoolId, [req.params.tariffId], 'read');
  });

  app.post('/api/accounting/tariffs/:tariffId/versions', async (req, res) => {
    return respondTariffVersioningUnavailable(req, res, req.body?.schoolId, [req.params.tariffId], 'configure');
  });

  app.post('/api/accounting/tariffs/:tariffId/versions/:versionId/replace', async (req, res) => {
    return respondTariffVersioningUnavailable(req, res, req.body?.schoolId, [
      req.params.tariffId,
      req.params.versionId,
    ], 'configure', 'Valid tariff and version ids are required');
  });

  app.post('/api/accounting/tariffs/:tariffId/versions/:versionId/cancel', async (req, res) => {
    return respondTariffVersioningUnavailable(req, res, req.body?.schoolId, [
      req.params.tariffId,
      req.params.versionId,
    ], 'configure', 'Valid tariff and version ids are required');
  });

  const validateClassAndYear = async (schoolId: number, classId: number, academicYearId: number) => {
    const [classRow] = await db.select({
      id: classes.id,
      schoolId: classes.schoolId,
      academicYearId: classes.academicYearId,
      name: classes.name,
    }).from(classes).where(eq(classes.id, classId));
    const [yearRow] = await db.select({
      id: academicYears.id,
      schoolId: academicYears.schoolId,
      name: academicYears.name,
    }).from(academicYears).where(eq(academicYears.id, academicYearId));
    if (!classRow || !yearRow || classRow.academicYearId !== academicYearId) return null;
    if (yearRow.schoolId != null && yearRow.schoolId !== schoolId) return null;
    const classAllowed = classRow.schoolId === schoolId
      || (classRow.schoolId == null && await options.isApprovedClassForSchool(classId, schoolId));
    return classAllowed ? { classRow, yearRow } : null;
  };

  const buildObligationGenerationPlan = async (
    executor: Pick<typeof db, 'select'>,
    {
      schoolId,
      academicYearId,
      classIds,
      categoryIds,
      selection,
      tuitionReductions,
      tuitionInstallmentAmounts,
      strictSelection,
    }: {
      schoolId: number;
      academicYearId: number;
      classIds: number[];
      categoryIds: number[];
      selection: ObligationGenerationSelection | null;
      tuitionReductions: TuitionReductionsByTariffId;
      tuitionInstallmentAmounts: TuitionInstallmentAmountsByTariffId;
      strictSelection: boolean;
    },
  ) => {
    const [year] = await executor.select({
      id: academicYears.id,
      schoolId: academicYears.schoolId,
      name: academicYears.name,
    }).from(academicYears).where(eq(academicYears.id, academicYearId));
    if (!year || (year.schoolId != null && year.schoolId !== schoolId)) {
      throw Object.assign(new Error('Academic year is not available for this school'), { statusCode: 400 });
    }

    const categoryRows = await executor.select({
      id: accountingCategories.id,
      code: accountingCategories.code,
      label: accountingCategories.label,
    }).from(accountingCategories).where(and(
      eq(accountingCategories.schoolId, schoolId),
      eq(accountingCategories.isEnabled, true),
      inArray(accountingCategories.id, categoryIds),
    ));
    if (categoryRows.length !== categoryIds.length) {
      throw Object.assign(new Error('One or more selected fee categories are unavailable'), { statusCode: 400 });
    }
    if (categoryRows.some((category) => category.code === 'enrollment')) {
      throw Object.assign(new Error('Enrollment fees are excluded from batch generation'), { statusCode: 400 });
    }

    const classRows = await executor.select({
      id: classes.id,
      schoolId: classes.schoolId,
      academicYearId: classes.academicYearId,
      name: classes.name,
    }).from(classes).where(inArray(classes.id, classIds));
    const validatedClasses = await Promise.all(classRows.map(async (classRow) => {
      if (classRow.academicYearId !== academicYearId) return null;
      const approval = classRow.schoolId == null
        ? await executor.select({ id: schoolClasses.id }).from(schoolClasses).where(and(
          eq(schoolClasses.classId, classRow.id),
          eq(schoolClasses.schoolId, schoolId),
          eq(schoolClasses.status, 'approved'),
        ))
        : [];
      const classAllowed = classRow.schoolId === schoolId
        || (classRow.schoolId == null && approval.length > 0);
      return classAllowed ? { classRow, yearRow: year } : null;
    }));
    if (classRows.length !== classIds.length || validatedClasses.some((context) => !context)) {
      throw Object.assign(new Error('One or more selected classes are not authorized for this school year'), { statusCode: 400 });
    }
    const classById = new Map(validatedClasses.map((context) => [context!.classRow.id, context!.classRow]));
    const studentRows = await executor.select({
      id: students.id,
      firstName: students.firstName,
      lastName: students.lastName,
      matricule: students.matricule,
      classId: students.classId,
    }).from(students).where(and(
      eq(students.schoolId, schoolId),
      eq(students.isActive, true),
      inArray(students.classId, classIds),
    ));
    const studentsByClass = new Map<number, typeof studentRows>();
    for (const student of studentRows) {
      if (student.classId == null) continue;
      const current = studentsByClass.get(student.classId) ?? [];
      current.push(student);
      studentsByClass.set(student.classId, current);
    }
    for (const classStudents of studentsByClass.values()) {
      classStudents.sort((left, right) => left.id - right.id);
    }

    const applicableTariffsByClass = new Map<number, typeof accountingTariffs.$inferSelect[]>();
    for (const classId of classIds) {
      applicableTariffsByClass.set(classId, await getApplicableTariffs(executor, {
        schoolId,
        academicYearId,
        classId,
      }));
    }

    const tuitionCategoryIds = categoryRows
      .filter((category) => category.code === 'tuition')
      .map((category) => category.id);
    const scheduleRows = tuitionCategoryIds.length
      ? await executor.select().from(accountingScheduleTemplates).where(and(
        eq(accountingScheduleTemplates.schoolId, schoolId),
        eq(accountingScheduleTemplates.academicYearId, academicYearId),
        inArray(accountingScheduleTemplates.classId, classIds),
        inArray(accountingScheduleTemplates.categoryId, tuitionCategoryIds),
      ))
      : [];
    const scheduleByScope = new Map(scheduleRows.map((schedule) =>
      [`${schedule.classId}:${schedule.categoryId}`, schedule]));

    const allStudentIds = studentRows.map((student) => student.id);
    const existingObligations = allStudentIds.length
      ? await executor.select({
        id: financialObligations.id,
        studentId: financialObligations.studentId,
        classId: financialObligations.classId,
        categoryId: financialObligations.categoryId,
        tariffId: financialObligations.tariffId,
        feeDefinitionId: financialObligations.feeDefinitionId,
        sourceKey: financialObligations.sourceKey,
        status: financialObligations.status,
        amount: financialObligations.amount,
      }).from(financialObligations).where(and(
        eq(financialObligations.schoolId, schoolId),
        eq(financialObligations.academicYearId, academicYearId),
        inArray(financialObligations.studentId, allStudentIds),
        inArray(financialObligations.categoryId, categoryIds),
      ))
      : [];
    const obligationsByStudentCategory = new Map<string, typeof existingObligations>();
    for (const obligation of existingObligations) {
      const key = `${obligation.studentId}:${obligation.categoryId}`;
      const current = obligationsByStudentCategory.get(key) ?? [];
      current.push(obligation);
      obligationsByStudentCategory.set(key, current);
    }

    const rows: ObligationGenerationRow[] = [];
    const configurationIssues: string[] = [];
    const appliedReductionKeys = new Set<string>();
    const appliedInstallmentOverrideKeys = new Set<string>();
    for (const classId of classIds) {
      const classRow = classById.get(classId)!;
      const classStudents = studentsByClass.get(classId) ?? [];
      const classTariffs = applicableTariffsByClass.get(classId) ?? [];
      for (const category of categoryRows) {
        const categoryTariffs = classTariffs.filter((tariff) => tariff.categoryId === category.id);
        const tariff = categoryTariffs.length === 1 ? categoryTariffs[0] : null;
        const issue = categoryTariffs.length > 1
          ? 'Plusieurs tarifs applicables à cette classe'
          : !tariff ? 'Aucun tarif actif applicable à cette classe' : null;
        const schedule = category.code === 'tuition' && tariff
          ? validateAccountingSchedule(
            scheduleByScope.get(`${classId}:${category.id}`)?.installments,
            tariff.amount,
          )
          : null;
        const plannedInstallments = category.code === 'tuition' && tariff && schedule
          ? splitAmountBySchedule(tariff.amount, schedule)
          : category.code === 'tuition' ? null : tariff
            ? [{ label: tariff.label, dueDate: todayUtc(), amount: tariff.amount, orderIndex: 1 }]
            : null;
        const scheduleIssue = category.code === 'tuition' && tariff && !plannedInstallments
          ? 'Échéancier de scolarité absent ou invalide'
          : null;
        if (issue) configurationIssues.push(`${classRow.name} — ${category.label} : ${issue}`);
        if (scheduleIssue) configurationIssues.push(`${classRow.name} — ${category.label} : ${scheduleIssue}`);

        for (const student of classStudents) {
          const existingForCategory = obligationsByStudentCategory.get(`${student.id}:${category.id}`) ?? [];
          const activeObligations = existingForCategory.filter((obligation) => obligation.status === 'active');
          const sourceKey = tariff ? `tariff-${tariff.id}-student-${student.id}` : null;
          const sameSourceObligation = sourceKey
            ? existingForCategory.find((obligation) => obligation.sourceKey === sourceKey)
            : null;
          const reduction = tariff && category.code === 'tuition'
            ? tuitionReductions[String(tariff.id)]?.[String(student.id)] ?? null
            : null;
          const individualizedAmounts = tariff && category.code === 'tuition'
            ? tuitionInstallmentAmounts[String(tariff.id)]?.[String(student.id)] ?? null
            : null;
          if (reduction && reduction.discountAmount >= tariff!.amount) {
            throw Object.assign(new Error('The tuition reduction must be lower than the class tariff; the final amount must remain positive'), { statusCode: 400 });
          }
          let state: ObligationGenerationRow['state'] = 'eligible';
          let reason: string | null = null;
          const referenceAmount = tariff?.amount ?? null;
          const discountAmount = reduction?.discountAmount ?? 0;
          let amount = referenceAmount == null ? null : referenceAmount - discountAmount;
          const individualizationReason = reduction?.reason ?? null;
          let canIndividualize = category.code === 'tuition' && tariff != null;
          let installments = plannedInstallments ?? [];
          if (activeObligations.length) {
            if (reduction) {
              throw Object.assign(new Error('Tuition can only be individualized before an obligation exists'), { statusCode: 409 });
            }
            state = 'existing';
            amount = activeObligations.reduce((total, obligation) => total + obligation.amount, 0);
            reason = activeObligations.length > 1
              ? 'Plusieurs obligations actives existent déjà pour cette catégorie et cette année'
              : 'Une obligation active existe déjà pour cette catégorie et cette année';
            installments = [];
            canIndividualize = false;
          } else if (issue) {
            if (reduction) {
              throw Object.assign(new Error('Tuition cannot be individualized without one unambiguous applicable tariff'), { statusCode: 400 });
            }
            state = 'excluded';
            reason = issue;
            installments = [];
            canIndividualize = false;
          } else if (scheduleIssue) {
            if (reduction) {
              throw Object.assign(new Error('Configure a valid tuition installment schedule before individualizing this student'), { statusCode: 409 });
            }
            state = 'excluded';
            reason = scheduleIssue;
            installments = [];
            canIndividualize = false;
          } else if (sameSourceObligation) {
            if (reduction) {
              throw Object.assign(new Error('Tuition can only be individualized before an obligation exists'), { statusCode: 409 });
            }
            state = 'excluded';
            reason = 'Une obligation historique utilise déjà la clé source de ce tarif';
            installments = [];
            canIndividualize = false;
          } else if (reduction) {
            if (!schedule) {
              throw Object.assign(new Error('Configure a valid tuition installment schedule before individualizing this student'), { statusCode: 409 });
            }
            if (!individualizedAmounts
              || individualizedAmounts.length !== schedule.length
              || individualizedAmounts.some((installmentAmount) => !asMoney(installmentAmount))
              || individualizedAmounts.reduce((total, installmentAmount) => total + installmentAmount, 0) !== amount) {
              throw Object.assign(new Error('Enter positive individualized tuition installment amounts whose total equals the reduced tuition amount'), { statusCode: 400 });
            }
            installments = schedule.map((item, index) => ({
              label: item.label,
              dueDate: item.dueDate,
              amount: individualizedAmounts[index],
              orderIndex: index + 1,
            }));
            appliedReductionKeys.add(`${tariff!.id}:${student.id}`);
            appliedInstallmentOverrideKeys.add(`${tariff!.id}:${student.id}`);
          }
          rows.push({
            key: `${student.id}:${category.id}:${tariff?.id ?? 'missing'}`,
            studentId: student.id,
            studentName: `${student.lastName} ${student.firstName}`.trim(),
            classId,
            className: classRow.name,
            categoryId: category.id,
            categoryCode: category.code,
            categoryLabel: tariff?.label ?? category.label,
            tariffId: tariff?.id ?? null,
            referenceAmount,
            discountAmount,
            individualizationReason,
            canIndividualize,
            amount,
            state,
            selected: false,
            reason,
            installments,
          });
        }
      }
    }
    const unknownReduction = Object.entries(tuitionReductions).some(([tariffId, studentReductions]) =>
      Object.entries(studentReductions).some(([studentId]) => !appliedReductionKeys.has(`${tariffId}:${studentId}`)));
    if (unknownReduction) {
      throw Object.assign(new Error('One or more tuition reductions are not valid for an eligible student and tariff'), { statusCode: 400 });
    }
    const unknownInstallmentOverride = Object.entries(tuitionInstallmentAmounts).some(([tariffId, studentInstallments]) =>
      Object.entries(studentInstallments).some(([studentId]) => !appliedInstallmentOverrideKeys.has(`${tariffId}:${studentId}`)));
    if (unknownInstallmentOverride) {
      throw Object.assign(new Error('One or more individualized installment amounts are not valid for a reduced tuition student and tariff'), { statusCode: 400 });
    }
    rows.sort((left, right) => left.classId - right.classId
      || left.categoryId - right.categoryId
      || left.studentId - right.studentId);

    const rowsByTariff = new Map<number, ObligationGenerationRow[]>();
    for (const row of rows) {
      if (row.tariffId == null) continue;
      const current = rowsByTariff.get(row.tariffId) ?? [];
      current.push(row);
      rowsByTariff.set(row.tariffId, current);
    }
    const effectiveSelection: ObligationGenerationSelection = {};
    const invalidSelectionIds: number[] = [];
    for (const [tariffId, tariffRows] of rowsByTariff) {
      const eligibleRows = tariffRows.filter((row) => row.state === 'eligible');
      const requestedIds = selection == null
        ? eligibleRows.filter((row) => row.categoryCode === 'tuition').map((row) => row.studentId)
        : selection[String(tariffId)] ?? [];
      const knownStudentIds = new Set(tariffRows.map((row) => row.studentId));
      const eligibleStudentIds = new Set(eligibleRows.map((row) => row.studentId));
      const invalidIds = requestedIds.filter((studentId) => !knownStudentIds.has(studentId));
      invalidSelectionIds.push(...invalidIds);
      if (strictSelection && invalidIds.length) {
        throw Object.assign(new Error('The student selection is no longer eligible; preview the generation again'), { statusCode: 400 });
      }
      const selectedIds = [...new Set(requestedIds.filter((studentId) => eligibleStudentIds.has(studentId)))]
        .sort((left, right) => left - right);
      effectiveSelection[String(tariffId)] = selectedIds;
      const selectedSet = new Set(selectedIds);
      for (const row of tariffRows) row.selected = row.state === 'eligible' && selectedSet.has(row.studentId);
    }
    for (const [tariffId, requestedIds] of Object.entries(selection ?? {})) {
      if (!rowsByTariff.has(Number(tariffId))) {
        invalidSelectionIds.push(...requestedIds);
        if (strictSelection && requestedIds.length) {
          throw Object.assign(new Error('The student selection is no longer eligible; preview the generation again'), { statusCode: 400 });
        }
      }
    }

    const sortedSelection = Object.fromEntries(Object.entries(effectiveSelection)
      .sort(([left], [right]) => Number(left) - Number(right)));
    const sortedTuitionReductions = Object.fromEntries(Object.entries(tuitionReductions)
      .sort(([left], [right]) => Number(left) - Number(right))
      .map(([tariffId, studentReductions]) => [
        tariffId,
        Object.fromEntries(Object.entries(studentReductions)
          .sort(([left], [right]) => Number(left) - Number(right))),
      ]));
    const sortedTuitionInstallmentAmounts = Object.fromEntries(Object.entries(tuitionInstallmentAmounts)
      .sort(([left], [right]) => Number(left) - Number(right))
      .map(([tariffId, studentInstallments]) => [
        tariffId,
        Object.fromEntries(Object.entries(studentInstallments)
          .sort(([left], [right]) => Number(left) - Number(right))),
      ]));
    const snapshot = {
      schoolId,
      year: { id: year.id, schoolId: year.schoolId, name: year.name },
      classIds,
      classes: validatedClasses.map((context) => ({
        id: context!.classRow.id,
        schoolId: context!.classRow.schoolId,
        academicYearId: context!.classRow.academicYearId,
        name: context!.classRow.name,
      })).sort((left, right) => left.id - right.id),
      categories: categoryRows.map((category) => ({
        id: category.id,
        code: category.code,
        label: category.label,
      })).sort((left, right) => left.id - right.id),
      students: studentRows.map((student) => ({
        id: student.id,
        classId: student.classId,
        firstName: student.firstName,
        lastName: student.lastName,
        matricule: student.matricule,
      })).sort((left, right) => left.id - right.id),
      tariffs: [...applicableTariffsByClass.entries()].flatMap(([classId, classTariffs]) =>
        classTariffs.filter((tariff) => categoryIds.includes(tariff.categoryId)).map((tariff) => ({
          classId,
          id: tariff.id,
          categoryId: tariff.categoryId,
          label: tariff.label,
          amount: tariff.amount,
          classIdOnTariff: tariff.classId,
          classFromId: tariff.classFromId,
          classToId: tariff.classToId,
        }))).sort((left, right) => left.classId - right.classId || left.id - right.id),
      schedules: scheduleRows.map((schedule) => ({
        classId: schedule.classId,
        categoryId: schedule.categoryId,
        installments: schedule.installments,
      })).sort((left, right) => left.classId - right.classId || left.categoryId - right.categoryId),
      obligations: existingObligations.map((obligation) => ({
        id: obligation.id,
        studentId: obligation.studentId,
        classId: obligation.classId,
        categoryId: obligation.categoryId,
        tariffId: obligation.tariffId,
        feeDefinitionId: obligation.feeDefinitionId,
        sourceKey: obligation.sourceKey,
        status: obligation.status,
        amount: obligation.amount,
      })).sort((left, right) => left.id - right.id),
      selection: sortedSelection,
      tuitionReductions: sortedTuitionReductions,
      tuitionInstallmentAmounts: sortedTuitionInstallmentAmounts,
      invalidSelectionIds: [...invalidSelectionIds].sort((left, right) => left - right),
      rows: rows.map((row) => ({
        key: row.key,
        state: row.state,
        selected: row.selected,
        referenceAmount: row.referenceAmount,
        discountAmount: row.discountAmount,
        individualizationReason: row.individualizationReason,
        amount: row.amount,
        reason: row.reason,
        installments: row.installments,
      })),
    };

    const selectedRows = rows.filter((row) => row.state === 'eligible' && row.selected);
    return {
      previewToken: hashObligationGenerationSnapshot(snapshot),
      selectionByTariffId: sortedSelection,
      tuitionReductionsByTariffId: sortedTuitionReductions,
      tuitionInstallmentAmountsByTariffId: sortedTuitionInstallmentAmounts,
      rows,
      studentsExamined: new Set(studentRows.map((student) => student.id)).size,
      studentsEligible: new Set(rows.filter((row) => row.state === 'eligible').map((row) => row.studentId)).size,
      newObligationCount: selectedRows.length,
      existingObligationCount: rows.filter((row) => row.state === 'existing').length,
      excludedCount: rows.filter((row) => row.state === 'excluded').length,
      estimatedTotal: selectedRows.reduce((total, row) => total + (row.amount ?? 0), 0),
      configurationIssues: [...new Set(configurationIssues)],
      snapshot,
    };
  };

  const parseObligationGenerationRequest = (body: Record<string, unknown> | undefined) => {
    const academicYearId = asPositiveInt(body?.academicYearId);
    const classIds = parsePositiveIdArray(body?.classIds);
    const categoryIds = parsePositiveIdArray(body?.categoryIds);
    const rawSelection = body?.selectedStudentIdsByTariffId;
    let selection: ObligationGenerationSelection | null = null;
    if (rawSelection != null) {
      if (typeof rawSelection !== 'object' || Array.isArray(rawSelection)) return null;
      selection = {};
      for (const [rawTariffId, rawStudentIds] of Object.entries(rawSelection)) {
        const tariffId = asPositiveInt(rawTariffId);
        if (!tariffId || !Array.isArray(rawStudentIds) || rawStudentIds.length > 500) return null;
        const studentIds = rawStudentIds.map(asPositiveInt);
        if (studentIds.some((studentId) => studentId == null)) return null;
        selection[String(tariffId)] = [...new Set(studentIds as number[])].sort((left, right) => left - right);
      }
    }
    const rawTuitionReductions = body?.tuitionReductionsByTariffId;
    const tuitionReductions: TuitionReductionsByTariffId = {};
    if (rawTuitionReductions != null) {
      if (typeof rawTuitionReductions !== 'object' || Array.isArray(rawTuitionReductions)) {
        throw Object.assign(new Error('Tuition reductions must be provided as a tariff-to-student map'), { statusCode: 400 });
      }
      let reductionCount = 0;
      for (const [rawTariffId, rawStudentReductions] of Object.entries(rawTuitionReductions)) {
        const tariffId = asPositiveInt(rawTariffId);
        if (!tariffId || typeof rawStudentReductions !== 'object' || rawStudentReductions == null || Array.isArray(rawStudentReductions)) {
          throw Object.assign(new Error('Tuition reduction references are invalid'), { statusCode: 400 });
        }
        for (const [rawStudentId, rawReduction] of Object.entries(rawStudentReductions)) {
          const studentId = asPositiveInt(rawStudentId);
          if (!studentId || typeof rawReduction !== 'object' || rawReduction == null || Array.isArray(rawReduction)) {
            throw Object.assign(new Error('Tuition reduction references are invalid'), { statusCode: 400 });
          }
          const reduction = rawReduction as Record<string, unknown>;
          const rawDiscountAmount = reduction.discountAmount;
          const hasNumericDiscount = typeof rawDiscountAmount === 'number'
            || (typeof rawDiscountAmount === 'string' && rawDiscountAmount.trim() !== '');
          const discountAmount = hasNumericDiscount ? asNonNegativeMoney(rawDiscountAmount) : null;
          const reason = typeof reduction.reason === 'string' ? reduction.reason.trim() : '';
          if (discountAmount == null || reason.length > 1000
            || (discountAmount > 0 && !reason)
            || (discountAmount === 0 && reason)) {
            throw Object.assign(new Error('Enter a positive tuition reduction below the class tariff and a justification; a 100% reduction is not allowed'), { statusCode: 400 });
          }
          if (discountAmount === 0) continue;
          reductionCount += 1;
          if (reductionCount > 500) {
            throw Object.assign(new Error('Too many individualized tuition rows were submitted'), { statusCode: 400 });
          }
          tuitionReductions[String(tariffId)] ??= {};
          tuitionReductions[String(tariffId)][String(studentId)] = { discountAmount, reason };
        }
      }
    }
    const rawTuitionInstallmentAmounts = body?.tuitionInstallmentAmountsByTariffId;
    const tuitionInstallmentAmounts: TuitionInstallmentAmountsByTariffId = {};
    if (rawTuitionInstallmentAmounts != null) {
      if (typeof rawTuitionInstallmentAmounts !== 'object' || Array.isArray(rawTuitionInstallmentAmounts)) {
        throw Object.assign(new Error('Individualized tuition installments must be provided as a tariff-to-student map'), { statusCode: 400 });
      }
      let installmentOverrideCount = 0;
      for (const [rawTariffId, rawStudentInstallments] of Object.entries(rawTuitionInstallmentAmounts)) {
        const tariffId = asPositiveInt(rawTariffId);
        if (!tariffId || typeof rawStudentInstallments !== 'object'
          || rawStudentInstallments == null || Array.isArray(rawStudentInstallments)) {
          throw Object.assign(new Error('Individualized tuition installment references are invalid'), { statusCode: 400 });
        }
        for (const [rawStudentId, rawAmounts] of Object.entries(rawStudentInstallments)) {
          const studentId = asPositiveInt(rawStudentId);
          if (!studentId || !Array.isArray(rawAmounts) || rawAmounts.length < 1 || rawAmounts.length > 12) {
            throw Object.assign(new Error('Individualized tuition installment references are invalid'), { statusCode: 400 });
          }
          const amounts = rawAmounts.map(asMoney);
          if (amounts.some((amount) => amount == null)) {
            throw Object.assign(new Error('Individualized tuition installment amounts must be positive whole numbers'), { statusCode: 400 });
          }
          installmentOverrideCount += 1;
          if (installmentOverrideCount > 500) {
            throw Object.assign(new Error('Too many individualized tuition schedules were submitted'), { statusCode: 400 });
          }
          tuitionInstallmentAmounts[String(tariffId)] ??= {};
          tuitionInstallmentAmounts[String(tariffId)][String(studentId)] = amounts as number[];
        }
      }
    }
    if (!academicYearId || !classIds || !categoryIds) return null;
    return {
      academicYearId,
      classIds,
      categoryIds,
      selection,
      tuitionReductions,
      tuitionInstallmentAmounts,
    };
  };

  app.post('/api/accounting/obligation-generation/preview', async (req, res) => {
    try {
      const actor = await actorFor(req, res, 'generate_obligations');
      if (!actor) return;
      const schoolId = await getSchoolId(actor, req.body?.schoolId, res);
      if (!schoolId) return;
      const input = parseObligationGenerationRequest(req.body);
      if (!input) return res.status(400).json({ error: 'Select a school year, at least one class, and at least one fee category' });
      const plan = await buildObligationGenerationPlan(db, {
        schoolId,
        ...input,
        strictSelection: true,
      });
      const { snapshot: _snapshot, ...preview } = plan;
      return res.json(preview);
    } catch (error) {
      const statusCode = typeof error === 'object' && error && 'statusCode' in error ? Number(error.statusCode) : 500;
      if (statusCode !== 500) return res.status(statusCode).json({ error: (error as Error).message });
      console.error('Failed to preview accounting obligation generation:', error);
      return res.status(500).json({ error: 'Failed to preview accounting obligation generation' });
    }
  });

  app.post('/api/accounting/obligation-generation/confirm', async (req, res) => {
    try {
      const actor = await actorFor(req, res, 'generate_obligations');
      if (!actor) return;
      const schoolId = await getSchoolId(actor, req.body?.schoolId, res);
      if (!schoolId) return;
      const input = parseObligationGenerationRequest(req.body);
      const previewToken = typeof req.body?.previewToken === 'string' ? req.body.previewToken : '';
      if (!input || !/^[a-f0-9]{64}$/.test(previewToken)) {
        return res.status(400).json({ error: 'A valid generation preview and selection are required' });
      }

      const result = await db.transaction(async (tx) => {
        await tx.execute(sql`SET TRANSACTION ISOLATION LEVEL SERIALIZABLE`);
        await tx.execute(sql`SELECT id FROM academic_years WHERE id = ${input.academicYearId} FOR UPDATE`);
        const plan = await buildObligationGenerationPlan(tx, {
          schoolId,
          ...input,
          strictSelection: false,
        });
        if (plan.previewToken !== previewToken) return { stale: true as const };
        const selectedRows = plan.rows.filter((row) => row.state === 'eligible' && row.selected);
        if (!selectedRows.length) {
          throw Object.assign(new Error('No new obligations are selected for generation'), { statusCode: 400 });
        }

        for (const row of selectedRows) {
          if (row.tariffId == null || row.amount == null || row.installments.length === 0) {
            throw Object.assign(new Error('The generation preview contains an incomplete obligation'), { statusCode: 409 });
          }
          const sourceKey = `tariff-${row.tariffId}-student-${row.studentId}`;
          const [created] = await tx.insert(financialObligations).values({
            schoolId,
            studentId: row.studentId,
            academicYearId: input.academicYearId,
            classId: row.classId,
            categoryId: row.categoryId,
            tariffId: row.tariffId,
            feeDefinitionId: null,
            label: row.categoryLabel,
            amount: row.amount,
            currency: 'XOF',
            classNameSnapshot: row.className,
            enrollmentKind: null,
            sourceKey,
            createdBy: actor.id ?? null,
          }).onConflictDoNothing().returning();
          if (!created) {
            throw Object.assign(new Error('An obligation changed during generation; preview the batch again'), { statusCode: 409 });
          }
          await tx.insert(financialInstallments).values(row.installments.map((installment) => ({
            obligationId: created.id,
            label: installment.label,
            orderIndex: installment.orderIndex,
            amount: installment.amount,
            dueDate: installment.dueDate,
          })));
          await addAudit(tx, actor, schoolId, 'create', 'financial_obligation', created.id,
            'Batch financial obligation created.',
            null,
            createAuditSnapshot(created, [
              'studentId', 'academicYearId', 'classId', 'categoryId', 'tariffId', 'label',
              'amount', 'currency', 'classNameSnapshot', 'enrollmentKind',
            ]));
        }
        return {
          stale: false as const,
          createdCount: selectedRows.length,
          totalAmount: selectedRows.reduce((total, row) => total + (row.amount ?? 0), 0),
        };
      });
      if (result.stale) {
        return res.status(409).json({
          error: 'The students, tariffs, schedules, or existing obligations changed after preview; preview the generation again',
          code: 'ACCOUNTING_GENERATION_PREVIEW_STALE',
        });
      }
      return res.status(201).json(result);
    } catch (error) {
      const statusCode = typeof error === 'object' && error && 'statusCode' in error ? Number(error.statusCode) : 500;
      if (statusCode !== 500) return res.status(statusCode).json({ error: (error as Error).message });
      if (typeof error === 'object' && error && 'code' in error && error.code === '40001') {
        return res.status(409).json({
          error: 'Concurrent accounting changes prevented generation; preview the batch again',
          code: 'ACCOUNTING_GENERATION_PREVIEW_STALE',
        });
      }
      console.error('Failed to confirm accounting obligation generation:', error);
      return res.status(500).json({ error: 'Failed to confirm accounting obligation generation' });
    }
  });

  app.get('/api/accounting/categories', async (req, res) => {
    try {
      const actor = await actorFor(req, res);
      if (!actor) return;
      const schoolId = await getSchoolId(actor, req.query.schoolId, res);
      if (!schoolId) return;
      const categories = await db.select().from(accountingCategories)
        .where(eq(accountingCategories.schoolId, schoolId))
        .orderBy(asc(accountingCategories.id));
      return res.json(categories);
    } catch (error) {
      console.error('Failed to load accounting categories:', error);
      return res.status(500).json({ error: 'Failed to load accounting categories' });
    }
  });

  app.get('/api/accounting/payments', async (req, res) => {
    try {
      const actor = await actorFor(req, res);
      if (!actor) return;
      const requestedSchoolId = req.query.schoolId;
      const allSchools = actor.role === 'super_admin'
        && (requestedSchoolId == null || requestedSchoolId === '');
      const schoolId = allSchools ? null : await getSchoolId(actor, requestedSchoolId, res);
      if (!allSchools && !schoolId) return;
      const conditions = [
        ...(schoolId == null ? [] : [eq(financialPayments.schoolId, schoolId)]),
      ];
      const yearId = req.query.academicYearId == null ? null : asPositiveInt(req.query.academicYearId);
      const studentId = req.query.studentId == null ? null : asPositiveInt(req.query.studentId);
      if ((req.query.academicYearId != null && !yearId) || (req.query.studentId != null && !studentId)) {
        return res.status(400).json({ error: 'Invalid payment filter' });
      }
      if (yearId) conditions.push(eq(financialPayments.academicYearId, yearId));
      if (studentId) conditions.push(eq(financialPayments.studentId, studentId));
      const rows = await db.select({
        id: financialPayments.id,
        schoolName: schools.name,
        studentId: financialPayments.studentId,
        studentName: sql<string>`${students.firstName} || ' ' || ${students.lastName}`,
        className: sql<string | null>`(
          SELECT string_agg(DISTINCT ${financialObligations.classNameSnapshot}, ' / ' ORDER BY ${financialObligations.classNameSnapshot})
          FROM ${financialPaymentAllocations}
          INNER JOIN ${financialObligations}
            ON ${financialObligations.id} = ${financialPaymentAllocations.obligationId}
          WHERE ${financialPaymentAllocations.paymentId} = ${financialPayments.id}
            AND ${financialObligations.schoolId} = ${financialPayments.schoolId}
        )`,
        academicYearId: financialPayments.academicYearId,
        amount: financialPayments.amount,
        currency: financialPayments.currency,
        method: financialPayments.method,
        reference: financialPayments.reference,
        paidAt: financialPayments.paidAt,
        status: financialPayments.status,
        receiptId: financialReceipts.id,
        receiptNumber: financialReceipts.receiptNumber,
      }).from(financialPayments)
        .innerJoin(students, and(
          eq(students.id, financialPayments.studentId),
          eq(students.schoolId, financialPayments.schoolId),
        ))
        .innerJoin(schools, eq(schools.id, financialPayments.schoolId))
        .leftJoin(financialReceipts, eq(financialReceipts.paymentId, financialPayments.id))
        .where(conditions.length ? and(...conditions) : undefined)
        .orderBy(desc(financialPayments.paidAt))
        .limit(500);
      return res.json(rows);
    } catch (error) {
      console.error('Failed to load accounting payments:', error);
      return res.status(500).json({ error: 'Failed to load accounting payments' });
    }
  });

  app.put('/api/accounting/categories/:id', async (req, res) => {
    try {
      const actor = await actorFor(req, res, 'configure');
      if (!actor) return;
      const schoolId = await getSchoolId(actor, req.body?.schoolId, res);
      if (!schoolId) return;
      const categoryId = asPositiveInt(req.params.id);
      if (!categoryId || typeof req.body?.isEnabled !== 'boolean') return res.status(400).json({ error: 'Invalid category update' });
      const updated = await db.transaction(async (tx) => {
        const [before] = await tx.select().from(accountingCategories).where(and(
          eq(accountingCategories.id, categoryId),
          eq(accountingCategories.schoolId, schoolId),
        )).for('update');
        if (!before) return null;
        const [after] = await tx.update(accountingCategories).set({
          isEnabled: req.body.isEnabled,
          updatedAt: new Date(),
        }).where(eq(accountingCategories.id, categoryId)).returning();
        if (after) await addAudit(tx, actor, schoolId, 'update', 'accounting_category', after.id, 'Accounting category updated.',
          createAuditSnapshot(before, ['code', 'label', 'isEnabled']),
          createAuditSnapshot(after, ['code', 'label', 'isEnabled']));
        return after ?? null;
      });
      if (!updated) return res.status(404).json({ error: 'Category not found' });
      return res.json(updated);
    } catch (error) {
      console.error('Failed to update accounting category:', error);
      return res.status(500).json({ error: 'Failed to update accounting category' });
    }
  });

  app.get('/api/accounting/tariffs', async (req, res) => {
    try {
      const actor = await actorFor(req, res);
      if (!actor) return;
      const schoolId = await getSchoolId(actor, req.query.schoolId, res);
      if (!schoolId) return;
      const yearId = req.query.academicYearId == null ? null : asPositiveInt(req.query.academicYearId);
      if (req.query.academicYearId != null && !yearId) return res.status(400).json({ error: 'Invalid academicYearId' });
      const conditions = [eq(accountingTariffs.schoolId, schoolId)];
      if (yearId) conditions.push(eq(accountingTariffs.academicYearId, yearId));
      const tariffClass = alias(classes, 'tariff_class');
      const rangeStartClass = alias(classes, 'range_start_class');
      const rangeEndClass = alias(classes, 'range_end_class');
      const rows = await db.select({
        id: accountingTariffs.id,
        schoolId: accountingTariffs.schoolId,
        academicYearId: accountingTariffs.academicYearId,
        classId: accountingTariffs.classId,
        className: sql<string>`COALESCE(${tariffClass.name}, ${rangeStartClass.name} || ' à ' || ${rangeEndClass.name})`,
        classFromId: accountingTariffs.classFromId,
        classFromName: rangeStartClass.name,
        classToId: accountingTariffs.classToId,
        classToName: rangeEndClass.name,
        categoryId: accountingTariffs.categoryId,
        categoryCode: accountingCategories.code,
        categoryLabel: accountingTariffs.label,
        amount: accountingTariffs.amount,
        currency: accountingTariffs.currency,
        isEnabled: accountingTariffs.isEnabled,
      }).from(accountingTariffs)
        .leftJoin(tariffClass, eq(tariffClass.id, accountingTariffs.classId))
        .leftJoin(rangeStartClass, eq(rangeStartClass.id, accountingTariffs.classFromId))
        .leftJoin(rangeEndClass, eq(rangeEndClass.id, accountingTariffs.classToId))
        .innerJoin(accountingCategories, eq(accountingCategories.id, accountingTariffs.categoryId))
        .where(and(...conditions, eq(accountingTariffs.isEnabled, true)))
        .orderBy(asc(accountingTariffs.academicYearId), asc(accountingTariffs.classId),
          asc(accountingTariffs.classFromId), asc(accountingCategories.id));
      return res.json(rows);
    } catch (error) {
      console.error('Failed to load accounting tariffs:', error);
      return res.status(500).json({ error: 'Failed to load accounting tariffs' });
    }
  });

  app.delete('/api/accounting/tariffs/:tariffId', async (req, res) => {
    try {
      const actor = await actorFor(req, res, 'configure');
      if (!actor) return;
      const schoolId = await getSchoolId(actor, req.query.schoolId, res);
      if (!schoolId) return;
      const tariffId = asPositiveInt(req.params.tariffId);
      if (!tariffId) return res.status(400).json({ error: 'Valid tariff id is required' });

      const result = await db.transaction(async (tx) => {
        const [tariff] = await tx.select().from(accountingTariffs).where(and(
          eq(accountingTariffs.id, tariffId),
          eq(accountingTariffs.schoolId, schoolId),
        )).for('update');
        if (!tariff) return { notFound: true as const };

        const obligations = await tx.select({ id: financialObligations.id })
          .from(financialObligations)
          .where(eq(financialObligations.tariffId, tariffId));
        if (obligations.length > 0) {
          const [archived] = await tx.update(accountingTariffs).set({ isEnabled: false, updatedAt: new Date() }).where(and(
            eq(accountingTariffs.id, tariffId),
            eq(accountingTariffs.schoolId, schoolId),
          )).returning();
          await addAudit(tx, actor, schoolId, 'archive', 'accounting_tariff', tariffId,
            'Accounting tariff archived.',
            createAuditSnapshot(tariff, ['classId', 'classFromId', 'classToId', 'categoryId', 'label', 'amount', 'isEnabled']),
            createAuditSnapshot(archived, ['classId', 'classFromId', 'classToId', 'categoryId', 'label', 'amount', 'isEnabled']));
          return { notFound: false as const, archived: true };
        }

        await tx.delete(accountingTariffs).where(and(
          eq(accountingTariffs.id, tariffId),
          eq(accountingTariffs.schoolId, schoolId),
        ));
        await addAudit(tx, actor, schoolId, 'delete', 'accounting_tariff', tariffId,
          'Unused accounting tariff deleted.',
          createAuditSnapshot(tariff, ['classId', 'classFromId', 'classToId', 'categoryId', 'label', 'amount', 'isEnabled']));
        return { notFound: false as const, archived: false };
      });

      if (result.notFound) return res.status(404).json({ error: 'Tariff not found' });
      return res.json({ success: true, archived: result.archived });
    } catch (error) {
      if (typeof error === 'object' && error && 'code' in error && error.code === '23503') {
        try {
          const actor = await actorFor(req, res, 'configure');
          if (!actor) return;
          const schoolId = await getSchoolId(actor, req.query.schoolId, res);
          if (!schoolId) return;
          const tariffId = asPositiveInt(req.params.tariffId);
          if (!tariffId) return res.status(400).json({ error: 'Valid tariff id is required' });
          const archived = await db.transaction(async (tx) => {
            const [before] = await tx.select().from(accountingTariffs).where(and(
              eq(accountingTariffs.id, tariffId),
              eq(accountingTariffs.schoolId, schoolId),
            )).for('update');
            if (!before) return false;
            const [after] = await tx.update(accountingTariffs).set({
              isEnabled: false,
              updatedAt: new Date(),
            }).where(and(
              eq(accountingTariffs.id, tariffId),
              eq(accountingTariffs.schoolId, schoolId),
            )).returning();
            if (!after) return false;
            await addAudit(tx, actor, schoolId, 'archive', 'accounting_tariff', tariffId,
              'Tarif comptable archivé après conflit de référence.',
              createAuditSnapshot(before, ['classId', 'classFromId', 'classToId', 'categoryId', 'label', 'amount', 'isEnabled']),
              createAuditSnapshot(after, ['classId', 'classFromId', 'classToId', 'categoryId', 'label', 'amount', 'isEnabled']));
            return true;
          });
          if (!archived) return res.status(404).json({ error: 'Tariff not found' });
          return res.json({ success: true, archived: true });
        } catch (archiveError) {
          console.error('Failed to archive accounting tariff after reference conflict:', archiveError);
          return res.status(500).json({ error: 'Failed to archive accounting tariff' });
        }
      }
      console.error('Failed to delete accounting tariff:', error);
      return res.status(500).json({ error: 'Failed to delete accounting tariff' });
    }
  });

  app.post('/api/accounting/tariffs', async (req, res) => {
    try {
      const actor = await actorFor(req, res, 'configure');
      if (!actor) return;
      const schoolId = await getSchoolId(actor, req.body?.schoolId, res);
      if (!schoolId) return;
      const classId = asPositiveInt(req.body?.classId);
      const classFromId = asPositiveInt(req.body?.classFromId);
      const classToId = asPositiveInt(req.body?.classToId);
      const academicYearId = asPositiveInt(req.body?.academicYearId);
      const label = typeof req.body?.label === 'string' ? req.body.label.trim() : '';
      const categoryId = req.body?.categoryId == null ? null : asPositiveInt(req.body.categoryId);
      const amount = asMoney(req.body?.amount);
      const usesLabel = Boolean(label);
      const isRange = classFromId != null || classToId != null;
      if ((!isRange && !classId) || (isRange && (classId != null || !classFromId || !classToId))
        || !academicYearId || !amount
        || (usesLabel && label.length > 120)
        || (usesLabel === Boolean(categoryId))
        || (req.body?.categoryId != null && !categoryId)) {
        return res.status(400).json({ error: 'Invalid tariff values' });
      }
      if (usesLabel && isStandardAccountingCategoryLabel(label)) {
        return res.status(409).json({ error: 'Select the standard fee type instead of creating a duplicate category' });
      }
      const classContext = !isRange && classId
        ? await validateClassAndYear(schoolId, classId, academicYearId)
        : null;
      const rangeContexts = isRange
        ? await Promise.all([
          validateClassAndYear(schoolId, classFromId!, academicYearId),
          validateClassAndYear(schoolId, classToId!, academicYearId),
        ])
        : [];
      if ((!isRange && !classContext) || (isRange && rangeContexts.some((context) => !context))) {
        return res.status(400).json({ error: 'Class and academic year are not valid for this school' });
      }
      let rangeOrder: { start: AccountingClassOrder; end: AccountingClassOrder } | null = null;
      if (isRange) {
        const rows = await db.select({
          classId: classes.id,
          className: classes.name,
          levelOrder: levels.orderIndex,
        }).from(classes).innerJoin(levels, eq(levels.id, classes.levelId))
          .where(inArray(classes.id, [classFromId!, classToId!]));
        const orderByClassId = new Map<number, AccountingClassOrder>(rows.map((row) => [row.classId, {
          classId: row.classId,
          className: row.className,
          levelOrder: row.levelOrder,
        }]));
        const start = orderByClassId.get(classFromId!);
        const end = orderByClassId.get(classToId!);
        if (!start || !end || compareAccountingClassOrder(start, end) > 0) {
          return res.status(400).json({ error: 'Class range must follow the pedagogical order' });
        }
        rangeOrder = { start, end };
      }
      const saved = await db.transaction(async (tx) => {
        const category = usesLabel
          ? await getOrCreateAccountingCategory(tx, schoolId, label, actor)
          : (await tx.select().from(accountingCategories).where(and(
            eq(accountingCategories.id, categoryId!),
            eq(accountingCategories.schoolId, schoolId),
            eq(accountingCategories.isEnabled, true),
          )))[0];
        if (!category) throw Object.assign(new Error('Accounting category is not enabled for this school'), { statusCode: 400 });
        const tariffLabel = usesLabel
          ? label
          : getAccountingCategoryDisplayLabel(category.code, category.label);
        if (isRange) {
          const configuredRanges = await tx.select({
            id: accountingTariffs.id,
            classFromId: accountingTariffs.classFromId,
            classToId: accountingTariffs.classToId,
          }).from(accountingTariffs).where(and(
            eq(accountingTariffs.schoolId, schoolId),
            eq(accountingTariffs.academicYearId, academicYearId),
            eq(accountingTariffs.categoryId, category.id),
            isNull(accountingTariffs.classId),
            eq(accountingTariffs.isEnabled, true),
          ));
          if (configuredRanges.length) {
            const rangeClassIds = [...new Set(configuredRanges.flatMap((tariff) =>
              [tariff.classFromId, tariff.classToId].filter((id): id is number => id != null)))];
            const rangeClassOrders = await tx.select({
              classId: classes.id,
              className: classes.name,
              levelOrder: levels.orderIndex,
            }).from(classes).innerJoin(levels, eq(levels.id, classes.levelId))
              .where(inArray(classes.id, rangeClassIds));
            const orders = new Map<number, AccountingClassOrder>(rangeClassOrders.map((row) => [row.classId, {
              classId: row.classId,
              className: row.className,
              levelOrder: row.levelOrder,
            }]));
            const overlaps = configuredRanges.some((tariff) => {
              const existingStart = tariff.classFromId == null ? undefined : orders.get(tariff.classFromId);
              const existingEnd = tariff.classToId == null ? undefined : orders.get(tariff.classToId);
              return existingStart != null && existingEnd != null
                && doAccountingClassRangesOverlap(rangeOrder!, { start: existingStart, end: existingEnd });
            });
            if (overlaps) {
              throw Object.assign(new Error('An enabled tariff range already overlaps these classes for this fee and year'), { statusCode: 409 });
            }
          }
          const [row] = await tx.insert(accountingTariffs).values({
            schoolId,
            academicYearId,
            classId: null,
            classFromId,
            classToId,
            categoryId: category.id,
            label: tariffLabel,
            amount,
            createdBy: actor.id ?? null,
          }).onConflictDoNothing().returning();
          if (!row) {
            return { duplicate: true as const, row: null };
          }
          const afterSnapshot = createAuditSnapshot(row, [
            'academicYearId', 'classFromId', 'classToId', 'categoryId', 'label', 'amount', 'isEnabled',
          ]);
          await addAudit(tx, actor, schoolId, 'create', 'accounting_tariff', row.id,
            'Accounting tariff range created.',
            null,
            afterSnapshot);
          return { duplicate: false as const, row };
        }
        if (usesLabel) {
          const scopedTariffs = await tx.select({
            id: accountingTariffs.id,
            label: accountingTariffs.label,
          }).from(accountingTariffs).where(and(
            eq(accountingTariffs.schoolId, schoolId),
            eq(accountingTariffs.academicYearId, academicYearId),
            eq(accountingTariffs.classId, classId),
          ));
          if (scopedTariffs.some((tariff) => normalizeAccountingLabel(tariff.label) === normalizeAccountingLabel(label))) {
            return { duplicate: true as const, row: null };
          }
          const [row] = await tx.insert(accountingTariffs).values({
            schoolId,
            academicYearId,
            classId,
            categoryId: category.id,
            label,
            amount,
            createdBy: actor.id ?? null,
          }).onConflictDoNothing().returning();
          if (!row) {
            return { duplicate: true as const, row: null };
          }
          const afterSnapshot = createAuditSnapshot(row, [
            'academicYearId', 'classId', 'categoryId', 'label', 'amount', 'isEnabled',
          ]);
          await addAudit(tx, actor, schoolId, 'create', 'accounting_tariff', row.id,
            'Accounting tariff created.',
            null,
            afterSnapshot);
          return { duplicate: false as const, row };
        }

        const [before] = await tx.select().from(accountingTariffs).where(and(
          eq(accountingTariffs.schoolId, schoolId),
          eq(accountingTariffs.academicYearId, academicYearId),
          eq(accountingTariffs.classId, classId),
          eq(accountingTariffs.categoryId, category.id),
        )).for('update');
        const [row] = await tx.insert(accountingTariffs).values({
          schoolId,
          academicYearId,
          classId,
          categoryId: category.id,
          label: tariffLabel,
          amount,
          createdBy: actor.id ?? null,
        }).onConflictDoUpdate({
          target: [accountingTariffs.schoolId, accountingTariffs.academicYearId, accountingTariffs.classId, accountingTariffs.categoryId],
          set: { label: tariffLabel, amount, isEnabled: true, updatedAt: new Date(), createdBy: actor.id ?? null },
        }).returning();
        const beforeSnapshot = createAuditSnapshot(before, ['classId', 'categoryId', 'label', 'amount', 'isEnabled']);
        const afterSnapshot = createAuditSnapshot(row, ['classId', 'categoryId', 'label', 'amount', 'isEnabled']);
        await addAudit(tx, actor, schoolId, 'upsert', 'accounting_tariff', row.id, 'Accounting tariff saved.',
          beforeSnapshot,
          afterSnapshot);
        return { duplicate: false as const, row };
      });
      if (saved.duplicate) return res.status(409).json({ error: 'A fee with this label is already configured for this class or range and school year. Use Modify instead.' });
      return res.status(201).json(saved.row);
    } catch (error) {
      if (typeof error === 'object' && error && 'code' in error && error.code === '23505') {
        return res.status(409).json({ error: 'A fee with this label is already configured for this class and school year. Use Modify instead.' });
      }
      if (typeof error === 'object' && error && 'statusCode' in error) {
        const statusCode = Number(error.statusCode);
        if ([400, 409].includes(statusCode)) return res.status(statusCode).json({ error: (error as Error).message });
      }
      console.error('Failed to save accounting tariff.');
      return res.status(500).json({ error: 'Failed to save accounting tariff' });
    }
  });

  app.put('/api/accounting/tariffs/:id', async (req, res) => {
    try {
      const actor = await actorFor(req, res, 'configure');
      if (!actor) return;
      const schoolId = await getSchoolId(actor, req.body?.schoolId, res);
      if (!schoolId) return;
      const tariffId = asPositiveInt(req.params.id);
      const academicYearId = asPositiveInt(req.body?.academicYearId);
      const classId = asPositiveInt(req.body?.classId);
      const classFromId = asPositiveInt(req.body?.classFromId);
      const classToId = asPositiveInt(req.body?.classToId);
      const isRange = classFromId != null || classToId != null;
      const amount = asMoney(req.body?.amount);
      const label = req.body?.label == null ? null : (typeof req.body.label === 'string' ? req.body.label.trim() : '');
      if (!tariffId || !academicYearId || (isRange
        ? classId != null || !classFromId || !classToId
        : !classId) || !amount || label == null || !label || label.length > 120) {
        return res.status(400).json({ error: 'Invalid tariff values' });
      }
      const contexts = isRange
        ? await Promise.all([
          validateClassAndYear(schoolId, classFromId!, academicYearId),
          validateClassAndYear(schoolId, classToId!, academicYearId),
        ])
        : [await validateClassAndYear(schoolId, classId!, academicYearId)];
      if (contexts.some((context) => !context)) {
        return res.status(400).json({ error: 'Class and academic year are not valid for this school' });
      }
      let rangeOrder: { start: AccountingClassOrder; end: AccountingClassOrder } | null = null;
      if (isRange) {
        const rows = await db.select({
          classId: classes.id,
          className: classes.name,
          levelOrder: levels.orderIndex,
        }).from(classes).innerJoin(levels, eq(levels.id, classes.levelId))
          .where(inArray(classes.id, [classFromId!, classToId!]));
        const orders = new Map<number, AccountingClassOrder>(rows.map((row) => [row.classId, {
          classId: row.classId,
          className: row.className,
          levelOrder: row.levelOrder,
        }]));
        const start = orders.get(classFromId!);
        const end = orders.get(classToId!);
        if (!start || !end || compareAccountingClassOrder(start, end) > 0) {
          return res.status(400).json({ error: 'Class range must follow the pedagogical order' });
        }
        rangeOrder = { start, end };
      }
      const [updated] = await db.transaction(async (tx) => {
        const [current] = await tx.select().from(accountingTariffs).where(and(
          eq(accountingTariffs.id, tariffId),
          eq(accountingTariffs.schoolId, schoolId),
        ));
        if (!current) return [null];
        if (current.academicYearId !== academicYearId) {
          throw Object.assign(new Error('The selected school year does not match this fee'), { statusCode: 400 });
        }

        const [category] = await tx.select().from(accountingCategories).where(and(
          eq(accountingCategories.id, current.categoryId),
          eq(accountingCategories.schoolId, schoolId),
        ));
        if (!category) throw Object.assign(new Error('Accounting category not found'), { statusCode: 404 });
        if (category.code !== 'tuition' && category.code !== 'enrollment'
          && isStandardAccountingCategoryLabel(label)
          && !isStandardAccountingCategoryLabel(current.label)) {
          throw Object.assign(new Error('Select the standard fee type instead of using its label for a custom fee'), { statusCode: 409 });
        }
        const tariffLabel = getAccountingCategoryDisplayLabel(category.code, label);
        if (isRange) {
          const otherRanges = await tx.select({
            id: accountingTariffs.id,
            classFromId: accountingTariffs.classFromId,
            classToId: accountingTariffs.classToId,
          }).from(accountingTariffs).where(and(
            eq(accountingTariffs.schoolId, schoolId),
            eq(accountingTariffs.academicYearId, academicYearId),
            eq(accountingTariffs.categoryId, current.categoryId),
            isNull(accountingTariffs.classId),
            eq(accountingTariffs.isEnabled, true),
          ));
          const rangeIds = [...new Set(otherRanges
            .filter((range) => range.id !== tariffId)
            .flatMap((range) => [range.classFromId, range.classToId]
              .filter((id): id is number => id != null)))];
          const rows = rangeIds.length
            ? await tx.select({
              classId: classes.id,
              className: classes.name,
              levelOrder: levels.orderIndex,
            }).from(classes).innerJoin(levels, eq(levels.id, classes.levelId))
              .where(inArray(classes.id, rangeIds))
            : [];
          const orders = new Map<number, AccountingClassOrder>(rows.map((row) => [row.classId, {
            classId: row.classId,
            className: row.className,
            levelOrder: row.levelOrder,
          }]));
          const overlaps = otherRanges.some((range) => {
            if (range.id === tariffId || range.classFromId == null || range.classToId == null) return false;
            const existingStart = orders.get(range.classFromId);
            const existingEnd = orders.get(range.classToId);
            return existingStart != null && existingEnd != null
              && doAccountingClassRangesOverlap(rangeOrder!, { start: existingStart, end: existingEnd });
          });
          if (overlaps) {
            throw Object.assign(new Error('An enabled tariff range already overlaps these classes for this fee and year'), { statusCode: 409 });
          }
        } else if (category.code !== 'tuition' && category.code !== 'enrollment') {
          const targetTariffs = await tx.select({
            id: accountingTariffs.id,
            label: accountingTariffs.label,
          }).from(accountingTariffs).where(and(
            eq(accountingTariffs.schoolId, schoolId),
            eq(accountingTariffs.academicYearId, academicYearId),
            eq(accountingTariffs.classId, classId!),
          ));
          const duplicate = targetTariffs.find((tariff) => tariff.id !== tariffId
            && normalizeAccountingLabel(tariff.label) === normalizeAccountingLabel(tariffLabel));
          if (duplicate) {
            throw Object.assign(new Error('Un frais avec ce libellé existe déjà pour cette classe et cette année scolaire.'), { statusCode: 409 });
          }
        }
        const [before] = await tx.select().from(accountingTariffs).where(and(
          eq(accountingTariffs.id, tariffId),
          eq(accountingTariffs.schoolId, schoolId),
        )).for('update');
        const [row] = await tx.update(accountingTariffs).set({
          classId: isRange ? null : classId,
          classFromId: isRange ? classFromId : null,
          classToId: isRange ? classToId : null,
          label: tariffLabel,
          amount,
          isEnabled: true,
          updatedAt: new Date(),
          createdBy: actor.id ?? null,
        }).where(and(
          eq(accountingTariffs.id, tariffId),
          eq(accountingTariffs.schoolId, schoolId),
        )).returning();
        if (row) await addAudit(tx, actor, schoolId, 'update', 'accounting_tariff', row.id,
          'Accounting tariff updated.',
          createAuditSnapshot(before, [
            'academicYearId', 'classId', 'classFromId', 'classToId', 'categoryId', 'label', 'amount', 'isEnabled',
          ]),
          createAuditSnapshot(row, [
            'academicYearId', 'classId', 'classFromId', 'classToId', 'categoryId', 'label', 'amount', 'isEnabled',
          ]));
        return [row];
      });
      if (!updated) return res.status(404).json({ error: 'Tariff not found' });
      return res.json(updated);
    } catch (error) {
      if (typeof error === 'object' && error && 'statusCode' in error) {
        const statusCode = Number(error.statusCode);
        if ([400, 404, 409].includes(statusCode)) return res.status(statusCode).json({ error: (error as Error).message });
      }
      if (typeof error === 'object' && error && 'code' in error && error.code === '23505') {
        return res.status(409).json({ error: 'Another fee already uses this label for this school' });
      }
      console.error('Failed to update accounting tariff:', error);
      return res.status(500).json({ error: 'Failed to update accounting tariff' });
    }
  });

  app.get('/api/accounting/schedules', async (req, res) => {
    try {
      const actor = await actorFor(req, res);
      if (!actor) return;
      const schoolId = await getSchoolId(actor, req.query.schoolId, res);
      if (!schoolId) return;
      const classId = asPositiveInt(req.query.classId);
      const academicYearId = asPositiveInt(req.query.academicYearId);
      const categoryId = asPositiveInt(req.query.categoryId);
      if (!classId || !academicYearId || !categoryId) {
        return res.status(400).json({ error: 'Select a school year, class, and fee category' });
      }
      if (!await validateClassAndYear(schoolId, classId, academicYearId)) {
        return res.status(400).json({ error: 'Class and academic year are not valid for this school' });
      }
      const [category] = await db.select({ id: accountingCategories.id }).from(accountingCategories).where(and(
        eq(accountingCategories.id, categoryId),
        eq(accountingCategories.schoolId, schoolId),
        eq(accountingCategories.isEnabled, true),
      ));
      if (!category) return res.status(400).json({ error: 'Accounting category is not enabled for this school' });
      const [schedule] = await db.select().from(accountingScheduleTemplates).where(and(
        eq(accountingScheduleTemplates.schoolId, schoolId),
        eq(accountingScheduleTemplates.academicYearId, academicYearId),
        eq(accountingScheduleTemplates.classId, classId),
        eq(accountingScheduleTemplates.categoryId, categoryId),
      ));
      return res.json(schedule ?? null);
    } catch (error) {
      console.error('Failed to load accounting schedule:', error);
      return res.status(500).json({ error: 'Failed to load accounting schedule' });
    }
  });

  app.put('/api/accounting/schedules', async (req, res) => {
    try {
      const actor = await actorFor(req, res, 'configure');
      if (!actor) return;
      const schoolId = await getSchoolId(actor, req.body?.schoolId, res);
      if (!schoolId) return;
      const classId = asPositiveInt(req.body?.classId);
      const academicYearId = asPositiveInt(req.body?.academicYearId);
      const categoryId = asPositiveInt(req.body?.categoryId);
      const periodType = String(req.body?.periodType ?? '');
      const installments = validateAccountingSchedule(req.body?.installments);
      if (!classId || !academicYearId || !categoryId || !['annual', 'trimester', 'semester'].includes(periodType) || !installments) {
        return res.status(400).json({ error: 'Invalid schedule template; installment basis points must total 10000' });
      }
      if (!await validateClassAndYear(schoolId, classId, academicYearId)) {
        return res.status(400).json({ error: 'Class and academic year are not valid for this school' });
      }
      const [category] = await db.select({
        id: accountingCategories.id,
        code: accountingCategories.code,
      }).from(accountingCategories).where(and(
        eq(accountingCategories.id, categoryId),
        eq(accountingCategories.schoolId, schoolId),
        eq(accountingCategories.isEnabled, true),
      ));
      if (!category) return res.status(400).json({ error: 'Accounting category is not enabled for this school' });
      if ('amount' in installments[0]) {
        if (category.code !== 'tuition') {
          return res.status(400).json({ error: 'Fixed installment amounts are only available for tuition' });
        }
        const applicableTuitionTariffs = await getApplicableTariffs(db, {
          schoolId,
          academicYearId,
          classId,
          categoryId,
        });
        if (applicableTuitionTariffs.length !== 1
          || !validateAccountingSchedule(req.body?.installments, applicableTuitionTariffs[0]?.amount)) {
          return res.status(400).json({
            error: applicableTuitionTariffs.length === 1
              ? 'Installment amounts must total the configured annual tuition tariff'
              : 'A single unambiguous tuition tariff is required before configuring fixed installment amounts',
          });
        }
      }
      const saved = await db.transaction(async (tx) => {
        const [before] = await tx.select().from(accountingScheduleTemplates).where(and(
          eq(accountingScheduleTemplates.schoolId, schoolId),
          eq(accountingScheduleTemplates.academicYearId, academicYearId),
          eq(accountingScheduleTemplates.classId, classId),
          eq(accountingScheduleTemplates.categoryId, categoryId),
        )).for('update');
        const [row] = await tx.insert(accountingScheduleTemplates).values({
          schoolId, academicYearId, classId, categoryId, periodType, installments, createdBy: actor.id ?? null,
        }).onConflictDoUpdate({
          target: [
            accountingScheduleTemplates.schoolId,
            accountingScheduleTemplates.academicYearId,
            accountingScheduleTemplates.classId,
            accountingScheduleTemplates.categoryId,
          ],
          set: { periodType, installments, updatedAt: new Date(), createdBy: actor.id ?? null },
        }).returning();
        await addAudit(tx, actor, schoolId, 'upsert', 'accounting_schedule', row.id, 'Accounting schedule saved.',
          createAuditSnapshot({
            periodType: before?.periodType ?? null,
            installmentCount: Array.isArray(before?.installments) ? before.installments.length : null,
            installments: before?.installments == null ? null : JSON.stringify(before.installments),
          }, ['periodType', 'installmentCount', 'installments']),
          createAuditSnapshot({
            periodType: row.periodType,
            installmentCount: Array.isArray(row.installments) ? row.installments.length : null,
            installments: row.installments == null ? null : JSON.stringify(row.installments),
          }, ['periodType', 'installmentCount', 'installments']));
        return row;
      });
      return res.json(saved);
    } catch (error) {
      console.error('Failed to save accounting schedule:', error);
      return res.status(500).json({ error: 'Failed to save accounting schedule' });
    }
  });

  app.post('/api/accounting/fees', async (req, res) => {
    try {
      const actor = await actorFor(req, res, 'configure');
      if (!actor) return;
      const schoolId = await getSchoolId(actor, req.body?.schoolId, res);
      if (!schoolId) return;
      const academicYearId = asPositiveInt(req.body?.academicYearId);
      const categoryId = asPositiveInt(req.body?.categoryId);
      const classId = req.body?.classId == null || req.body.classId === '' ? null : asPositiveInt(req.body.classId);
      const studentId = req.body?.studentId == null || req.body.studentId === '' ? null : asPositiveInt(req.body.studentId);
      const amount = asMoney(req.body?.amount);
      const label = typeof req.body?.label === 'string' ? req.body.label.trim() : '';
      if (!academicYearId || !categoryId || !amount || !label || label.length > 120
        || (req.body?.classId && !classId) || (req.body?.studentId && !studentId)) {
        return res.status(400).json({ error: 'Invalid custom fee values' });
      }
      const dueDate = req.body?.dueDate == null || req.body.dueDate === '' ? null : asDate(req.body.dueDate);
      if (req.body?.dueDate && !dueDate) return res.status(400).json({ error: 'Invalid due date' });
      const [year] = await db.select().from(academicYears).where(and(
        eq(academicYears.id, academicYearId),
      ));
      const [category] = await db.select().from(accountingCategories).where(and(
        eq(accountingCategories.id, categoryId),
        eq(accountingCategories.schoolId, schoolId),
        eq(accountingCategories.isEnabled, true),
      ));
      if (!year || (year.schoolId != null && year.schoolId !== schoolId) || !category) {
        return res.status(400).json({ error: 'Invalid school year or category' });
      }
      if (classId && !await validateClassAndYear(schoolId, classId, academicYearId)) {
        return res.status(400).json({ error: 'Class is not valid for this school year' });
      }
      if (studentId) {
        const [student] = await db.select().from(students).where(and(
          eq(students.id, studentId),
          eq(students.schoolId, schoolId),
          eq(students.isActive, true),
        ));
        if (!student || !student.classId || (classId != null && student.classId !== classId)
          || !await validateClassAndYear(schoolId, student.classId, academicYearId)) {
          return res.status(400).json({ error: 'Student is not valid for this school and academic year' });
        }
      }
      const [fee] = await db.transaction(async (tx) => {
        const [row] = await tx.insert(accountingFeeDefinitions).values({
          schoolId,
          academicYearId,
          studentId,
          categoryId,
          classId,
          label,
          description: typeof req.body?.description === 'string' ? req.body.description.trim() || null : null,
          amount,
          isMandatory: req.body?.isMandatory === true,
          dueDate,
          status: 'pending',
          proposedBy: actor.id ?? null,
        }).returning();
        await addAudit(tx, actor, schoolId, 'create', 'accounting_fee_definition', row.id, 'Custom fee proposed.',
          null,
          createAuditSnapshot(row, [
            'academicYearId', 'studentId', 'classId', 'categoryId', 'label', 'amount',
            'isMandatory', 'dueDate', 'status',
          ]));
        return [row];
      });
      return res.status(201).json(fee);
    } catch (error) {
      console.error('Failed to create custom fee:', error);
      return res.status(500).json({ error: 'Failed to create custom fee' });
    }
  });

  app.get('/api/accounting/fees', async (req, res) => {
    try {
      const actor = await actorFor(req, res);
      if (!actor) return;
      const schoolId = await getSchoolId(actor, req.query.schoolId, res);
      if (!schoolId) return;
      return res.json(await db.select().from(accountingFeeDefinitions)
        .where(eq(accountingFeeDefinitions.schoolId, schoolId))
        .orderBy(desc(accountingFeeDefinitions.createdAt)));
    } catch (error) {
      console.error('Failed to load custom accounting fees:', error);
      return res.status(500).json({ error: 'Failed to load custom accounting fees' });
    }
  });

  app.put('/api/accounting/fees/:id/status', async (req, res) => {
    try {
      const actor = await actorFor(req, res, 'configure');
      if (!actor) return;
      const schoolId = await getSchoolId(actor, req.body?.schoolId, res);
      if (!schoolId) return;
      const feeId = asPositiveInt(req.params.id);
      const status = req.body?.status;
      if (!feeId || !['active', 'rejected'].includes(status)) {
        return res.status(400).json({ error: 'Invalid fee status update' });
      }
      const updated = await db.transaction(async (tx) => {
        const [before] = await tx.select().from(accountingFeeDefinitions).where(and(
          eq(accountingFeeDefinitions.id, feeId),
          eq(accountingFeeDefinitions.schoolId, schoolId),
          eq(accountingFeeDefinitions.status, 'pending'),
        )).for('update');
        if (!before) return null;
        const [fee] = await tx.update(accountingFeeDefinitions).set({
          status,
          validatedBy: actor.id ?? null,
          validatedAt: new Date(),
          updatedAt: new Date(),
        }).where(eq(accountingFeeDefinitions.id, feeId)).returning();
        if (fee) await addAudit(
          tx, actor, schoolId, status === 'active' ? 'approve' : 'reject',
          'accounting_fee_definition', fee.id, 'Custom fee status updated.',
          createAuditSnapshot(before, ['status']),
          createAuditSnapshot(fee, ['status']),
        );
        return fee ?? null;
      });
      if (!updated) return res.status(409).json({ error: 'Fee not found or no longer pending' });
      return res.json(updated);
    } catch (error) {
      console.error('Failed to update custom accounting fee:', error);
      return res.status(500).json({ error: 'Failed to update custom accounting fee' });
    }
  });

  app.post('/api/accounting/obligations', async (req, res) => {
    try {
      const actor = await actorFor(req, res, 'generate_obligations');
      if (!actor) return;
      const schoolId = await getSchoolId(actor, req.body?.schoolId, res);
      if (!schoolId) return;
      const studentId = asPositiveInt(req.body?.studentId);
      const academicYearId = asPositiveInt(req.body?.academicYearId);
      const tariffId = req.body?.tariffId == null ? null : asPositiveInt(req.body.tariffId);
      const feeDefinitionId = req.body?.feeDefinitionId == null ? null : asPositiveInt(req.body.feeDefinitionId);
      const enrollmentKind = req.body?.enrollmentKind == null ? null : String(req.body.enrollmentKind);
      const initialTuitionInput = parseInitialTuitionInput(req.body ?? {});
      if (!studentId || !academicYearId || (Boolean(tariffId) === Boolean(feeDefinitionId))) {
        return res.status(400).json({ error: 'Provide a student, academic year, and exactly one tariff or validated fee' });
      }
      if (enrollmentKind != null && !isAccountingEnrollmentKind(enrollmentKind)) {
        return res.status(400).json({ error: 'Invalid enrollment kind' });
      }
      const [student] = await db.select().from(students).where(and(
        eq(students.id, studentId),
        eq(students.schoolId, schoolId),
        eq(students.isActive, true),
      ));
      if (!student || !student.classId) return res.status(404).json({ error: 'Active student with a class not found in this school' });
      if (!await validateClassAndYear(schoolId, student.classId, academicYearId)) {
        return res.status(400).json({ error: 'Student class is not part of the selected school year' });
      }

      let tariff: typeof accountingTariffs.$inferSelect | null = null;
      let fee: typeof accountingFeeDefinitions.$inferSelect | null = null;
      let category: typeof accountingCategories.$inferSelect | null = null;
      if (tariffId) {
        [tariff] = await getApplicableTariffs(db, {
          schoolId,
          academicYearId,
          classId: student.classId,
          tariffId,
        });
        if (tariff) [category] = await db.select().from(accountingCategories).where(and(
          eq(accountingCategories.id, tariff.categoryId),
          eq(accountingCategories.schoolId, schoolId),
          eq(accountingCategories.isEnabled, true),
        ));
      } else if (feeDefinitionId) {
        [fee] = await db.select().from(accountingFeeDefinitions).where(and(
          eq(accountingFeeDefinitions.id, feeDefinitionId),
          eq(accountingFeeDefinitions.schoolId, schoolId),
          eq(accountingFeeDefinitions.academicYearId, academicYearId),
          eq(accountingFeeDefinitions.status, 'active'),
          or(
            isNull(accountingFeeDefinitions.studentId),
            eq(accountingFeeDefinitions.studentId, studentId),
          ),
        ));
        if (fee && (fee.classId == null || fee.classId === student.classId)) {
          [category] = await db.select().from(accountingCategories).where(and(
            eq(accountingCategories.id, fee.categoryId),
            eq(accountingCategories.schoolId, schoolId),
            eq(accountingCategories.isEnabled, true),
          ));
        }
      }
      if ((!tariff && !fee) || !category) {
        return res.status(400).json({ error: 'Tariff or fee is unavailable, inactive, or unvalidated' });
      }
      if (initialTuitionInput.amount != null && (!tariff || category.code !== 'tuition')) {
        return res.status(400).json({ error: 'An individualized initial amount is only available for tuition tariffs' });
      }
      if (category.code === 'enrollment' && enrollmentKind == null) {
        return res.status(400).json({ error: 'enrollmentKind must explicitly distinguish first enrollment, re-enrollment, or ordinary enrollment' });
      }
      const referenceAmount = tariff?.amount ?? fee!.amount;
      const label = fee?.label ?? tariff?.label ?? category.label;
      const sourceKey = tariff
        ? `tariff-${tariff.id}-student-${studentId}`
        : `fee-${fee!.id}-student-${studentId}`;

      const context = await validateClassAndYear(schoolId, student.classId, academicYearId);
      if (!context) return res.status(400).json({ error: 'Class and academic year are not valid for this school' });
      const result = await db.transaction(async (tx) => {
        await tx.execute(sql`SELECT id FROM academic_years WHERE id = ${academicYearId} FOR UPDATE`);
        if (tariff) {
          if (category!.code === 'tuition' && initialTuitionInput.amount != null) {
            const [priorTuitionObligation] = await tx.select({
              id: financialObligations.id,
            }).from(financialObligations).where(and(
              eq(financialObligations.schoolId, schoolId),
              eq(financialObligations.studentId, studentId),
              eq(financialObligations.academicYearId, academicYearId),
              eq(financialObligations.categoryId, category!.id),
            ));
            if (priorTuitionObligation) {
              throw Object.assign(new Error('Initial tuition can only be individualized before any tuition obligation has been constituted'), { statusCode: 409 });
            }
          }
          const existingInScope = await tx.select({
            id: financialObligations.id,
            classId: financialObligations.classId,
            tariffId: financialObligations.tariffId,
            feeDefinitionId: financialObligations.feeDefinitionId,
            enrollmentKind: financialObligations.enrollmentKind,
          }).from(financialObligations).where(and(
            eq(financialObligations.schoolId, schoolId),
            eq(financialObligations.studentId, studentId),
            eq(financialObligations.academicYearId, academicYearId),
            eq(financialObligations.categoryId, category!.id),
            eq(financialObligations.status, 'active'),
          ));
          const equivalent = findEquivalentTariffObligation(existingInScope, {
            classId: student.classId!,
            enrollmentKind,
          });
          if (category!.code === 'tuition') {
            const existingTuition = findExistingTuitionObligation(existingInScope);
            if (existingTuition) {
              if (initialTuitionInput.amount != null) {
                throw Object.assign(new Error('An existing tuition obligation cannot be individualized or replaced'), { statusCode: 409 });
              }
              return { obligation: existingTuition, created: false };
            }
          }
          if (equivalent) return { obligation: equivalent, created: false };
        }
        const [existingSource] = await tx.select().from(financialObligations).where(and(
          eq(financialObligations.schoolId, schoolId),
          eq(financialObligations.sourceKey, sourceKey),
        ));
        if (existingSource) {
          if (existingSource.status === 'active' && tariff
            && (existingSource.classId !== student.classId
              || existingSource.categoryId !== category!.id
              || existingSource.feeDefinitionId != null
              || existingSource.enrollmentKind !== enrollmentKind)) {
            throw Object.assign(new Error('The configured charge already exists for a different class or fee nature'), { statusCode: 409 });
          }
          if (initialTuitionInput.amount != null) {
            throw Object.assign(new Error('An existing obligation cannot be individualized or replaced'), { statusCode: 409 });
          }
          return { obligation: existingSource, created: false };
        }
        const initialTerms = tariff
          ? resolveInitialTuitionAmount(
            category!.code,
            referenceAmount,
            initialTuitionInput.amount,
            initialTuitionInput.justification,
          )
          : { amount: referenceAmount, individualized: false };
        const amount = initialTerms.amount;
        let planned: Array<{ label: string; dueDate: string; amount: number; orderIndex: number }>;
        if (category!.code === 'tuition') {
          const [scheduleRow] = await tx.select().from(accountingScheduleTemplates).where(and(
            eq(accountingScheduleTemplates.schoolId, schoolId),
            eq(accountingScheduleTemplates.academicYearId, academicYearId),
            eq(accountingScheduleTemplates.classId, student.classId),
            eq(accountingScheduleTemplates.categoryId, category!.id),
          ));
          const schedule = validateAccountingSchedule(scheduleRow?.installments);
          if (!schedule) {
            throw Object.assign(new Error('Configure a valid installment schedule before creating a tuition obligation'), { statusCode: 409 });
          }
          const split = splitAmountBySchedule(amount, schedule);
          if (!split) throw Object.assign(new Error('Invalid tuition schedule amounts'), { statusCode: 400 });
          planned = split;
        } else {
          const dueDate = fee?.dueDate || asDate(req.body?.dueDate) || todayUtc();
          planned = [{ label, dueDate, amount, orderIndex: 1 }];
        }
        const [created] = await tx.insert(financialObligations).values({
          schoolId,
          studentId,
          academicYearId,
          classId: student.classId!,
          categoryId: category!.id,
          tariffId: tariff?.id ?? null,
          feeDefinitionId: fee?.id ?? null,
          label,
          amount,
          currency: 'XOF',
          classNameSnapshot: context.classRow.name,
          enrollmentKind,
          sourceKey,
          createdBy: actor.id ?? null,
        }).onConflictDoNothing().returning();
        if (!created) {
          const [duplicate] = await tx.select().from(financialObligations).where(and(
            eq(financialObligations.schoolId, schoolId),
            eq(financialObligations.sourceKey, sourceKey),
          ));
          if (duplicate?.status === 'active' && tariff
            && duplicate.classId !== student.classId) {
            throw Object.assign(new Error('The configured charge already exists for a different class or fee nature'), { statusCode: 409 });
          }
          return { obligation: duplicate, created: false };
        }
        await tx.insert(financialInstallments).values(planned.map((item) => ({
          obligationId: created.id,
          label: item.label,
          orderIndex: item.orderIndex,
          amount: item.amount,
          dueDate: item.dueDate,
        })));
        await addAudit(
          tx,
          actor,
          schoolId,
          'create',
          'financial_obligation',
          created.id,
          'Financial obligation created.',
          null,
          createAuditSnapshot(created, [
            'studentId', 'academicYearId', 'classId', 'categoryId', 'tariffId', 'feeDefinitionId',
            'label', 'amount', 'currency', 'classNameSnapshot', 'enrollmentKind', 'status',
          ]),
        );
        return { obligation: created, created: true };
      });
      if (!result.obligation) {
        return res.status(409).json({ error: 'The configured charge could not be created for this payment' });
      }
      return res.status(result.created ? 201 : 200).json(result.obligation);
    } catch (error) {
      const statusCode = typeof error === 'object' && error && 'statusCode' in error ? Number(error.statusCode) : 500;
      if (statusCode !== 500) {
        return res.status(statusCode).json({ error: (error as Error).message });
      }
      console.error('Failed to create financial obligation:', error);
      return res.status(500).json({ error: 'Failed to create financial obligation' });
    }
  });

  app.get('/api/accounting/obligations', async (req, res) => {
    try {
      const actor = await actorFor(req, res);
      if (!actor) return;
      const schoolId = await getSchoolId(actor, req.query.schoolId, res);
      if (!schoolId) return;
      const conditions = [eq(financialObligations.schoolId, schoolId)];
      const studentId = req.query.studentId == null ? null : asPositiveInt(req.query.studentId);
      const yearId = req.query.academicYearId == null ? null : asPositiveInt(req.query.academicYearId);
      if (req.query.studentId != null && !studentId) return res.status(400).json({ error: 'Invalid studentId' });
      if (req.query.academicYearId != null && !yearId) return res.status(400).json({ error: 'Invalid academicYearId' });
      if (studentId) conditions.push(eq(financialObligations.studentId, studentId));
      if (yearId) conditions.push(eq(financialObligations.academicYearId, yearId));
      const rows = await db.select({
        id: financialObligations.id,
        schoolId: financialObligations.schoolId,
        studentId: financialObligations.studentId,
        studentName: sql<string>`${students.firstName} || ' ' || ${students.lastName}`,
        academicYearId: financialObligations.academicYearId,
        classId: financialObligations.classId,
        className: financialObligations.classNameSnapshot,
        categoryId: financialObligations.categoryId,
        categoryCode: accountingCategories.code,
        categoryLabel: sql<string>`COALESCE(${accountingTariffs.label}, ${accountingCategories.label})`,
        label: financialObligations.label,
        amount: financialObligations.amount,
        currency: financialObligations.currency,
        status: financialObligations.status,
        createdAt: financialObligations.createdAt,
      }).from(financialObligations)
        .innerJoin(students, eq(students.id, financialObligations.studentId))
        .innerJoin(accountingCategories, eq(accountingCategories.id, financialObligations.categoryId))
        .leftJoin(accountingTariffs, eq(accountingTariffs.id, financialObligations.tariffId))
        .where(and(...conditions))
        .orderBy(desc(financialObligations.createdAt));
      return res.json(rows);
    } catch (error) {
      console.error('Failed to load financial obligations:', error);
      return res.status(500).json({ error: 'Failed to load financial obligations' });
    }
  });

  app.get('/api/accounting/situation', async (req, res) => {
    try {
      const actor = await actorFor(req, res);
      if (!actor) return;
      const schoolId = await getSchoolId(actor, req.query.schoolId, res);
      if (!schoolId) return;
      const academicYearId = asPositiveInt(req.query.academicYearId);
      const categoryId = req.query.categoryId == null ? null : asPositiveInt(req.query.categoryId);
      const rawTariffIds = req.query.tariffId == null
        ? []
        : Array.isArray(req.query.tariffId) ? req.query.tariffId : [req.query.tariffId];
      const tariffIds = [...new Set(rawTariffIds.map(asPositiveInt))];
      const studentStatus = req.query.status == null ? null : String(req.query.status);
      const aggregateByStudent = req.query.aggregate === 'student';
      const includeAllCategories = req.query.includeAllCategories === 'true';
      const includeInstallmentDetails = req.query.includeInstallmentDetails === 'true';
      if (req.query.aggregate != null && !aggregateByStudent) {
        return res.status(400).json({ error: 'Valid situation aggregate is required' });
      }
      if (req.query.includeAllCategories != null && !includeAllCategories) {
        return res.status(400).json({ error: 'Valid includeAllCategories value is required' });
      }
      if (req.query.includeInstallmentDetails != null && !includeInstallmentDetails) {
        return res.status(400).json({ error: 'Valid installment detail value is required' });
      }
      if (includeInstallmentDetails && !aggregateByStudent) {
        return res.status(400).json({ error: 'Installment details require student aggregate situations' });
      }
      if (!academicYearId || (req.query.categoryId != null && !categoryId)) {
        return res.status(400).json({ error: 'Valid academicYearId and categoryId are required' });
      }
      if (tariffIds.some((tariffId) => tariffId == null)) {
        return res.status(400).json({ error: 'Valid tariffId values are required' });
      }
      if (studentStatus != null && !['paid', 'partial', 'unpaid'].includes(studentStatus)) {
        return res.status(400).json({ error: 'Valid student status is required' });
      }
      if ((studentStatus != null || aggregateByStudent) && (categoryId != null || tariffIds.length > 0)) {
        return res.status(400).json({ error: 'Student status cannot be combined with fee filters' });
      }
      const [year] = await db.select({
        id: academicYears.id,
        schoolId: academicYears.schoolId,
      }).from(academicYears).where(eq(academicYears.id, academicYearId));
      const yearBelongsToSchool = Boolean(
        year && (year.schoolId == null || year.schoolId === schoolId),
      );
      if (!year || !yearBelongsToSchool) {
        return res.status(404).json({ error: 'Academic year not found in this school' });
      }
      const classId = req.query.classId == null ? null : asPositiveInt(req.query.classId);
      if (req.query.classId != null && !classId) {
        return res.status(400).json({ error: 'Valid classId is required' });
      }
      if (classId && !await validateClassAndYear(schoolId, classId, academicYearId)) {
        return res.status(404).json({ error: 'Class not found in this school and academic year' });
      }

      const categoryCondition = categoryId ? sql`AND category.id = ${categoryId}` : sql``;
      const categoryEnabledCondition = tariffIds.length || studentStatus != null || aggregateByStudent || includeAllCategories
        ? sql``
        : sql`AND category.is_enabled = true`;
      const selectedTariffIdList = sql.join(tariffIds.map((tariffId) => sql`${tariffId}`), sql`, `);
      const tariffCondition = tariffIds.length
        ? sql`AND (
          tariff.id IN (${selectedTariffIdList})
          OR EXISTS (
            SELECT 1
            FROM accounting_tariffs AS selected_filter
            LEFT JOIN classes AS selected_start_class
              ON selected_start_class.id = selected_filter.class_from_id
              AND selected_start_class.academic_year_id = ${academicYearId}
            LEFT JOIN levels AS selected_start_level
              ON selected_start_level.id = selected_start_class.level_id
            LEFT JOIN classes AS selected_end_class
              ON selected_end_class.id = selected_filter.class_to_id
              AND selected_end_class.academic_year_id = ${academicYearId}
            LEFT JOIN levels AS selected_end_level
              ON selected_end_level.id = selected_end_class.level_id
            LEFT JOIN levels AS selected_student_level
              ON selected_student_level.id = class.level_id
            WHERE selected_filter.id IN (${selectedTariffIdList})
              AND selected_filter.school_id = ${schoolId}
              AND selected_filter.academic_year_id = ${academicYearId}
              AND selected_filter.category_id = tariff.category_id
              AND selected_filter.is_enabled = true
              AND selected_filter.class_id IS NULL
              AND selected_filter.class_from_id IS NOT NULL
              AND selected_filter.class_to_id IS NOT NULL
              AND (selected_start_level.order_index, selected_start_class.name COLLATE "C", selected_start_class.id)
                <= (selected_end_level.order_index, selected_end_class.name COLLATE "C", selected_end_class.id)
              AND (selected_start_level.order_index, selected_start_class.name COLLATE "C", selected_start_class.id)
                <= (selected_student_level.order_index, class.name COLLATE "C", class.id)
              AND (selected_student_level.order_index, class.name COLLATE "C", class.id)
                <= (selected_end_level.order_index, selected_end_class.name COLLATE "C", selected_end_class.id)
          )
        )`
        : sql``;
      const selectedClassCondition = classId ? sql`AND class.id = ${classId}` : sql``;
      const studentActiveCondition = req.query.includeInactive === 'true'
        ? sql``
        : sql`AND student.is_active = true`;
      const result = await db.execute(sql`
        WITH student_obligations AS (
          SELECT obligation.student_id, obligation.category_id,
            sum(obligation.amount)::int AS obligation_amount,
            array_agg(DISTINCT obligation.class_name_snapshot)
              FILTER (WHERE obligation.class_name_snapshot IS NOT NULL) AS obligation_class_names
          FROM financial_obligations AS obligation
          WHERE obligation.school_id = ${schoolId}
            AND obligation.academic_year_id = ${academicYearId}
            AND obligation.status = 'active'
          GROUP BY obligation.student_id, obligation.category_id
        ),
        student_payments AS (
          SELECT obligation.student_id, obligation.category_id,
            sum(GREATEST(allocation.amount - COALESCE(adjustment.amount, 0), 0))::int AS amount
          FROM financial_payment_allocations AS allocation
          INNER JOIN financial_payments AS payment
            ON payment.id = allocation.payment_id AND payment.status = 'posted'
          INNER JOIN financial_obligations AS obligation
            ON obligation.id = allocation.obligation_id
          LEFT JOIN LATERAL (
            SELECT sum(adjustment_allocation.amount)::int AS amount
            FROM financial_adjustment_allocations AS adjustment_allocation
            INNER JOIN financial_adjustments AS adjustment
              ON adjustment.id = adjustment_allocation.adjustment_id
            WHERE adjustment_allocation.payment_allocation_id = allocation.id
          ) AS adjustment ON true
          WHERE payment.school_id = ${schoolId}
            AND payment.academic_year_id = ${academicYearId}
            AND obligation.status = 'active'
          GROUP BY obligation.student_id, obligation.category_id
        )
        SELECT student.id AS "studentId",
          student.first_name AS "firstName",
          student.last_name AS "lastName",
          student.matricule,
          student.class_id AS "classId",
          class.name AS "className",
          category.id AS "categoryId",
          category.code AS "categoryCode",
          tariff.id AS "tariffId",
          COALESCE(student_obligations.obligation_class_names, ARRAY[]::text[]) AS "obligationClassNames",
          CASE
            WHEN tariff.id IS NOT NULL AND NOT EXISTS (
              SELECT 1
              FROM financial_obligations AS current_tariff_obligation
              WHERE current_tariff_obligation.school_id = ${schoolId}
                AND current_tariff_obligation.student_id = student.id
                AND current_tariff_obligation.academic_year_id = ${academicYearId}
                AND current_tariff_obligation.category_id = category.id
                AND current_tariff_obligation.tariff_id IS NOT NULL
                AND current_tariff_obligation.fee_definition_id IS NULL
                AND current_tariff_obligation.status = 'active'
                AND (
                  current_tariff_obligation.class_id = student.class_id
                  OR category.code = 'tuition'
                )
            ) THEN tariff.amount
            ELSE NULL
          END::int AS "indicativeTariffAmount",
          COALESCE(tariff.label, category.label) AS "categoryLabel",
          COALESCE(expected.amount, 0)::int AS due,
          COALESCE(student_payments.amount, 0)::int AS paid,
          GREATEST(
            COALESCE(expected.amount, 0) - COALESCE(student_payments.amount, 0),
            0
          )::int AS remaining,
          CASE
            WHEN COALESCE(expected.amount, 0) = 0 THEN 'unconfigured'
            WHEN GREATEST(COALESCE(expected.amount, 0) - COALESCE(student_payments.amount, 0), 0) = 0 THEN 'paid'
            WHEN COALESCE(student_payments.amount, 0) = 0 THEN 'unpaid'
            ELSE 'partial'
          END AS status
        FROM students AS student
        INNER JOIN classes AS class
          ON class.id = student.class_id
          AND class.academic_year_id = ${academicYearId}
          AND (
            class.school_id = ${schoolId}
            OR (
              class.school_id IS NULL
              AND EXISTS (
                SELECT 1 FROM school_classes AS school_class
                WHERE school_class.school_id = ${schoolId}
                  AND school_class.class_id = class.id
                  AND school_class.status = 'approved'
              )
            )
          )
        INNER JOIN accounting_categories AS category
          ON category.school_id = ${schoolId}
        LEFT JOIN LATERAL (
          SELECT configured_tariff.*
          FROM accounting_tariffs AS configured_tariff
          LEFT JOIN classes AS range_start_class
            ON range_start_class.id = configured_tariff.class_from_id
            AND range_start_class.academic_year_id = ${academicYearId}
          LEFT JOIN levels AS range_start_level
            ON range_start_level.id = range_start_class.level_id
          LEFT JOIN classes AS range_end_class
            ON range_end_class.id = configured_tariff.class_to_id
            AND range_end_class.academic_year_id = ${academicYearId}
          LEFT JOIN levels AS range_end_level
            ON range_end_level.id = range_end_class.level_id
          LEFT JOIN levels AS student_level
            ON student_level.id = class.level_id
          WHERE configured_tariff.school_id = ${schoolId}
            AND configured_tariff.academic_year_id = ${academicYearId}
            AND configured_tariff.category_id = category.id
            AND configured_tariff.is_enabled = true
            AND (
              configured_tariff.class_id = student.class_id
              OR (
                configured_tariff.class_id IS NULL
                AND configured_tariff.class_from_id IS NOT NULL
                AND configured_tariff.class_to_id IS NOT NULL
                AND (range_start_level.order_index, range_start_class.name COLLATE "C", range_start_class.id)
                  <= (range_end_level.order_index, range_end_class.name COLLATE "C", range_end_class.id)
                AND (range_start_level.order_index, range_start_class.name COLLATE "C", range_start_class.id)
                  <= (student_level.order_index, class.name COLLATE "C", class.id)
                AND (student_level.order_index, class.name COLLATE "C", class.id)
                  <= (range_end_level.order_index, range_end_class.name COLLATE "C", range_end_class.id)
              )
            )
          ORDER BY CASE WHEN configured_tariff.class_id = student.class_id THEN 0 ELSE 1 END,
            configured_tariff.id
          LIMIT 1
        ) AS tariff ON true
        LEFT JOIN student_obligations
          ON student_obligations.student_id = student.id
          AND student_obligations.category_id = category.id
        LEFT JOIN student_payments
          ON student_payments.student_id = student.id
          AND student_payments.category_id = category.id
        LEFT JOIN LATERAL (
          SELECT CASE
            WHEN student_obligations.obligation_amount IS NOT NULL THEN student_obligations.obligation_amount
            ELSE 0
          END AS amount
        ) AS expected ON true
        WHERE student.school_id = ${schoolId}
          ${studentActiveCondition}
          ${categoryEnabledCondition}
          ${categoryCondition}
          ${tariffCondition}
          ${selectedClassCondition}
        ORDER BY category.id, student.last_name, student.first_name
      `);
      if (!aggregateByStudent && studentStatus == null && !includeAllCategories) {
        return res.json({ academicYearId, rows: result.rows });
      }

      const situationRows = result.rows as Array<Record<string, unknown> & {
        studentId: number;
        due: number;
        paid: number;
        obligationClassNames?: string[];
      }>;
      const totalsByStudent = new Map<number, { due: number; paid: number }>();
      for (const row of situationRows) {
        const studentTotals = totalsByStudent.get(row.studentId) ?? { due: 0, paid: 0 };
        const due = Math.max(0, Number(row.due) || 0);
        const paid = Math.max(0, Number(row.paid) || 0);
        studentTotals.due += due;
        studentTotals.paid += paid;
        totalsByStudent.set(row.studentId, studentTotals);
      }

      const rowsWithTotals = situationRows.map((row) => {
        const totals = totalsByStudent.get(row.studentId)!;
        const remaining = Math.max(0, totals.due - totals.paid);
        const status = totals.due === 0
          ? 'unconfigured'
          : remaining === 0
            ? 'paid'
            : totals.paid > 0
              ? 'partial'
              : 'unpaid';
        return {
          ...row,
          studentDue: totals.due,
          studentPaid: totals.paid,
          studentRemaining: remaining,
          studentStatus: status,
        };
      });
      const rows = rowsWithTotals.filter((row) =>
        studentStatus == null || row.studentStatus === studentStatus);
      if (aggregateByStudent) {
        const rowsByStudent = new Map<number, (typeof rows)[number]>();
        for (const row of rows) {
          const existing = rowsByStudent.get(row.studentId);
          if (!existing) {
            rowsByStudent.set(row.studentId, row);
            continue;
          }
          rowsByStudent.set(row.studentId, {
            ...existing,
            obligationClassNames: [...new Set([
              ...(existing.obligationClassNames ?? []),
              ...(row.obligationClassNames ?? []),
            ])],
          });
        }
        const studentRows = [...rowsByStudent.values()]
          .filter((row) => studentStatus == null || row.studentStatus === studentStatus);
        const installmentSummaries = await loadClassInstallmentSummaries(
          db,
          schoolId,
          academicYearId,
          studentRows.map((row) => row.studentId),
          includeInstallmentDetails,
        );
        return res.json({
          academicYearId,
          rows: studentRows.map((row) => ({
            ...row,
            ...installmentSummaries.get(row.studentId),
          })),
        });
      }
      return res.json({ academicYearId, rows });
    } catch (error) {
      console.error('Failed to load accounting student situation:', error);
      return res.status(500).json({ error: 'Failed to load accounting student situation' });
    }
  });

  app.get('/api/accounting/students/:studentId', async (req, res) => {
    try {
      const actor = await actorFor(req, res);
      if (!actor) return;
      const schoolId = await getSchoolId(actor, req.query.schoolId, res);
      if (!schoolId) return;
      const studentId = asPositiveInt(req.params.studentId);
      const academicYearId = asPositiveInt(req.query.academicYearId);
      if (!studentId || !academicYearId) return res.status(400).json({ error: 'Valid studentId and academicYearId are required' });
      const [student] = await db.select({
        id: students.id,
        firstName: students.firstName,
        lastName: students.lastName,
        matricule: students.matricule,
        classId: students.classId,
        schoolId: students.schoolId,
        className: classes.name,
      }).from(students).leftJoin(classes, eq(classes.id, students.classId))
        .where(and(eq(students.id, studentId), eq(students.schoolId, schoolId)));
      if (!student) return res.status(404).json({ error: 'Student not found' });
      const { obligations, installments } = await db.transaction((tx) =>
        loadOutstandingInstallments(tx, schoolId, studentId, academicYearId));
      const obligationIds = obligations.map((row) => row.id);
      const allocations = obligationIds.length
        ? await db.select({
          id: financialPaymentAllocations.id,
          obligationId: financialPaymentAllocations.obligationId,
          installmentId: financialPaymentAllocations.installmentId,
          amount: financialPaymentAllocations.amount,
          paidAtDate: sql<string>`to_char(${financialPayments.paidAt}, 'YYYY-MM-DD')`,
        }).from(financialPaymentAllocations)
          .innerJoin(financialPayments, eq(financialPayments.id, financialPaymentAllocations.paymentId))
          .where(and(
            inArray(financialPaymentAllocations.obligationId, obligationIds),
            eq(financialPayments.schoolId, schoolId),
            eq(financialPayments.academicYearId, academicYearId),
            eq(financialPayments.status, 'posted'),
          ))
        : [];
      const allocationIds = allocations.map((row) => row.id);
      const adjustments = allocationIds.length
        ? await db.select({
          paymentAllocationId: financialAdjustmentAllocations.paymentAllocationId,
          amount: financialAdjustmentAllocations.amount,
          kind: financialAdjustments.kind,
          recordedAtDate: sql<string>`to_char(${financialAdjustments.createdAt}, 'YYYY-MM-DD')`,
        }).from(financialAdjustmentAllocations)
          .innerJoin(financialAdjustments, eq(financialAdjustments.id, financialAdjustmentAllocations.adjustmentId))
          .where(inArray(financialAdjustmentAllocations.paymentAllocationId, allocationIds))
        : [];
      const adjustedById = getAdjustmentTotals(allocations, adjustments);
      const paidByObligation = new Map<number, number>();
      const paidByInstallment = new Map<number, number>();
      const allocationsByInstallment = new Map<number, typeof allocations>();
      const refundsByAllocation = new Map<number, typeof adjustments>();
      const hasUnallocatedPaymentByObligation = new Set<number>();
      for (const allocation of allocations) {
        const net = allocation.amount - (adjustedById.get(allocation.id) ?? 0);
        paidByObligation.set(allocation.obligationId, (paidByObligation.get(allocation.obligationId) ?? 0) + net);
        if (allocation.installmentId != null) {
          paidByInstallment.set(allocation.installmentId, (paidByInstallment.get(allocation.installmentId) ?? 0) + net);
          const installmentAllocations = allocationsByInstallment.get(allocation.installmentId) ?? [];
          installmentAllocations.push(allocation);
          allocationsByInstallment.set(allocation.installmentId, installmentAllocations);
        } else {
          hasUnallocatedPaymentByObligation.add(allocation.obligationId);
        }
      }
      for (const adjustment of adjustments) {
        if (adjustment.kind !== 'refund') continue;
        const allocationAdjustments = refundsByAllocation.get(adjustment.paymentAllocationId) ?? [];
        allocationAdjustments.push(adjustment);
        refundsByAllocation.set(adjustment.paymentAllocationId, allocationAdjustments);
      }
      const today = todayUtc();
      const categories = await db.select().from(accountingCategories).where(eq(accountingCategories.schoolId, schoolId));
      const tariffs = await getApplicableTariffs(db, {
        schoolId,
        academicYearId,
        classId: student.classId!,
      });
      const tariffByCategory = new Map(tariffs.map((tariff) => [tariff.categoryId, tariff]));
      const obligationByCategory = new Map<number, { due: number; paid: number; items: unknown[]; count: number }>();
      for (const obligation of obligations) {
        const group = obligationByCategory.get(obligation.categoryId) ?? { due: 0, paid: 0, items: [], count: 0 };
        group.due += obligation.amount;
        group.paid += paidByObligation.get(obligation.id) ?? 0;
        group.count += 1;
        group.items.push({
          id: obligation.id,
          label: obligation.label,
          className: obligation.classNameSnapshot,
          amount: obligation.amount,
          paid: paidByObligation.get(obligation.id) ?? 0,
          remaining: Math.max(0, obligation.amount - (paidByObligation.get(obligation.id) ?? 0)),
          installments: installments.filter((item) => item.obligationId === obligation.id).map((item) => {
            const remaining = Math.max(0, item.amount - (paidByInstallment.get(item.id) ?? 0));
            const installmentAllocations = allocationsByInstallment.get(item.id) ?? [];
            const installmentRefunds = installmentAllocations.flatMap((allocation) =>
              (refundsByAllocation.get(allocation.id) ?? []).map((adjustment) => ({
                amount: adjustment.amount,
                recordedAtDate: adjustment.recordedAtDate,
              })),
            );
            const punctuality = calculateInstallmentPunctuality({
              amount: item.amount,
              dueDate: item.dueDate,
              remaining,
              today,
              hasUnallocatedPayment: hasUnallocatedPaymentByObligation.has(obligation.id),
              payments: installmentAllocations.map((allocation) => ({
                amount: allocation.amount,
                paidAtDate: allocation.paidAtDate,
                status: 'posted',
              })),
              refunds: installmentRefunds,
            });
            return {
              id: item.id,
              label: item.label,
              dueDate: item.dueDate,
              amount: item.amount,
              paid: paidByInstallment.get(item.id) ?? 0,
              remaining,
              status: remaining === 0 ? 'paid'
                : punctuality.currentStatus === 'overdue' ? 'overdue'
                : (paidByInstallment.get(item.id) ?? 0) > 0 ? 'partial'
                  : item.dueDate < today ? 'overdue' : 'pending',
              currentStatus: punctuality.currentStatus,
              punctualityStatus: punctuality.status,
              settledAt: punctuality.settledAt,
              punctualityReason: punctuality.reason,
            };
          }),
        });
        obligationByCategory.set(obligation.categoryId, group);
      }
      const paymentRows = obligationIds.length
        ? await db.select({
          id: financialPayments.id,
          amount: financialPayments.amount,
          method: financialPayments.method,
          reference: financialPayments.reference,
          paidAt: financialPayments.paidAt,
          status: financialPayments.status,
          receiptId: financialReceipts.id,
          receiptNumber: financialReceipts.receiptNumber,
        }).from(financialPayments)
          .leftJoin(financialReceipts, eq(financialReceipts.paymentId, financialPayments.id))
          .where(and(eq(financialPayments.schoolId, schoolId), eq(financialPayments.studentId, studentId), eq(financialPayments.academicYearId, academicYearId)))
          .orderBy(desc(financialPayments.paidAt))
        : [];
      const categoryBalances = categories.map((category) => {
        const group = obligationByCategory.get(category.id) ?? { due: 0, paid: 0, items: [], count: 0 };
        const tariff = tariffByCategory.get(category.id);
        const hasEquivalentTariffObligation = tariff != null && obligations.some((obligation) =>
          obligation.categoryId === category.id
          && obligation.tariffId != null
          && obligation.feeDefinitionId == null
          && (obligation.enrollmentKind == null || category.code === 'enrollment')
          && (category.code === 'tuition' || obligation.classId === student.classId));
        const balance = calculateStudentFeeBalance({
          studentId,
          categoryId: category.id,
          indicativeTariffAmount: tariff?.amount ?? null,
          obligations: obligations.filter((obligation) => obligation.categoryId === category.id).map((obligation) => ({
            id: obligation.id,
            amount: obligation.amount,
            tariffId: obligation.tariffId,
          })),
          allocations: allocations.filter((allocation) =>
            obligations.some((obligation) => obligation.id === allocation.obligationId
              && obligation.categoryId === category.id),
          ).map((allocation) => ({
            obligationId: allocation.obligationId,
            amount: allocation.amount,
            adjustedAmount: adjustedById.get(allocation.id) ?? 0,
          })),
        });
        return {
          ...category,
          label: tariff?.label ?? category.label,
          due: balance.due,
          paid: balance.paid,
          remaining: balance.remaining,
          overpayment: Math.max(0, balance.paid - balance.due),
          status: balance.status,
          tariffId: tariff?.id ?? null,
          indicativeTariffAmount: tariff && !hasEquivalentTariffObligation ? tariff.amount : null,
          obligationClassNames: [...new Set(obligations
            .filter((obligation) => obligation.categoryId === category.id)
            .map((obligation) => obligation.classNameSnapshot)
            .filter((className): className is string => Boolean(className)))],
          obligations: group.items,
        };
      });
      return res.json({
        student,
        academicYearId,
        totals: {
          due: categoryBalances.reduce((sum, category) => sum + category.due, 0),
          paid: categoryBalances.reduce((sum, category) => sum + category.paid, 0),
          remaining: categoryBalances.reduce((sum, category) => sum + category.remaining, 0),
          overpayment: categoryBalances.reduce((sum, category) => sum + category.overpayment, 0),
        },
        categories: categoryBalances,
        payments: paymentRows,
      });
    } catch (error) {
      console.error('Failed to load student financial statement:', error);
      return res.status(500).json({ error: 'Failed to load student financial statement' });
    }
  });

  app.post('/api/accounting/payments', async (req, res) => {
    try {
      const actor = await actorFor(req, res, 'collect_payment');
      if (!actor) return;
      const schoolId = await getSchoolId(actor, req.body?.schoolId, res);
      if (!schoolId) return;
      const studentId = asPositiveInt(req.body?.studentId);
      const academicYearId = asPositiveInt(req.body?.academicYearId);
      const obligationId = req.body?.obligationId == null || req.body.obligationId === ''
        ? null
        : asPositiveInt(req.body.obligationId);
      const categoryId = req.body?.categoryId == null || req.body.categoryId === ''
        ? null
        : asPositiveInt(req.body.categoryId);
      const rawAllocations = req.body?.allocations;
      const tariffAllocations = Array.isArray(rawAllocations)
        ? rawAllocations.map((item: unknown) => {
          const line = item as { tariffId?: unknown; amount?: unknown };
          return {
            tariffId: asPositiveInt(line?.tariffId),
            amount: asMoney(line?.amount),
          };
        })
        : null;
      const initialTuitionInput = parseInitialTuitionInput(req.body ?? {});
      const amount = tariffAllocations
        ? tariffAllocations.reduce((sum, item) => sum + item.amount, 0)
        : asMoney(req.body?.amount);
      const method = String(req.body?.method ?? '');
      const idempotencyKey = typeof req.body?.idempotencyKey === 'string' ? req.body.idempotencyKey.trim() : '';
      const reference = typeof req.body?.reference === 'string' ? req.body.reference.trim() || null : null;
      const enrollmentKindInput = req.body?.enrollmentKind;
      const normalizedEnrollmentKind = typeof enrollmentKindInput === 'string'
        ? enrollmentKindInput.trim()
        : '';
      const enrollmentKind = isAccountingEnrollmentKind(normalizedEnrollmentKind)
        ? normalizedEnrollmentKind
        : null;
      const hasExplicitPaidAt = req.body?.paidAt != null && req.body.paidAt !== '';
      const paidAt = req.body?.paidAt ? new Date(req.body.paidAt) : new Date();
      const paidAtFingerprint = hasExplicitPaidAt && !Number.isNaN(paidAt.getTime())
        ? paidAt.toISOString()
        : null;
      const requestFingerprint = JSON.stringify([
        studentId,
        academicYearId,
        amount,
        method,
        reference,
        obligationId,
        categoryId,
        paidAtFingerprint,
        ...(tariffAllocations ? [tariffAllocations.map((item) => [item.tariffId, item.amount])] : []),
        ...(initialTuitionInput.amount != null
          ? [initialTuitionInput.amount, initialTuitionInput.justification]
          : []),
        ...(enrollmentKind ? [enrollmentKind] : []),
      ]);
      if (enrollmentKindInput != null && enrollmentKindInput !== ''
        && enrollmentKind == null) {
        return res.status(400).json({ error: 'Le type d’inscription sélectionné est invalide.' });
      }
      if (!studentId || !academicYearId || !Number.isSafeInteger(amount) || amount <= 0 || amount > 2147483647
        || !idempotencyKey || idempotencyKey.length > 120
        || (req.body?.obligationId != null && req.body.obligationId !== '' && !obligationId)
        || (req.body?.categoryId != null && req.body.categoryId !== '' && !categoryId)
        || (rawAllocations != null && (!tariffAllocations?.length
          || tariffAllocations.some((item) => !item.tariffId || !item.amount)
          || new Set(tariffAllocations.map((item) => item.tariffId)).size !== tariffAllocations.length
          || obligationId != null || categoryId != null))
        || !['cash', 'tmoney', 'flooz', 'bank_transfer', 'check', 'other'].includes(method)
        || (typeof req.body?.reference === 'string' && req.body.reference.length > 200)
        || Number.isNaN(paidAt.getTime())) {
        return res.status(400).json({ error: 'Invalid payment values' });
      }
      const [student] = await db.select({
        id: students.id, schoolId: students.schoolId, classId: students.classId,
        firstName: students.firstName, lastName: students.lastName, matricule: students.matricule,
        className: classes.name,
      }).from(students).leftJoin(classes, eq(classes.id, students.classId))
        .where(and(eq(students.id, studentId), eq(students.schoolId, schoolId)));
      const [year] = await db.select().from(academicYears).where(and(
        eq(academicYears.id, academicYearId),
      ));
      if (!student || !year || (year.schoolId != null && year.schoolId !== schoolId)
        || !student.classId || !await validateClassAndYear(schoolId, student.classId, academicYearId)) {
        return res.status(404).json({ error: 'Student or academic year not found in this school' });
      }

      const result = await db.transaction(async (tx) => {
        await assertSchoolActiveInTransaction(tx, schoolId);
        await tx.execute(sql`SELECT id FROM academic_years WHERE id = ${academicYearId} FOR UPDATE`);
        const [existing] = await tx.select().from(financialPayments).where(and(
          eq(financialPayments.schoolId, schoolId),
          eq(financialPayments.idempotencyKey, idempotencyKey),
        ));
        if (existing) {
          if (existing.studentId !== studentId || existing.academicYearId !== academicYearId
            || existing.amount !== amount || existing.method !== method || existing.reference !== reference
            || existing.requestFingerprint !== requestFingerprint
            || (hasExplicitPaidAt && existing.paidAt.getTime() !== paidAt.getTime())) {
            throw Object.assign(new Error('Idempotency key was already used for a different payment'), { statusCode: 409 });
          }
          const [receipt] = await tx.select().from(financialReceipts).where(eq(financialReceipts.paymentId, existing.id));
          return { payment: existing, receipt, duplicate: true, pushNotification: undefined };
        }
        const obligationIdByTariffId = new Map<number, number>();
        if (tariffAllocations) {
          let initialTuitionApplied = false;
          for (const allocation of tariffAllocations) {
            const [tariff] = await getApplicableTariffs(tx, {
              schoolId,
              academicYearId,
              classId: student.classId!,
              tariffId: allocation.tariffId!,
            });
            if (!tariff) {
              throw Object.assign(new Error('Selected fee is not available for this student and year'), { statusCode: 404 });
            }
            let tariffCategoryCode: string | null = null;
            if (initialTuitionInput.amount != null) {
              const [tariffCategory] = await tx.select({
                code: accountingCategories.code,
              }).from(accountingCategories).where(and(
                eq(accountingCategories.id, tariff.categoryId),
                eq(accountingCategories.schoolId, schoolId),
              ));
              tariffCategoryCode = tariffCategory?.code ?? null;
            }
            const applyInitialTuition = initialTuitionInput.amount != null
              && tariffCategoryCode === 'tuition'
              && !initialTuitionApplied;
            const obligation = await ensureTariffObligation(tx, {
              actor,
              schoolId,
              studentId,
              academicYearId,
              classId: student.classId!,
              className: student.className ?? '—',
              categoryId: tariff.categoryId,
              tariffId: tariff.id,
              enrollmentKind,
              initialTuitionAmount: applyInitialTuition ? initialTuitionInput.amount : null,
              initialTuitionJustification: applyInitialTuition ? initialTuitionInput.justification : null,
            });
            if (!obligation) {
              throw Object.assign(new Error('No obligation exists for a selected fee'), { statusCode: 409 });
            }
            obligationIdByTariffId.set(allocation.tariffId!, obligation.id);
            if (applyInitialTuition) initialTuitionApplied = true;
          }
          if (initialTuitionInput.amount != null && !initialTuitionApplied) {
            throw Object.assign(new Error('An individualized initial amount requires a selected tuition tariff'), { statusCode: 400 });
          }
        } else if (categoryId) {
          await ensureTariffObligation(tx, {
            actor,
            schoolId,
            studentId,
            academicYearId,
            classId: student.classId!,
            className: student.className ?? '—',
            categoryId,
            enrollmentKind,
            initialTuitionAmount: initialTuitionInput.amount,
            initialTuitionJustification: initialTuitionInput.justification,
          });
        } else if (initialTuitionInput.amount != null) {
          throw Object.assign(new Error('An individualized initial amount requires a selected tuition fee'), { statusCode: 400 });
        }
        const outstanding = await loadOutstandingInstallments(tx, schoolId, studentId, academicYearId, tariffAllocations
          ? undefined
          : { obligationId, categoryId });
        if (obligationId && !outstanding.obligations.some((row) => row.id === obligationId)) {
          throw Object.assign(new Error('Selected obligation is not available for this student'), { statusCode: 404 });
        }
        let totalDue: number;
        let payableRemaining: number;
        let plannedAllocations: ReturnType<typeof allocateToOldestInstallments>;
        if (tariffAllocations) {
          const relevantObligations = tariffAllocations.map((allocation) => {
            const resolvedObligationId = obligationIdByTariffId.get(allocation.tariffId!);
            const obligation = outstanding.obligations.find((row) => row.id === resolvedObligationId);
            if (!obligation) {
              throw Object.assign(new Error('No obligation exists for a selected fee'), { statusCode: 409 });
            }
            const installmentBalances = outstanding.installments
              .filter((item) => item.obligationId === obligation.id)
              .map((item) => ({
                installmentId: item.id,
                obligationId: item.obligationId,
                remaining: outstanding.balances.get(item.id) ?? 0,
              }))
              .filter((item) => item.remaining > 0);
            const remaining = installmentBalances.reduce((sum, item) => sum + item.remaining, 0);
            if (allocation.amount > remaining) {
              throw Object.assign(new Error('Payment exceeds the outstanding balance for a selected fee'), { statusCode: 409 });
            }
            const allocations = allocateToOldestInstallments(allocation.amount, installmentBalances);
            if (!allocations) {
              throw Object.assign(new Error('Payment could not be fully allocated to a selected fee'), { statusCode: 409 });
            }
            return { obligation, allocations, remaining };
          });
          const obligationIds = new Set(relevantObligations.map((item) => item.obligation.id));
          if (obligationIds.size !== tariffAllocations.length) {
            throw Object.assign(new Error('Each selected fee must map to a separate obligation'), { statusCode: 409 });
          }
          totalDue = relevantObligations.reduce((sum, item) => sum + item.obligation.amount, 0);
          const totalPaid = relevantObligations.reduce(
            (sum, item) => sum + (outstanding.paidByObligation.get(item.obligation.id) ?? 0),
            0,
          );
          payableRemaining = relevantObligations.reduce((sum, item) => sum + item.remaining, 0);
          if (!payableRemaining) {
            throw Object.assign(new Error('No outstanding balance for this student and year'), { statusCode: 409 });
          }
          plannedAllocations = relevantObligations.flatMap((item) => item.allocations);
          if (amount > Math.max(0, totalDue - totalPaid)) {
            throw Object.assign(new Error('Payment exceeds the outstanding balance'), { statusCode: 409 });
          }
        } else {
          const totalRemaining = [...outstanding.balances.values()].reduce((sum, value) => sum + value, 0);
        const scopedObligations = categoryId
          ? outstanding.obligations.filter((row) => row.categoryId === categoryId)
          : outstanding.obligations;
        totalDue = scopedObligations.reduce((sum, row) => sum + row.amount, 0);
        const totalPaid = scopedObligations.reduce(
          (sum, row) => sum + (outstanding.paidByObligation.get(row.id) ?? 0),
          0,
        );
        const availableInstallmentBalance = categoryId
          ? outstanding.installments
            .filter((item) => scopedObligations.some((row) => row.id === item.obligationId))
            .reduce((sum, item) => sum + (outstanding.balances.get(item.id) ?? 0), 0)
          : totalRemaining;
        payableRemaining = Math.min(availableInstallmentBalance, Math.max(0, totalDue - totalPaid));
        if (!payableRemaining) throw Object.assign(new Error('No outstanding balance for this student and year'), { statusCode: 409 });
        if (amount > payableRemaining) throw Object.assign(new Error('Payment exceeds the outstanding balance'), { statusCode: 409 });
        let allocationLimit = payableRemaining;
        plannedAllocations = allocateToOldestInstallments(amount, outstanding.installments
          .filter((item) => !categoryId || scopedObligations.some((row) => row.id === item.obligationId))
          .map((item) => {
            const available = Math.min(outstanding.balances.get(item.id) ?? 0, allocationLimit);
            allocationLimit -= available;
            return { installmentId: item.id, obligationId: item.obligationId, remaining: available };
          })
          .filter((item) => item.remaining > 0));
        }
        if (!plannedAllocations) throw Object.assign(new Error('Payment could not be fully allocated'), { statusCode: 409 });

        const [payment] = await tx.insert(financialPayments).values({
          schoolId, studentId, academicYearId, amount, currency: 'XOF', method,
          reference, requestFingerprint,
          paidAt, idempotencyKey, recordedBy: actor.id ?? null,
        }).returning();
        await tx.insert(financialPaymentAllocations).values(plannedAllocations.map((allocation) => ({
          paymentId: payment.id,
          ...allocation,
        })));
        const allocationDetails = await tx.select({
          categoryId: financialObligations.categoryId,
          category: accountingCategories.label,
          label: financialObligations.label,
          tariffLabel: accountingTariffs.label,
          amount: financialPaymentAllocations.amount,
          installmentLabel: financialInstallments.label,
          dueDate: financialInstallments.dueDate,
        }).from(financialPaymentAllocations)
          .innerJoin(financialObligations, eq(financialObligations.id, financialPaymentAllocations.obligationId))
          .innerJoin(accountingCategories, eq(accountingCategories.id, financialObligations.categoryId))
          .leftJoin(accountingTariffs, eq(accountingTariffs.id, financialObligations.tariffId))
          .leftJoin(financialInstallments, eq(financialInstallments.id, financialPaymentAllocations.installmentId))
          .where(eq(financialPaymentAllocations.paymentId, payment.id));
        const numberResult = await tx.execute(sql`SELECT nextval('accounting_receipt_number_seq')::text AS value`);
        const receiptSequence = BigInt(String(numberResult.rows[0]?.value));
        const receiptNumber = `REC-${new Date().getUTCFullYear()}-${receiptSequence.toString().padStart(6, '0')}`;
        const snapshot = await createReceiptSnapshot({
          database: db,
          schoolId,
          payment,
          receiptNumber,
          student: {
            id: student.id,
            firstName: student.firstName,
            lastName: student.lastName,
            matricule: student.matricule,
            className: student.className ?? '—',
          },
          schoolYearName: year.name,
          allocations: allocationDetails,
          paidBeforePayment: totalDue - payableRemaining,
          totalDue,
          remainingAfterPayment: payableRemaining - amount,
          actor,
        });
        const [receipt] = await tx.insert(financialReceipts).values({
          schoolId,
          paymentId: payment.id,
          receiptNumber,
          snapshot,
        }).returning();
        await addAudit(tx, actor, schoolId, 'create', 'financial_payment', payment.id, 'Payment recorded.',
          null,
          createAuditSnapshot(payment, ['studentId', 'academicYearId', 'amount', 'method', 'status', 'recordedBy']));
        await addAudit(tx, actor, schoolId, 'create', 'financial_receipt', receipt.id, 'Receipt issued.',
          null,
          createAuditSnapshot(receipt, ['paymentId', 'receiptNumber', 'issuedAt']));
        const [parent] = await tx.select({ userId: parents.userId }).from(students)
          .innerJoin(parents, eq(parents.id, students.parentId))
          .where(eq(students.id, studentId));
        if (parent?.userId) {
          const afterPayment = await loadOutstandingInstallments(tx, schoolId, studentId, academicYearId);
          const remainingByObligation = new Map<number, number>();
          for (const installment of afterPayment.installments) {
            remainingByObligation.set(
              installment.obligationId,
              (remainingByObligation.get(installment.obligationId) ?? 0)
                + (afterPayment.balances.get(installment.id) ?? 0),
            );
          }
          const remainingByCategory = new Map<number, number>();
          for (const obligation of afterPayment.obligations) {
            remainingByCategory.set(
              obligation.categoryId,
              (remainingByCategory.get(obligation.categoryId) ?? 0)
                + (remainingByObligation.get(obligation.id) ?? 0),
            );
          }
          const formatNotificationAmount = (value: number) => value
            .toLocaleString('fr-FR')
            .replace(/[\u00a0\u202f]/g, ' ');
          const feeNames = [...new Set(allocationDetails.map((allocation) =>
            allocation.tariffLabel?.trim() || allocation.label?.trim() || allocation.category?.trim() || 'Frais'))];
          const categoriesPaid = new Map<number, string>();
          for (const allocation of allocationDetails) {
            if (!categoriesPaid.has(allocation.categoryId)) {
              categoriesPaid.set(allocation.categoryId, allocation.category?.trim() || 'Frais');
            }
          }
          const paidCategoryBalances = [...categoriesPaid].map(([id, label]) =>
            `${label} : ${formatNotificationAmount(remainingByCategory.get(id) ?? 0)} FCFA`);
          const studentName = [student.firstName, student.lastName].filter(Boolean).join(' ') || 'votre enfant';
          const paidAtLabel = payment.paidAt.toLocaleDateString('fr-FR', { timeZone: 'UTC' });
          const title = 'Paiement enregistré';
          const message = [
            `Paiement de ${formatNotificationAmount(payment.amount)} FCFA enregistré pour ${studentName}.`,
            `Frais concernés : ${feeNames.join(', ')}.`,
            `Reste total à payer pour l’année ${year.name} : ${formatNotificationAmount(
              [...afterPayment.balances.values()].reduce((total, balance) => total + balance, 0),
            )} FCFA.`,
            `Reste pour les rubriques réglées : ${paidCategoryBalances.join('; ')}.`,
            `Date du paiement : ${paidAtLabel}.`,
          ].join(' ');
          const dedupeKey = `accounting-payment-${payment.id}`;
          await tx.insert(notifications).values({
            userId: parent.userId,
            title,
            body: message,
            type: 'info',
            dedupeKey,
          }).onConflictDoNothing();
          return {
            payment,
            receipt,
            duplicate: false,
            pushNotification: {
              parentId: String(parent.userId),
              title,
              message: 'Un paiement a été enregistré. Consultez l’application pour le détail.',
              category: 'info' as const,
              metadata: { target: 'payment' as const, paymentId: String(payment.id) },
              dedupeKey,
            },
          };
        }
        return { payment, receipt, duplicate: false, pushNotification: undefined };
      });
      let receiptAttachment: {
        attachmentId: number;
        fileName: string;
        mimeType: string;
        fileSize: number;
      } | undefined;
      let receiptNotificationId: number | undefined;
      if (result.receipt) {
        let storedReference: string | undefined;
        try {
          const dedupeKey = `accounting-payment-${result.payment.id}`;
          const [paymentNotification] = await db.select({
            id: notifications.id,
          }).from(notifications).where(eq(notifications.dedupeKey, dedupeKey));
          if (!paymentNotification) {
            throw new Error('Payment notification was not found for receipt attachment');
          }
          receiptNotificationId = paymentNotification.id;
          if (paymentNotification) {
            const fileName = `${result.receipt.receiptNumber}.pdf`;
            const [existingAttachment] = await db.select({
              id: notificationAttachments.id,
              fileName: notificationAttachments.fileName,
              mimeType: notificationAttachments.mimeType,
              fileSize: notificationAttachments.fileSize,
            }).from(notificationAttachments).where(and(
              eq(notificationAttachments.notificationId, paymentNotification.id),
              eq(notificationAttachments.fileName, fileName),
            ));
            if (existingAttachment) {
              receiptAttachment = {
                attachmentId: existingAttachment.id,
                fileName: existingAttachment.fileName,
                mimeType: existingAttachment.mimeType,
                fileSize: Number(existingAttachment.fileSize),
              };
            } else {
              if (actor.id == null) throw new Error('Payment receipt attachment requires an authenticated actor id');
              const pdf = await renderAccountingReceipt(result.receipt.snapshot);
              const storedFile = await persistUploadedFile({
                originalname: fileName,
                buffer: Buffer.from(pdf),
                mimetype: 'application/pdf',
                size: pdf.byteLength,
              }, 'notification-attachments');
              storedReference = storedFile.storedReference;

              const inserted = await db.transaction(async (tx) => {
                await tx.execute(sql`SELECT id FROM notifications WHERE id = ${paymentNotification.id} FOR UPDATE`);
                const [concurrentAttachment] = await tx.select({
                  id: notificationAttachments.id,
                  fileName: notificationAttachments.fileName,
                  mimeType: notificationAttachments.mimeType,
                  fileSize: notificationAttachments.fileSize,
                }).from(notificationAttachments).where(and(
                  eq(notificationAttachments.notificationId, paymentNotification.id),
                  eq(notificationAttachments.fileName, fileName),
                ));
                if (concurrentAttachment) return { created: false, attachment: concurrentAttachment };
                const [attachment] = await tx.insert(notificationAttachments).values({
                  notificationId: paymentNotification.id,
                  fileName,
                  filePath: storedFile.storedReference,
                  mimeType: 'application/pdf',
                  fileSize: pdf.byteLength,
                  uploadedBy: actor.id,
                }).returning({
                  id: notificationAttachments.id,
                  fileName: notificationAttachments.fileName,
                  mimeType: notificationAttachments.mimeType,
                  fileSize: notificationAttachments.fileSize,
                });
                return { created: true, attachment };
              });
              if (inserted.attachment) {
                receiptAttachment = {
                  attachmentId: inserted.attachment.id,
                  fileName: inserted.attachment.fileName,
                  mimeType: inserted.attachment.mimeType,
                  fileSize: Number(inserted.attachment.fileSize),
                };
              }
              if (!inserted.created) {
                await deleteStoredFile(storedReference, 'notification-attachments');
                storedReference = undefined;
              }
            }
          }
        } catch (attachmentError) {
          if (storedReference) {
            try {
              await deleteStoredFile(storedReference, 'notification-attachments');
            } catch (cleanupError) {
              console.error('Failed to clean up unattached accounting receipt PDF', {
                paymentId: result.payment.id,
                receiptId: result.receipt.id,
                errorName: cleanupError instanceof Error ? cleanupError.name : 'UnknownError',
              });
            }
          }
          console.error('Failed to attach accounting receipt PDF to payment notification', {
            paymentId: result.payment.id,
            receiptId: result.receipt.id,
            errorName: attachmentError instanceof Error ? attachmentError.name : 'UnknownError',
          });
        }
      }
      if (!result.duplicate && result.pushNotification) {
        try {
          console.info('Accounting payment push requested', { paymentId: result.payment.id });
          const status = await options.dispatchPaymentNotification({
            ...result.pushNotification,
            metadata: {
              ...result.pushNotification.metadata,
              ...(receiptAttachment && receiptNotificationId != null ? {
                notificationId: receiptNotificationId,
                attachmentCount: 1,
                attachments: [receiptAttachment],
              } : {}),
            },
          });
          console.info('Accounting payment push relay accepted', {
            paymentId: result.payment.id,
            status,
          });
        } catch (notificationError) {
          const statusCode = typeof notificationError === 'object' && notificationError
            && 'statusCode' in notificationError && Number.isInteger(Number(notificationError.statusCode))
            ? Number(notificationError.statusCode)
            : undefined;
          console.error('Accounting payment push relay failed', {
            paymentId: result.payment.id,
            ...(statusCode ? { status: statusCode } : {}),
            errorName: notificationError instanceof Error ? notificationError.name : 'UnknownError',
          });
        }
      }
      return res.status(result.duplicate ? 200 : 201).json({
        payment: result.payment,
        receipt: result.receipt,
        duplicate: result.duplicate,
      });
    } catch (error) {
      const statusCode = typeof error === 'object' && error && 'statusCode' in error ? Number(error.statusCode) : 500;
      if (statusCode !== 500) {
        return res.status(statusCode).json({
          error: (error as Error).message,
          ...(error instanceof SchoolSuspendedError ? { code: error.code, schoolId: error.schoolId } : {}),
        });
      }
      console.error('Failed to record accounting payment:', error);
      return res.status(500).json({ error: 'Failed to record accounting payment' });
    }
  });

  app.post('/api/accounting/payments/:id/cancel', async (req, res) => {
    return handlePaymentAdjustment(req, res, options, actorFor, getSchoolId, 'cancellation');
  });

  app.post('/api/accounting/payments/:id/refund', async (req, res) => {
    return handlePaymentAdjustment(req, res, options, actorFor, getSchoolId, 'refund');
  });

  app.get('/api/accounting/adjustment-requests', async (req, res) => {
    try {
      const actor = await actorFor(req, res);
      if (!actor) return;
      const requestedSchoolId = req.query.schoolId;
      const allSchools = actor.role === 'super_admin'
        && (requestedSchoolId == null || requestedSchoolId === '');
      const schoolId = allSchools ? null : await getSchoolId(actor, requestedSchoolId, res);
      if (!allSchools && !schoolId) return;
      const status = req.query.status == null ? null : String(req.query.status);
      const paymentId = req.query.paymentId == null ? null : asPositiveInt(req.query.paymentId);
      if ((status != null && !['pending', 'approved', 'rejected'].includes(status))
        || (req.query.paymentId != null && !paymentId)) {
        return res.status(400).json({ error: 'Invalid adjustment request filter' });
      }
      const conditions = [
        ...(schoolId == null ? [] : [eq(financialAdjustmentRequests.schoolId, schoolId)]),
        ...(status ? [eq(financialAdjustmentRequests.status, status)] : []),
        ...(paymentId ? [eq(financialAdjustmentRequests.paymentId, paymentId)] : []),
      ];
      const rows = await db.select({
        id: financialAdjustmentRequests.id,
        schoolName: schools.name,
        paymentId: financialAdjustmentRequests.paymentId,
        paymentAmount: financialPayments.amount,
        studentFirstName: students.firstName,
        studentLastName: students.lastName,
        className: sql<string | null>`(
          SELECT string_agg(DISTINCT ${financialObligations.classNameSnapshot}, ' / ' ORDER BY ${financialObligations.classNameSnapshot})
          FROM ${financialPaymentAllocations}
          INNER JOIN ${financialObligations}
            ON ${financialObligations.id} = ${financialPaymentAllocations.obligationId}
          WHERE ${financialPaymentAllocations.paymentId} = ${financialAdjustmentRequests.paymentId}
            AND ${financialObligations.schoolId} = ${financialAdjustmentRequests.schoolId}
        )`,
        kind: financialAdjustmentRequests.kind,
        amount: financialAdjustmentRequests.amount,
        reason: financialAdjustmentRequests.reason,
        status: financialAdjustmentRequests.status,
        requestedByUserId: financialAdjustmentRequests.requestedByUserId,
        requestedByRole: financialAdjustmentRequests.requestedByRole,
        requestedByName: financialAdjustmentRequests.requestedByName,
        requestedByEmail: financialAdjustmentRequests.requestedByEmail,
        requestedAt: financialAdjustmentRequests.requestedAt,
        decidedByUserId: financialAdjustmentRequests.decidedByUserId,
        decidedByRole: financialAdjustmentRequests.decidedByRole,
        decidedByName: financialAdjustmentRequests.decidedByName,
        decidedByEmail: financialAdjustmentRequests.decidedByEmail,
        decidedAt: financialAdjustmentRequests.decidedAt,
        decisionReason: financialAdjustmentRequests.decisionReason,
        resultingAdjustmentId: financialAdjustmentRequests.resultingAdjustmentId,
        refundConfirmedByUserId: financialAdjustmentRequests.refundConfirmedByUserId,
        refundConfirmedByRole: financialAdjustmentRequests.refundConfirmedByRole,
        refundConfirmedByName: financialAdjustmentRequests.refundConfirmedByName,
        refundConfirmedByEmail: financialAdjustmentRequests.refundConfirmedByEmail,
        refundConfirmedAt: financialAdjustmentRequests.refundConfirmedAt,
      }).from(financialAdjustmentRequests)
        .innerJoin(financialPayments, and(
          eq(financialPayments.id, financialAdjustmentRequests.paymentId),
          eq(financialPayments.schoolId, financialAdjustmentRequests.schoolId),
        ))
        .innerJoin(students, and(
          eq(students.id, financialPayments.studentId),
          eq(students.schoolId, financialPayments.schoolId),
        ))
        .innerJoin(schools, eq(schools.id, financialAdjustmentRequests.schoolId))
        .where(conditions.length ? and(...conditions) : undefined)
        .orderBy(desc(financialAdjustmentRequests.createdAt))
        .limit(500);
      return res.json(rows);
    } catch (error) {
      console.error('Failed to load accounting adjustment requests:', error);
      return res.status(500).json({ error: 'Failed to load adjustment requests' });
    }
  });

  app.post('/api/accounting/payments/:id/adjustment-requests', async (req, res) => {
    try {
      const actor = await actorFor(req, res, 'request_adjustment');
      if (!actor) return;
      if (!actor.id) return res.status(401).json({ error: 'Authenticated account identity is unavailable' });
      const schoolId = await getSchoolId(actor, undefined, res);
      if (!schoolId) return;
      const paymentId = asPositiveInt(req.params.id);
      const kind = req.body?.kind;
      const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
      const idempotencyKey = typeof req.body?.idempotencyKey === 'string'
        ? req.body.idempotencyKey.trim()
        : '';
      const amount = kind === 'refund' ? asMoney(req.body?.amount) : null;
      if (!paymentId || (kind !== 'cancellation' && kind !== 'refund')
        || (kind === 'cancellation' && req.body?.amount != null)
        || (kind === 'refund' && !amount)
        || !reason || reason.length > 500
        || !idempotencyKey || idempotencyKey.length > 120) {
        return res.status(400).json({ error: 'Invalid adjustment request' });
      }

      const result = await db.transaction(async (tx) => {
        await assertSchoolActiveInTransaction(tx, schoolId);
        const [payment] = await tx.select().from(financialPayments).where(and(
          eq(financialPayments.id, paymentId),
          eq(financialPayments.schoolId, schoolId),
        )).for('update').limit(1);
        if (!payment) throw Object.assign(new Error('Payment not found'), { statusCode: 404 });

        const [existingByKey] = await tx.select().from(financialAdjustmentRequests).where(and(
          eq(financialAdjustmentRequests.schoolId, schoolId),
          eq(financialAdjustmentRequests.idempotencyKey, idempotencyKey),
        )).for('update').limit(1);
        if (existingByKey) {
          const sameRequest = existingByKey.paymentId === paymentId
            && existingByKey.kind === kind
            && existingByKey.amount === amount
            && existingByKey.reason === reason
            && existingByKey.requestedByUserId === actor.id;
          if (!sameRequest) {
            throw Object.assign(new Error('Idempotency key was already used for a different request'), { statusCode: 409 });
          }
          return { request: existingByKey, duplicate: true };
        }
        if (payment.status !== 'posted') {
          throw Object.assign(new Error('Only posted payments can be adjusted'), { statusCode: 409 });
        }
        const balance = await loadRemainingPaymentBalance(tx, paymentId);
        if (!balance.remaining || (amount != null && amount > balance.remaining)) {
          throw Object.assign(new Error('Requested amount exceeds the unreversed payment amount'), { statusCode: 409 });
        }

        const insertedRequest = await tx.execute(sql`
          INSERT INTO public.financial_adjustment_requests (
            school_id, payment_id, kind, amount, reason,
            requested_by_user_id, requested_by_role, requested_by_name,
            requested_by_email, idempotency_key
          )
          VALUES (
            ${schoolId}, ${paymentId}, ${kind}, ${amount}, ${reason},
            ${actor.id}, ${actor.role}, ${actor.name ?? null},
            ${actor.email ?? null}, ${idempotencyKey}
          )
          RETURNING id
        `);
        const requestId = Number(insertedRequest.rows[0]?.id);
        if (!Number.isSafeInteger(requestId) || requestId <= 0) {
          throw new Error('Failed to retrieve created accounting adjustment request');
        }
        const [request] = await tx.select().from(financialAdjustmentRequests)
          .where(eq(financialAdjustmentRequests.id, requestId))
          .limit(1);
        if (!request) throw new Error('Created accounting adjustment request could not be reloaded');
        await addAudit(tx, actor, schoolId, 'request', 'financial_adjustment_request', request.id,
          `${kind} request created for payment ${paymentId}.`,
          null,
          createAuditSnapshot(request, [
            'paymentId', 'kind', 'amount', 'status', 'requestedByUserId', 'requestedByRole', 'requestedAt',
          ]),
          reason);
        return { request, duplicate: false };
      });
      return res.status(result.duplicate ? 200 : 201).json(result);
    } catch (error) {
      const statusCode = typeof error === 'object' && error && 'statusCode' in error ? Number(error.statusCode) : 500;
      if (statusCode !== 500) return res.status(statusCode).json({ error: (error as Error).message });
      if (typeof error === 'object' && error && 'code' in error && error.code === '23505') {
        return res.status(409).json({ error: 'An active adjustment request already exists for this payment' });
      }
      console.error('Failed to create accounting adjustment request:', error);
      return res.status(500).json({ error: 'Failed to create adjustment request' });
    }
  });

  app.post('/api/accounting/adjustment-requests/:id/decision', async (req, res) => {
    try {
      const actor = await actorFor(req, res, 'review_adjustment');
      if (!actor) return;
      if (!actor.id) return res.status(401).json({ error: 'Authenticated account identity is unavailable' });
      const schoolId = await getSchoolId(actor, undefined, res);
      if (!schoolId) return;
      const requestId = asPositiveInt(req.params.id);
      const decision = req.body?.decision;
      const decisionReason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
      if (!requestId || (decision !== 'approve' && decision !== 'reject')
        || !decisionReason || decisionReason.length > 500) {
        return res.status(400).json({ error: 'A valid decision and reason are required' });
      }
      const [scopedRequest] = await db.select({
        paymentId: financialAdjustmentRequests.paymentId,
      }).from(financialAdjustmentRequests).where(and(
        eq(financialAdjustmentRequests.id, requestId),
        eq(financialAdjustmentRequests.schoolId, schoolId),
      )).limit(1);
      if (!scopedRequest) return res.status(404).json({ error: 'Adjustment request not found' });

      const result = await db.transaction(async (tx) => {
        await assertSchoolActiveInTransaction(tx, schoolId);
        const [payment] = await tx.select().from(financialPayments).where(and(
          eq(financialPayments.id, scopedRequest.paymentId),
          eq(financialPayments.schoolId, schoolId),
        )).for('update').limit(1);
        if (!payment) throw Object.assign(new Error('Payment not found'), { statusCode: 404 });
        const [request] = await tx.select().from(financialAdjustmentRequests).where(and(
          eq(financialAdjustmentRequests.id, requestId),
          eq(financialAdjustmentRequests.schoolId, schoolId),
          eq(financialAdjustmentRequests.paymentId, payment.id),
        )).for('update').limit(1);
        if (!request) throw Object.assign(new Error('Adjustment request not found'), { statusCode: 404 });
        if (request.requestedByUserId === actor.id) {
          throw Object.assign(new Error('A requester cannot decide their own adjustment request'), { statusCode: 403 });
        }
        const nextStatus = decision === 'approve' ? 'approved' : 'rejected';
        if (request.status !== 'pending') {
          const sameDecision = request.status === nextStatus
            && request.decidedByUserId === actor.id
            && request.decisionReason === decisionReason;
          if (sameDecision) return { request, duplicate: true };
          throw Object.assign(new Error('Adjustment request has already been decided'), { statusCode: 409 });
        }

        let resultingAdjustmentId: number | null = null;
        if (decision === 'approve') {
          if (payment.status !== 'posted') {
            throw Object.assign(new Error('Only posted payments can be adjusted'), { statusCode: 409 });
          }
          const balance = await loadRemainingPaymentBalance(tx, payment.id);
          if (!balance.remaining || (request.amount != null && request.amount > balance.remaining)) {
            throw Object.assign(new Error('The remaining refundable amount has changed'), { statusCode: 409 });
          }
          if (request.kind === 'cancellation') {
            const sourceKey = `cancel:${payment.id}`;
            const [existingCancellation] = await tx.select({ id: financialAdjustments.id })
              .from(financialAdjustments)
              .where(eq(financialAdjustments.sourceKey, sourceKey))
              .limit(1);
            if (existingCancellation) {
              throw Object.assign(new Error('Payment already has a cancellation adjustment'), { statusCode: 409 });
            }
            const applied = await applyPaymentAdjustmentInTransaction(tx, {
              actor,
              schoolId,
              payment,
              kind: 'cancellation',
              amount: null,
              reason: request.reason,
              sourceKey,
            });
            resultingAdjustmentId = applied.adjustment.id;
          }
        }

        const before = request;
        const [updatedRequest] = await tx.update(financialAdjustmentRequests).set({
          status: nextStatus,
          decidedByUserId: actor.id,
          decidedByRole: actor.role,
          decidedByName: actor.name ?? null,
          decidedByEmail: actor.email ?? null,
          decidedAt: new Date(),
          decisionReason,
          resultingAdjustmentId,
          updatedAt: new Date(),
        }).where(and(
          eq(financialAdjustmentRequests.id, requestId),
          eq(financialAdjustmentRequests.status, 'pending'),
        )).returning();
        if (!updatedRequest) throw Object.assign(new Error('Adjustment request has already been decided'), { statusCode: 409 });
        await addAudit(tx, actor, schoolId, decision, 'financial_adjustment_request', requestId,
          `${request.kind} request ${nextStatus} for payment ${payment.id}.`,
          createAuditSnapshot(before, ['status', 'kind', 'amount', 'resultingAdjustmentId']),
          createAuditSnapshot(updatedRequest, ['status', 'decidedByUserId', 'decidedByRole', 'decidedAt', 'resultingAdjustmentId']),
          decisionReason);
        return { request: updatedRequest, duplicate: false };
      });
      return res.json(result);
    } catch (error) {
      const statusCode = typeof error === 'object' && error && 'statusCode' in error ? Number(error.statusCode) : 500;
      if (statusCode !== 500) return res.status(statusCode).json({ error: (error as Error).message });
      console.error('Failed to decide accounting adjustment request:', error);
      return res.status(500).json({ error: 'Failed to decide adjustment request' });
    }
  });

  app.post('/api/accounting/adjustment-requests/:id/refund-confirmation', async (req, res) => {
    try {
      const actor = await actorFor(req, res, 'confirm_refund');
      if (!actor) return;
      if (!actor.id) return res.status(401).json({ error: 'Authenticated account identity is unavailable' });
      const schoolId = await getSchoolId(actor, undefined, res);
      if (!schoolId) return;
      const requestId = asPositiveInt(req.params.id);
      if (!requestId) return res.status(400).json({ error: 'Invalid adjustment request id' });
      const [scopedRequest] = await db.select({
        paymentId: financialAdjustmentRequests.paymentId,
      }).from(financialAdjustmentRequests).where(and(
        eq(financialAdjustmentRequests.id, requestId),
        eq(financialAdjustmentRequests.schoolId, schoolId),
      )).limit(1);
      if (!scopedRequest) return res.status(404).json({ error: 'Adjustment request not found' });

      const result = await db.transaction(async (tx) => {
        await assertSchoolActiveInTransaction(tx, schoolId);
        const [payment] = await tx.select().from(financialPayments).where(and(
          eq(financialPayments.id, scopedRequest.paymentId),
          eq(financialPayments.schoolId, schoolId),
        )).for('update').limit(1);
        if (!payment) throw Object.assign(new Error('Payment not found'), { statusCode: 404 });
        const [request] = await tx.select().from(financialAdjustmentRequests).where(and(
          eq(financialAdjustmentRequests.id, requestId),
          eq(financialAdjustmentRequests.schoolId, schoolId),
          eq(financialAdjustmentRequests.paymentId, payment.id),
        )).for('update').limit(1);
        if (!request) throw Object.assign(new Error('Adjustment request not found'), { statusCode: 404 });
        if (request.kind !== 'refund' || request.status !== 'approved') {
          throw Object.assign(new Error('Only approved refund requests can be confirmed'), { statusCode: 409 });
        }
        if (request.resultingAdjustmentId != null) {
          const [adjustment] = await tx.select().from(financialAdjustments)
            .where(eq(financialAdjustments.id, request.resultingAdjustmentId)).limit(1);
          if (!adjustment) throw new Error('The confirmed refund adjustment is missing');
          return { request, adjustment, duplicate: true };
        }
        if (payment.status !== 'posted' || request.amount == null) {
          throw Object.assign(new Error('Payment is no longer eligible for this refund'), { statusCode: 409 });
        }
        const balance = await loadRemainingPaymentBalance(tx, payment.id);
        if (request.amount > balance.remaining) {
          throw Object.assign(new Error('The remaining refundable amount is lower than the approved amount'), { statusCode: 409 });
        }
        const applied = await applyPaymentAdjustmentInTransaction(tx, {
          actor,
          schoolId,
          payment,
          kind: 'refund',
          amount: request.amount,
          reason: request.reason,
          sourceKey: `refund-request:${request.id}`,
        });
        const [updatedRequest] = await tx.update(financialAdjustmentRequests).set({
          resultingAdjustmentId: applied.adjustment.id,
          refundConfirmedByUserId: actor.id,
          refundConfirmedByRole: actor.role,
          refundConfirmedByName: actor.name ?? null,
          refundConfirmedByEmail: actor.email ?? null,
          refundConfirmedAt: new Date(),
          updatedAt: new Date(),
        }).where(and(
          eq(financialAdjustmentRequests.id, request.id),
          eq(financialAdjustmentRequests.status, 'approved'),
          isNull(financialAdjustmentRequests.resultingAdjustmentId),
        )).returning();
        if (!updatedRequest) throw Object.assign(new Error('Refund has already been confirmed'), { statusCode: 409 });
        await addAudit(tx, actor, schoolId, 'refund_confirmed', 'financial_adjustment_request', request.id,
          `Approved refund request executed for payment ${payment.id}.`,
          createAuditSnapshot(request, ['status', 'amount', 'resultingAdjustmentId']),
          createAuditSnapshot(updatedRequest, [
            'status', 'amount', 'resultingAdjustmentId', 'refundConfirmedByUserId', 'refundConfirmedByRole', 'refundConfirmedAt',
          ]),
          request.reason);
        return { request: updatedRequest, adjustment: applied.adjustment, duplicate: false };
      });
      return res.status(result.duplicate ? 200 : 201).json(result);
    } catch (error) {
      const statusCode = typeof error === 'object' && error && 'statusCode' in error ? Number(error.statusCode) : 500;
      if (statusCode !== 500) return res.status(statusCode).json({ error: (error as Error).message });
      console.error('Failed to confirm accounting refund:', error);
      return res.status(500).json({ error: 'Failed to confirm refund' });
    }
  });

  app.get('/api/accounting/cash', async (req, res) => {
    try {
      const actor = await actorFor(req, res);
      if (!actor) return;
      const schoolId = await getSchoolId(actor, req.query.schoolId, res);
      if (!schoolId) return;
      const conditions = [
        eq(financialPayments.schoolId, schoolId),
        eq(financialPayments.status, 'posted'),
      ];
      const yearId = req.query.academicYearId == null ? null : asPositiveInt(req.query.academicYearId);
      const studentId = req.query.studentId == null ? null : asPositiveInt(req.query.studentId);
      const categoryId = req.query.categoryId == null ? null : asPositiveInt(req.query.categoryId);
      const classId = req.query.classId == null ? null : asPositiveInt(req.query.classId);
      const rawTariffIds = req.query.tariffId == null
        ? []
        : Array.isArray(req.query.tariffId) ? req.query.tariffId : [req.query.tariffId];
      const tariffIds = rawTariffIds.map(asPositiveInt);
      const method = typeof req.query.method === 'string' ? req.query.method : null;
      const startDate = req.query.startDate == null ? null : asDate(req.query.startDate);
      const endDate = req.query.endDate == null ? null : asDate(req.query.endDate);
      const allowedMethods = ['cash', 'tmoney', 'flooz', 'bank_transfer', 'check', 'other'];
      if ((req.query.academicYearId != null && !yearId) || (req.query.studentId != null && !studentId)
        || (req.query.categoryId != null && !categoryId) || (req.query.classId != null && !classId)
        || tariffIds.some((id) => !id)
        || (req.query.startDate != null && !startDate) || (req.query.endDate != null && !endDate)
        || (method != null && !allowedMethods.includes(method))
        || (startDate != null && endDate != null && startDate > endDate)) {
        return res.status(400).json({ error: 'Invalid cash filter' });
      }
      if (yearId) conditions.push(eq(financialPayments.academicYearId, yearId));
      if (studentId) conditions.push(eq(financialPayments.studentId, studentId));
      if (categoryId) conditions.push(eq(financialObligations.categoryId, categoryId));
      if (classId) conditions.push(eq(financialObligations.classId, classId));
      if (tariffIds.length) conditions.push(inArray(financialObligations.tariffId, tariffIds as number[]));
      if (method) conditions.push(eq(financialPayments.method, method));
      if (startDate) conditions.push(sql`${financialPayments.paidAt} >= ${startDate}::date`);
      if (endDate) conditions.push(sql`${financialPayments.paidAt} < (${endDate}::date + interval '1 day')`);
      const rows = await db.select({
        allocationId: financialPaymentAllocations.id,
        amount: financialPaymentAllocations.amount,
        categoryCode: accountingCategories.code,
        categoryLabel: sql<string>`COALESCE(${accountingTariffs.label}, ${accountingCategories.label})`,
        method: financialPayments.method,
        paymentId: financialPayments.id,
        paidAt: financialPayments.paidAt,
        receiptId: financialReceipts.id,
        receiptNumber: financialReceipts.receiptNumber,
        classId: financialObligations.classId,
        studentId: financialPayments.studentId,
        studentName: sql<string>`concat_ws(' ', ${students.lastName}, ${students.firstName})`,
        tariffId: financialObligations.tariffId,
      }).from(financialPaymentAllocations)
        .innerJoin(financialPayments, eq(financialPayments.id, financialPaymentAllocations.paymentId))
        .innerJoin(financialObligations, eq(financialObligations.id, financialPaymentAllocations.obligationId))
        .innerJoin(accountingCategories, eq(accountingCategories.id, financialObligations.categoryId))
        .leftJoin(accountingTariffs, eq(accountingTariffs.id, financialObligations.tariffId))
        .leftJoin(financialReceipts, eq(financialReceipts.paymentId, financialPayments.id))
        .innerJoin(students, eq(students.id, financialPayments.studentId))
        .where(and(...conditions));
      const allocationIds = rows.map((row) => row.allocationId);
      const adjustments = allocationIds.length
        ? await db.select({
          paymentAllocationId: financialAdjustmentAllocations.paymentAllocationId,
          amount: sql<number>`sum(${financialAdjustmentAllocations.amount})::int`,
        }).from(financialAdjustmentAllocations)
          .innerJoin(financialAdjustments, eq(financialAdjustments.id, financialAdjustmentAllocations.adjustmentId))
          .where(inArray(financialAdjustmentAllocations.paymentAllocationId, allocationIds))
          .groupBy(financialAdjustmentAllocations.paymentAllocationId)
        : [];
      const adjustedById = getAdjustmentTotals(rows.map((row) => ({
        id: row.allocationId,
        obligationId: 0,
        installmentId: null,
        amount: row.amount,
      })), adjustments);
      const categories = new Map<string, number>();
      const methods = new Map<string, number>();
      let total = 0;
      for (const row of rows) {
        const net = row.amount - (adjustedById.get(row.allocationId) ?? 0);
        total += net;
        categories.set(row.categoryCode, (categories.get(row.categoryCode) ?? 0) + net);
        methods.set(row.method, (methods.get(row.method) ?? 0) + net);
      }
      const obligationTotals = await fetchObligationTotals(db, schoolId, yearId, {
        studentId,
        categoryId,
        classId,
        tariffIds,
      });
      return res.json({
        total,
        categories: Object.fromEntries(categories),
        methods: Object.fromEntries(methods),
        ...obligationTotals,
        currency: 'XOF',
        paymentCount: new Set(rows.map((row) => row.paymentId)).size,
        allocations: rows.map((row) => ({
          ...row,
          amount: row.amount - (adjustedById.get(row.allocationId) ?? 0),
        })),
      });
    } catch (error) {
      console.error('Failed to load accounting cash report:', error);
      return res.status(500).json({ error: 'Failed to load accounting cash report' });
    }
  });

  app.get('/api/accounting/dashboard', async (req, res) => {
    try {
      const actor = await actorFor(req, res);
      if (!actor) return;
      const schoolId = await getSchoolId(actor, req.query.schoolId, res);
      if (!schoolId) return;
      const yearId = req.query.academicYearId == null ? null : asPositiveInt(req.query.academicYearId);
      if (req.query.academicYearId != null && !yearId) return res.status(400).json({ error: 'Invalid academicYearId' });
      const conditions = [eq(financialObligations.schoolId, schoolId), eq(financialObligations.status, 'active')];
      if (yearId) conditions.push(eq(financialObligations.academicYearId, yearId));
      const obligations = await db.select({
        id: financialObligations.id,
        amount: financialObligations.amount,
        studentId: financialObligations.studentId,
      }).from(financialObligations).where(and(...conditions));
      const payments = await db.select({
        id: financialPayments.id,
        amount: financialPayments.amount,
        method: financialPayments.method,
        paidAt: financialPayments.paidAt,
      }).from(financialPayments).where(and(
        eq(financialPayments.schoolId, schoolId),
        eq(financialPayments.status, 'posted'),
        ...(yearId ? [eq(financialPayments.academicYearId, yearId)] : []),
      )).orderBy(desc(financialPayments.paidAt)).limit(10);
      const cashResponse = await fetchAccountingCash(db, schoolId, yearId);
      const { lateInstallments, dueSoonInstallments } = await loadOverdueInstallments(db, schoolId, yearId);
      return res.json({
        ...cashResponse,
        studentCount: new Set(obligations.map((row) => row.studentId)).size,
        overdueInstallmentCount: lateInstallments.length,
        upcomingInstallmentCount: dueSoonInstallments.length,
        recentPaymentCount: payments.length,
        recentPayments: payments,
      });
    } catch (error) {
      console.error('Failed to load accounting dashboard:', error);
      return res.status(500).json({ error: 'Failed to load accounting dashboard' });
    }
  });

  const resolveReminderScope = async (
    actor: AccountingActor,
    requestedSchoolId: unknown,
    requestedYearId: unknown,
    requestedClassId: unknown,
    requestedStatus: unknown,
    res: express.Response,
  ) => {
    const schoolId = await getSchoolId(actor, requestedSchoolId, res);
    if (!schoolId) return null;
    const academicYearId = asPositiveInt(requestedYearId);
    if (!academicYearId) {
      res.status(400).json({ error: 'A valid academicYearId is required' });
      return null;
    }
    const classId = requestedClassId == null || requestedClassId === ''
      ? null
      : asPositiveInt(requestedClassId);
    if (requestedClassId != null && requestedClassId !== '' && !classId) {
      res.status(400).json({ error: 'Invalid classId' });
      return null;
    }
    const status = requestedStatus == null || requestedStatus === ''
      ? 'all'
      : asReminderStatusFilter(requestedStatus);
    if (!status) {
      res.status(400).json({ error: 'Invalid reminder status filter' });
      return null;
    }

    const [year] = await db.select({
      id: academicYears.id,
      schoolId: academicYears.schoolId,
      name: academicYears.name,
    }).from(academicYears).where(eq(academicYears.id, academicYearId));
    if (!year || (year.schoolId != null && year.schoolId !== schoolId)) {
      res.status(404).json({ error: 'Academic year not found in this school' });
      return null;
    }
    if (classId != null && !await validateClassAndYear(schoolId, classId, academicYearId)) {
      res.status(404).json({ error: 'Class not found in this school and academic year' });
      return null;
    }
    const [school] = await db.select({ name: schools.name })
      .from(schools)
      .where(eq(schools.id, schoolId));
    if (!school) {
      res.status(404).json({ error: 'School not found' });
      return null;
    }

    return {
      schoolId,
      academicYearId,
      classId,
      status,
      schoolName: school.name,
      yearName: year.name,
    };
  };

  const isReminderStudentScopeValid = async (
    executor: Pick<typeof defaultDb, 'select'>,
    schoolId: number,
    studentIds: number[],
  ) => {
    const rows = await executor.select({ id: students.id })
      .from(students)
      .where(and(
        eq(students.schoolId, schoolId),
        inArray(students.id, studentIds),
      ))
      .for('share');
    return rows.length === studentIds.length;
  };

  const getReminderPreviewFingerprint = (
    scope: AccountingReminderScope,
    studentIds: number[],
    candidates: AccountingReminderCandidate[],
  ) => getAccountingReminderPreviewFingerprint({
    schoolId: scope.schoolId,
    academicYearId: scope.academicYearId,
    classId: scope.classId,
    status: scope.status,
    selectedStudentIds: studentIds,
    candidates: candidates.map((candidate) => ({
      studentId: candidate.studentId,
      recipientUserId: candidate.recipientUserId,
      canSend: candidate.canSend,
      dedupeKey: candidate.dedupeKey,
      message: candidate.message,
      installments: candidate.installments,
      ambiguousInstallments: candidate.ambiguousInstallments,
      reason: candidate.reason,
    })),
  });

  app.post('/api/accounting/notifications/overdue', async (req, res) => {
    const actor = await actorFor(req, res, 'manual_reminder');
    if (!actor) return;
    return res.status(410).json({
      error: 'Les rappels globaux implicites sont désactivés. Utilisez l’aperçu puis confirmez les élèves sélectionnés.',
      code: 'MANUAL_REMINDER_PREVIEW_REQUIRED',
    });
  });

  app.get('/api/accounting/reminders/candidates', async (req, res) => {
    try {
      const actor = await actorFor(req, res, 'manual_reminder');
      if (!actor) return;
      const scope = await resolveReminderScope(
        actor,
        req.query?.schoolId,
        req.query?.academicYearId,
        req.query?.classId,
        req.query?.status,
        res,
      );
      if (!scope) return;
      const candidates = await loadAccountingReminderCandidates(db, {
        ...scope,
        schoolName: scope.schoolName,
        yearName: scope.yearName,
      });
      return res.json({
        candidates: candidates.map(publicAccountingReminderCandidate),
        deliveryChannel: 'in_app',
        reminderPreferencesAvailable: false,
      });
    } catch (error) {
      console.error('Failed to load accounting payment reminder candidates:', error);
      return res.status(500).json({ error: 'Failed to load payment reminder candidates' });
    }
  });

  app.post('/api/accounting/reminders/preview', async (req, res) => {
    try {
      const actor = await actorFor(req, res, 'manual_reminder');
      if (!actor) return;
      const scope = await resolveReminderScope(
        actor,
        req.body?.schoolId,
        req.body?.academicYearId,
        req.body?.classId,
        req.body?.status,
        res,
      );
      if (!scope) return;
      const studentIds = asStudentIdList(req.body?.studentIds);
      if (!studentIds) return res.status(400).json({ error: 'Select at least one valid student' });
      if (!await isReminderStudentScopeValid(db, scope.schoolId, studentIds)) {
        return res.status(403).json({ error: 'A selected student is outside the authorized school' });
      }

      const candidates = await loadAccountingReminderCandidates(db, {
        ...scope,
        schoolName: scope.schoolName,
        yearName: scope.yearName,
        selectedStudentIds: studentIds,
      });
      return res.json({
        previewFingerprint: getReminderPreviewFingerprint(scope, studentIds, candidates),
        candidates: candidates.map(publicAccountingReminderCandidate),
        deliveryChannel: 'in_app',
        reminderPreferencesAvailable: false,
      });
    } catch (error) {
      console.error('Failed to preview accounting payment reminders:', error);
      return res.status(500).json({ error: 'Failed to preview payment reminders' });
    }
  });

  app.post('/api/accounting/reminders/confirm', async (req, res) => {
    const actor = await actorFor(req, res, 'manual_reminder');
    if (!actor) return;
    try {
      const scope = await resolveReminderScope(
        actor,
        req.body?.schoolId,
        req.body?.academicYearId,
        req.body?.classId,
        req.body?.status,
        res,
      );
      if (!scope) return;
      const studentIds = asStudentIdList(req.body?.studentIds);
      const previewFingerprint = typeof req.body?.previewFingerprint === 'string'
        ? req.body.previewFingerprint
        : '';
      if (!studentIds || !/^[a-f0-9]{64}$/i.test(previewFingerprint)) {
        return res.status(400).json({ error: 'A valid preview and selected students are required' });
      }

      const result = await db.transaction(async (tx) => {
        await assertSchoolActiveInTransaction(tx, scope.schoolId);
        await tx.execute(sql`SELECT id FROM academic_years WHERE id = ${scope.academicYearId} FOR UPDATE`);
        if (!await isReminderStudentScopeValid(tx, scope.schoolId, studentIds)) {
          return { kind: 'student-scope-invalid' as const };
        }

        const obligationConditions = [
          eq(financialObligations.schoolId, scope.schoolId),
          eq(financialObligations.academicYearId, scope.academicYearId),
          eq(financialObligations.status, 'active'),
          inArray(financialObligations.studentId, studentIds),
          ...(scope.classId == null ? [] : [eq(financialObligations.classId, scope.classId)]),
        ];
        const obligations = await tx.select({ id: financialObligations.id })
          .from(financialObligations)
          .where(and(...obligationConditions));
        const obligationIds = obligations.map((obligation) => obligation.id);
        const paymentIdRows = obligationIds.length
          ? await tx.select({ id: financialPaymentAllocations.paymentId })
            .from(financialPaymentAllocations)
            .where(inArray(financialPaymentAllocations.obligationId, obligationIds))
          : [];
        const paymentIds = [...new Set(paymentIdRows.map((row) => row.id))];
        if (paymentIds.length > 0) {
          await tx.select({ id: financialPayments.id })
            .from(financialPayments)
            .where(inArray(financialPayments.id, paymentIds))
            .for('update');
        }

        const candidates = await loadAccountingReminderCandidates(tx, {
          ...scope,
          schoolName: scope.schoolName,
          yearName: scope.yearName,
          selectedStudentIds: studentIds,
        });
        const currentFingerprint = getReminderPreviewFingerprint(scope, studentIds, candidates);
        if (currentFingerprint !== previewFingerprint) {
          return {
            kind: 'stale-preview' as const,
            previewFingerprint: currentFingerprint,
            candidates: candidates.map(publicAccountingReminderCandidate),
          };
        }

        const operationResult = {
          kind: 'complete' as const,
          selectedStudentCount: studentIds.length,
          createdNotifications: 0,
          duplicateCount: 0,
          excludedZeroBalance: 0,
          excludedAmbiguous: 0,
          excludedNoRecipient: 0,
          excludedNoMatchingInstallments: 0,
          studentsWithAmbiguousInstallments: 0,
          ambiguousInstallmentCount: 0,
          failedCount: 0,
          deliveryChannel: 'in_app' as const,
        };
        for (const candidate of candidates) {
          if (candidate.ambiguousInstallments.length > 0) {
            operationResult.studentsWithAmbiguousInstallments += 1;
            operationResult.ambiguousInstallmentCount += candidate.ambiguousInstallments.length;
          }
          if (candidate.installments.length === 0) {
            if (candidate.ambiguousInstallments.length > 0) {
              operationResult.excludedAmbiguous += 1;
            } else if (candidate.status === 'settled') {
              operationResult.excludedZeroBalance += 1;
            } else {
              operationResult.excludedNoMatchingInstallments += 1;
            }
            continue;
          }
          if (candidate.recipientUserId == null) {
            operationResult.excludedNoRecipient += 1;
            continue;
          }
          if (!candidate.message || !candidate.dedupeKey) {
            throw new Error(`Reminder preview is incomplete for student ${candidate.studentId}`);
          }
          const [insertedNotification] = await tx.insert(notifications).values({
            userId: candidate.recipientUserId,
            title: 'Rappel de paiement',
            body: candidate.message,
            type: 'info',
            dedupeKey: candidate.dedupeKey,
          }).onConflictDoNothing().returning({ id: notifications.id });
          if (insertedNotification) {
            operationResult.createdNotifications += 1;
            await addAudit(tx, actor, scope.schoolId, 'send_manual_reminder', 'payment_reminder',
              insertedNotification.id, 'Rappel manuel de scolarité envoyé.', null,
              createAuditSnapshot({
                studentId: candidate.studentId,
                academicYearId: scope.academicYearId,
                amount: candidate.totalRemaining,
                status: candidate.status,
                installmentCount: candidate.installments.length,
              }, ['studentId', 'academicYearId', 'amount', 'status', 'installmentCount']));
          } else {
            operationResult.duplicateCount += 1;
          }
        }
        return operationResult;
      });

      if (result.kind === 'student-scope-invalid') {
        return res.status(403).json({ error: 'A selected student is outside the authorized school' });
      }
      if (result.kind === 'stale-preview') {
        return res.status(409).json({
          error: 'Les soldes ou les destinataires ont changé. Vérifiez le nouvel aperçu avant de confirmer.',
          code: 'ACCOUNTING_REMINDER_PREVIEW_STALE',
          previewFingerprint: result.previewFingerprint,
          candidates: result.candidates,
        });
      }
      return res.json(result);
    } catch (error) {
      console.error('Failed to confirm accounting payment reminders:', error);
      return res.status(500).json({
        error: 'La confirmation a échoué ; aucune notification de cette opération n’a été enregistrée.',
        code: 'ACCOUNTING_REMINDER_CONFIRMATION_FAILED',
        failedCount: 1,
      });
    }
  });

  app.get('/api/accounting/receipts/:id', async (req, res) => {
    try {
      const actor = await actorFor(req, res);
      if (!actor) return;
      const receiptId = asPositiveInt(req.params.id);
      if (!receiptId) return res.status(400).json({ error: 'Invalid receipt id' });
      const activeSchoolId = actor.role === 'school_admin' || actor.role === 'school_accountant'
        ? await getSchoolId(actor, undefined, res)
        : null;
      if ((actor.role === 'school_admin' || actor.role === 'school_accountant') && !activeSchoolId) return;
      const [receipt] = await db.select().from(financialReceipts).where(and(
        eq(financialReceipts.id, receiptId),
        ...(activeSchoolId == null ? [] : [eq(financialReceipts.schoolId, activeSchoolId)]),
      ));
      if (!receipt) return res.status(404).json({ error: 'Receipt not found' });
      const schoolId = await getSchoolId(actor, activeSchoolId ?? receipt.schoolId, res);
      if (!schoolId) return;
      if (receipt.schoolId !== schoolId) return res.status(403).json({ error: 'Forbidden' });
      const [payment] = await db.select({
        status: financialPayments.status,
      }).from(financialPayments).where(and(
        eq(financialPayments.id, receipt.paymentId),
        eq(financialPayments.schoolId, schoolId),
      ));
      if (!payment) return res.status(404).json({ error: 'Payment not found for this receipt' });
      if (payment.status !== 'posted') {
        return res.status(409).json({ error: 'Le reçu d’un paiement annulé ne peut pas être réimprimé.' });
      }
      const pdf = await renderAccountingReceipt(receipt.snapshot);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="${receipt.receiptNumber}.pdf"`);
      return res.send(Buffer.from(pdf));
    } catch (error) {
      console.error('Failed to generate accounting receipt PDF:', error);
      return res.status(500).json({ error: 'Failed to generate receipt PDF' });
    }
  });
};

async function fetchAccountingCash(db: typeof defaultDb, schoolId: number, academicYearId: number | null) {
  const conditions = [
    eq(financialPayments.schoolId, schoolId),
    eq(financialPayments.status, 'posted'),
  ];
  if (academicYearId) conditions.push(eq(financialPayments.academicYearId, academicYearId));
  const rows = await db.select({
    allocationId: financialPaymentAllocations.id,
    amount: financialPaymentAllocations.amount,
    categoryCode: accountingCategories.code,
    categoryLabel: sql<string>`COALESCE(${accountingTariffs.label}, ${accountingCategories.label})`,
  }).from(financialPaymentAllocations)
    .innerJoin(financialPayments, eq(financialPayments.id, financialPaymentAllocations.paymentId))
    .innerJoin(financialObligations, eq(financialObligations.id, financialPaymentAllocations.obligationId))
    .innerJoin(accountingCategories, eq(accountingCategories.id, financialObligations.categoryId))
    .leftJoin(accountingTariffs, eq(accountingTariffs.id, financialObligations.tariffId))
    .where(and(...conditions));
  const adjustments = rows.length
    ? await db.select({
      paymentAllocationId: financialAdjustmentAllocations.paymentAllocationId,
      amount: sql<number>`sum(${financialAdjustmentAllocations.amount})::int`,
    }).from(financialAdjustmentAllocations)
      .innerJoin(financialAdjustments, eq(financialAdjustments.id, financialAdjustmentAllocations.adjustmentId))
      .where(inArray(financialAdjustmentAllocations.paymentAllocationId, rows.map((row) => row.allocationId)))
      .groupBy(financialAdjustmentAllocations.paymentAllocationId)
    : [];
  const adjustedById = getAdjustmentTotals(
    rows.map((row) => ({ id: row.allocationId, amount: row.amount, obligationId: 0, installmentId: null })),
    adjustments,
  );
  const categories = new Map<string, number>();
  let total = 0;
  for (const row of rows) {
    const net = row.amount - (adjustedById.get(row.allocationId) ?? 0);
    categories.set(row.categoryCode, (categories.get(row.categoryCode) ?? 0) + net);
    total += net;
  }

  const obligationTotals = await fetchObligationTotals(db, schoolId, academicYearId);
  return { total, categories: Object.fromEntries(categories), ...obligationTotals, currency: 'XOF' };
}

async function fetchObligationTotals(
  db: typeof defaultDb,
  schoolId: number,
  academicYearId: number | null,
  filters: {
    studentId?: number | null;
    categoryId?: number | null;
    classId?: number | null;
    tariffIds?: number[];
  } = {},
) {
  const obligations = await db.select({
    amount: financialObligations.amount,
    id: financialObligations.id,
  }).from(financialObligations).where(and(
    eq(financialObligations.schoolId, schoolId),
    eq(financialObligations.status, 'active'),
    ...(academicYearId ? [eq(financialObligations.academicYearId, academicYearId)] : []),
    ...(filters.studentId ? [eq(financialObligations.studentId, filters.studentId)] : []),
    ...(filters.categoryId ? [eq(financialObligations.categoryId, filters.categoryId)] : []),
    ...(filters.classId ? [eq(financialObligations.classId, filters.classId)] : []),
    ...(filters.tariffIds?.length ? [inArray(financialObligations.tariffId, filters.tariffIds)] : []),
  ));
  const allocations = obligations.length
    ? await db.select({
      id: financialPaymentAllocations.id,
      obligationId: financialPaymentAllocations.obligationId,
      amount: financialPaymentAllocations.amount,
    }).from(financialPaymentAllocations)
      .innerJoin(financialPayments, eq(financialPayments.id, financialPaymentAllocations.paymentId))
      .where(and(
        inArray(financialPaymentAllocations.obligationId, obligations.map((row) => row.id)),
        eq(financialPayments.status, 'posted'),
      ))
    : [];
  const adjustments = allocations.length
    ? await db.select({
      paymentAllocationId: financialAdjustmentAllocations.paymentAllocationId,
      amount: sql<number>`sum(${financialAdjustmentAllocations.amount})::int`,
    }).from(financialAdjustmentAllocations)
      .innerJoin(financialAdjustments, eq(financialAdjustments.id, financialAdjustmentAllocations.adjustmentId))
      .where(inArray(financialAdjustmentAllocations.paymentAllocationId, allocations.map((row) => row.id)))
      .groupBy(financialAdjustmentAllocations.paymentAllocationId)
    : [];
  const adjustedById = getAdjustmentTotals(
    allocations.map((row) => ({ ...row, installmentId: null })),
    adjustments,
  );
  const paidByObligation = new Map<number, number>();
  for (const allocation of allocations) {
    paidByObligation.set(
      allocation.obligationId,
      (paidByObligation.get(allocation.obligationId) ?? 0)
        + allocation.amount - (adjustedById.get(allocation.id) ?? 0),
    );
  }
  const expected = obligations.reduce((sum, obligation) => sum + obligation.amount, 0);
  const paid = obligations.reduce((sum, obligation) => sum + (paidByObligation.get(obligation.id) ?? 0), 0);
  return { expected, paid, remaining: Math.max(0, expected - paid) };
}

async function loadOverdueInstallments(db: typeof defaultDb, schoolId: number, academicYearId: number | null) {
  const conditions = [
    eq(financialObligations.schoolId, schoolId),
    eq(financialObligations.status, 'active'),
    ...(academicYearId ? [eq(financialObligations.academicYearId, academicYearId)] : []),
  ];
  const obligations = await db.select({
    id: financialObligations.id,
    studentId: financialObligations.studentId,
  }).from(financialObligations).where(and(...conditions));
  if (!obligations.length) return { obligations, lateInstallments: [], dueSoonInstallments: [] };

  const installments = await db.select().from(financialInstallments)
    .where(inArray(financialInstallments.obligationId, obligations.map((row) => row.id)));
  const allocations = await db.select({
    id: financialPaymentAllocations.id,
    installmentId: financialPaymentAllocations.installmentId,
    amount: financialPaymentAllocations.amount,
  }).from(financialPaymentAllocations)
    .innerJoin(financialPayments, eq(financialPayments.id, financialPaymentAllocations.paymentId))
    .where(and(
      inArray(financialPaymentAllocations.obligationId, obligations.map((row) => row.id)),
      eq(financialPayments.status, 'posted'),
    ));
  const adjustments = allocations.length
    ? await db.select({
      paymentAllocationId: financialAdjustmentAllocations.paymentAllocationId,
      amount: sql<number>`sum(${financialAdjustmentAllocations.amount})::int`,
    }).from(financialAdjustmentAllocations)
      .innerJoin(financialAdjustments, eq(financialAdjustments.id, financialAdjustmentAllocations.adjustmentId))
      .where(inArray(financialAdjustmentAllocations.paymentAllocationId, allocations.map((row) => row.id)))
      .groupBy(financialAdjustmentAllocations.paymentAllocationId)
    : [];
  const adjustedById = getAdjustmentTotals(
    allocations.map((row) => ({ ...row, obligationId: 0 })),
    adjustments,
  );
  const paidByInstallment = new Map<number, number>();
  for (const allocation of allocations) {
    if (allocation.installmentId == null) continue;
    paidByInstallment.set(
      allocation.installmentId,
      (paidByInstallment.get(allocation.installmentId) ?? 0)
        + allocation.amount - (adjustedById.get(allocation.id) ?? 0),
    );
  }
  const today = todayUtc();
  const dueSoonLimit = new Date(`${today}T00:00:00.000Z`);
  dueSoonLimit.setUTCDate(dueSoonLimit.getUTCDate() + 7);
  const latestDueSoonDate = dueSoonLimit.toISOString().slice(0, 10);
  const unpaidInstallments = installments.filter((installment) =>
    (paidByInstallment.get(installment.id) ?? 0) < installment.amount);
  return {
    obligations,
    lateInstallments: unpaidInstallments.filter((installment) => installment.dueDate < today),
    dueSoonInstallments: unpaidInstallments.filter((installment) =>
      installment.dueDate >= today && installment.dueDate <= latestDueSoonDate),
  };
}

async function loadAccountingReminderCandidates(
  executor: Pick<typeof defaultDb, 'select'>,
  input: AccountingReminderScope & {
    schoolName: string;
    yearName: string;
    selectedStudentIds?: number[];
    today?: string;
  },
): Promise<AccountingReminderCandidate[]> {
  const obligationConditions = [
    eq(financialObligations.schoolId, input.schoolId),
    eq(financialObligations.academicYearId, input.academicYearId),
    eq(financialObligations.status, 'active'),
    eq(students.schoolId, input.schoolId),
    ...(input.classId == null ? [] : [eq(financialObligations.classId, input.classId)]),
    ...(input.selectedStudentIds == null
      ? []
      : [inArray(financialObligations.studentId, input.selectedStudentIds)]),
  ];
  const obligationRows = await executor.select({
    id: financialObligations.id,
    studentId: financialObligations.studentId,
    classNameSnapshot: financialObligations.classNameSnapshot,
    obligationClassName: classes.name,
    label: financialObligations.label,
    tariffLabel: accountingTariffs.label,
    categoryLabel: accountingCategories.label,
  }).from(financialObligations)
    .innerJoin(students, eq(students.id, financialObligations.studentId))
    .leftJoin(classes, eq(classes.id, financialObligations.classId))
    .innerJoin(accountingCategories, eq(accountingCategories.id, financialObligations.categoryId))
    .leftJoin(accountingTariffs, eq(accountingTariffs.id, financialObligations.tariffId))
    .where(and(...obligationConditions))
    .orderBy(asc(students.lastName), asc(students.firstName), asc(financialObligations.id));

  const obligationIds = obligationRows.map((row) => row.id);
  const installmentRows = obligationIds.length
    ? await executor.select().from(financialInstallments)
      .where(inArray(financialInstallments.obligationId, obligationIds))
      .orderBy(asc(financialInstallments.dueDate), asc(financialInstallments.id))
    : [];
  const allocationRows = obligationIds.length
    ? await executor.select({
      id: financialPaymentAllocations.id,
      obligationId: financialPaymentAllocations.obligationId,
      installmentId: financialPaymentAllocations.installmentId,
      amount: financialPaymentAllocations.amount,
      paymentSchoolId: financialPayments.schoolId,
      paymentAcademicYearId: financialPayments.academicYearId,
    }).from(financialPaymentAllocations)
      .innerJoin(financialPayments, eq(financialPayments.id, financialPaymentAllocations.paymentId))
      .where(and(
        inArray(financialPaymentAllocations.obligationId, obligationIds),
        eq(financialPayments.status, 'posted'),
      ))
    : [];
  const adjustmentRows = allocationRows.length
    ? await executor.select({
      paymentAllocationId: financialAdjustmentAllocations.paymentAllocationId,
      amount: sql<number>`sum(${financialAdjustmentAllocations.amount})::int`,
    }).from(financialAdjustmentAllocations)
      .innerJoin(financialAdjustments, eq(financialAdjustments.id, financialAdjustmentAllocations.adjustmentId))
      .where(inArray(
        financialAdjustmentAllocations.paymentAllocationId,
        allocationRows.map((row) => row.id),
      ))
      .groupBy(financialAdjustmentAllocations.paymentAllocationId)
    : [];
  const adjustedByAllocationId = getAdjustmentTotals(
    allocationRows.map((row) => ({
      id: row.id,
      amount: row.amount,
      obligationId: row.obligationId,
      installmentId: row.installmentId,
    })),
    adjustmentRows,
  );
  const installmentsByObligation = new Map<number, typeof installmentRows>();
  for (const installment of installmentRows) {
    const current = installmentsByObligation.get(installment.obligationId) ?? [];
    current.push(installment);
    installmentsByObligation.set(installment.obligationId, current);
  }
  const allocationsByObligation = new Map<number, typeof allocationRows>();
  for (const allocation of allocationRows) {
    const current = allocationsByObligation.get(allocation.obligationId) ?? [];
    current.push(allocation);
    allocationsByObligation.set(allocation.obligationId, current);
  }

  const studentIds = input.selectedStudentIds
    ?? [...new Set(obligationRows.map((row) => row.studentId))];
  if (!studentIds.length) return [];
  const studentRows = await executor.select({
    id: students.id,
    firstName: students.firstName,
    lastName: students.lastName,
    className: classes.name,
  }).from(students)
    .leftJoin(classes, eq(classes.id, students.classId))
    .where(and(
      eq(students.schoolId, input.schoolId),
      inArray(students.id, studentIds),
    ));
  const studentById = new Map(studentRows.map((student) => [student.id, student]));

  const groupByStudent = new Map<number, {
    firstName: string;
    lastName: string;
    className: string | null;
    obligationClassNames: Set<string>;
    installments: AccountingReminderInstallmentLine[];
    ambiguousInstallments: AmbiguousAccountingReminderInstallment[];
    matchedInstallmentCount: number;
    settledInstallmentCount: number;
  }>();
  for (const student of studentRows) {
    groupByStudent.set(student.id, {
      firstName: student.firstName,
      lastName: student.lastName,
      className: student.className ?? null,
      obligationClassNames: new Set<string>(),
      installments: [],
      ambiguousInstallments: [],
      matchedInstallmentCount: 0,
      settledInstallmentCount: 0,
    });
  }

  for (const obligation of obligationRows) {
    let group = groupByStudent.get(obligation.studentId);
    if (!group) {
      group = {
        firstName: '',
        lastName: '',
        className: null,
        obligationClassNames: new Set<string>(),
        installments: [],
        ambiguousInstallments: [],
        matchedInstallmentCount: 0,
        settledInstallmentCount: 0,
      };
      groupByStudent.set(obligation.studentId, group);
    }
    const obligationClassName = obligation.classNameSnapshot || obligation.obligationClassName;
    if (obligationClassName) group.obligationClassNames.add(obligationClassName);

    const sourceInstallments = (installmentsByObligation.get(obligation.id) ?? []).map((installment) => ({
      id: installment.id,
      obligationId: installment.obligationId,
      categoryLabel: obligation.categoryLabel?.trim() || 'Frais',
      feeLabel: obligation.tariffLabel?.trim() || obligation.label,
      label: installment.label?.trim() || 'Échéance',
      dueDate: installment.dueDate,
      amount: installment.amount,
    }));
    const sourceAllocations = (allocationsByObligation.get(obligation.id) ?? []).map((allocation) => ({
      obligationId: allocation.obligationId,
      installmentId: allocation.installmentId,
      amount: allocation.amount,
      adjustedAmount: adjustedByAllocationId.get(allocation.id) ?? 0,
      valid: allocation.paymentSchoolId === input.schoolId
        && allocation.paymentAcademicYearId === input.academicYearId,
    }));
    const calculated = calculateAccountingReminderInstallments(
      sourceInstallments,
      sourceAllocations,
      input.today ?? todayUtc(),
      input.status,
    );
    group.matchedInstallmentCount += calculated.matchedCount;
    group.settledInstallmentCount += calculated.settledCount;
    group.installments.push(...calculated.eligible);
    group.ambiguousInstallments.push(...calculated.ambiguous);
  }

  const recipientRows = await executor.select({
    studentId: students.id,
    userId: users.id,
  }).from(students)
    .innerJoin(parents, and(
      eq(parents.id, students.parentId),
      eq(parents.schoolId, input.schoolId),
    ))
    .innerJoin(userSchools, and(
      eq(userSchools.userId, parents.userId),
      eq(userSchools.schoolId, input.schoolId),
      eq(userSchools.role, 'parent'),
      sql`${userSchools.isActive} IS DISTINCT FROM FALSE`,
    ))
    .innerJoin(users, and(
      eq(users.id, parents.userId),
      eq(users.isDeleted, false),
    ))
    .where(and(
      eq(students.schoolId, input.schoolId),
      inArray(students.id, studentIds),
    ))
    .for('share', { of: [parents, userSchools, users] });
  const recipientByStudent = new Map(recipientRows.map((row) => [row.studentId, row.userId]));

  const candidates: AccountingReminderCandidate[] = [];
  for (const studentId of studentIds) {
    const group = groupByStudent.get(studentId);
    const student = studentById.get(studentId);
    if (!group || !student) continue;
    const recipientUserId = recipientByStudent.get(studentId) ?? null;
    const statusSet = new Set<AccountingReminderStatus>([
      ...group.installments.map((installment) => installment.status),
      ...group.ambiguousInstallments.flatMap((installment) =>
        installment.status == null ? [] : [installment.status]),
    ]);
    const status: AccountingReminderCandidate['status'] = statusSet.size > 1
      ? 'mixed'
      : statusSet.size === 1
        ? [...statusSet][0]
        : group.ambiguousInstallments.length > 0
          ? 'undetermined'
          : group.matchedInstallmentCount > 0
            && group.settledInstallmentCount === group.matchedInstallmentCount
            ? 'settled'
            : 'none';
    const installments = [...group.installments].sort((left, right) =>
      left.dueDate.localeCompare(right.dueDate) || left.id - right.id);
    const ambiguousInstallments = [...group.ambiguousInstallments].sort((left, right) =>
      left.dueDate.localeCompare(right.dueDate) || left.id - right.id);
    const dedupeKey = installments.length
      ? getAccountingReminderDedupeKey({
        schoolId: input.schoolId,
        academicYearId: input.academicYearId,
        studentId,
        installmentIds: installments.map((installment) => installment.id),
      })
      : null;
    const message = installments.length && recipientUserId != null
      ? buildAccountingPaymentReminderMessage({
        schoolName: input.schoolName,
        yearName: input.yearName,
        studentName: `${student.firstName} ${student.lastName}`.trim(),
        installments,
      })
      : null;

    candidates.push({
      studentId,
      firstName: student.firstName,
      lastName: student.lastName,
      className: student.className ?? null,
      obligationClassNames: [...group.obligationClassNames].sort((left, right) => left.localeCompare(right, 'fr')),
      installments,
      ambiguousInstallments,
      matchedInstallmentCount: group.matchedInstallmentCount,
      settledInstallmentCount: group.settledInstallmentCount,
      totalRemaining: installments.reduce((sum, installment) => sum + installment.remaining, 0),
      earliestDueDate: installments[0]?.dueDate ?? ambiguousInstallments[0]?.dueDate ?? null,
      status,
      canSend: installments.length > 0 && recipientUserId != null,
      alreadyNotified: false,
      reason: installments.length === 0
        ? ambiguousInstallments.length > 0
          ? 'Le solde d’au moins une échéance est indéterminé ; aucun rappel affirmatif ne sera créé pour ces échéances.'
          : status === 'settled'
            ? 'Les échéances correspondant aux filtres sont déjà soldées.'
            : 'Aucune échéance non soldée ne correspond aux filtres.'
        : recipientUserId == null
          ? 'Aucun compte parent actif associé à cet élève dans cet établissement.'
          : null,
      message,
      dedupeKey,
      recipientUserId,
    });
  }

  const candidateKeys = candidates.flatMap((candidate) =>
    candidate.dedupeKey == null ? [] : [candidate.dedupeKey]);
  const existingNotifications = candidateKeys.length
    ? await executor.select({ dedupeKey: notifications.dedupeKey })
      .from(notifications)
      .where(inArray(notifications.dedupeKey, candidateKeys))
    : [];
  const existingKeys = new Set(existingNotifications.map((row) => row.dedupeKey));
  for (const candidate of candidates) {
    candidate.alreadyNotified = candidate.dedupeKey != null && existingKeys.has(candidate.dedupeKey);
    if (candidate.alreadyNotified) {
      candidate.canSend = false;
      candidate.reason = 'Un rappel a déjà été créé pour cet élève et cet ensemble d’échéances.';
    }
  }

  return input.selectedStudentIds == null
    ? candidates.filter((candidate) =>
      candidate.installments.length > 0 || candidate.ambiguousInstallments.length > 0)
    : candidates;
}

const publicAccountingReminderCandidate = (candidate: AccountingReminderCandidate) => {
  const { recipientUserId: _recipientUserId, ...publicCandidate } = candidate;
  return publicCandidate;
};

const loadRemainingPaymentBalance = async (
  tx: AccountingTuitionProgressExecutor,
  paymentId: number,
) => {
  const allocations = await tx.select({
    id: financialPaymentAllocations.id,
    amount: financialPaymentAllocations.amount,
  }).from(financialPaymentAllocations).where(eq(financialPaymentAllocations.paymentId, paymentId));
  const adjustments = allocations.length
    ? await tx.select({
      paymentAllocationId: financialAdjustmentAllocations.paymentAllocationId,
      amount: sql<number>`sum(${financialAdjustmentAllocations.amount})::int`,
    }).from(financialAdjustmentAllocations)
      .innerJoin(financialAdjustments, eq(financialAdjustments.id, financialAdjustmentAllocations.adjustmentId))
      .where(inArray(financialAdjustmentAllocations.paymentAllocationId, allocations.map((row) => row.id)))
      .groupBy(financialAdjustmentAllocations.paymentAllocationId)
    : [];
  const adjustedById = getAdjustmentTotals(
    allocations.map((row) => ({ ...row, obligationId: 0, installmentId: null })),
    adjustments,
  );
  return {
    allocations,
    adjustedById,
    remaining: allocations.reduce(
      (sum, row) => sum + row.amount - (adjustedById.get(row.id) ?? 0),
      0,
    ),
  };
};

const applyPaymentAdjustmentInTransaction = async (
  tx: AccountingTuitionProgressExecutor,
  input: {
    actor: AccountingActor;
    schoolId: number;
    payment: typeof financialPayments.$inferSelect;
    kind: 'cancellation' | 'refund';
    amount: number | null;
    reason: string;
    sourceKey: string;
  },
) => {
  if (input.payment.status !== 'posted') {
    throw Object.assign(new Error('Only posted payments can be adjusted'), { statusCode: 409 });
  }
  const { allocations, adjustedById, remaining } = await loadRemainingPaymentBalance(tx, input.payment.id);
  const adjustmentAmount = input.kind === 'cancellation' ? remaining : input.amount;
  if (!remaining || adjustmentAmount == null || adjustmentAmount <= 0 || adjustmentAmount > remaining) {
    throw Object.assign(new Error('Adjustment exceeds the unreversed payment amount'), { statusCode: 409 });
  }

  const [adjustment] = await tx.insert(financialAdjustments).values({
    paymentId: input.payment.id,
    kind: input.kind,
    amount: adjustmentAmount,
    reason: input.reason,
    sourceKey: input.sourceKey,
    recordedBy: input.actor.id ?? null,
  }).returning();
  let left = adjustmentAmount;
  for (const allocation of allocations) {
    if (!left) break;
    const available = allocation.amount - (adjustedById.get(allocation.id) ?? 0);
    if (!available) continue;
    const adjusted = Math.min(left, available);
    await tx.insert(financialAdjustmentAllocations).values({
      adjustmentId: adjustment.id,
      paymentAllocationId: allocation.id,
      amount: adjusted,
    });
    left -= adjusted;
  }
  if (left) throw new Error('Adjustment allocation failed');

  let paymentAfter = input.payment;
  if (input.kind === 'cancellation') {
    const [cancelled] = await tx.update(financialPayments).set({ status: 'cancelled' })
      .where(and(
        eq(financialPayments.id, input.payment.id),
        eq(financialPayments.status, 'posted'),
      )).returning();
    if (!cancelled) throw Object.assign(new Error('Payment state changed during cancellation'), { statusCode: 409 });
    paymentAfter = cancelled;
  }

  await addAudit(tx, input.actor, input.schoolId, input.kind, 'financial_payment', input.payment.id,
    `${input.kind} recorded. ${input.actor.role === 'super_admin' ? 'Super admin direct adjustment.' : ''}`.trim(),
    createAuditSnapshot(input.payment, ['amount', 'method', 'status']),
    createAuditSnapshot({
      amount: paymentAfter.amount,
      method: paymentAfter.method,
      status: paymentAfter.status,
      adjustmentId: adjustment.id,
      adjustmentKind: adjustment.kind,
      adjustmentAmount: adjustment.amount,
    }, ['amount', 'method', 'status', 'adjustmentId', 'adjustmentKind', 'adjustmentAmount']),
    input.reason);
  return { adjustment, paymentAfter };
};

async function handlePaymentAdjustment(
  req: any,
  res: express.Response,
  options: RegisterAccountingApiOptions,
  actorFor: (
    req: any,
    res: express.Response,
    permission?: AccountingPermission,
  ) => Promise<AccountingActor | null>,
  getSchoolIdFn: typeof getSchoolId,
  kind: 'cancellation' | 'refund',
) {
  const db = options.database ?? defaultDb;
  try {
    const actor = await actorFor(req, res, 'adjustment');
    if (!actor) return;
    const paymentId = asPositiveInt(req.params.id);
    if (!paymentId) return res.status(400).json({ error: 'Invalid payment id' });
    const actorSchoolId = actor.role === 'school_admin' || actor.role === 'school_accountant'
      ? await getSchoolIdFn(actor, undefined, res)
      : null;
    if ((actor.role === 'school_admin' || actor.role === 'school_accountant') && !actorSchoolId) return;
    const [payment] = await db.select().from(financialPayments).where(and(
      eq(financialPayments.id, paymentId),
      ...(actorSchoolId == null ? [] : [eq(financialPayments.schoolId, actorSchoolId)]),
    ));
    if (!payment) return res.status(404).json({ error: 'Payment not found' });
    const schoolId = await getSchoolIdFn(actor, actorSchoolId ?? payment.schoolId, res);
    if (!schoolId) return;
    if (payment.schoolId !== schoolId) return res.status(403).json({ error: 'Forbidden' });
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
    const idempotencyKey = typeof req.body?.idempotencyKey === 'string' ? req.body.idempotencyKey.trim() : '';
    const amount = kind === 'cancellation' ? null : asMoney(req.body?.amount);
    if (!reason || reason.length > 500 || !idempotencyKey || idempotencyKey.length > 120 || (kind === 'refund' && !amount)) {
      return res.status(400).json({ error: 'Reason, idempotency key, and valid refund amount are required' });
    }
    const result = await db.transaction(async (tx) => {
      await assertSchoolActiveInTransaction(tx, schoolId);
      const [paymentBefore] = await tx.select().from(financialPayments)
        .where(eq(financialPayments.id, paymentId))
        .for('update');
      if (!paymentBefore || paymentBefore.schoolId !== schoolId) {
        throw Object.assign(new Error('Payment not found'), { statusCode: 404 });
      }
      const [activeRequest] = await tx.select({ id: financialAdjustmentRequests.id })
        .from(financialAdjustmentRequests)
        .where(and(
          eq(financialAdjustmentRequests.paymentId, paymentId),
          or(
            eq(financialAdjustmentRequests.status, 'pending'),
            and(
              eq(financialAdjustmentRequests.status, 'approved'),
              eq(financialAdjustmentRequests.kind, 'refund'),
              isNull(financialAdjustmentRequests.refundConfirmedAt),
            ),
          ),
        ))
        .limit(1);
      if (activeRequest) {
        throw Object.assign(new Error('A pending adjustment request must be resolved before a direct adjustment'), { statusCode: 409 });
      }
      const [existing] = await tx.select().from(financialAdjustments).where(eq(
        financialAdjustments.sourceKey,
        kind === 'cancellation' ? `cancel:${paymentId}` : `refund:${paymentId}:${idempotencyKey}`,
      ));
      if (existing) {
        if (existing.kind !== kind || existing.paymentId !== paymentId || existing.reason !== reason
          || (kind === 'refund' && existing.amount !== amount)) {
          throw Object.assign(new Error('Idempotency key was already used for a different adjustment'), { statusCode: 409 });
        }
        return { adjustment: existing, duplicate: true };
      }
      const applied = await applyPaymentAdjustmentInTransaction(tx, {
        actor,
        schoolId,
        payment: paymentBefore,
        kind,
        amount,
        reason,
        sourceKey: kind === 'cancellation' ? `cancel:${paymentId}` : `refund:${paymentId}:${idempotencyKey}`,
      });
      return { adjustment: applied.adjustment, duplicate: false };
    });
    return res.status(result.duplicate ? 200 : 201).json(result);
  } catch (error) {
    const statusCode = typeof error === 'object' && error && 'statusCode' in error ? Number(error.statusCode) : 500;
    if (statusCode !== 500) {
      return res.status(statusCode).json({
        error: (error as Error).message,
        ...(error instanceof SchoolSuspendedError ? { code: error.code, schoolId: error.schoolId } : {}),
      });
    }
    console.error(`Failed to ${kind} accounting payment:`, error);
    return res.status(500).json({ error: `Failed to ${kind} accounting payment` });
  }
}

export function formatAccountingReceiptAllocationLine(allocation: {
  category?: string | null;
  label?: string | null;
  tariffLabel?: string | null;
  installmentLabel?: string | null;
  dueDate?: string | null;
  amount: number;
}) {
  const category = allocation.category?.trim() ?? '';
  const label = allocation.label?.trim() ?? '';
  const tariffLabel = allocation.tariffLabel?.trim() ?? '';
  const description = tariffLabel || label || category || 'Frais';
  const dueDate = allocation.dueDate?.trim();
  const dueDateSuffix = dueDate ? ` (échéance ${dueDate})` : '';
  const amount = Number(allocation.amount || 0)
    .toLocaleString('fr-FR')
    .replace(/[\u00a0\u202f]/g, ' ');
  return `${description}${dueDateSuffix} : ${amount} FCFA`;
}

async function renderAccountingReceipt(snapshot: unknown): Promise<Uint8Array> {
  if (!snapshot || typeof snapshot !== 'object') throw new Error('Receipt snapshot is invalid');
  const data = snapshot as Record<string, any>;
  const pdf = await PDFDocument.create();
  const pageWidth = 595.28;
  const pageHeight = 419.53;
  const margin = 28;
  const bottomLimit = margin;
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const formatReceiptAmount = (amount: number) => Number(amount || 0)
    .toLocaleString('fr-FR')
    .replace(/[\u00a0\u202f]/g, ' ');
  const school = data.school ?? {};
  const payment = data.payment ?? {};
  const student = data.student ?? {};
  const receiptNumber = String(data.receiptNumber ?? '');
  const formatReceiptDate = (value: unknown) => {
    const date = String(value ?? '');
    const isoDate = date.match(/^(\d{4})-(\d{2})-(\d{2})/);
    return isoDate ? `${isoDate[3]}/${isoDate[2]}/${isoDate[1]}` : date;
  };
  const ink = rgb(0.1, 0.12, 0.18);
  const wrapText = (text: string, selectedFont: typeof font, size: number, maxWidth: number) => {
    const tokens = text.match(/\S+\s*/gu) ?? [text];
    const lines: string[] = [];
    let line = '';
    for (const token of tokens) {
      if (selectedFont.widthOfTextAtSize(line + token, size) <= maxWidth) {
        line += token;
        continue;
      }
      if (line) {
        lines.push(line);
        line = '';
      }
      if (selectedFont.widthOfTextAtSize(token, size) <= maxWidth) {
        line = token;
        continue;
      }
      for (const character of Array.from(token)) {
        if (line && selectedFont.widthOfTextAtSize(line + character, size) > maxWidth) {
          lines.push(line);
          line = '';
        }
        line += character;
      }
    }
    if (line || lines.length === 0) lines.push(line);
    return lines;
  };
  const allocationSize = 9.5;
  const allocationLineHeight = 12;
  const allocationX = margin;
  const allocationWidth = pageWidth - margin * 2;
  const logoData = typeof school.logoData === 'string' ? school.logoData : '';
  let logo: Awaited<ReturnType<typeof pdf.embedPng>> | Awaited<ReturnType<typeof pdf.embedJpg>> | null = null;
  if (logoData) {
    const bytes = Uint8Array.from(Buffer.from(logoData, 'base64'));
    logo = school.logoMimeType === 'image/png' ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);
  }

  let page = pdf.addPage([pageWidth, pageHeight]);
  let y = pageHeight - margin;
  const drawLines = (
    text: string,
    x: number,
    top: number,
    maxWidth: number,
    size: number,
    isBold = false,
    lineHeight = size + 3,
  ) => {
    const selectedFont = isBold ? bold : font;
    const lines = wrapText(text, selectedFont, size, maxWidth);
    lines.forEach((line, index) => {
      page.drawText(line, {
        x,
        y: top - index * lineHeight,
        size,
        font: selectedFont,
        color: ink,
      });
    });
    return top - lines.length * lineHeight;
  };
  const drawRightLines = (
    text: string,
    right: number,
    top: number,
    maxWidth: number,
    size: number,
    isBold = false,
    lineHeight = size + 3,
  ) => {
    const selectedFont = isBold ? bold : font;
    const lines = wrapText(text, selectedFont, size, maxWidth);
    lines.forEach((line, index) => {
      page.drawText(line, {
        x: right - selectedFont.widthOfTextAtSize(line, size),
        y: top - index * lineHeight,
        size,
        font: selectedFont,
        color: ink,
      });
    });
    return top - lines.length * lineHeight;
  };
  const startContinuationPage = () => {
    page = pdf.addPage([pageWidth, pageHeight]);
    y = pageHeight - margin;
    const continuationLogoZone = logo ? 112 : 0;
    const continuationGap = logo ? 18 : 24;
    const columnWidth = logo
      ? (pageWidth - margin * 2 - continuationLogoZone - continuationGap * 2) / 2
      : (pageWidth - margin * 2 - continuationGap) / 2;
    const rightEdge = pageWidth - margin;
    let leftBottom = drawLines(String(school.name ?? 'Établissement'), margin, y, columnWidth, 10, true);
    for (const detail of [
      school.address ? String(school.address) : null,
      school.phone ? `Tél. ${school.phone}` : null,
      school.email ? String(school.email) : null,
    ]) {
      if (detail) {
        leftBottom = drawLines(detail, margin, leftBottom - 1, columnWidth, 8, false, 10);
      }
    }
    let rightBottom = drawRightLines('REÇU DE PAIEMENT', rightEdge, y, columnWidth, 10, true);
    rightBottom = drawRightLines(`Numéro : ${receiptNumber}`, rightEdge, rightBottom - 1, columnWidth, 9, true, 12);
    rightBottom = drawRightLines(
      `Date : ${formatReceiptDate(payment.paidAt)}`,
      rightEdge,
      rightBottom - 1,
      columnWidth,
      9,
      false,
      12,
    );
    rightBottom = drawRightLines(
      `Année scolaire : ${String(data.academicYearName ?? '—')}`,
      rightEdge,
      rightBottom - 1,
      columnWidth,
      9,
      false,
      12,
    );
    const contentBottom = Math.min(leftBottom, rightBottom);
    if (logo) {
      const logoSize = logo.scaleToFit(98, 82);
      const headerCenterY = (y + contentBottom) / 2;
      page.drawImage(logo, {
        x: (pageWidth - logoSize.width) / 2,
        y: headerCenterY - logoSize.height / 2,
        ...logoSize,
      });
      y = Math.min(contentBottom, headerCenterY - logoSize.height / 2) - 8;
    } else {
      y = contentBottom - 8;
    }
    y = drawLines('Suite du reçu', margin, y, allocationWidth, 10, true) - 5;
  };
  const ensureSpace = (height: number) => {
    if (y - height < bottomLimit) startContinuationPage();
  };
  const drawWrapped = (text: string, size = 9.5, isBold = false, lineHeight = size + 3) => {
    const selectedFont = isBold ? bold : font;
    const lines = wrapText(text, selectedFont, size, allocationWidth);
    for (const line of lines) {
      ensureSpace(lineHeight);
      page.drawText(line, { x: allocationX, y, size, font: selectedFont, color: ink });
      y -= lineHeight;
    }
  };
  const drawAllocation = (allocation: Parameters<typeof formatAccountingReceiptAllocationLine>[0]) => {
    const description = allocation.tariffLabel?.trim()
      || allocation.label?.trim()
      || allocation.category?.trim()
      || 'Frais';
    const formattedLine = formatAccountingReceiptAllocationLine(allocation);
    const segments = [
      { text: description, isBold: true },
      { text: formattedLine.slice(description.length).trimStart(), isBold: false },
    ];
    const lines: Array<Array<{ text: string; isBold: boolean }>> = [[]];
    let lineWidth = 0;
    const appendToLine = (text: string, isBold: boolean) => {
      const line = lines[lines.length - 1];
      const previousSegment = line[line.length - 1];
      if (previousSegment?.isBold === isBold) {
        previousSegment.text += text;
      } else {
        line.push({ text, isBold });
      }
      lineWidth += (isBold ? bold : font).widthOfTextAtSize(text, allocationSize);
    };
    const startLine = () => {
      lines.push([]);
      lineWidth = 0;
    };
    for (const [segmentIndex, segment] of segments.entries()) {
      if (segmentIndex > 0 && lineWidth > 0) {
        const spaceWidth = font.widthOfTextAtSize(' ', allocationSize);
        if (lineWidth + spaceWidth <= allocationWidth) {
          appendToLine(' ', false);
        } else {
          startLine();
        }
      }
      const selectedFont = segment.isBold ? bold : font;
      for (const token of segment.text.match(/\S+\s*/gu) ?? [segment.text]) {
        const tokenWidth = selectedFont.widthOfTextAtSize(token, allocationSize);
        if (lineWidth + tokenWidth <= allocationWidth) {
          appendToLine(token, segment.isBold);
          continue;
        }
        if (lineWidth > 0) startLine();
        if (tokenWidth <= allocationWidth) {
          appendToLine(token, segment.isBold);
          continue;
        }
        for (const character of Array.from(token)) {
          if (
            lineWidth > 0
            && lineWidth + selectedFont.widthOfTextAtSize(character, allocationSize) > allocationWidth
          ) {
            startLine();
          }
          appendToLine(character, segment.isBold);
        }
      }
    }
    for (const line of lines) {
      ensureSpace(allocationLineHeight);
      let x = allocationX;
      for (const segment of line) {
        const selectedFont = segment.isBold ? bold : font;
        page.drawText(segment.text, { x, y, size: allocationSize, font: selectedFont, color: ink });
        const segmentWidth = selectedFont.widthOfTextAtSize(segment.text, allocationSize);
        if (segment.isBold) {
          const underlineWidth = bold.widthOfTextAtSize(segment.text.trimEnd(), allocationSize);
          if (underlineWidth > 0) {
            page.drawLine({
              start: { x, y: y - 2.5 },
              end: { x: x + underlineWidth, y: y - 2.5 },
              color: ink,
              thickness: 0.55,
            });
          }
        }
        x += segmentWidth;
      }
      y -= allocationLineHeight;
    }
  };
  const drawFieldRow = (leftText: string, rightText?: string) => {
    const columnGap = 18;
    const columnWidth = rightText == null
      ? allocationWidth
      : (allocationWidth - columnGap) / 2;
    const leftLines = wrapText(leftText, font, 9.5, columnWidth);
    const rightLines = rightText == null ? [] : wrapText(rightText, font, 9.5, columnWidth);
    const lineCount = Math.max(leftLines.length, rightLines.length, 1);
    for (let index = 0; index < lineCount; index++) {
      ensureSpace(12);
      if (leftLines[index]) {
        page.drawText(leftLines[index], { x: margin, y, size: 9.5, font, color: ink });
      }
      if (rightLines[index]) {
        page.drawText(rightLines[index], {
          x: margin + columnWidth + columnGap,
          y,
          size: 9.5,
          font,
          color: ink,
        });
      }
      y -= 12;
    }
    y -= 2;
  };

  const headerTop = y;
  const headerGap = 24;
  const logoZoneWidth = logo ? 112 : 0;
  const columnGap = logo ? 18 : headerGap;
  const headerColumnWidth = logo
    ? (allocationWidth - logoZoneWidth - columnGap * 2) / 2
    : (allocationWidth - headerGap) / 2;
  const leftHeaderX = margin;
  const rightHeaderEdge = pageWidth - margin;
  let logoBounds: { x: number; y: number; width: number; height: number } | null = null;
  let leftHeaderTextX = leftHeaderX;
  let leftHeaderTextWidth = headerColumnWidth;
  let schoolBottom = drawLines(
    String(school.name ?? 'Établissement'),
    leftHeaderTextX,
    headerTop,
    leftHeaderTextWidth,
    12,
    true,
  );
  for (const detail of [
    school.address ? String(school.address) : null,
    school.phone ? `Tél. ${school.phone}` : null,
    school.email ? String(school.email) : null,
  ]) {
    if (detail) {
      schoolBottom = drawLines(detail, leftHeaderTextX, schoolBottom - 1, leftHeaderTextWidth, 9, false, 11);
    }
  }
  const displayPaidAt = formatReceiptDate(payment.paidAt);
  let receiptBottom = drawRightLines(
    'REÇU DE PAIEMENT',
    rightHeaderEdge,
    headerTop,
    headerColumnWidth,
    12,
    true,
  );
  receiptBottom = drawRightLines(
    `Numéro : ${receiptNumber}`,
    rightHeaderEdge,
    receiptBottom - 1,
    headerColumnWidth,
    9.5,
    true,
    12,
  );
  receiptBottom = drawRightLines(
    `Date : ${displayPaidAt}`,
    rightHeaderEdge,
    receiptBottom - 1,
    headerColumnWidth,
    9.5,
    false,
    12,
  );
  receiptBottom = drawRightLines(
    `Année scolaire : ${String(data.academicYearName ?? '—')}`,
    rightHeaderEdge,
    receiptBottom - 1,
    headerColumnWidth,
    9.5,
    false,
    12,
  );
  const headerContentBottom = Math.min(schoolBottom, receiptBottom);
  if (logo) {
    const logoSize = logo.scaleToFit(98, 82);
    const headerCenterY = (headerTop + headerContentBottom) / 2;
    page.drawImage(logo, {
      x: (pageWidth - logoSize.width) / 2,
      y: headerCenterY - logoSize.height / 2,
      ...logoSize,
    });
    logoBounds = {
      x: (pageWidth - logoSize.width) / 2,
      y: headerCenterY - logoSize.height / 2,
      ...logoSize,
    };
    y = Math.min(headerContentBottom, headerCenterY - logoSize.height / 2) - 7;
  } else {
    y = headerContentBottom - 7;
  }

  const studentCardFontSize = 10.5;
  const studentCardLineHeight = 13;
  const studentCardPaddingX = 12;
  const studentCardPaddingY = 9;
  const studentCardTextWidth = allocationWidth - studentCardPaddingX * 2;
  const studentCardLines = [
    ...wrapText(
      `Élève : ${String(student.firstName ?? '')} ${String(student.lastName ?? '')}`,
      bold,
      studentCardFontSize,
      studentCardTextWidth,
    ),
    ...wrapText(
      `Matricule : ${String(student.matricule ?? '—')}  |  Classe : ${String(student.className ?? '—')}`,
      bold,
      studentCardFontSize,
      studentCardTextWidth,
    ),
  ];
  const studentCardWidth = Math.min(
    allocationWidth,
    Math.max(...studentCardLines.map(line => bold.widthOfTextAtSize(line, studentCardFontSize)))
      + studentCardPaddingX * 2,
  );
  const studentCardHeight = studentCardLines.length * studentCardLineHeight + studentCardPaddingY * 2;
  const studentCardLeft = margin;
  const studentCardRight = studentCardLeft + studentCardWidth;
  const studentCardTopUnderSchool = schoolBottom - 7;
  const studentCardBottomUnderSchool = studentCardTopUnderSchool - studentCardHeight;
  const leftHeaderAvailableRight = logoBounds
    ? logoBounds.x
    : rightHeaderEdge - headerColumnWidth;
  const canPlaceUnderSchool = studentCardRight + 8 <= leftHeaderAvailableRight
    && studentCardBottomUnderSchool > bottomLimit;
  if (canPlaceUnderSchool) {
    y = Math.min(y, studentCardBottomUnderSchool - 8);
  } else {
    ensureSpace(studentCardHeight + 8);
  }
  const studentCardTop = canPlaceUnderSchool ? studentCardTopUnderSchool : y;
  const studentCardBottom = studentCardTop - studentCardHeight;
  const cornerRadius = Math.min(7, studentCardHeight / 4, studentCardWidth / 4);
  const cornerCurve = cornerRadius * 0.5523;
  const studentCardPath = [
    `M ${cornerRadius} 0`,
    `H ${studentCardWidth - cornerRadius}`,
    `C ${studentCardWidth - cornerRadius + cornerCurve} 0 ${studentCardWidth} ${cornerRadius - cornerCurve} ${studentCardWidth} ${cornerRadius}`,
    `V ${studentCardHeight - cornerRadius}`,
    `C ${studentCardWidth} ${studentCardHeight - cornerRadius + cornerCurve} ${studentCardWidth - cornerRadius + cornerCurve} ${studentCardHeight} ${studentCardWidth - cornerRadius} ${studentCardHeight}`,
    `H ${cornerRadius}`,
    `C ${cornerRadius - cornerCurve} ${studentCardHeight} 0 ${studentCardHeight - cornerRadius + cornerCurve} 0 ${studentCardHeight - cornerRadius}`,
    `V ${cornerRadius}`,
    `C 0 ${cornerRadius - cornerCurve} ${cornerRadius - cornerCurve} 0 ${cornerRadius} 0`,
    'Z',
  ].join(' ');
  page.drawSvgPath(studentCardPath, {
    x: margin,
    y: studentCardBottom + studentCardHeight,
    borderColor: rgb(0, 0, 0),
    borderWidth: 0.8,
  });
  studentCardLines.forEach((line, index) => {
    page.drawText(line, {
      x: margin + studentCardPaddingX,
      y: studentCardTop - studentCardPaddingY - studentCardFontSize - index * studentCardLineHeight,
      size: studentCardFontSize,
      font: bold,
      color: ink,
    });
  });
  y = studentCardBottom - 8;
  y -= 2;
  y -= 4;
  y -= 15;
  drawWrapped('Allocations', 10, true, 13);
  y -= 2;
  for (const allocation of Array.isArray(data.allocations) ? data.allocations : []) {
    drawAllocation(allocation);
  }
  y -= 5;
  drawFieldRow(
    `Montant encaissé : ${formatReceiptAmount(payment.amount)} FCFA`,
    `Total dû : ${formatReceiptAmount(data.totalDue)} FCFA`,
  );
  drawFieldRow(
    `Déjà payé avant ce règlement : ${formatReceiptAmount(data.paidBeforePayment)} FCFA`,
    `Reste dû après paiement : ${formatReceiptAmount(data.remainingAfterPayment)} FCFA`,
  );
  drawFieldRow(
    `Mode : ${String(payment.method ?? '')}`,
    payment.reference ? `Référence : ${String(payment.reference)}` : undefined,
  );
  drawFieldRow(`Enregistré par : ${String(data.recordedBy ?? '—')}`);
  return pdf.save();
}
