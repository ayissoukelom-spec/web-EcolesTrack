import type express from 'express';
import { and, asc, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { db as defaultDb } from '../db/index.ts';
import {
  accountingCategories,
  accountingFeeDefinitions,
  accountingScheduleTemplates,
  accountingTariffs,
  academicYears,
  auditEvents,
  classes,
  financialAdjustmentAllocations,
  financialAdjustments,
  financialInstallments,
  financialObligations,
  financialPaymentAllocations,
  financialPayments,
  financialReceipts,
  levels,
  notifications,
  parents,
  schools,
  schoolClasses,
  students,
} from '../db/schema.ts';
import { readStoredFile } from './fileStorage.ts';
import {
  allocateToOldestInstallments,
  calculateStudentFeeBalance,
  splitAmountBySchedule,
  validateAccountingSchedule,
} from './accountingRules.ts';
import type { AccountingScheduleItem } from './accountingRules.ts';

type AccountingActor = {
  id?: number | null;
  role: string;
  schoolId?: number | null;
  academicYearId?: number | null;
  email?: string | null;
  name?: string | null;
};

type PaymentAllocationState = {
  id: number;
  obligationId: number;
  installmentId: number | null;
  amount: number;
};

type AdjustmentAllocationState = { paymentAllocationId: number; amount: number };

const asPositiveInt = (value: unknown): number | null => {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
};

const asMoney = (value: unknown): number | null => {
  const amount = Number(value);
  return Number.isSafeInteger(amount) && amount > 0 && amount <= 2147483647 ? amount : null;
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
  if (actor.role === 'school_admin') {
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
  tx: Parameters<Parameters<typeof defaultDb.transaction>[0]>[0],
  actor: AccountingActor,
  schoolId: number,
  action: string,
  resourceType: string,
  resourceId: number | null,
  description: string,
) => {
  await tx.insert(auditEvents).values({
    actorUserId: actor.id ?? null,
    actorRole: actor.role,
    actorEmail: actor.email ?? null,
    actorName: actor.name ?? null,
    action,
    resourceType,
    resourceId,
    schoolId,
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
  const existing = categories.find((category) => category.code !== 'enrollment'
    && normalizeAccountingLabel(category.label) === normalizedLabel);
  if (existing) {
    if (!existing.isEnabled) {
      const [enabled] = await tx.update(accountingCategories).set({
        isEnabled: true,
        updatedAt: new Date(),
      }).where(and(eq(accountingCategories.id, existing.id), eq(accountingCategories.schoolId, schoolId))).returning();
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
    await addAudit(tx, actor, schoolId, 'create', 'accounting_category', created.id, `Created accounting fee label=${label.trim()}`);
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
    tariffId: financialObligations.tariffId,
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
    ...(tariffId ? [eq(accountingTariffs.id, tariffId)] : []),
  ));
  const exact = candidates.filter((tariff) => tariff.classId === classId);
  if (!candidates.some((tariff) => tariff.classFromId != null && tariff.classToId != null)) {
    return exact;
  }
  const scopedRanges = candidates.filter((tariff) => tariff.classId == null
    && tariff.classFromId != null && tariff.classToId != null);
  const classIds = [...new Set([
    classId,
    ...scopedRanges.flatMap((tariff) => [tariff.classFromId!, tariff.classToId!]),
  ])];
  const classOrders = await executor.select({
    classId: classes.id,
    academicYearId: classes.academicYearId,
    orderIndex: levels.orderIndex,
  }).from(classes).innerJoin(levels, eq(levels.id, classes.levelId))
    .where(inArray(classes.id, classIds));
  const orderByClassId = new Map(classOrders
    .filter((row) => row.academicYearId === academicYearId)
    .map((row) => [row.classId, row.orderIndex]));
  const studentOrder = orderByClassId.get(classId);
  if (studentOrder == null) return exact;
  const exactCategories = new Set(exact.map((tariff) => tariff.categoryId));
  const matchingRanges = scopedRanges.filter((tariff) => {
    if (exactCategories.has(tariff.categoryId)) return false;
    const startOrder = tariff.classFromId == null ? undefined : orderByClassId.get(tariff.classFromId);
    const endOrder = tariff.classToId == null ? undefined : orderByClassId.get(tariff.classToId);
    return startOrder != null && endOrder != null
      && startOrder <= endOrder && studentOrder >= startOrder && studentOrder <= endOrder;
  });
  const rangeByCategory = new Map<number, (typeof matchingRanges)[number]>();
  for (const tariff of matchingRanges) {
    if (!rangeByCategory.has(tariff.categoryId)) rangeByCategory.set(tariff.categoryId, tariff);
  }
  return [...exact, ...rangeByCategory.values()];
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
  }: {
    actor: AccountingActor;
    schoolId: number;
    studentId: number;
    academicYearId: number;
    classId: number;
    className: string;
    categoryId: number;
    tariffId?: number;
  },
) => {
  const existing = await executor.select({
    id: financialObligations.id,
    tariffId: financialObligations.tariffId,
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
  const tariff = (await getApplicableTariffs(executor, {
    schoolId,
    academicYearId,
    classId,
    categoryId,
    tariffId,
  }))[0];
  const existingTariffObligation = existing.find((obligation) => obligation.tariffId === tariff?.id);
  if (existing.length && (!tariff || existingTariffObligation)) {
    if (tariff && existingTariffObligation) {
      const installments = await executor.select().from(financialInstallments)
        .where(eq(financialInstallments.obligationId, existingTariffObligation.id))
        .orderBy(asc(financialInstallments.orderIndex));
      const scheduledAmount = installments.reduce((total, item) => total + item.amount, 0);
      const additionalAmount = tariff.amount - scheduledAmount;
      if (additionalAmount > 0) {
        await executor.insert(financialInstallments).values({
          obligationId: existingTariffObligation.id,
          label: 'Complément du tarif actuel',
          orderIndex: installments.reduce((max, item) => Math.max(max, item.orderIndex), 0) + 1,
          amount: additionalAmount,
          dueDate: todayUtc(),
        });
      }
    }
    return;
  }
  if (!category || !tariff) {
    throw Object.assign(new Error('No configured amount is available for this fee and class'), { statusCode: 409 });
  }
  if (category.code === 'enrollment') {
    console.warn('Rejected enrollment category during tariff payment', {
      tariffId: tariff?.id ?? tariffId ?? null,
      categoryId,
      categoryCode: category.code,
      academicYearId,
      classId,
      studentId,
      enrollmentId: null,
      configuredAmount: tariff?.amount ?? null,
      tariffFound: Boolean(tariff),
    });
    throw Object.assign(new Error('Select a configured enrollment charge before recording this payment'), { statusCode: 409 });
  }

  const sourceKey = `tariff-${tariff.id}-student-${studentId}`;
  const [duplicate] = await executor.select().from(financialObligations).where(and(
    eq(financialObligations.schoolId, schoolId),
    eq(financialObligations.sourceKey, sourceKey),
  ));
  if (duplicate) {
    if (duplicate.status === 'active') return;
    throw Object.assign(new Error('The configured charge has already been cancelled'), { statusCode: 409 });
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
      ? splitAmountBySchedule(tariff.amount, schedule) ?? [{
        label: 'Paiement unique',
        dueDate: todayUtc(),
        amount: tariff.amount,
        orderIndex: 1,
      }]
      : [{
        label: 'Paiement unique',
        dueDate: todayUtc(),
        amount: tariff.amount,
        orderIndex: 1,
      }];
  } else {
    planned = [{
      label: category.label,
      dueDate: todayUtc(),
      amount: tariff.amount,
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
    amount: tariff.amount,
    currency: 'XOF',
    classNameSnapshot: className,
    enrollmentKind: null,
    sourceKey,
    createdBy: actor.id ?? null,
  }).onConflictDoNothing().returning();
  if (!created) {
    const [raced] = await executor.select().from(financialObligations).where(and(
      eq(financialObligations.schoolId, schoolId),
      eq(financialObligations.sourceKey, sourceKey),
    ));
    if (raced?.status === 'active') return;
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
    `Charge created from configured tariff: category=${category.code} amount=${tariff.amount}`,
  );
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
  database?: typeof defaultDb;
}

export const registerAccountingRoutes = (app: express.Express, options: RegisterAccountingApiOptions) => {
  const db = options.database ?? defaultDb;
  const actorFor = async (req: any, res: express.Response) => {
    const actor = await options.resolveActor(req);
    if (!actor) {
      res.status(404).json({ error: 'User not found' });
      return null;
    }
    if (!['school_admin', 'super_admin'].includes(actor.role)) {
      res.status(403).json({ error: 'Forbidden' });
      return null;
    }
    return actor;
  };

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
      const schoolId = await getSchoolId(actor, req.query.schoolId, res);
      if (!schoolId) return;
      const conditions = [eq(financialPayments.schoolId, schoolId)];
      const yearId = req.query.academicYearId == null ? null : asPositiveInt(req.query.academicYearId);
      const studentId = req.query.studentId == null ? null : asPositiveInt(req.query.studentId);
      if ((req.query.academicYearId != null && !yearId) || (req.query.studentId != null && !studentId)) {
        return res.status(400).json({ error: 'Invalid payment filter' });
      }
      if (yearId) conditions.push(eq(financialPayments.academicYearId, yearId));
      if (studentId) conditions.push(eq(financialPayments.studentId, studentId));
      const rows = await db.select({
        id: financialPayments.id,
        studentId: financialPayments.studentId,
        studentName: sql<string>`${students.firstName} || ' ' || ${students.lastName}`,
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
        .innerJoin(students, eq(students.id, financialPayments.studentId))
        .leftJoin(financialReceipts, eq(financialReceipts.paymentId, financialPayments.id))
        .where(and(...conditions))
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
      const actor = await actorFor(req, res);
      if (!actor) return;
      const schoolId = await getSchoolId(actor, req.body?.schoolId, res);
      if (!schoolId) return;
      const categoryId = asPositiveInt(req.params.id);
      if (!categoryId || typeof req.body?.isEnabled !== 'boolean') return res.status(400).json({ error: 'Invalid category update' });
      const [updated] = await db.transaction(async (tx) => {
        const [row] = await tx.update(accountingCategories).set({
          isEnabled: req.body.isEnabled,
          updatedAt: new Date(),
        }).where(and(eq(accountingCategories.id, categoryId), eq(accountingCategories.schoolId, schoolId))).returning();
        if (row) await addAudit(tx, actor, schoolId, 'update', 'accounting_category', row.id, `Category ${row.code} enabled=${row.isEnabled}`);
        return [row];
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
      const actor = await actorFor(req, res);
      if (!actor) return;
      const schoolId = await getSchoolId(actor, req.query.schoolId, res);
      if (!schoolId) return;
      const tariffId = asPositiveInt(req.params.tariffId);
      if (!tariffId) return res.status(400).json({ error: 'Valid tariff id is required' });

      const result = await db.transaction(async (tx) => {
        const [tariff] = await tx.select().from(accountingTariffs).where(and(
          eq(accountingTariffs.id, tariffId),
          eq(accountingTariffs.schoolId, schoolId),
        ));
        if (!tariff) return { notFound: true as const };

        const obligations = await tx.select({ id: financialObligations.id })
          .from(financialObligations)
          .where(eq(financialObligations.tariffId, tariffId));
        if (obligations.length > 0) {
          await tx.update(accountingTariffs).set({ isEnabled: false, updatedAt: new Date() }).where(and(
            eq(accountingTariffs.id, tariffId),
            eq(accountingTariffs.schoolId, schoolId),
          ));
          await addAudit(tx, actor, schoolId, 'archive', 'accounting_tariff', tariffId,
            `Archived tariff ${tariffId}; retained ${obligations.length} financial obligation(s)`);
          return { notFound: false as const, archived: true };
        }

        await tx.delete(accountingTariffs).where(and(
          eq(accountingTariffs.id, tariffId),
          eq(accountingTariffs.schoolId, schoolId),
        ));
        await addAudit(tx, actor, schoolId, 'delete', 'accounting_tariff', tariffId,
          `Deleted unused tariff ${tariffId}`);
        return { notFound: false as const, archived: false };
      });

      if (result.notFound) return res.status(404).json({ error: 'Tariff not found' });
      return res.json({ success: true, archived: result.archived });
    } catch (error) {
      if (typeof error === 'object' && error && 'code' in error && error.code === '23503') {
        try {
          const actor = await actorFor(req, res);
          if (!actor) return;
          const schoolId = await getSchoolId(actor, req.query.schoolId, res);
          if (!schoolId) return;
          const tariffId = asPositiveInt(req.params.tariffId);
          if (!tariffId) return res.status(400).json({ error: 'Valid tariff id is required' });
          await db.update(accountingTariffs).set({ isEnabled: false, updatedAt: new Date() }).where(and(
            eq(accountingTariffs.id, tariffId),
            eq(accountingTariffs.schoolId, schoolId),
          ));
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
      const actor = await actorFor(req, res);
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
      let rangeOrder: { startOrder: number; endOrder: number } | null = null;
      if (isRange) {
        const rows = await db.select({
          classId: classes.id,
          orderIndex: levels.orderIndex,
        }).from(classes).innerJoin(levels, eq(levels.id, classes.levelId))
          .where(inArray(classes.id, [classFromId!, classToId!]));
        const orderByClassId = new Map(rows.map((row) => [row.classId, row.orderIndex]));
        const startOrder = orderByClassId.get(classFromId!);
        const endOrder = orderByClassId.get(classToId!);
        if (startOrder == null || endOrder == null || startOrder > endOrder) {
          return res.status(400).json({ error: 'Class range must follow the pedagogical order' });
        }
        rangeOrder = { startOrder, endOrder };
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
              orderIndex: levels.orderIndex,
            }).from(classes).innerJoin(levels, eq(levels.id, classes.levelId))
              .where(inArray(classes.id, rangeClassIds));
            const orders = new Map(rangeClassOrders.map((row) => [row.classId, row.orderIndex]));
            const overlaps = configuredRanges.some((tariff) => {
              const existingStart = tariff.classFromId == null ? undefined : orders.get(tariff.classFromId);
              const existingEnd = tariff.classToId == null ? undefined : orders.get(tariff.classToId);
              return existingStart != null && existingEnd != null
                && rangeOrder!.startOrder <= existingEnd && existingStart <= rangeOrder!.endOrder;
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
            label: usesLabel ? label : category.label,
            amount,
            createdBy: actor.id ?? null,
          }).onConflictDoNothing().returning();
          if (!row) return { duplicate: true as const, row: null };
          await addAudit(tx, actor, schoolId, 'create', 'accounting_tariff', row.id,
            `Created tariff range ${classFromId}-${classToId} amount=${amount} year=${academicYearId}`);
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
          if (!row) return { duplicate: true as const, row: null };
          await addAudit(tx, actor, schoolId, 'create', 'accounting_tariff', row.id,
            `Created tariff ${label} amount=${amount} class=${classId} year=${academicYearId}`);
          return { duplicate: false as const, row };
        }

        const [row] = await tx.insert(accountingTariffs).values({
          schoolId,
          academicYearId,
          classId,
          categoryId: category.id,
          label: category.label,
          amount,
          createdBy: actor.id ?? null,
        }).onConflictDoUpdate({
          target: [accountingTariffs.schoolId, accountingTariffs.academicYearId, accountingTariffs.classId, accountingTariffs.categoryId],
          set: { label: category.label, amount, isEnabled: true, updatedAt: new Date(), createdBy: actor.id ?? null },
        }).returning();
        await addAudit(tx, actor, schoolId, 'upsert', 'accounting_tariff', row.id, `Tariff ${category.code} amount=${amount} class=${classId} year=${academicYearId}`);
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
      console.error('Failed to save accounting tariff:', error);
      return res.status(500).json({ error: 'Failed to save accounting tariff' });
    }
  });

  app.put('/api/accounting/tariffs/:id', async (req, res) => {
    try {
      const actor = await actorFor(req, res);
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
      let rangeOrder: { startOrder: number; endOrder: number } | null = null;
      if (isRange) {
        const rows = await db.select({
          classId: classes.id,
          orderIndex: levels.orderIndex,
        }).from(classes).innerJoin(levels, eq(levels.id, classes.levelId))
          .where(inArray(classes.id, [classFromId!, classToId!]));
        const orders = new Map(rows.map((row) => [row.classId, row.orderIndex]));
        const startOrder = orders.get(classFromId!);
        const endOrder = orders.get(classToId!);
        if (startOrder == null || endOrder == null || startOrder > endOrder) {
          return res.status(400).json({ error: 'Class range must follow the pedagogical order' });
        }
        rangeOrder = { startOrder, endOrder };
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
              orderIndex: levels.orderIndex,
            }).from(classes).innerJoin(levels, eq(levels.id, classes.levelId))
              .where(inArray(classes.id, rangeIds))
            : [];
          const orders = new Map(rows.map((row) => [row.classId, row.orderIndex]));
          const overlaps = otherRanges.some((range) => {
            if (range.id === tariffId || range.classFromId == null || range.classToId == null) return false;
            const existingStart = orders.get(range.classFromId);
            const existingEnd = orders.get(range.classToId);
            return existingStart != null && existingEnd != null
              && rangeOrder!.startOrder <= existingEnd && existingStart <= rangeOrder!.endOrder;
          });
          if (overlaps) {
            throw Object.assign(new Error('An enabled tariff range already overlaps these classes for this fee and year'), { statusCode: 409 });
          }
        } else {
          const targetTariffs = await tx.select({
            id: accountingTariffs.id,
            label: accountingTariffs.label,
          }).from(accountingTariffs).where(and(
            eq(accountingTariffs.schoolId, schoolId),
            eq(accountingTariffs.academicYearId, academicYearId),
            eq(accountingTariffs.classId, classId!),
          ));
          const duplicate = targetTariffs.find((tariff) => tariff.id !== tariffId
            && normalizeAccountingLabel(tariff.label) === normalizeAccountingLabel(label));
          if (duplicate) {
            throw Object.assign(new Error('Un frais avec ce libellé existe déjà pour cette classe et cette année scolaire.'), { statusCode: 409 });
          }
        }
        const [row] = await tx.update(accountingTariffs).set({
          classId: isRange ? null : classId,
          classFromId: isRange ? classFromId : null,
          classToId: isRange ? classToId : null,
          label,
          amount,
          isEnabled: true,
          updatedAt: new Date(),
          createdBy: actor.id ?? null,
        }).where(and(
          eq(accountingTariffs.id, tariffId),
          eq(accountingTariffs.schoolId, schoolId),
        )).returning();
        if (row) await addAudit(tx, actor, schoolId, 'update', 'accounting_tariff', row.id,
          `Updated tariff ${isRange ? `range=${classFromId}-${classToId}` : `class=${classId}`} label=${label} amount=${amount}`);
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

  app.put('/api/accounting/schedules', async (req, res) => {
    try {
      const actor = await actorFor(req, res);
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
      if ((periodType === 'annual' && installments.length !== 1)
        || (periodType === 'trimester' && installments.length !== 3)
        || (periodType === 'semester' && installments.length !== 2)) {
        return res.status(400).json({ error: 'Installment count does not match the selected period type' });
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
      const [saved] = await db.transaction(async (tx) => {
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
        await addAudit(tx, actor, schoolId, 'upsert', 'accounting_schedule', row.id, `Schedule ${periodType} configured for class=${classId} year=${academicYearId}`);
        return [row];
      });
      return res.json(saved);
    } catch (error) {
      console.error('Failed to save accounting schedule:', error);
      return res.status(500).json({ error: 'Failed to save accounting schedule' });
    }
  });

  app.post('/api/accounting/fees', async (req, res) => {
    try {
      const actor = await actorFor(req, res);
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
        await addAudit(tx, actor, schoolId, 'create', 'accounting_fee_definition', row.id, `Custom fee proposed: ${label}`);
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
      const actor = await actorFor(req, res);
      if (!actor) return;
      const schoolId = await getSchoolId(actor, req.body?.schoolId, res);
      if (!schoolId) return;
      const feeId = asPositiveInt(req.params.id);
      const status = req.body?.status;
      if (!feeId || !['active', 'rejected'].includes(status)) {
        return res.status(400).json({ error: 'Invalid fee status update' });
      }
      const [updated] = await db.transaction(async (tx) => {
        const [fee] = await tx.update(accountingFeeDefinitions).set({
          status,
          validatedBy: actor.id ?? null,
          validatedAt: new Date(),
          updatedAt: new Date(),
        }).where(and(
          eq(accountingFeeDefinitions.id, feeId),
          eq(accountingFeeDefinitions.schoolId, schoolId),
          eq(accountingFeeDefinitions.status, 'pending'),
        )).returning();
        if (fee) await addAudit(
          tx, actor, schoolId, status === 'active' ? 'approve' : 'reject',
          'accounting_fee_definition', fee.id, `Custom fee ${status}: ${fee.label}`,
        );
        return [fee];
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
      const actor = await actorFor(req, res);
      if (!actor) return;
      const schoolId = await getSchoolId(actor, req.body?.schoolId, res);
      if (!schoolId) return;
      const studentId = asPositiveInt(req.body?.studentId);
      const academicYearId = asPositiveInt(req.body?.academicYearId);
      const tariffId = req.body?.tariffId == null ? null : asPositiveInt(req.body.tariffId);
      const feeDefinitionId = req.body?.feeDefinitionId == null ? null : asPositiveInt(req.body.feeDefinitionId);
      const enrollmentKind = req.body?.enrollmentKind == null ? null : String(req.body.enrollmentKind);
      if (!studentId || !academicYearId || (Boolean(tariffId) === Boolean(feeDefinitionId))) {
        return res.status(400).json({ error: 'Provide a student, academic year, and exactly one tariff or validated fee' });
      }
      if (enrollmentKind != null && !['first_enrollment', 're_enrollment', 'ordinary'].includes(enrollmentKind)) {
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
      if (category.code === 'enrollment' && enrollmentKind == null) {
        return res.status(400).json({ error: 'enrollmentKind must explicitly distinguish first enrollment, re-enrollment, or ordinary enrollment' });
      }
      const amount = tariff?.amount ?? fee!.amount;
      const label = fee?.label ?? tariff?.label ?? category.label;
      const sourceKey = tariff
        ? `tariff-${tariff.id}-student-${studentId}`
        : `fee-${fee!.id}-student-${studentId}`;
      const existing = await db.select().from(financialObligations).where(and(
        eq(financialObligations.schoolId, schoolId),
        eq(financialObligations.sourceKey, sourceKey),
      ));
      if (existing.length) return res.json(existing[0]);

      const context = await validateClassAndYear(schoolId, student.classId, academicYearId);
      if (!context) return res.status(400).json({ error: 'Class and academic year are not valid for this school' });
      const scheduleRows = await db.select().from(accountingScheduleTemplates).where(and(
        eq(accountingScheduleTemplates.schoolId, schoolId),
        eq(accountingScheduleTemplates.academicYearId, academicYearId),
        eq(accountingScheduleTemplates.classId, student.classId),
        eq(accountingScheduleTemplates.categoryId, category.id),
      ));
      let planned: Array<{ label: string; dueDate: string; amount: number; orderIndex: number }>;
      if (category.code === 'tuition') {
        const schedule = validateAccountingSchedule(scheduleRows[0]?.installments);
        if (!schedule) return res.status(409).json({ error: 'Configure a valid installment schedule before creating a tuition obligation' });
        const split = splitAmountBySchedule(amount, schedule);
        if (!split) return res.status(400).json({ error: 'Invalid tuition schedule amounts' });
        planned = split;
      } else {
        const dueDate = fee?.dueDate || asDate(req.body?.dueDate) || todayUtc();
        planned = [{ label, dueDate, amount, orderIndex: 1 }];
      }
      const obligation = await db.transaction(async (tx) => {
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
          return duplicate;
        }
        await tx.insert(financialInstallments).values(planned.map((item) => ({
          obligationId: created.id,
          label: item.label,
          orderIndex: item.orderIndex,
          amount: item.amount,
          dueDate: item.dueDate,
        })));
        await addAudit(tx, actor, schoolId, 'create', 'financial_obligation', created.id, `Obligation created: category=${category!.code} amount=${amount}`);
        return created;
      });
      return res.status(201).json(obligation);
    } catch (error) {
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
      if (req.query.aggregate != null && !aggregateByStudent) {
        return res.status(400).json({ error: 'Valid situation aggregate is required' });
      }
      if (req.query.includeAllCategories != null && !includeAllCategories) {
        return res.status(400).json({ error: 'Valid includeAllCategories value is required' });
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
      const yearBelongsToSchool = year?.schoolId === schoolId
        || (year?.schoolId == null
          && (actor.role === 'super_admin' || actor.academicYearId === academicYearId));
      if (!year || !yearBelongsToSchool) {
        return res.status(404).json({ error: 'Academic year not found in this school' });
      }
      const classId = req.query.classId == null ? null : asPositiveInt(req.query.classId);
      if (req.query.classId != null && !classId) {
        return res.status(400).json({ error: 'Valid classId is required' });
      }
      if (aggregateByStudent && classId == null) {
        return res.status(400).json({ error: 'A classId is required for student aggregate situations' });
      }
      if (classId && !await validateClassAndYear(schoolId, classId, academicYearId)) {
        return res.status(404).json({ error: 'Class not found in this school and academic year' });
      }

      const categoryCondition = categoryId ? sql`AND category.id = ${categoryId}` : sql``;
      const categoryEnabledCondition = tariffIds.length || studentStatus != null || aggregateByStudent || includeAllCategories
        ? sql``
        : sql`AND category.is_enabled = true`;
      const tariffCondition = tariffIds.length
        ? sql`AND tariff.id IN (${sql.join(tariffIds.map((tariffId) => sql`${tariffId}`), sql`, `)})`
        : sql``;
      const selectedClassCondition = classId ? sql`AND class.id = ${classId}` : sql``;
      const studentActiveCondition = req.query.includeInactive === 'true'
        ? sql``
        : sql`AND student.is_active = true`;
      const result = await db.execute(sql`
        WITH student_obligations AS (
          SELECT obligation.student_id, obligation.category_id,
            (sum(obligation.amount) FILTER (WHERE obligation.tariff_id IS NULL))::int AS historical_amount,
            (sum(obligation.amount) FILTER (WHERE obligation.tariff_id IS NOT NULL))::int AS tariff_obligation_amount,
            bool_or(obligation.tariff_id IS NOT NULL) AS has_tariff_obligation
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
                AND range_start_level.order_index <= range_end_level.order_index
                AND student_level.order_index BETWEEN range_start_level.order_index AND range_end_level.order_index
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
            WHEN COALESCE(student_obligations.has_tariff_obligation, false) THEN
              COALESCE(tariff.amount, student_obligations.tariff_obligation_amount, 0)
                + COALESCE(student_obligations.historical_amount, 0)
            WHEN student_obligations.historical_amount IS NOT NULL THEN student_obligations.historical_amount
            ELSE tariff.amount
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
      }>;
      const totalsByStudent = new Map<number, { due: number; paid: number }>();
      for (const row of situationRows) {
        const studentTotals = totalsByStudent.get(row.studentId) ?? { due: 0, paid: 0 };
        const due = Math.max(0, Number(row.due) || 0);
        const paid = Math.max(0, Number(row.paid) || 0);
        studentTotals.due += due;
        studentTotals.paid += Math.min(due, paid);
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
          if (!rowsByStudent.has(row.studentId)) rowsByStudent.set(row.studentId, row);
        }
        const studentRows = [...rowsByStudent.values()]
          .filter((row) => studentStatus == null || row.studentStatus === studentStatus);
        return res.json({ academicYearId, rows: studentRows });
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
        }).from(financialPaymentAllocations)
          .innerJoin(financialPayments, eq(financialPayments.id, financialPaymentAllocations.paymentId))
          .where(and(inArray(financialPaymentAllocations.obligationId, obligationIds), eq(financialPayments.status, 'posted')))
        : [];
      const allocationIds = allocations.map((row) => row.id);
      const adjustments = allocationIds.length
        ? await db.select({
          paymentAllocationId: financialAdjustmentAllocations.paymentAllocationId,
          amount: sql<number>`sum(${financialAdjustmentAllocations.amount})::int`,
        }).from(financialAdjustmentAllocations)
          .innerJoin(financialAdjustments, eq(financialAdjustments.id, financialAdjustmentAllocations.adjustmentId))
          .where(inArray(financialAdjustmentAllocations.paymentAllocationId, allocationIds))
          .groupBy(financialAdjustmentAllocations.paymentAllocationId)
        : [];
      const adjustedById = getAdjustmentTotals(allocations, adjustments);
      const paidByObligation = new Map<number, number>();
      const paidByInstallment = new Map<number, number>();
      for (const allocation of allocations) {
        const net = allocation.amount - (adjustedById.get(allocation.id) ?? 0);
        paidByObligation.set(allocation.obligationId, (paidByObligation.get(allocation.obligationId) ?? 0) + net);
        if (allocation.installmentId != null) {
          paidByInstallment.set(allocation.installmentId, (paidByInstallment.get(allocation.installmentId) ?? 0) + net);
        }
      }
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
          amount: obligation.amount,
          paid: paidByObligation.get(obligation.id) ?? 0,
          remaining: Math.max(0, obligation.amount - (paidByObligation.get(obligation.id) ?? 0)),
          installments: installments.filter((item) => item.obligationId === obligation.id).map((item) => ({
            id: item.id,
            label: item.label,
            dueDate: item.dueDate,
            amount: item.amount,
            paid: paidByInstallment.get(item.id) ?? 0,
            remaining: Math.max(0, item.amount - (paidByInstallment.get(item.id) ?? 0)),
            status: (paidByInstallment.get(item.id) ?? 0) >= item.amount ? 'paid'
              : (paidByInstallment.get(item.id) ?? 0) > 0 ? 'partial'
                : item.dueDate < todayUtc() ? 'overdue' : 'pending',
          })),
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
        const balance = calculateStudentFeeBalance({
          studentId,
          categoryId: category.id,
          tariffAmount: tariff?.amount ?? null,
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
          status: balance.status,
          tariffId: tariff?.id ?? null,
          obligations: group.items,
        };
      });
      return res.json({
        student,
        academicYearId,
        totals: {
          due: categoryBalances.reduce((sum, category) => sum + category.due, 0),
          paid: categoryBalances.reduce((sum, category) => sum + Math.min(category.due, category.paid), 0),
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
      const actor = await actorFor(req, res);
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
      const amount = tariffAllocations
        ? tariffAllocations.reduce((sum, item) => sum + item.amount, 0)
        : asMoney(req.body?.amount);
      const method = String(req.body?.method ?? '');
      const idempotencyKey = typeof req.body?.idempotencyKey === 'string' ? req.body.idempotencyKey.trim() : '';
      const reference = typeof req.body?.reference === 'string' ? req.body.reference.trim() || null : null;
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
      ]);
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
          return { payment: existing, receipt, duplicate: true };
        }
        if (tariffAllocations) {
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
            await ensureTariffObligation(tx, {
              actor,
              schoolId,
              studentId,
              academicYearId,
              classId: student.classId!,
              className: student.className ?? '—',
              categoryId: tariff.categoryId,
              tariffId: tariff.id,
            });
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
          });
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
            const obligation = outstanding.obligations.find((row) => row.tariffId === allocation.tariffId);
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
          if ([...obligationIds].length !== tariffAllocations.length) {
            throw Object.assign(new Error('Each selected fee must map to a separate obligation'), { statusCode: 409 });
          }
        } else {
          const totalRemaining = [...outstanding.balances.values()].reduce((sum, value) => sum + value, 0);
        const currentTariff = categoryId
          ? (await getApplicableTariffs(tx, {
            schoolId,
            academicYearId,
            classId: student.classId!,
            categoryId,
          }))[0]
          : null;
        const scopedObligations = categoryId
          ? outstanding.obligations.filter((row) => row.categoryId === categoryId)
          : outstanding.obligations;
        totalDue = categoryId && currentTariff
          ? scopedObligations
            .filter((row) => row.tariffId == null)
            .reduce((sum, row) => sum + row.amount, currentTariff.amount)
          : scopedObligations.reduce((sum, row) => sum + row.amount, 0);
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
        await addAudit(tx, actor, schoolId, 'create', 'financial_payment', payment.id, `Payment recorded: amount=${amount} method=${method}`);
        await addAudit(tx, actor, schoolId, 'create', 'financial_receipt', receipt.id, `Receipt issued: ${receiptNumber}`);
        const [parent] = await tx.select({ userId: parents.userId }).from(students)
          .innerJoin(parents, eq(parents.id, students.parentId))
          .where(eq(students.id, studentId));
        if (parent?.userId) {
          await tx.insert(notifications).values({
            userId: parent.userId,
            title: 'Paiement enregistré',
            body: `Un paiement de ${amount} FCFA a été enregistré pour votre enfant.`,
            type: 'info',
            dedupeKey: `accounting-payment-${payment.id}`,
          }).onConflictDoNothing();
        }
        return { payment, receipt, duplicate: false };
      });
      return res.status(result.duplicate ? 200 : 201).json(result);
    } catch (error) {
      const statusCode = typeof error === 'object' && error && 'statusCode' in error ? Number(error.statusCode) : 500;
      if (statusCode !== 500) return res.status(statusCode).json({ error: (error as Error).message });
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
        classId: financialObligations.classId,
        studentId: financialPayments.studentId,
        studentName: sql<string>`concat_ws(' ', ${students.lastName}, ${students.firstName})`,
        tariffId: financialObligations.tariffId,
      }).from(financialPaymentAllocations)
        .innerJoin(financialPayments, eq(financialPayments.id, financialPaymentAllocations.paymentId))
        .innerJoin(financialObligations, eq(financialObligations.id, financialPaymentAllocations.obligationId))
        .innerJoin(accountingCategories, eq(accountingCategories.id, financialObligations.categoryId))
        .leftJoin(accountingTariffs, eq(accountingTariffs.id, financialObligations.tariffId))
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
      const allObligations = await db.select({
        amount: financialObligations.amount,
        id: financialObligations.id,
      }).from(financialObligations).where(and(
        eq(financialObligations.schoolId, schoolId),
        eq(financialObligations.status, 'active'),
        ...(yearId ? [eq(financialObligations.academicYearId, yearId)] : []),
        ...(studentId ? [eq(financialObligations.studentId, studentId)] : []),
        ...(categoryId ? [eq(financialObligations.categoryId, categoryId)] : []),
        ...(classId ? [eq(financialObligations.classId, classId)] : []),
        ...(tariffIds.length ? [inArray(financialObligations.tariffId, tariffIds as number[])] : []),
      ));
      const allAllocations = allObligations.length
        ? await db.select({
          id: financialPaymentAllocations.id,
          obligationId: financialPaymentAllocations.obligationId,
          amount: financialPaymentAllocations.amount,
        }).from(financialPaymentAllocations)
          .innerJoin(financialPayments, eq(financialPayments.id, financialPaymentAllocations.paymentId))
          .where(and(inArray(financialPaymentAllocations.obligationId, allObligations.map((row) => row.id)), eq(financialPayments.status, 'posted')))
        : [];
      const outstandingAdjustments = allAllocations.length
        ? await db.select({
          paymentAllocationId: financialAdjustmentAllocations.paymentAllocationId,
          amount: sql<number>`sum(${financialAdjustmentAllocations.amount})::int`,
        }).from(financialAdjustmentAllocations)
          .innerJoin(financialAdjustments, eq(financialAdjustments.id, financialAdjustmentAllocations.adjustmentId))
          .where(inArray(financialAdjustmentAllocations.paymentAllocationId, allAllocations.map((row) => row.id)))
          .groupBy(financialAdjustmentAllocations.paymentAllocationId)
        : [];
      const adjustedForOutstanding = getAdjustmentTotals(
        allAllocations.map((row) => ({ ...row, installmentId: null })),
        outstandingAdjustments,
      );
      const paidForScope = new Map<number, number>();
      for (const allocation of allAllocations) {
        paidForScope.set(
          allocation.obligationId,
          (paidForScope.get(allocation.obligationId) ?? 0)
            + allocation.amount - (adjustedForOutstanding.get(allocation.id) ?? 0),
        );
      }
      const expected = allObligations.reduce((sum, obligation) => sum + obligation.amount, 0);
      const paidAll = allObligations.reduce((sum, obligation) => sum + (paidForScope.get(obligation.id) ?? 0), 0);
      return res.json({
        total,
        categories: Object.fromEntries(categories),
        methods: Object.fromEntries(methods),
        expected,
        paid: paidAll,
        remaining: expected - paidAll,
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

  app.post('/api/accounting/notifications/overdue', async (req, res) => {
    try {
      const actor = await actorFor(req, res);
      if (!actor) return;
      const schoolId = await getSchoolId(actor, req.body?.schoolId, res);
      if (!schoolId) return;
      const yearId = req.body?.academicYearId == null ? null : asPositiveInt(req.body.academicYearId);
      if (req.body?.academicYearId != null && !yearId) return res.status(400).json({ error: 'Invalid academicYearId' });
      const { obligations, lateInstallments, dueSoonInstallments } = await loadOverdueInstallments(db, schoolId, yearId);
      await notifyDueInstallments(db, schoolId, obligations, lateInstallments, dueSoonInstallments);
      return res.json({ notified: lateInstallments.length + dueSoonInstallments.length });
    } catch (error) {
      console.error('Failed to notify overdue accounting installments:', error);
      return res.status(500).json({ error: 'Failed to notify overdue accounting installments' });
    }
  });

  app.get('/api/accounting/receipts/:id', async (req, res) => {
    try {
      const actor = await actorFor(req, res);
      if (!actor) return;
      const receiptId = asPositiveInt(req.params.id);
      if (!receiptId) return res.status(400).json({ error: 'Invalid receipt id' });
      const [receipt] = await db.select().from(financialReceipts).where(eq(financialReceipts.id, receiptId));
      if (!receipt) return res.status(404).json({ error: 'Receipt not found' });
      const schoolId = await getSchoolId(actor, actor.role === 'school_admin' ? undefined : receipt.schoolId, res);
      if (!schoolId) return;
      if (receipt.schoolId !== schoolId) return res.status(403).json({ error: 'Forbidden' });
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

  return { total, categories: Object.fromEntries(categories), currency: 'XOF' };
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

async function notifyDueInstallments(
  db: typeof defaultDb,
  schoolId: number,
  obligations: Array<{ id: number; studentId: number }>,
  lateInstallments: Array<{ id: number; obligationId: number; dueDate: string }>,
  dueSoonInstallments: Array<{ id: number; obligationId: number; dueDate: string }>,
) {
  const notificationsToSend = [
    ...lateInstallments.map((item) => ({ ...item, event: 'overdue' as const })),
    ...dueSoonInstallments.map((item) => ({ ...item, event: 'due-soon' as const })),
  ];
  if (!notificationsToSend.length) return;
  const obligationIds = new Set(notificationsToSend.map((item) => item.obligationId));
  const relevantObligations = obligations.filter((item) => obligationIds.has(item.id));
  const parentByStudent = await db.select({ studentId: students.id, userId: parents.userId })
    .from(students).innerJoin(parents, eq(parents.id, students.parentId))
    .where(and(
      eq(students.schoolId, schoolId),
      inArray(students.id, relevantObligations.map((row) => row.studentId)),
    ));
  const parentForStudent = new Map(parentByStudent.map((row) => [row.studentId, row.userId]));
  const obligationById = new Map(obligations.map((row) => [row.id, row]));
  for (const installment of notificationsToSend) {
    const obligation = obligationById.get(installment.obligationId);
    const userId = obligation ? parentForStudent.get(obligation.studentId) : null;
    if (!userId) continue;
    const isOverdue = installment.event === 'overdue';
    await db.insert(notifications).values({
      userId,
      title: isOverdue ? 'Échéance scolaire impayée' : 'Échéance scolaire à venir',
      body: isOverdue
        ? 'Une échéance financière de votre enfant est arrivée à échéance et reste partiellement ou totalement impayée.'
        : 'Une échéance financière de votre enfant arrive à échéance dans les sept prochains jours.',
      type: 'info',
      dedupeKey: `accounting-${installment.event}-${installment.id}-${installment.dueDate}`,
    }).onConflictDoNothing();
  }
}

async function handlePaymentAdjustment(
  req: any,
  res: express.Response,
  options: RegisterAccountingApiOptions,
  actorFor: (req: any, res: express.Response) => Promise<AccountingActor | null>,
  getSchoolIdFn: typeof getSchoolId,
  kind: 'cancellation' | 'refund',
) {
  const db = options.database ?? defaultDb;
  try {
    const actor = await actorFor(req, res);
    if (!actor) return;
    const paymentId = asPositiveInt(req.params.id);
    if (!paymentId) return res.status(400).json({ error: 'Invalid payment id' });
    const [payment] = await db.select().from(financialPayments).where(eq(financialPayments.id, paymentId));
    if (!payment) return res.status(404).json({ error: 'Payment not found' });
    const schoolId = await getSchoolIdFn(actor, actor.role === 'school_admin' ? undefined : payment.schoolId, res);
    if (!schoolId) return;
    if (payment.schoolId !== schoolId) return res.status(403).json({ error: 'Forbidden' });
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
    const idempotencyKey = typeof req.body?.idempotencyKey === 'string' ? req.body.idempotencyKey.trim() : '';
    const amount = kind === 'cancellation' ? null : asMoney(req.body?.amount);
    if (!reason || reason.length > 500 || !idempotencyKey || idempotencyKey.length > 120 || (kind === 'refund' && !amount)) {
      return res.status(400).json({ error: 'Reason, idempotency key, and valid refund amount are required' });
    }
    const result = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT id FROM financial_payments WHERE id = ${paymentId} FOR UPDATE`);
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
      const remaining = allocations.reduce((sum, row) => sum + row.amount - (adjustedById.get(row.id) ?? 0), 0);
      const adjustmentAmount = kind === 'cancellation' ? remaining : amount!;
      if (!remaining || adjustmentAmount > remaining) {
        throw Object.assign(new Error('Adjustment exceeds the unreversed payment amount'), { statusCode: 409 });
      }
      const [adjustment] = await tx.insert(financialAdjustments).values({
        paymentId,
        kind,
        amount: adjustmentAmount,
        reason,
        sourceKey: kind === 'cancellation' ? `cancel:${paymentId}` : `refund:${paymentId}:${idempotencyKey}`,
        recordedBy: actor.id ?? null,
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
      if (kind === 'cancellation') {
        await tx.update(financialPayments).set({ status: 'cancelled' }).where(eq(financialPayments.id, paymentId));
      }
      await addAudit(tx, actor, schoolId, kind, 'financial_payment', paymentId, `${kind} recorded: amount=${adjustmentAmount}; reason=${reason}`);
      return { adjustment, duplicate: false };
    });
    return res.status(result.duplicate ? 200 : 201).json(result);
  } catch (error) {
    const statusCode = typeof error === 'object' && error && 'statusCode' in error ? Number(error.statusCode) : 500;
    if (statusCode !== 500) return res.status(statusCode).json({ error: (error as Error).message });
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
  const page = pdf.addPage([595, 842]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const formatReceiptAmount = (amount: number) => Number(amount || 0)
    .toLocaleString('fr-FR')
    .replace(/[\u00a0\u202f]/g, ' ');
  let y = 790;
  const draw = (text: string, size = 11, isBold = false) => {
    page.drawText(text, { x: 48, y, size, font: isBold ? bold : font, color: rgb(0.1, 0.12, 0.18), maxWidth: 500 });
    y -= size + 12;
  };
  const school = data.school ?? {};
  draw(String(school.name ?? 'Établissement'), 18, true);
  if (school.address) draw(String(school.address));
  if (school.phone) draw(`Tél. ${school.phone}`);
  if (school.email) draw(String(school.email));
  y -= 14;
  draw('REÇU DE PAIEMENT', 16, true);
  draw(`Numéro : ${String(data.receiptNumber ?? '')}`, 12, true);
  const payment = data.payment ?? {};
  draw(`Date : ${String(payment.paidAt ?? '')}`);
  const student = data.student ?? {};
  draw(`Élève : ${String(student.firstName ?? '')} ${String(student.lastName ?? '')}`);
  draw(`Matricule : ${String(student.matricule ?? '—')}  |  Classe : ${String(student.className ?? '—')}`);
  draw(`Année scolaire : ${String(data.academicYearName ?? '—')}`);
  y -= 10;
  for (const allocation of Array.isArray(data.allocations) ? data.allocations : []) {
    draw(formatAccountingReceiptAllocationLine(allocation));
  }
  y -= 8;
  draw(`Montant encaissé : ${formatReceiptAmount(payment.amount)} FCFA`, 13, true);
  draw(`Total dû : ${formatReceiptAmount(data.totalDue)} FCFA`);
  draw(`Déjà payé avant ce règlement : ${formatReceiptAmount(data.paidBeforePayment)} FCFA`);
  draw(`Reste dû après paiement : ${formatReceiptAmount(data.remainingAfterPayment)} FCFA`);
  draw(`Mode : ${String(payment.method ?? '')}`);
  if (payment.reference) draw(`Référence : ${String(payment.reference)}`);
  draw(`Enregistré par : ${String(data.recordedBy ?? '—')}`);
  const logoData = typeof school.logoData === 'string' ? school.logoData : '';
  if (logoData) {
    const bytes = Uint8Array.from(Buffer.from(logoData, 'base64'));
    const image = school.logoMimeType === 'image/png' ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);
    page.drawImage(image, { x: 450, y: 730, width: Math.min(90, image.width), height: Math.min(70, image.height) });
  }
  return pdf.save();
}
