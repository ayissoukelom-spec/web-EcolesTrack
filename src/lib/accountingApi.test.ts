import express from 'express';
import request from 'supertest';
import { PgDialect } from 'drizzle-orm/pg-core';
import { PDFDocument } from 'pdf-lib';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockedFunction } from 'vitest';
import {
  accountingCategories,
  accountingFeeDefinitions,
  accountingScheduleTemplates,
  accountingTariffs,
  academicYears,
  auditEvents,
  classes,
  financialAdjustmentAllocations,
  financialInstallments,
  financialObligations,
  financialPaymentAllocations,
  financialPayments,
  financialReceipts,
  notifications,
  notificationAttachments,
  userSchools,
  users,
  schools,
  students,
} from '../db/schema.ts';

const fileStorageMock = vi.hoisted(() => ({
  persistUploadedFile: vi.fn(async (file: {
    originalname?: string;
    buffer?: Buffer | Uint8Array;
    mimetype?: string;
    size?: number;
  }) => ({
    storedReference: `notification-attachments/${file.originalname ?? 'receipt.pdf'}`,
  })),
  deleteStoredFile: vi.fn(async () => true),
}));

const dbMock = vi.hoisted(() => ({
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  execute: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock('../db/index.ts', () => ({ db: dbMock }));
vi.mock('./fileStorage.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./fileStorage.ts')>()),
  ...fileStorageMock,
}));

import {
  formatAccountingReceiptAllocationLine,
  registerAccountingRoutes,
  type RegisterAccountingApiOptions,
} from './accountingApi.ts';
import { getAccountingReminderDedupeKey } from './accountingPaymentReminders.ts';

const mockState = {
  selectResults: new Map<any, any[][]>(),
  insertResults: new Map<any, any[][]>(),
  inserted: [] as Array<{ table: any; values: any }>,
  updated: [] as Array<{ table: any; values: any }>,
  deleted: [] as Array<{ table: any; condition: any }>,
  whereConditions: [] as Array<{ table: any; condition: any }>,
  selectProjections: [] as Array<Record<string, any>>,
  executedSql: [] as any[],
  approvedClasses: new Set<string>(),
  upsertTargets: [] as any[],
  nextId: 100,
  actor: {
    id: 7,
    role: 'super_admin',
    schoolId: null as number | null,
    academicYearId: null as number | null,
    email: 'admin@example.com',
    name: 'Admin',
  },
  transactionCommitted: false,
};

const setSelectResults = (table: any, ...results: any[][]) => {
  mockState.selectResults.set(table, results);
};

const setInsertResults = (table: any, ...results: any[][]) => {
  mockState.insertResults.set(table, results);
};

const prepareTariffModification = ({
  targetClassId = 53,
  targetLabel = 'Transport',
  targetAmount = 15000,
  duplicate = false,
}: {
  targetClassId?: number;
  targetLabel?: string;
  targetAmount?: number;
  duplicate?: boolean;
} = {}) => {
  const existingCategory = { id: 41, schoolId: 2, code: 'custom:transport', label: 'Transport', isEnabled: true };
  const collisionCategory = { id: 42, schoolId: 2, code: 'custom:other', label: targetLabel, isEnabled: true };
  mockState.actor = { ...mockState.actor, role: 'school_admin', schoolId: 2 };
  setSelectResults(academicYears, [{ id: 2, schoolId: null }]);
  setSelectResults(classes, [{ id: targetClassId, schoolId: 2, academicYearId: 2, name: 'Classe cible' }]);
  setSelectResults(accountingTariffs,
    [{ id: 31, schoolId: 2, academicYearId: 2, classId: 53, categoryId: 41, label: 'Transport', amount: 15000 }],
    [
      { id: 31, label: 'Transport' },
      ...(duplicate ? [{ id: 32, label: targetLabel }] : []),
    ]);
  setSelectResults(accountingCategories,
    [existingCategory, ...(duplicate ? [collisionCategory] : [])],
    [existingCategory]);
};

const prepareObligationGeneration = (
  studentRows = [{
    id: 10,
    firstName: 'Afi',
    lastName: 'Doe',
    matricule: 'A10',
    classId: 2,
  }],
  obligationRows: Array<{
    id: number;
    studentId: number;
    classId: number;
    categoryId: number;
    tariffId: number | null;
    feeDefinitionId: number | null;
    sourceKey: string;
    status: string;
    amount: number;
  }> = [],
  categoryCode = 'tuition',
) => {
  mockState.actor = { ...mockState.actor, role: 'school_admin', schoolId: 1 };
  setSelectResults(academicYears,
    [{ id: 4, schoolId: 1, name: '2026-2027' }],
    [{ id: 4, schoolId: 1, name: '2026-2027' }]);
  setSelectResults(classes, [{
    id: 2,
    schoolId: 1,
    academicYearId: 4,
    name: '6e',
  }]);
  setSelectResults(accountingCategories, [{
    id: 8,
    schoolId: 1,
    code: categoryCode,
    label: categoryCode === 'tuition' ? 'Scolarité' : 'Cantine',
    isEnabled: true,
  }]);
  setSelectResults(students, studentRows);
  setSelectResults(accountingTariffs, [{
    id: 41,
    schoolId: 1,
    academicYearId: 4,
    classId: 2,
    classFromId: null,
    classToId: null,
    categoryId: 8,
    label: categoryCode === 'tuition' ? 'Frais de scolarité' : 'Cantine',
    amount: 120000,
    isEnabled: true,
  }]);
  setSelectResults(accountingScheduleTemplates, categoryCode === 'tuition' ? [{
    schoolId: 1,
    academicYearId: 4,
    classId: 2,
    categoryId: 8,
    installments: [
      { label: 'Tranche 1', dueDate: '2026-10-01', basisPoints: 5000 },
      { label: 'Tranche 2', dueDate: '2027-01-01', basisPoints: 5000 },
    ],
  }] : []);
  setSelectResults(financialObligations, obligationRows);
};

const makeQuery = () => {
  const query: any = {
    table: null,
    from(table: any) {
      this.table = table;
      return this;
    },
    where(condition: any) {
      if (this.table) mockState.whereConditions.push({ table: this.table, condition });
      return this;
    },
    innerJoin() { return this; },
    leftJoin() { return this; },
    orderBy() { return this; },
    groupBy() { return this; },
    limit() { return this; },
    for() { return this; },
    then(resolve: (value: any) => unknown, reject: (reason: unknown) => unknown) {
      const queue = mockState.selectResults.get(this.table);
      const rows = queue?.length ? queue.shift() : [];
      return Promise.resolve(rows).then(resolve, reject);
    },
  };
  return query;
};

const mockDb: any = dbMock;
mockDb.select.mockImplementation((projection: Record<string, any>) => {
  mockState.selectProjections.push(projection);
  return makeQuery();
});

mockDb.insert.mockImplementation((table: any) => ({
  values(values: any) {
    mockState.inserted.push({ table, values });
    const queue = mockState.insertResults.get(table);
    const rows = queue?.length
      ? queue.shift()
      : [{ id: mockState.nextId++, ...values }];
    const insertQuery: any = {
      onConflictDoNothing() { return this; },
      onConflictDoUpdate(options: any) {
        mockState.upsertTargets.push(options.target);
        return this;
      },
      returning: async () => rows,
      then(resolve: (value: any) => unknown, reject: (reason: unknown) => unknown) {
        return Promise.resolve([]).then(resolve, reject);
      },
    };
    return insertQuery;
  },
}));
mockDb.update.mockImplementation((table: any) => ({
  set(values: any) {
    mockState.updated.push({ table, values });
    const updateQuery: any = {
      where() { return this; },
      returning: async () => [{ id: 1, ...values }],
    };
    return updateQuery;
  },
}));
mockDb.delete.mockImplementation((table: any) => ({
  where(condition: any) {
    mockState.deleted.push({ table, condition });
    return Promise.resolve();
  },
}));
mockDb.execute.mockImplementation((statement: any) => {
  mockState.executedSql.push(statement);
  return Promise.resolve({ rows: [{ value: '15' }] });
});
mockDb.transaction.mockImplementation(async (callback: (tx: any) => unknown) => {
  const result = await callback(mockDb);
  mockState.transactionCommitted = true;
  return result;
});

const reminderObligation = {
  id: 31,
  studentId: 10,
  classNameSnapshot: '6e',
  obligationClassName: '6e',
  label: 'Scolarité',
  tariffLabel: 'Scolarité annuelle',
  categoryLabel: 'Scolarité',
};
const reminderStudent = {
  id: 10,
  firstName: 'Afi',
  lastName: 'Doe',
  className: '6e',
};
const reminderRecipient = { studentId: 10, userId: 25 };
const reminderInstallments = [
  { id: 41, obligationId: 31, label: 'Tranche 1', dueDate: '2000-01-01', amount: 10000 },
  { id: 42, obligationId: 31, label: 'Tranche 2', dueDate: '2000-02-01', amount: 5000 },
];
const reminderAllocation = {
  id: 51,
  obligationId: 31,
  installmentId: 41,
  amount: 2000,
  paymentSchoolId: 1,
  paymentAcademicYearId: 4,
};

const prepareReminderCandidateQueries = (includeStudentScopeCheck = false) => {
  mockState.actor = { ...mockState.actor, role: 'school_admin', schoolId: 1 };
  setSelectResults(academicYears, [{ id: 4, schoolId: 1, name: '2026-2027' }]);
  setSelectResults(schools,
    [{ id: 1, name: 'École test' }],
    [{ name: 'École test' }]);
  setSelectResults(financialObligations, [reminderObligation]);
  setSelectResults(financialInstallments, reminderInstallments);
  setSelectResults(financialPaymentAllocations, [reminderAllocation]);
  setSelectResults(financialAdjustmentAllocations, []);
  setSelectResults(
    students,
    ...(includeStudentScopeCheck ? [[{ id: 10 }]] : []),
    [reminderStudent],
    [reminderRecipient],
  );
  setSelectResults(notifications, []);
};

describe('accounting API', () => {
  let app: express.Express;
  let dispatchPaymentNotification: MockedFunction<RegisterAccountingApiOptions['dispatchPaymentNotification']>;

  beforeEach(() => {
    mockDb.select.mockClear();
    mockDb.insert.mockClear();
    mockDb.update.mockClear();
    mockDb.delete.mockClear();
    mockDb.execute.mockClear();
    mockDb.transaction.mockClear();
    mockState.selectResults.clear();
    mockState.insertResults.clear();
    mockState.inserted = [];
    mockState.updated = [];
    mockState.deleted = [];
    mockState.whereConditions = [];
    mockState.selectProjections = [];
    mockState.executedSql = [];
    mockState.approvedClasses.clear();
    mockState.upsertTargets = [];
    mockState.nextId = 100;
    mockState.transactionCommitted = false;
    fileStorageMock.persistUploadedFile.mockClear();
    fileStorageMock.deleteStoredFile.mockClear();
    fileStorageMock.persistUploadedFile.mockImplementation(async (file) => ({
      storedReference: `notification-attachments/${file.originalname ?? 'receipt.pdf'}`,
    }));
    mockState.actor = { id: 7, role: 'super_admin', schoolId: null, academicYearId: null, email: 'admin@example.com', name: 'Admin' };
    dispatchPaymentNotification = vi.fn(async (
      _payload: Parameters<RegisterAccountingApiOptions['dispatchPaymentNotification']>[0],
    ) => 202);
    app = express();
    app.use(express.json());
    registerAccountingRoutes(app, {
      resolveActor: async () => mockState.actor,
      isApprovedClassForSchool: async (classId, schoolId) => mockState.approvedClasses.has(`${schoolId}:${classId}`),
      dispatchPaymentNotification,
    });
  });

  it('resolves an explicitly selected range to the exact tariff when both apply', async () => {
    const historicalObligation = {
      id: 21,
      schoolId: 1,
      studentId: 10,
      academicYearId: 4,
      classId: 2,
      categoryId: 2,
      tariffId: 5,
      feeDefinitionId: null,
      enrollmentKind: null,
      label: 'Scolarité',
      amount: 50000,
      createdAt: new Date(),
    };
    const exactTariff = {
      id: 5,
      schoolId: 1,
      academicYearId: 4,
      classId: 2,
      classFromId: null,
      classToId: null,
      categoryId: 2,
      label: 'Scolarité exacte',
      amount: 80000,
      isEnabled: true,
    };
    prepareRangeTariffPayment([historicalObligation], exactTariff);

    const response = await request(app).post('/api/accounting/payments').send({
      ...validPaymentBody(),
      allocations: [{ tariffId: 6, amount: 30000 }],
    });

    expect(response.status, JSON.stringify(response.body)).toBe(201);
    expect(mockState.inserted.some((item) => item.table === financialObligations)).toBe(false);
    expect(mockState.inserted.find((item) => item.table === financialPaymentAllocations)?.values)
      .toEqual([{ paymentId: 100, installmentId: 31, obligationId: 21, amount: 30000 }]);
  });

  it('rejects roles outside the existing administrative roles', async () => {
    mockState.actor = { ...mockState.actor, role: 'teacher' };
    const response = await request(app).get('/api/accounting/categories?schoolId=3');
    expect(response.status).toBe(403);
    expect(mockDb.select).not.toHaveBeenCalled();
  });

  it('previews tuition obligations without writing and uses the configured installment schedule', async () => {
    prepareObligationGeneration();

    const response = await request(app).post('/api/accounting/obligation-generation/preview').send({
      academicYearId: 4,
      classIds: [2],
      categoryIds: [8],
    });

    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body).toMatchObject({
      studentsExamined: 1,
      studentsEligible: 1,
      newObligationCount: 1,
      estimatedTotal: 120000,
      selectionByTariffId: { 41: [10] },
    });
    expect(response.body.rows[0]).toMatchObject({
      state: 'eligible',
      selected: true,
      amount: 120000,
      installments: [
        { label: 'Tranche 1', amount: 60000 },
        { label: 'Tranche 2', amount: 60000 },
      ],
    });
    expect(mockDb.transaction).not.toHaveBeenCalled();
    expect(mockState.inserted).toHaveLength(0);
  });

  it('rejects positive individualized installments whose sum differs from the reduced tuition amount', async () => {
    prepareObligationGeneration();

    const response = await request(app).post('/api/accounting/obligation-generation/preview').send({
      academicYearId: 4,
      classIds: [2],
      categoryIds: [8],
      tuitionReductionsByTariffId: {
        41: { 10: { discountAmount: 30000, reason: 'Bourse accordée' } },
      },
      tuitionInstallmentAmountsByTariffId: {
        41: { 10: [40000, 40000] },
      },
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('total equals the reduced tuition amount');
    expect(mockState.inserted).toHaveLength(0);
  });

  it('previews fixed unequal tuition installments exactly as configured', async () => {
    prepareObligationGeneration();
    setSelectResults(accountingTariffs, [{
      id: 41,
      schoolId: 1,
      academicYearId: 4,
      classId: 2,
      classFromId: null,
      classToId: null,
      categoryId: 8,
      label: 'Frais de scolarité',
      amount: 71000,
      isEnabled: true,
    }]);
    setSelectResults(accountingScheduleTemplates, [{
      schoolId: 1,
      academicYearId: 4,
      classId: 2,
      categoryId: 8,
      periodType: 'annual',
      installments: [
        { label: 'Première tranche', dueDate: '2026-10-01', amount: 36000 },
        { label: 'Deuxième tranche', dueDate: '2027-01-01', amount: 25000 },
        { label: 'Troisième tranche', dueDate: '2027-04-01', amount: 10000 },
      ],
    }]);

    const response = await request(app).post('/api/accounting/obligation-generation/preview').send({
      academicYearId: 4,
      classIds: [2],
      categoryIds: [8],
    });

    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body.estimatedTotal).toBe(71000);
    expect(response.body.rows[0].installments).toEqual([
      { label: 'Première tranche', dueDate: '2026-10-01', amount: 36000, orderIndex: 1 },
      { label: 'Deuxième tranche', dueDate: '2027-01-01', amount: 25000, orderIndex: 2 },
      { label: 'Troisième tranche', dueDate: '2027-04-01', amount: 10000, orderIndex: 3 },
    ]);
    expect(mockState.inserted).toHaveLength(0);
  });

  it('saves fixed tuition schedules with any permitted tranche count after exact-total validation', async () => {
    prepareObligationGeneration();
    setSelectResults(accountingTariffs, [{
      id: 41,
      schoolId: 1,
      academicYearId: 4,
      classId: 2,
      classFromId: null,
      classToId: null,
      categoryId: 8,
      label: 'Frais de scolarité',
      amount: 71000,
      isEnabled: true,
    }]);

    const response = await request(app).put('/api/accounting/schedules').send({
      academicYearId: 4,
      classId: 2,
      categoryId: 8,
      periodType: 'annual',
      installments: [
        { label: 'Première tranche', dueDate: '2026-10-01', amount: 36000 },
        { label: 'Deuxième tranche', dueDate: '2027-01-01', amount: 25000 },
        { label: 'Troisième tranche', dueDate: '2027-04-01', amount: 10000 },
      ],
    });

    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body.installments.map((item: any) => item.amount)).toEqual([36000, 25000, 10000]);
    expect(mockState.inserted.find((item) => item.table === accountingScheduleTemplates)?.values).toMatchObject({
      schoolId: 1,
      academicYearId: 4,
      classId: 2,
      categoryId: 8,
      periodType: 'annual',
    });
    expect(mockState.transactionCommitted).toBe(true);
  });

  it('rejects fixed tuition schedules whose total differs from the annual tariff', async () => {
    prepareObligationGeneration();
    setSelectResults(accountingTariffs, [{
      id: 41,
      schoolId: 1,
      academicYearId: 4,
      classId: 2,
      classFromId: null,
      classToId: null,
      categoryId: 8,
      label: 'Frais de scolarité',
      amount: 71000,
      isEnabled: true,
    }]);

    const response = await request(app).put('/api/accounting/schedules').send({
      academicYearId: 4,
      classId: 2,
      categoryId: 8,
      periodType: 'annual',
      installments: [
        { label: 'Première tranche', dueDate: '2026-10-01', amount: 36000 },
        { label: 'Deuxième tranche', dueDate: '2027-01-01', amount: 25000 },
        { label: 'Troisième tranche', dueDate: '2027-04-01', amount: 9999 },
      ],
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('total the configured annual tuition tariff');
    expect(mockDb.transaction).not.toHaveBeenCalled();
    expect(mockState.inserted).toHaveLength(0);
  });

  it('rejects fixed tuition schedules for unauthorized classes and school years', async () => {
    const scheduleRequest = {
      classId: 2,
      categoryId: 8,
      periodType: 'annual',
      installments: [{ label: 'Tranche 1', dueDate: '2026-10-01', amount: 71000 }],
    };
    prepareObligationGeneration();
    setSelectResults(classes, [{ id: 2, schoolId: 2, academicYearId: 4, name: 'Classe hors établissement' }]);
    const unauthorizedClass = await request(app).put('/api/accounting/schedules').send({
      ...scheduleRequest,
      academicYearId: 4,
    });

    expect(unauthorizedClass.status).toBe(400);
    expect(unauthorizedClass.body.error).toContain('not valid for this school');
    expect(mockState.inserted).toHaveLength(0);

    prepareObligationGeneration();
    const unauthorizedYear = await request(app).put('/api/accounting/schedules').send({
      ...scheduleRequest,
      academicYearId: 5,
    });

    expect(unauthorizedYear.status).toBe(400);
    expect(unauthorizedYear.body.error).toContain('not valid for this school');
    expect(mockState.inserted).toHaveLength(0);
  });

  it('previews an individualized tuition reduction and recalculates its installments without writing', async () => {
    prepareObligationGeneration([
      { id: 10, firstName: 'Afi', lastName: 'Doe', matricule: 'A10', classId: 2 },
      { id: 11, firstName: 'Kossi', lastName: 'Doe', matricule: 'A11', classId: 2 },
    ]);

    const response = await request(app).post('/api/accounting/obligation-generation/preview').send({
      academicYearId: 4,
      classIds: [2],
      categoryIds: [8],
      tuitionReductionsByTariffId: {
        41: { 10: { discountAmount: 30000, reason: 'Bourse accordée' } },
      },
      tuitionInstallmentAmountsByTariffId: {
        41: { 10: [45000, 45000] },
      },
    });

    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body).toMatchObject({
      estimatedTotal: 210000,
      tuitionReductionsByTariffId: {
        41: { 10: { discountAmount: 30000, reason: 'Bourse accordée' } },
      },
      tuitionInstallmentAmountsByTariffId: {
        41: { 10: [45000, 45000] },
      },
    });
    expect(response.body.rows[0]).toMatchObject({
      referenceAmount: 120000,
      discountAmount: 30000,
      individualizationReason: 'Bourse accordée',
      amount: 90000,
      installments: [
        { label: 'Tranche 1', amount: 45000 },
        { label: 'Tranche 2', amount: 45000 },
      ],
    });
    expect(response.body.rows[1]).toMatchObject({
      studentId: 11,
      referenceAmount: 120000,
      discountAmount: 0,
      amount: 120000,
    });
    expect(mockDb.transaction).not.toHaveBeenCalled();
    expect(mockState.inserted).toHaveLength(0);
  });

  it('rejects a full tuition reduction and requires a reason for a positive reduction', async () => {
    prepareObligationGeneration();
    const fullReduction = await request(app).post('/api/accounting/obligation-generation/preview').send({
      academicYearId: 4,
      classIds: [2],
      categoryIds: [8],
      tuitionReductionsByTariffId: {
        41: { 10: { discountAmount: 120000, reason: 'Exonération totale' } },
      },
    });

    expect(fullReduction.status).toBe(400);
    expect(fullReduction.body.error).toContain('final amount must remain positive');
    expect(mockState.inserted).toHaveLength(0);

    prepareObligationGeneration();
    const missingReason = await request(app).post('/api/accounting/obligation-generation/preview').send({
      academicYearId: 4,
      classIds: [2],
      categoryIds: [8],
      tuitionReductionsByTariffId: {
        41: { 10: { discountAmount: 10000, reason: '' } },
      },
    });

    expect(missingReason.status).toBe(400);
    expect(missingReason.body.error).toContain('justification');
    expect(mockState.inserted).toHaveLength(0);
  });

  it('rejects personalized tuition installments that cannot be positive and total the reduced amount', async () => {
    prepareObligationGeneration();

    const response = await request(app).post('/api/accounting/obligation-generation/preview').send({
      academicYearId: 4,
      classIds: [2],
      categoryIds: [8],
      tuitionReductionsByTariffId: {
        41: { 10: { discountAmount: 119999, reason: 'Réduction exceptionnelle' } },
      },
      tuitionInstallmentAmountsByTariffId: {
        41: { 10: [1, 0] },
      },
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('positive whole numbers');
    expect(mockState.inserted).toHaveLength(0);
  });

  it('uses the selected school context for a super admin batch preview', async () => {
    prepareObligationGeneration();
    mockState.actor = { ...mockState.actor, role: 'super_admin', schoolId: null };
    setSelectResults(schools, [{ id: 1 }]);

    const response = await request(app).post('/api/accounting/obligation-generation/preview').send({
      schoolId: 1,
      academicYearId: 4,
      classIds: [2],
      categoryIds: [8],
    });

    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body.newObligationCount).toBe(1);
    expect(mockState.whereConditions.some((item) => item.table === schools)).toBe(true);
    expect(mockState.inserted).toHaveLength(0);
  });

  it('excludes tuition when its required schedule is missing or invalid', async () => {
    prepareObligationGeneration();
    setSelectResults(accountingScheduleTemplates, [{
      schoolId: 1,
      academicYearId: 4,
      classId: 2,
      categoryId: 8,
      installments: [],
    }]);

    const response = await request(app).post('/api/accounting/obligation-generation/preview').send({
      academicYearId: 4,
      classIds: [2],
      categoryIds: [8],
    });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      newObligationCount: 0,
      estimatedTotal: 0,
      excludedCount: 1,
    });
    expect(response.body.rows[0]).toMatchObject({
      state: 'excluded',
      amount: 120000,
      reason: 'Échéancier de scolarité absent ou invalide',
      installments: [],
    });
    expect(response.body.configurationIssues).toContain('6e — Scolarité : Échéancier de scolarité absent ou invalide');
    expect(mockState.inserted).toHaveLength(0);
  });

  it('skips and reports an active tuition obligation even when it belongs to a previous class', async () => {
    prepareObligationGeneration(undefined, [{
      id: 75,
      studentId: 10,
      classId: 1,
      categoryId: 8,
      tariffId: 40,
      feeDefinitionId: null,
      sourceKey: 'tariff-40-student-10',
      status: 'active',
      amount: 90000,
    }]);

    const response = await request(app).post('/api/accounting/obligation-generation/preview').send({
      academicYearId: 4,
      classIds: [2],
      categoryIds: [8],
    });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      newObligationCount: 0,
      existingObligationCount: 1,
      estimatedTotal: 0,
    });
    expect(response.body.rows[0]).toMatchObject({
      state: 'existing',
      selected: false,
      amount: 90000,
    });
    expect(mockState.inserted).toHaveLength(0);
  });

  it('requires explicit student selection for non-tuition fees', async () => {
    prepareObligationGeneration(undefined, [], 'canteen');
    const defaultPreview = await request(app).post('/api/accounting/obligation-generation/preview').send({
      academicYearId: 4,
      classIds: [2],
      categoryIds: [8],
    });

    expect(defaultPreview.status).toBe(200);
    expect(defaultPreview.body).toMatchObject({
      newObligationCount: 0,
      selectionByTariffId: { 41: [] },
    });
    expect(defaultPreview.body.rows[0]).toMatchObject({ state: 'eligible', selected: false });

    prepareObligationGeneration(undefined, [], 'canteen');
    const selectedPreview = await request(app).post('/api/accounting/obligation-generation/preview').send({
      academicYearId: 4,
      classIds: [2],
      categoryIds: [8],
      selectedStudentIdsByTariffId: { 41: [10] },
    });

    expect(selectedPreview.status).toBe(200);
    expect(selectedPreview.body).toMatchObject({
      newObligationCount: 1,
      estimatedTotal: 120000,
    });
    expect(selectedPreview.body.rows[0]).toMatchObject({ state: 'eligible', selected: true });
    expect(mockState.inserted).toHaveLength(0);
  });

  it('creates a confirmed batch atomically with the normal obligation and installment records', async () => {
    prepareObligationGeneration();
    const preview = await request(app).post('/api/accounting/obligation-generation/preview').send({
      academicYearId: 4,
      classIds: [2],
      categoryIds: [8],
    });
    prepareObligationGeneration();

    const response = await request(app).post('/api/accounting/obligation-generation/confirm').send({
      academicYearId: 4,
      classIds: [2],
      categoryIds: [8],
      selectedStudentIdsByTariffId: preview.body.selectionByTariffId,
      previewToken: preview.body.previewToken,
    });

    expect(response.status, JSON.stringify(response.body)).toBe(201);
    expect(response.body).toMatchObject({ createdCount: 1, totalAmount: 120000 });
    expect(mockState.transactionCommitted).toBe(true);
    const transactionSql = mockState.executedSql.map((statement) => new PgDialect().sqlToQuery(statement).sql);
    expect(transactionSql).toContain('SET TRANSACTION ISOLATION LEVEL SERIALIZABLE');
    expect(transactionSql.some((statement) => statement.includes('FROM academic_years') && statement.includes('FOR UPDATE'))).toBe(true);
    expect(mockState.inserted.find((item) => item.table === financialObligations)?.values).toMatchObject({
      schoolId: 1,
      studentId: 10,
      academicYearId: 4,
      classId: 2,
      categoryId: 8,
      tariffId: 41,
      amount: 120000,
      sourceKey: 'tariff-41-student-10',
    });
    expect(mockState.inserted.find((item) => item.table === financialInstallments)?.values).toHaveLength(2);
  });

  it('confirms individualized tuition with reduced installments and a complete audit event', async () => {
    const tuitionReductionsByTariffId = {
      41: { 10: { discountAmount: 11000, reason: 'Bourse accordée' } },
    };
    const tuitionInstallmentAmountsByTariffId = {
      41: { 10: [30000, 20000, 10000] },
    };
    prepareObligationGeneration();
    setSelectResults(accountingTariffs, [{
      id: 41,
      schoolId: 1,
      academicYearId: 4,
      classId: 2,
      classFromId: null,
      classToId: null,
      categoryId: 8,
      label: 'Frais de scolarité',
      amount: 71000,
      isEnabled: true,
    }]);
    setSelectResults(accountingScheduleTemplates, [{
      schoolId: 1,
      academicYearId: 4,
      classId: 2,
      categoryId: 8,
      periodType: 'annual',
      installments: [
        { label: 'Première tranche', dueDate: '2026-10-01', amount: 36000 },
        { label: 'Deuxième tranche', dueDate: '2027-01-01', amount: 25000 },
        { label: 'Troisième tranche', dueDate: '2027-04-01', amount: 10000 },
      ],
    }]);
    const preview = await request(app).post('/api/accounting/obligation-generation/preview').send({
      academicYearId: 4,
      classIds: [2],
      categoryIds: [8],
      tuitionReductionsByTariffId,
      tuitionInstallmentAmountsByTariffId,
    });
    expect(preview.status, JSON.stringify(preview.body)).toBe(200);
    expect(preview.body.rows[0].installments.map((installment: any) => ({
      label: installment.label,
      dueDate: installment.dueDate,
      amount: installment.amount,
    }))).toEqual([
      { label: 'Première tranche', dueDate: '2026-10-01', amount: 30000 },
      { label: 'Deuxième tranche', dueDate: '2027-01-01', amount: 20000 },
      { label: 'Troisième tranche', dueDate: '2027-04-01', amount: 10000 },
    ]);
    prepareObligationGeneration();
    setSelectResults(accountingTariffs, [{
      id: 41,
      schoolId: 1,
      academicYearId: 4,
      classId: 2,
      classFromId: null,
      classToId: null,
      categoryId: 8,
      label: 'Frais de scolarité',
      amount: 71000,
      isEnabled: true,
    }]);
    setSelectResults(accountingScheduleTemplates, [{
      schoolId: 1,
      academicYearId: 4,
      classId: 2,
      categoryId: 8,
      periodType: 'annual',
      installments: [
        { label: 'Première tranche', dueDate: '2026-10-01', amount: 36000 },
        { label: 'Deuxième tranche', dueDate: '2027-01-01', amount: 25000 },
        { label: 'Troisième tranche', dueDate: '2027-04-01', amount: 10000 },
      ],
    }]);

    const response = await request(app).post('/api/accounting/obligation-generation/confirm').send({
      academicYearId: 4,
      classIds: [2],
      categoryIds: [8],
      selectedStudentIdsByTariffId: preview.body.selectionByTariffId,
      tuitionReductionsByTariffId: preview.body.tuitionReductionsByTariffId,
      tuitionInstallmentAmountsByTariffId: preview.body.tuitionInstallmentAmountsByTariffId,
      previewToken: preview.body.previewToken,
    });

    expect(response.status, JSON.stringify(response.body)).toBe(201);
    expect(response.body).toMatchObject({ createdCount: 1, totalAmount: 60000 });
    expect(mockState.inserted.find((item) => item.table === financialObligations)?.values)
      .toMatchObject({ amount: 60000, sourceKey: 'tariff-41-student-10' });
    expect(mockState.inserted.find((item) => item.table === financialInstallments)?.values)
      .toEqual([
        expect.objectContaining({ amount: 30000, dueDate: '2026-10-01' }),
        expect.objectContaining({ amount: 20000, dueDate: '2027-01-01' }),
        expect.objectContaining({ amount: 10000, dueDate: '2027-04-01' }),
      ]);
    const audit = mockState.inserted.find((item) => item.table === auditEvents)?.values;
    expect(audit.description).toContain('referenceAmount=71000');
    expect(audit.description).toContain('discountAmount=11000');
    expect(audit.description).toContain('amount=60000');
    expect(audit.description).toContain('Bourse accordée');
    expect(audit.description).toContain('"amount":30000');
  });

  it('refuses batch confirmation when the obligation source key was created after preview', async () => {
    prepareObligationGeneration();
    const preview = await request(app).post('/api/accounting/obligation-generation/preview').send({
      academicYearId: 4,
      classIds: [2],
      categoryIds: [8],
    });
    prepareObligationGeneration();
    setInsertResults(financialObligations, []);

    const response = await request(app).post('/api/accounting/obligation-generation/confirm').send({
      academicYearId: 4,
      classIds: [2],
      categoryIds: [8],
      selectedStudentIdsByTariffId: preview.body.selectionByTariffId,
      previewToken: preview.body.previewToken,
    });

    expect(response.status).toBe(409);
    expect(response.body.error).toContain('obligation changed during generation');
    expect(mockState.inserted.some((item) => item.table === financialInstallments)).toBe(false);
    expect(mockState.inserted.some((item) => item.table === auditEvents)).toBe(false);
  });

  it('rejects confirmation when the reduction or its reason differs from the preview', async () => {
    prepareObligationGeneration();
    const preview = await request(app).post('/api/accounting/obligation-generation/preview').send({
      academicYearId: 4,
      classIds: [2],
      categoryIds: [8],
      tuitionReductionsByTariffId: {
        41: { 10: { discountAmount: 30000, reason: 'Bourse accordée' } },
      },
      tuitionInstallmentAmountsByTariffId: {
        41: { 10: [45000, 45000] },
      },
    });
    prepareObligationGeneration();

    const response = await request(app).post('/api/accounting/obligation-generation/confirm').send({
      academicYearId: 4,
      classIds: [2],
      categoryIds: [8],
      selectedStudentIdsByTariffId: preview.body.selectionByTariffId,
      tuitionReductionsByTariffId: {
        41: { 10: { discountAmount: 35000, reason: 'Bourse accordée' } },
      },
      tuitionInstallmentAmountsByTariffId: {
        41: { 10: [42500, 42500] },
      },
      previewToken: preview.body.previewToken,
    });

    expect(response.status).toBe(409);
    expect(response.body.code).toBe('ACCOUNTING_GENERATION_PREVIEW_STALE');
    expect(mockState.inserted).toHaveLength(0);
  });

  it('rejects confirmation when only the tuition reduction reason differs from the preview', async () => {
    prepareObligationGeneration();
    const preview = await request(app).post('/api/accounting/obligation-generation/preview').send({
      academicYearId: 4,
      classIds: [2],
      categoryIds: [8],
      tuitionReductionsByTariffId: {
        41: { 10: { discountAmount: 30000, reason: 'Bourse accordée' } },
      },
      tuitionInstallmentAmountsByTariffId: {
        41: { 10: [45000, 45000] },
      },
    });
    prepareObligationGeneration();

    const response = await request(app).post('/api/accounting/obligation-generation/confirm').send({
      academicYearId: 4,
      classIds: [2],
      categoryIds: [8],
      selectedStudentIdsByTariffId: preview.body.selectionByTariffId,
      tuitionReductionsByTariffId: {
        41: { 10: { discountAmount: 30000, reason: 'Aide exceptionnelle' } },
      },
      tuitionInstallmentAmountsByTariffId: {
        41: { 10: [45000, 45000] },
      },
      previewToken: preview.body.previewToken,
    });

    expect(response.status).toBe(409);
    expect(response.body.code).toBe('ACCOUNTING_GENERATION_PREVIEW_STALE');
    expect(mockState.inserted).toHaveLength(0);
  });

  it('rejects confirmation when individualized installment amounts differ from the preview', async () => {
    prepareObligationGeneration();
    const preview = await request(app).post('/api/accounting/obligation-generation/preview').send({
      academicYearId: 4,
      classIds: [2],
      categoryIds: [8],
      tuitionReductionsByTariffId: {
        41: { 10: { discountAmount: 30000, reason: 'Bourse accordée' } },
      },
      tuitionInstallmentAmountsByTariffId: {
        41: { 10: [45000, 45000] },
      },
    });
    prepareObligationGeneration();

    const response = await request(app).post('/api/accounting/obligation-generation/confirm').send({
      academicYearId: 4,
      classIds: [2],
      categoryIds: [8],
      selectedStudentIdsByTariffId: preview.body.selectionByTariffId,
      tuitionReductionsByTariffId: preview.body.tuitionReductionsByTariffId,
      tuitionInstallmentAmountsByTariffId: {
        41: { 10: [40000, 50000] },
      },
      previewToken: preview.body.previewToken,
    });

    expect(response.status).toBe(409);
    expect(response.body.code).toBe('ACCOUNTING_GENERATION_PREVIEW_STALE');
    expect(mockState.inserted).toHaveLength(0);
  });

  it('rejects individual reductions for custom fees while preserving explicit custom-fee selection', async () => {
    prepareObligationGeneration(undefined, [], 'canteen');
    const reductionResponse = await request(app).post('/api/accounting/obligation-generation/preview').send({
      academicYearId: 4,
      classIds: [2],
      categoryIds: [8],
      selectedStudentIdsByTariffId: { 41: [10] },
      tuitionReductionsByTariffId: {
        41: { 10: { discountAmount: 10000, reason: 'Aide' } },
      },
    });

    expect(reductionResponse.status).toBe(400);
    expect(reductionResponse.body.error).toContain('not valid for an eligible student and tariff');
    expect(mockState.inserted).toHaveLength(0);

    prepareObligationGeneration(undefined, [], 'canteen');
    const normalResponse = await request(app).post('/api/accounting/obligation-generation/preview').send({
      academicYearId: 4,
      classIds: [2],
      categoryIds: [8],
      selectedStudentIdsByTariffId: { 41: [10] },
    });

    expect(normalResponse.status).toBe(200);
    expect(normalResponse.body).toMatchObject({
      newObligationCount: 1,
      estimatedTotal: 120000,
      rows: [{ categoryCode: 'canteen', selected: true, amount: 120000 }],
    });
    expect(normalResponse.body.tuitionReductionsByTariffId).toEqual({});
    expect(mockState.inserted).toHaveLength(0);
  });

  it('rejects a stale generation preview without creating a partial batch', async () => {
    prepareObligationGeneration();
    const preview = await request(app).post('/api/accounting/obligation-generation/preview').send({
      academicYearId: 4,
      classIds: [2],
      categoryIds: [8],
    });
    prepareObligationGeneration([]);

    const response = await request(app).post('/api/accounting/obligation-generation/confirm').send({
      academicYearId: 4,
      classIds: [2],
      categoryIds: [8],
      selectedStudentIdsByTariffId: preview.body.selectionByTariffId,
      previewToken: preview.body.previewToken,
    });

    expect(response.status).toBe(409);
    expect(response.body.code).toBe('ACCOUNTING_GENERATION_PREVIEW_STALE');
    expect(mockState.inserted).toHaveLength(0);
  });

  it('excludes enrollment fees from batch generation', async () => {
    mockState.actor = { ...mockState.actor, role: 'school_admin', schoolId: 1 };
    setSelectResults(academicYears, [{ id: 4, schoolId: 1, name: '2026-2027' }]);
    setSelectResults(accountingCategories, [{
      id: 9,
      schoolId: 1,
      code: 'enrollment',
      label: 'Inscription',
      isEnabled: true,
    }]);

    const response = await request(app).post('/api/accounting/obligation-generation/preview').send({
      academicYearId: 4,
      classIds: [2],
      categoryIds: [9],
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('Enrollment fees are excluded');
    expect(mockDb.transaction).not.toHaveBeenCalled();
    expect(mockState.inserted).toHaveLength(0);
  });

  it('keeps tariff version endpoints unavailable without touching tariff-version persistence', async () => {
    mockState.actor = { ...mockState.actor, role: 'school_admin', schoolId: 12 };

    const history = await request(app).get('/api/accounting/tariffs/8/versions?schoolId=99');
    const create = await request(app).post('/api/accounting/tariffs/8/versions').send({
      schoolId: 99,
      mode: 'immediate',
    });
    const replace = await request(app).post('/api/accounting/tariffs/8/versions/10/replace').send({
      schoolId: 99,
      reason: 'Correction',
    });
    const cancel = await request(app).post('/api/accounting/tariffs/8/versions/10/cancel').send({
      schoolId: 99,
      reason: 'Annulation',
    });

    for (const response of [history, create, replace, cancel]) {
      expect(response.status).toBe(503);
      expect(response.body).toMatchObject({ code: 'ACCOUNTING_TARIFF_VERSIONING_UNAVAILABLE' });
    }
    expect(mockDb.select).not.toHaveBeenCalled();
    expect(mockDb.transaction).not.toHaveBeenCalled();
    expect(mockState.inserted).toHaveLength(0);
    expect(mockState.updated).toHaveLength(0);
    expect(mockState.deleted).toHaveLength(0);
  });

  it('keeps tariff version endpoints unavailable to a super admin until explicit activation', async () => {
    setSelectResults(schools, [{ id: 3 }]);

    const response = await request(app).get('/api/accounting/tariffs/8/versions?schoolId=3');

    expect(response.status).toBe(503);
    expect(response.body).toMatchObject({ code: 'ACCOUNTING_TARIFF_VERSIONING_UNAVAILABLE' });
    expect(mockState.whereConditions.map((item) => item.table)).toEqual([schools]);
    expect(mockDb.transaction).not.toHaveBeenCalled();
    expect(mockState.inserted).toHaveLength(0);
  });

  it('ignores a foreign schoolId supplied by a school admin', async () => {
    mockState.actor = { ...mockState.actor, role: 'school_admin', schoolId: 12 };
    setSelectResults(accountingCategories, [{ id: 4, schoolId: 12, code: 'tuition' }]);
    const response = await request(app).get('/api/accounting/categories?schoolId=99');
    expect(response.status).toBe(200);

    const where = mockState.whereConditions.find((item) => item.table === accountingCategories)?.condition;
    const query = new PgDialect().sqlToQuery(where);
    expect(query.params).toContain(12);
    expect(query.params).not.toContain(99);
  });

  it('rejects a custom label that duplicates a standard fee category', async () => {
    setSelectResults(schools, [{ id: 1 }]);
    setSelectResults(classes, [{ id: 2, schoolId: 1, academicYearId: 4, name: '6e' }]);
    setSelectResults(academicYears, [{ id: 4, schoolId: 1, name: '2026-2027' }]);
    setSelectResults(accountingCategories, [{
      id: 5,
      schoolId: 1,
      code: 'enrollment',
      label: 'Frais d’inscription',
      isEnabled: true,
    }]);

    const response = await request(app).post('/api/accounting/tariffs').send({
      schoolId: 1,
      academicYearId: 4,
      classId: 2,
      label: "Frais d'inscription",
      amount: 25000,
    });

    expect(response.status).toBe(409);
    expect(mockState.inserted).toHaveLength(0);
  });

  it('creates a standard tariff by category id and stores its canonical label', async () => {
    setSelectResults(schools, [{ id: 1 }]);
    setSelectResults(classes, [{ id: 2, schoolId: 1, academicYearId: 4, name: '6e' }]);
    setSelectResults(academicYears, [{ id: 4, schoolId: 1, name: '2026-2027' }]);
    setSelectResults(accountingCategories, [{
      id: 5,
      schoolId: 1,
      code: 'tuition',
      label: 'Scolarité',
      isEnabled: true,
    }]);
    setInsertResults(accountingTariffs, [{
      id: 81,
      schoolId: 1,
      academicYearId: 4,
      classId: 2,
      categoryId: 5,
      label: 'Frais de scolarité',
      amount: 25000,
    }]);

    const response = await request(app).post('/api/accounting/tariffs').send({
      schoolId: 1,
      academicYearId: 4,
      classId: 2,
      categoryId: 5,
      amount: 25000,
    });

    expect(response.status, JSON.stringify(response.body)).toBe(201);
    expect(mockState.inserted.some((item) => item.table === accountingCategories)).toBe(false);
    expect(mockState.inserted.find((item) => item.table === accountingTariffs)?.values).toMatchObject({
      schoolId: 1,
      academicYearId: 4,
      classId: 2,
      categoryId: 5,
      label: 'Frais de scolarité',
      amount: 25000,
    });
  });

  it('stores a pedagogical class range as one tariff configuration', async () => {
    mockState.actor = { ...mockState.actor, role: 'school_admin', schoolId: 1 };
    setSelectResults(classes,
      [{ id: 6, schoolId: 1, academicYearId: 4, name: '6e A' }],
      [{ id: 3, schoolId: 1, academicYearId: 4, name: '6e C' }],
      [
        { classId: 6, className: '6e A', levelOrder: 2 },
        { classId: 3, className: '6e C', levelOrder: 2 },
      ]);
    setSelectResults(academicYears,
      [{ id: 4, schoolId: 1 }],
      [{ id: 4, schoolId: 1 }]);
    setSelectResults(accountingCategories, []);
    setSelectResults(accountingTariffs, []);
    setInsertResults(accountingCategories, [{
      id: 18,
      schoolId: 1,
      code: 'custom:scolarité',
      label: 'Scolarité',
      isEnabled: true,
    }]);

    const response = await request(app).post('/api/accounting/tariffs').send({
      schoolId: 99,
      academicYearId: 4,
      classFromId: 6,
      classToId: 3,
      label: 'Scolarité',
      amount: 120000,
    });

    expect(response.status, JSON.stringify(response.body)).toBe(201);
    const tariffInsertions = mockState.inserted.filter((item) => item.table === accountingTariffs);
    expect(tariffInsertions).toHaveLength(1);
    expect(tariffInsertions[0].values).toMatchObject({
      schoolId: 1,
      academicYearId: 4,
      classId: null,
      classFromId: 6,
      classToId: 3,
      categoryId: 18,
      label: 'Scolarité',
      amount: 120000,
    });
  });

  it('stores a standard fee range against its existing category id', async () => {
    mockState.actor = { ...mockState.actor, role: 'school_admin', schoolId: 1 };
    setSelectResults(classes,
      [{ id: 21, schoolId: 1, academicYearId: 4, name: '6e A' }],
      [{ id: 22, schoolId: 1, academicYearId: 4, name: '6e B' }],
      [
        { classId: 21, className: '6e A', levelOrder: 2 },
        { classId: 22, className: '6e B', levelOrder: 2 },
      ]);
    setSelectResults(academicYears, [{ id: 4, schoolId: 1 }], [{ id: 4, schoolId: 1 }]);
    setSelectResults(accountingCategories, [{
      id: 8, schoolId: 1, code: 'tuition', label: 'Scolarité', isEnabled: true,
    }]);
    setSelectResults(accountingTariffs, []);
    setInsertResults(accountingTariffs, [{
      id: 81, schoolId: 1, academicYearId: 4, classFromId: 21, classToId: 22,
      categoryId: 8, label: 'Frais de scolarité', amount: 150000,
    }]);

    const response = await request(app).post('/api/accounting/tariffs').send({
      schoolId: 1,
      academicYearId: 4,
      classFromId: 21,
      classToId: 22,
      categoryId: 8,
      amount: 150000,
    });

    expect(response.status, JSON.stringify(response.body)).toBe(201);
    expect(mockState.inserted.some((item) => item.table === accountingCategories)).toBe(false);
    expect(mockState.inserted.find((item) => item.table === accountingTariffs)?.values).toMatchObject({
      classId: null,
      classFromId: 21,
      classToId: 22,
      categoryId: 8,
      label: 'Frais de scolarité',
      amount: 150000,
    });
  });

  it('requires an enrollment kind before creating an enrollment obligation', async () => {
    prepareValidPayment();
    const enrollmentTariff = {
      id: 88,
      schoolId: 1,
      academicYearId: 4,
      classId: 2,
      categoryId: 5,
      label: 'Frais d’inscription',
      amount: 25000,
      isEnabled: true,
    };
    setSelectResults(financialPayments, []);
    setSelectResults(accountingTariffs, [enrollmentTariff], [enrollmentTariff]);
    setSelectResults(accountingCategories, [{
      id: 5,
      schoolId: 1,
      code: 'enrollment',
      label: 'Frais d’inscription',
      isEnabled: true,
    }]);
    setSelectResults(financialObligations, []);
    const response = await request(app).post('/api/accounting/payments').send({
      ...validPaymentBody(),
      allocations: [{ tariffId: enrollmentTariff.id, amount: 12000 }],
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('Sélectionnez un type d’inscription');
    expect(mockState.inserted.some((item) => item.table === financialObligations)).toBe(false);
    expect(mockState.inserted.some((item) => item.table === financialPayments)).toBe(false);
  });

  it('rejects an unsupported enrollment kind before opening a payment transaction', async () => {
    prepareValidPayment();

    const response = await request(app).post('/api/accounting/payments').send({
      ...validPaymentBody(),
      allocations: [{ tariffId: 88, amount: 12000 }],
      enrollmentKind: 'unknown',
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('type d’inscription sélectionné est invalide');
    expect(mockDb.transaction).not.toHaveBeenCalled();
    expect(mockState.inserted).toHaveLength(0);
  });

  it('includes the enrollment kind in payment idempotency matching', async () => {
    prepareValidPayment();
    setSelectResults(financialPayments, [{
      id: 70,
      schoolId: 1,
      studentId: 10,
      academicYearId: 4,
      amount: 12000,
      method: 'cash',
      reference: null,
      requestFingerprint: JSON.stringify([
        10, 4, 12000, 'cash', null, null, null, null, [[88, 12000]], 're_enrollment',
      ]),
      paidAt: new Date(),
    }]);

    const response = await request(app).post('/api/accounting/payments').send({
      ...validPaymentBody(),
      allocations: [{ tariffId: 88, amount: 12000 }],
      enrollmentKind: 'first_enrollment',
    });

    expect(response.status).toBe(409);
    expect(response.body.error).toContain('Idempotency key');
    expect(mockState.inserted.some((item) => item.table === financialPayments)).toBe(false);
  });

  it('refuses a school admin receipt request for another school', async () => {
    mockState.actor = { ...mockState.actor, role: 'school_admin', schoolId: 12 };
    setSelectResults(financialReceipts, [{ id: 5, schoolId: 99, receiptNumber: 'REC-2026-000001', snapshot: {} }]);
    const response = await request(app).get('/api/accounting/receipts/5');
    expect(response.status).toBe(403);
  });

  it('filters cash allocations using every selected tariff id', async () => {
    setSelectResults(schools, [{ id: 1 }]);
    setSelectResults(financialPaymentAllocations, []);
    setSelectResults(financialObligations, []);

    const response = await request(app)
      .get('/api/accounting/cash?schoolId=1&academicYearId=4&tariffId=5&tariffId=6');

    expect(response.status).toBe(200);
    const allocationWhere = mockState.whereConditions.find((item) => item.table === financialPaymentAllocations)?.condition;
    const whereQuery = new PgDialect().sqlToQuery(allocationWhere);
    expect(whereQuery.params).toContain(5);
    expect(whereQuery.params).toContain(6);
    const obligationWhere = mockState.whereConditions.find((item) => item.table === financialObligations)?.condition;
    expect(new PgDialect().sqlToQuery(obligationWhere).params).toContain(5);
    expect(new PgDialect().sqlToQuery(obligationWhere).params).toContain(6);
  });

  it('returns receipt references with posted cash allocations', async () => {
    setSelectResults(schools, [{ id: 1 }]);
    setSelectResults(financialPaymentAllocations, [{
      allocationId: 31,
      amount: 12000,
      categoryCode: 'tuition',
      categoryLabel: 'Scolarité',
      method: 'cash',
      paymentId: 45,
      paidAt: new Date('2026-10-07T12:00:00.000Z'),
      receiptId: 55,
      receiptNumber: 'REC-2026-000055',
      classId: 2,
      studentId: 10,
      studentName: 'Doe Afi',
      tariffId: 41,
    }]);

    const response = await request(app).get('/api/accounting/cash?schoolId=1');

    expect(response.status).toBe(200);
    expect(response.body.allocations[0]).toMatchObject({
      paymentId: 45,
      receiptId: 55,
      receiptNumber: 'REC-2026-000055',
    });
  });

  it('renders a receipt PDF from its stored snapshot', async () => {
    setSelectResults(financialReceipts, [{
      id: 5,
      paymentId: 15,
      schoolId: 1,
      receiptNumber: 'REC-2026-000005',
      snapshot: {
        school: { name: 'École test' },
        payment: { paidAt: '2026-10-07T12:00:00.000Z', amount: 1000, method: 'cash' },
        student: { firstName: 'Afi', lastName: 'Doe', matricule: 'A10', className: '6e' },
        academicYearName: '2026-2027',
        allocations: [{ category: 'Scolarité', label: 'Trimestre 1', amount: 1000 }],
        paidBeforePayment: 0,
        totalDue: 3000,
        remainingAfterPayment: 2000,
        recordedBy: 'Admin',
      },
    }]);
    setSelectResults(schools, [{ id: 1 }]);
    setSelectResults(financialPayments, [{ status: 'posted' }]);

    const response = await request(app).get('/api/accounting/receipts/5');
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('application/pdf');
    expect(Buffer.from(response.body).subarray(0, 4).toString()).toBe('%PDF');
  });

  it('refuses to render a receipt for a cancelled payment', async () => {
    setSelectResults(financialReceipts, [{
      id: 5,
      paymentId: 15,
      schoolId: 1,
      receiptNumber: 'REC-2026-000005',
      snapshot: {},
    }]);
    setSelectResults(schools, [{ id: 1 }]);
    setSelectResults(financialPayments, [{ status: 'cancelled' }]);

    const response = await request(app).get('/api/accounting/receipts/5');

    expect(response.status).toBe(409);
    expect(response.body.error).toContain('paiement annulé');
  });

  it.each([
    { fee: 'Frais de scolarité', category: 'Scolarité' },
    { fee: 'Cantine', category: 'Cantine' },
    { fee: 'Uniforme', category: 'Uniforme' },
    { fee: 'Transport personnalisé', category: 'Autres frais' },
    { fee: 'Inscription 2', category: 'Inscription 2' },
  ])('prints the $fee fee name once with its due date', ({ fee, category }) => {
    const receiptLine = formatAccountingReceiptAllocationLine({
      category,
      label: fee,
      tariffLabel: fee,
      installmentLabel: fee,
      dueDate: '2026-10-07',
      amount: 12000,
    });

    expect(receiptLine).toBe(`${fee} (échéance 2026-10-07) : 12 000 FCFA`);
    expect(receiptLine.match(new RegExp(fee, 'g'))).toHaveLength(1);
  });

  it('uses one fee name when category, tariff and obligation labels differ', () => {
    const receiptLine = formatAccountingReceiptAllocationLine({
      category: 'Scolarité',
      label: 'Frais de scolarité',
      tariffLabel: 'Frais de scolarité',
      installmentLabel: 'Frais de scolarité',
      dueDate: '2026-10-07',
      amount: 10000,
    });

    expect(receiptLine).toBe('Frais de scolarité (échéance 2026-10-07) : 10 000 FCFA');
    expect(receiptLine).not.toContain('Scolarité —');
  });

  it('omits installment names when there is no due date', () => {
    expect(formatAccountingReceiptAllocationLine({
      category: 'Transport',
      label: 'Transport',
      tariffLabel: 'Transport',
      installmentLabel: 'Transport',
      amount: 12000,
    })).toBe('Transport : 12 000 FCFA');
  });

  it('uses tariff labels for obligation and cash category display projections', async () => {
    mockState.actor = { ...mockState.actor, role: 'school_admin', schoolId: 1 };
    setSelectResults(financialObligations, [{ id: 21, categoryLabel: 'Frais de scolarité' }], []);
    setSelectResults(financialPaymentAllocations, []);

    const obligationsResponse = await request(app).get('/api/accounting/obligations?academicYearId=4');
    expect(obligationsResponse.status).toBe(200);
    const obligationLabelProjection = mockState.selectProjections
      .find((projection) => projection?.categoryLabel != null)?.categoryLabel;
    expect(new PgDialect().sqlToQuery(obligationLabelProjection).sql)
      .toContain('COALESCE("accounting_tariffs"."label", "accounting_categories"."label")');

    const cashResponse = await request(app).get('/api/accounting/cash?academicYearId=4');
    expect(cashResponse.status).toBe(200);
    const cashLabelProjection = mockState.selectProjections
      .filter((projection) => projection?.categoryLabel != null)
      .at(-1)?.categoryLabel;
    expect(new PgDialect().sqlToQuery(cashLabelProjection).sql)
      .toContain('COALESCE("accounting_tariffs"."label", "accounting_categories"."label")');
  });

  it('accepts the school admin assigned global year and returns approved global-class balances', async () => {
    mockState.actor = { ...mockState.actor, role: 'school_admin', schoolId: 2, academicYearId: 2 };
    mockState.approvedClasses.add('2:53');
    setSelectResults(academicYears, [{ id: 2, schoolId: null }], [{ id: 2, schoolId: null }]);
    setSelectResults(classes, [{ id: 53, schoolId: null, academicYearId: 2, name: '5ème' }]);
    const overviewRow = {
      studentId: 10,
      firstName: 'Afi',
      lastName: 'Doe',
      className: '6e',
      categoryId: 2,
      categoryCode: 'tuition',
      tariffId: 5,
      categoryLabel: 'Scolarité',
      indicativeTariffAmount: 150000,
      due: 0,
      paid: 0,
      remaining: 0,
      status: 'unconfigured',
    };
    mockDb.execute.mockImplementationOnce((statement: any) => {
      mockState.executedSql.push(statement);
      return Promise.resolve({ rows: [overviewRow] });
    });

    const response = await request(app)
      .get('/api/accounting/situation?schoolId=99&academicYearId=2&classId=53&categoryId=2&tariffId=5&tariffId=6');

    expect(response.status, response.body.error).toBe(200);
    expect(response.body.rows).toEqual([overviewRow]);
    const yearCondition = mockState.whereConditions.find((item) => item.table === academicYears)?.condition;
    const yearQuery = new PgDialect().sqlToQuery(yearCondition);
    expect(yearQuery.params).toContain(2);
    const query = new PgDialect().sqlToQuery(mockState.executedSql[0]);
    expect(query.sql).toContain('student_obligations.obligation_amount');
    expect(query.sql).toContain('array_agg(DISTINCT obligation.class_name_snapshot)');
    expect(query.sql).toContain('indicativeTariffAmount');
    expect(query.sql).toContain('current_tariff_obligation.class_id = student.class_id');
    expect(query.sql).toContain("OR category.code = 'tuition'");
    expect(query.sql).toContain('current_tariff_obligation.fee_definition_id IS NULL');
    expect(query.sql).not.toContain('ELSE tariff.amount');
    expect(query.sql).toContain('COALESCE(tariff.label, category.label)');
    expect(query.sql).toContain('configured_tariff.class_id = student.class_id');
    expect(query.sql).toContain('range_start_class.name COLLATE "C"');
    expect(query.sql).toContain('student_level.order_index, class.name COLLATE "C", class.id');
    expect(query.sql).toContain('tariff.academic_year_id');
    expect(query.sql).toContain('tariff.id IN');
    expect(query.params).toContain(5);
    expect(query.params).toContain(6);
    expect(query.sql).not.toContain('category.is_enabled = true');
    expect(query.sql).toContain('financial_payment_allocations');
    expect(query.sql).toContain('school_classes');
    expect(query.sql).toContain("school_class.status = 'approved'");
    expect(query.sql).toContain("THEN 'unconfigured'");
    expect(query.params).toContain(2);
    expect(query.params).not.toContain(99);
  });

  it('keeps the enabled-category filter for unscoped student situations', async () => {
    mockState.actor = { ...mockState.actor, role: 'school_admin', schoolId: 2, academicYearId: 2 };
    setSelectResults(academicYears, [{ id: 2, schoolId: null }]);
    mockDb.execute.mockImplementationOnce((statement: any) => {
      mockState.executedSql.push(statement);
      return Promise.resolve({ rows: [] });
    });

    const response = await request(app).get('/api/accounting/situation?schoolId=99&academicYearId=2');

    expect(response.status, response.body.error).toBe(200);
    const query = new PgDialect().sqlToQuery(mockState.executedSql[0]);
    expect(query.sql).toContain('category.is_enabled = true');
    expect(query.sql).not.toContain('tariff.id IN');
    expect(query.sql).toContain('student.is_active = true');
    expect(query.params).not.toContain(99);
  });

  it('includes former students in a payment-status situation only when explicitly requested', async () => {
    mockState.actor = { ...mockState.actor, role: 'school_admin', schoolId: 2, academicYearId: 2 };
    setSelectResults(academicYears, [{ id: 2, schoolId: null }]);
    mockDb.execute.mockImplementationOnce((statement: any) => {
      mockState.executedSql.push(statement);
      return Promise.resolve({ rows: [] });
    });

    const response = await request(app)
      .get('/api/accounting/situation?schoolId=99&academicYearId=2&includeInactive=true');

    expect(response.status, response.body.error).toBe(200);
    const query = new PgDialect().sqlToQuery(mockState.executedSql[0]);
    expect(query.sql).not.toContain('student.is_active = true');
    expect(query.sql).toContain('student.school_id =');
  });

  it('filters by the global student balance and preserves net paid amounts above an obligation', async () => {
    mockState.actor = { ...mockState.actor, role: 'school_admin', schoolId: 2, academicYearId: 2 };
    setSelectResults(academicYears, [{ id: 2, schoolId: null }], [{ id: 2, schoolId: null }]);
    setSelectResults(classes, [{ id: 53, schoolId: 2, academicYearId: 2, name: '5ème' }]);
    mockDb.execute.mockImplementationOnce((statement: any) => {
      mockState.executedSql.push(statement);
      return Promise.resolve({ rows: [
        {
          studentId: 10, firstName: 'Afi', lastName: 'Doe', classId: 53,
          categoryId: 1, due: 150, paid: 150, remaining: 0, status: 'paid',
        },
        {
          studentId: 10, firstName: 'Afi', lastName: 'Doe', classId: 53,
          categoryId: 2, due: 50, paid: 0, remaining: 50, status: 'unpaid',
        },
        {
          studentId: 11, firstName: 'Ama', lastName: 'Doe', classId: 53,
          categoryId: 1, due: 0, paid: 0, remaining: 0, status: 'unconfigured',
        },
        {
          studentId: 12, firstName: 'Kossi', lastName: 'Doe', classId: 53,
          categoryId: 1, due: 50, paid: 80, remaining: 0, status: 'paid',
        },
        {
          studentId: 12, firstName: 'Kossi', lastName: 'Doe', classId: 53,
          categoryId: 2, due: 100, paid: 0, remaining: 100, status: 'unpaid',
        },
      ] });
    });

    const response = await request(app)
      .get('/api/accounting/situation?academicYearId=2&classId=53&status=partial&includeInactive=true');

    expect(response.status, response.body.error).toBe(200);
    expect(response.body.rows).toHaveLength(4);
    expect(response.body.rows.map((row: any) => row.studentId)).toEqual([10, 10, 12, 12]);
    expect(response.body.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ studentId: 10, studentDue: 200, studentPaid: 150, studentRemaining: 50, studentStatus: 'partial' }),
      expect.objectContaining({
        studentId: 12,
        studentDue: 150,
        studentPaid: 80,
        studentRemaining: 70,
        studentStatus: 'partial',
      }),
    ]));
    const query = new PgDialect().sqlToQuery(mockState.executedSql[0]);
    expect(query.sql).toContain('class.id =');
    expect(query.sql).toContain('school_class.status = \'approved\'');
    expect(query.sql).not.toContain('category.is_enabled = true');
    expect(query.params).toContain(53);
  });

  it('returns one class situation row per student with globally aggregated balances', async () => {
    mockState.actor = { ...mockState.actor, role: 'school_admin', schoolId: 2, academicYearId: 2 };
    mockState.approvedClasses.add('2:53');
    setSelectResults(academicYears, [{ id: 2, schoolId: null }], [{ id: 2, schoolId: null }]);
    setSelectResults(classes, [{ id: 53, schoolId: null, academicYearId: 2, name: '5ème' }]);
    mockDb.execute.mockImplementationOnce((statement: any) => {
      mockState.executedSql.push(statement);
      return Promise.resolve({ rows: [
        { studentId: 10, firstName: 'Afi', lastName: 'Doe', classId: 53, className: '5ème', categoryId: 1, due: 100, paid: 100 },
        { studentId: 10, firstName: 'Afi', lastName: 'Doe', classId: 53, className: '5ème', categoryId: 2, due: 100, paid: 20 },
        { studentId: 11, firstName: 'Ama', lastName: 'Doe', classId: 53, className: '5ème', categoryId: 1, due: 0, paid: 0 },
      ] });
    });

    const response = await request(app)
      .get('/api/accounting/situation?academicYearId=2&classId=53&aggregate=student&includeInactive=true');

    expect(response.status, response.body.error).toBe(200);
    expect(response.body.rows).toHaveLength(2);
    expect(response.body.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({
        studentId: 10,
        studentDue: 200,
        studentPaid: 120,
        studentRemaining: 80,
        studentStatus: 'partial',
      }),
      expect.objectContaining({
        studentId: 11,
        studentDue: 0,
        studentPaid: 0,
        studentRemaining: 0,
        studentStatus: 'unconfigured',
        overdueInstallmentCount: 0,
        overdueInstallmentAmount: 0,
        nextInstallment: null,
      }),
    ]));
    const query = new PgDialect().sqlToQuery(mockState.executedSql[0]);
    expect(query.sql).toContain('school_class.status = \'approved\'');
    expect(query.params).toContain(53);
  });

  it('summarizes overdue balances once per installment after posted allocations and adjustments', async () => {
    mockState.actor = { ...mockState.actor, role: 'school_admin', schoolId: 2, academicYearId: 2 };
    mockState.approvedClasses.add('2:53');
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    setSelectResults(academicYears, [{ id: 2, schoolId: null }], [{ id: 2, schoolId: null }]);
    setSelectResults(classes, [{ id: 53, schoolId: null, academicYearId: 2, name: '5ème' }]);
    setSelectResults(financialObligations, [
      { id: 81, studentId: 10 },
      { id: 82, studentId: 10 },
      { id: 83, studentId: 11 },
    ]);
    setSelectResults(financialInstallments, [
      { id: 91, obligationId: 81, label: 'Tranche échue', dueDate: yesterday, amount: 5000 },
      { id: 92, obligationId: 82, label: 'Tranche suivante', dueDate: tomorrow, amount: 10000 },
      { id: 93, obligationId: 83, label: 'Tranche à venir', dueDate: tomorrow, amount: 8000 },
    ]);
    setSelectResults(financialPaymentAllocations, [
      { id: 101, obligationId: 81, installmentId: 91, amount: 3000, paymentStatus: 'posted', paidAtDate: yesterday },
      { id: 102, obligationId: 81, installmentId: 91, amount: 1000, paymentStatus: 'posted', paidAtDate: yesterday },
    ]);
    setSelectResults(financialAdjustmentAllocations, [
      { paymentAllocationId: 101, amount: 1000 },
    ]);
    mockDb.execute.mockImplementationOnce((statement: any) => {
      mockState.executedSql.push(statement);
      return Promise.resolve({ rows: [
        { studentId: 10, firstName: 'Afi', lastName: 'Doe', classId: 53, className: '5ème', categoryId: 1, due: 5000, paid: 3000 },
        { studentId: 11, firstName: 'Ama', lastName: 'Doe', classId: 53, className: '5ème', categoryId: 1, due: 8000, paid: 0 },
      ] });
    });

    const response = await request(app)
      .get('/api/accounting/situation?academicYearId=2&classId=53&aggregate=student&includeInactive=true');

    expect(response.status, response.body.error).toBe(200);
    expect(response.body.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({
        studentId: 10,
        overdueInstallmentCount: 1,
        overdueInstallmentAmount: 2000,
        punctualityStatus: 'overdue',
        nextInstallment: {
          label: 'Tranche suivante',
          dueDate: tomorrow,
          remaining: 10000,
        },
      }),
      expect.objectContaining({
        studentId: 11,
        overdueInstallmentCount: 0,
        overdueInstallmentAmount: 0,
        punctualityStatus: 'upcoming',
        nextInstallment: {
          label: 'Tranche à venir',
          dueDate: tomorrow,
          remaining: 8000,
        },
      }),
    ]));
  });

  it('returns installment details in one school- and year-scoped aggregate request', async () => {
    mockState.actor = { ...mockState.actor, role: 'school_admin', schoolId: 2, academicYearId: 2 };
    mockState.approvedClasses.add('2:53');
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    setSelectResults(academicYears, [{ id: 2, schoolId: null }], [{ id: 2, schoolId: null }]);
    setSelectResults(classes, [{ id: 53, schoolId: null, academicYearId: 2, name: '5ème' }]);
    setSelectResults(accountingCategories, [{ id: 1, label: 'Scolarité' }]);
    setSelectResults(financialObligations, [{
      id: 81,
      studentId: 10,
      className: '4ème',
      categoryId: 1,
    }]);
    setSelectResults(financialInstallments, [{
      id: 91,
      obligationId: 81,
      label: 'Tranche 1',
      dueDate: yesterday,
      amount: 100,
    }]);
    setSelectResults(financialPaymentAllocations, [{
      id: 101,
      obligationId: 81,
      installmentId: 91,
      amount: 40,
      paymentStatus: 'posted',
      paidAtDate: yesterday,
    }]);
    setSelectResults(financialAdjustmentAllocations, []);
    mockDb.execute.mockImplementationOnce((statement: any) => {
      mockState.executedSql.push(statement);
      return Promise.resolve({ rows: [
        { studentId: 10, firstName: 'Afi', lastName: 'Doe', classId: 53, className: '5ème', categoryId: 1, due: 100, paid: 40 },
      ] });
    });

    const response = await request(app)
      .get('/api/accounting/situation?academicYearId=2&classId=53&aggregate=student&includeInactive=true&includeInstallmentDetails=true');

    expect(response.status, response.body.error).toBe(200);
    expect(response.body.rows[0].installmentDetails).toEqual([expect.objectContaining({
      studentId: 10,
      obligationId: 81,
      className: '4ème',
      categoryLabel: 'Scolarité',
      label: 'Tranche 1',
      dueDate: yesterday,
      amount: 100,
      paid: 40,
      remaining: 60,
      currentStatus: 'overdue',
      punctualityStatus: 'overdue',
      settledAt: null,
    })]);
    expect(mockState.whereConditions.filter((item) => item.table === financialObligations)).toHaveLength(1);
    expect(mockState.whereConditions.filter((item) => item.table === accountingCategories)).toHaveLength(1);
    expect(mockState.whereConditions.filter((item) => item.table === financialInstallments)).toHaveLength(1);
    expect(mockState.whereConditions.filter((item) => item.table === financialPaymentAllocations)).toHaveLength(1);
  });

  it('returns timely settlement from the stored payment day without timezone conversion', async () => {
    mockState.actor = { ...mockState.actor, role: 'school_admin', schoolId: 2, academicYearId: 2 };
    mockState.approvedClasses.add('2:53');
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    setSelectResults(academicYears, [{ id: 2, schoolId: null }], [{ id: 2, schoolId: null }]);
    setSelectResults(classes, [{ id: 53, schoolId: null, academicYearId: 2, name: '5ème' }]);
    setSelectResults(financialObligations, [{ id: 81, studentId: 10 }]);
    setSelectResults(financialInstallments, [
      { id: 91, obligationId: 81, label: 'Tranche soldée', dueDate: yesterday, amount: 5000 },
    ]);
    setSelectResults(financialPaymentAllocations, [{
      id: 101,
      obligationId: 81,
      installmentId: 91,
      amount: 5000,
      paymentStatus: 'posted',
      paidAtDate: yesterday,
    }]);
    setSelectResults(financialAdjustmentAllocations, []);
    mockDb.execute.mockImplementationOnce((statement: any) => {
      mockState.executedSql.push(statement);
      return Promise.resolve({ rows: [
        { studentId: 10, firstName: 'Afi', lastName: 'Doe', classId: 53, className: '5ème', categoryId: 1, due: 5000, paid: 5000 },
      ] });
    });

    const response = await request(app)
      .get('/api/accounting/situation?academicYearId=2&classId=53&aggregate=student&includeInactive=true');

    expect(response.status, response.body.error).toBe(200);
    expect(response.body.rows).toEqual([expect.objectContaining({
      studentId: 10,
      overdueInstallmentCount: 0,
      punctualityStatus: 'paid_on_time',
      punctualityReason: null,
    })]);
    const allocationConditions = mockState.whereConditions.filter((item) =>
      item.table === financialPaymentAllocations);
    const allocationWhere = allocationConditions[allocationConditions.length - 1]?.condition;
    const allocationQuery = new PgDialect().sqlToQuery(allocationWhere);
    expect(allocationQuery.sql).toContain('"financial_payments"."school_id" =');
    expect(allocationQuery.sql).toContain('"financial_payments"."academic_year_id" =');
  });

  it('returns category detail rows for a class PDF while retaining global student totals', async () => {
    mockState.actor = { ...mockState.actor, role: 'school_admin', schoolId: 2, academicYearId: 2 };
    mockState.approvedClasses.add('2:53');
    setSelectResults(academicYears, [{ id: 2, schoolId: null }], [{ id: 2, schoolId: null }]);
    setSelectResults(classes, [{ id: 53, schoolId: null, academicYearId: 2, name: '5ème' }]);
    mockDb.execute.mockImplementationOnce((statement: any) => {
      mockState.executedSql.push(statement);
      return Promise.resolve({ rows: [
        { studentId: 10, firstName: 'Kossi', lastName: 'Afi', classId: 53, className: '5ème', categoryId: 1, categoryCode: 'tuition', categoryLabel: 'Scolarité', obligationClassNames: ['4ème'], due: 100000, paid: 100000 },
        { studentId: 10, firstName: 'Kossi', lastName: 'Afi', classId: 53, className: '5ème', categoryId: 2, categoryCode: 'enrollment', categoryLabel: 'Inscription', due: 10000, paid: 0 },
        { studentId: 10, firstName: 'Kossi', lastName: 'Afi', classId: 53, className: '5ème', categoryId: 3, categoryCode: 'canteen', categoryLabel: 'Cantine', due: 20000, paid: 10000 },
      ] });
    });

    const response = await request(app)
      .get('/api/accounting/situation?academicYearId=2&classId=53&includeAllCategories=true&status=partial&includeInactive=true');

    expect(response.status, response.body.error).toBe(200);
    expect(response.body.rows).toHaveLength(3);
    expect(response.body.rows.map((row: any) => row.categoryLabel)).toEqual(['Scolarité', 'Inscription', 'Cantine']);
    expect(response.body.rows[0].obligationClassNames).toEqual(['4ème']);
    expect(response.body.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({
        studentId: 10,
        studentDue: 130000,
        studentPaid: 110000,
        studentRemaining: 20000,
        studentStatus: 'partial',
      }),
    ]));
    const query = new PgDialect().sqlToQuery(mockState.executedSql[0]);
    expect(query.sql).not.toContain('category.is_enabled = true');
    expect(query.params).toContain(53);
  });

  it('requires a selected class for an aggregated student situation', async () => {
    mockState.actor = { ...mockState.actor, role: 'school_admin', schoolId: 2, academicYearId: 2 };
    setSelectResults(academicYears, [{ id: 2, schoolId: null }]);

    const response = await request(app)
      .get('/api/accounting/situation?academicYearId=2&aggregate=student');

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('A classId is required for student aggregate situations');
    expect(mockDb.execute).not.toHaveBeenCalled();
  });

  it.each(['paid', 'partial', 'unpaid'])('accepts the global student status filter %s', async (status) => {
    mockState.actor = { ...mockState.actor, role: 'school_admin', schoolId: 2, academicYearId: 2 };
    setSelectResults(academicYears, [{ id: 2, schoolId: null }]);
    mockDb.execute.mockImplementationOnce((statement: any) => {
      mockState.executedSql.push(statement);
      return Promise.resolve({ rows: [
        { studentId: 20, due: 100, paid: 100, categoryId: 1 },
        { studentId: 21, due: 100, paid: 25, categoryId: 1 },
        { studentId: 22, due: 100, paid: 0, categoryId: 1 },
        { studentId: 23, due: 0, paid: 0, categoryId: 1 },
      ] });
    });

    const response = await request(app)
      .get(`/api/accounting/situation?academicYearId=2&status=${status}`);

    expect(response.status, response.body.error).toBe(200);
    const expectedStudentId = status === 'paid' ? 20 : status === 'partial' ? 21 : 22;
    expect(response.body.rows).toHaveLength(1);
    expect(response.body.rows[0]).toMatchObject({
      studentId: expectedStudentId,
      studentStatus: status,
    });
  });

  it('rejects unknown global student statuses and status combined with fee-specific filters', async () => {
    mockState.actor = { ...mockState.actor, role: 'school_admin', schoolId: 2, academicYearId: 2 };
    setSelectResults(academicYears, [{ id: 2, schoolId: null }]);

    const invalidStatus = await request(app)
      .get('/api/accounting/situation?academicYearId=2&status=unconfigured');
    expect(invalidStatus.status).toBe(400);

    const feeScopedStatus = await request(app)
      .get('/api/accounting/situation?academicYearId=2&status=paid&categoryId=3');
    expect(feeScopedStatus.status).toBe(400);
    expect(mockDb.execute).not.toHaveBeenCalled();
  });

  it('returns net paid, remaining debt, and overpayment consistently by category and in totals', async () => {
    mockState.actor = { ...mockState.actor, role: 'school_admin', schoolId: 1, academicYearId: 4 };
    const obligations = [
      { id: 21, schoolId: 1, studentId: 10, academicYearId: 4, classId: 2, categoryId: 2, tariffId: 5, feeDefinitionId: null, enrollmentKind: null, amount: 100, status: 'active', createdAt: new Date() },
      { id: 22, schoolId: 1, studentId: 10, academicYearId: 4, classId: 2, categoryId: 3, tariffId: 6, feeDefinitionId: null, enrollmentKind: null, amount: 100, status: 'active', createdAt: new Date() },
      { id: 23, schoolId: 1, studentId: 10, academicYearId: 4, classId: 2, categoryId: 4, tariffId: 7, feeDefinitionId: null, enrollmentKind: 're_enrollment', amount: 50, status: 'active', createdAt: new Date() },
    ];
    const allocations = [{ id: 51, obligationId: 21, installmentId: 31, amount: 120 }];
    setSelectResults(students, [{
      id: 10, firstName: 'Afi', lastName: 'Doe', matricule: 'A10',
      classId: 2, schoolId: 1, className: '6e',
    }]);
    setSelectResults(financialObligations, obligations);
    setSelectResults(financialInstallments, [
      { id: 31, obligationId: 21, label: 'Scolarité', orderIndex: 1, amount: 100, dueDate: '2026-10-01' },
      { id: 32, obligationId: 22, label: 'Cantine', orderIndex: 1, amount: 100, dueDate: '2026-10-01' },
      { id: 33, obligationId: 23, label: 'Inscription', orderIndex: 1, amount: 50, dueDate: '2026-10-01' },
    ]);
    setSelectResults(financialPaymentAllocations, allocations, allocations);
    setSelectResults(financialAdjustmentAllocations, [], []);
    setSelectResults(accountingCategories, [
      { id: 2, schoolId: 1, code: 'tuition', label: 'Scolarité', isEnabled: true },
      { id: 3, schoolId: 1, code: 'canteen', label: 'Cantine', isEnabled: true },
      { id: 4, schoolId: 1, code: 'enrollment', label: 'Inscription', isEnabled: true },
    ]);
    setSelectResults(accountingTariffs, [
      {
        id: 50, schoolId: 1, academicYearId: 4, classId: null, classFromId: 1, classToId: 3,
        categoryId: 2, label: 'Scolarité par plage', amount: 120,
      },
      { id: 6, schoolId: 1, academicYearId: 4, classId: 2, categoryId: 3, label: 'Cantine', amount: 100 },
      { id: 7, schoolId: 1, academicYearId: 4, classId: 2, categoryId: 4, label: 'Inscription', amount: 50 },
    ]);
    setSelectResults(classes, [[
      { classId: 1, className: '6e A', academicYearId: 4, levelOrder: 2 },
      { classId: 2, className: '6e B', academicYearId: 4, levelOrder: 2 },
      { classId: 3, className: '6e C', academicYearId: 4, levelOrder: 2 },
    ]]);
    setSelectResults(financialPayments, []);

    const response = await request(app)
      .get('/api/accounting/students/10?schoolId=1&academicYearId=4');

    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body.categories).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 2,
        due: 100,
        paid: 120,
        remaining: 0,
        overpayment: 20,
        indicativeTariffAmount: null,
      }),
      expect.objectContaining({ id: 3, due: 100, paid: 0, remaining: 100, overpayment: 0 }),
      expect.objectContaining({
        id: 4,
        due: 50,
        paid: 0,
        remaining: 50,
        indicativeTariffAmount: null,
      }),
    ]));
    expect(response.body.totals).toMatchObject({
      due: 250,
      paid: 120,
      remaining: 150,
      overpayment: 20,
    });
  });

  it('physically deletes a tariff that has never been used', async () => {
    mockState.actor = { ...mockState.actor, role: 'school_admin', schoolId: 2 };
    setSelectResults(accountingTariffs, [{
      id: 31, schoolId: 2, academicYearId: 2, classId: 53, categoryId: 41, label: 'Transport',
    }]);
    setSelectResults(financialObligations, []);

    const response = await request(app).delete('/api/accounting/tariffs/31?schoolId=2');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true, archived: false });
    expect(mockState.deleted).toHaveLength(1);
    expect(mockState.deleted[0].table).toBe(accountingTariffs);
    expect(mockState.updated).toHaveLength(0);
  });

  it('matches the frontend DELETE URL and returns 404 only when that tariff does not exist', async () => {
    mockState.actor = { ...mockState.actor, role: 'school_admin', schoolId: 2 };
    setSelectResults(accountingTariffs, []);

    const response = await request(app).delete('/api/accounting/tariffs/987?schoolId=2');

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: 'Tariff not found' });
    const lookupCondition = mockState.whereConditions.find((item) => item.table === accountingTariffs)?.condition;
    const query = new PgDialect().sqlToQuery(lookupCondition);
    expect(query.params).toContain(987);
    expect(query.params).toContain(2);
  });

  it('archives a tariff referenced by obligations and retains its payment history', async () => {
    mockState.actor = { ...mockState.actor, role: 'school_admin', schoolId: 2 };
    setSelectResults(accountingTariffs, [{
      id: 31, schoolId: 2, academicYearId: 2, classId: 53, categoryId: 41, label: 'Transport',
    }]);
    setSelectResults(financialObligations, [{ id: 90, tariffId: 31 }]);

    const response = await request(app).delete('/api/accounting/tariffs/31?schoolId=2');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true, archived: true });
    expect(mockState.deleted).toHaveLength(0);
    expect(mockState.updated).toContainEqual({
      table: accountingTariffs,
      values: expect.objectContaining({ isEnabled: false }),
    });
    const obligationCondition = mockState.whereConditions.find((item) => item.table === financialObligations)?.condition;
    expect(new PgDialect().sqlToQuery(obligationCondition).params).toContain(31);
  });

  it('does not return archived tariffs from the configuration listing', async () => {
    mockState.actor = { ...mockState.actor, role: 'school_admin', schoolId: 2 };
    setSelectResults(accountingTariffs, []);

    const response = await request(app).get('/api/accounting/tariffs?academicYearId=2');

    expect(response.status).toBe(200);
    expect(response.body).toEqual([]);
    const condition = mockState.whereConditions.find((item) => item.table === accountingTariffs)?.condition;
    expect(new PgDialect().sqlToQuery(condition).sql).toContain('"accounting_tariffs"."is_enabled" =');
  });

  it('creates or updates exactly one tariff for a school-year-class-category combination', async () => {
    mockState.actor = { ...mockState.actor, role: 'school_admin', schoolId: 2 };
    setSelectResults(academicYears,
      [{ id: 2, schoolId: null }],
      [{ id: 2, schoolId: null }],
    );
    setSelectResults(classes,
      [{ id: 53, schoolId: 2, academicYearId: 2, name: '5ème' }],
      [{ id: 53, schoolId: 2, academicYearId: 2, name: '5ème' }],
    );
    setSelectResults(accountingCategories,
      [{ id: 8, schoolId: 2, isEnabled: true, code: 'tuition' }],
      [{ id: 8, schoolId: 2, isEnabled: true, code: 'tuition' }],
    );
    setInsertResults(
      accountingTariffs,
      [{ id: 31, schoolId: 2, academicYearId: 2, classId: 53, categoryId: 8, amount: 50000 }],
      [{ id: 31, schoolId: 2, academicYearId: 2, classId: 53, categoryId: 8, amount: 100000 }],
    );

    const first = await request(app).post('/api/accounting/tariffs').send({
      schoolId: 2, academicYearId: 2, classId: 53, categoryId: 8, amount: 50000,
    });
    const second = await request(app).post('/api/accounting/tariffs').send({
      schoolId: 2, academicYearId: 2, classId: 53, categoryId: 8, amount: 100000,
    });

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(first.body.id).toBe(31);
    expect(second.body.id).toBe(31);
    expect(mockState.upsertTargets).toHaveLength(2);
    expect(mockState.upsertTargets[0]).toHaveLength(4);
    expect(mockState.inserted.filter((item) => item.table === accountingTariffs)).toHaveLength(2);
  });

  it('creates dynamic fee labels, rejects duplicate school-year-class-label combinations, and keeps other combinations distinct', async () => {
    mockState.actor = { ...mockState.actor, role: 'school_admin', schoolId: 2 };
    setSelectResults(academicYears,
      ...Array.from({ length: 8 }, () => [{ id: 2, schoolId: null }]));
    setSelectResults(classes,
      [{ id: 53, schoolId: 2, academicYearId: 2, name: '5ème' }],
      [{ id: 53, schoolId: 2, academicYearId: 2, name: '5ème' }],
      [{ id: 54, schoolId: 2, academicYearId: 2, name: '6ème' }],
      [{ id: 53, schoolId: 2, academicYearId: 2, name: '5ème' }]);
    setSelectResults(accountingCategories,
      [],
      [{ id: 41, schoolId: 2, code: 'custom:transport', label: 'Transport', isEnabled: true }],
      [{ id: 41, schoolId: 2, code: 'custom:transport', label: 'Transport', isEnabled: true }],
      [{ id: 41, schoolId: 2, code: 'custom:transport', label: 'Transport', isEnabled: true }]);
    setSelectResults(accountingTariffs,
      [],
      [{ id: 71, schoolId: 2, academicYearId: 2, classId: 53, categoryId: 41, label: 'Transport' }],
      [],
      []);
    setInsertResults(accountingCategories,
      [{ id: 41, schoolId: 2, code: 'custom:transport', label: 'Transport', isEnabled: true }],
      [{ id: 42, schoolId: 2, code: 'custom:examen', label: 'Examen', isEnabled: true }]);
    setInsertResults(accountingTariffs,
      [{ id: 71, schoolId: 2, academicYearId: 2, classId: 53, categoryId: 41, amount: 15000 }],
      [{ id: 72, schoolId: 2, academicYearId: 2, classId: 54, categoryId: 41, amount: 16000 }],
      [{ id: 73, schoolId: 2, academicYearId: 2, classId: 53, categoryId: 42, amount: 5000 }]);

    const create = (classId: number, label: string, amount: number) => request(app).post('/api/accounting/tariffs').send({
      schoolId: 2, academicYearId: 2, classId, label, amount,
    });
    const created = await create(53, 'Transport', 15000);
    const duplicate = await create(53, '  transport  ', 20000);
    const otherClass = await create(54, 'Transport', 16000);
    const otherLabel = await create(53, 'Examen', 5000);

    expect(created.status).toBe(201);
    expect(duplicate.status).toBe(409);
    expect(otherClass.status).toBe(201);
    expect(otherLabel.status).toBe(201);
    expect(mockState.inserted.filter((item) => item.table === accountingTariffs)).toHaveLength(3);
    expect(mockState.inserted.filter((item) => item.table === accountingTariffs).map(({ values }) => ({
      classId: values.classId,
      categoryId: values.categoryId,
    }))).toEqual([
      { classId: 53, categoryId: 41 },
      { classId: 54, categoryId: 41 },
      { classId: 53, categoryId: 42 },
    ]);
    expect(mockState.inserted.find((item) => item.table === accountingCategories)?.values)
      .toMatchObject({ code: 'custom:transport', label: 'Transport', schoolId: 2 });
  });

  it.each([
    ['label only', { label: 'Transport scolaire' }, { label: 'Transport scolaire' }],
    ['class only', { classId: 54 }, { classId: 54 }],
    ['amount only', { amount: 20000 }, { amount: 20000 }],
    ['label, class, and amount', { label: 'Transport scolaire', classId: 54, amount: 20000 }, {
      label: 'Transport scolaire', classId: 54, amount: 20000,
    }],
  ])('updates the existing tariff with %s without changing historical financial records', async (_name, changes, expected) => {
    const targetClassId = 'classId' in changes ? changes.classId as number : 53;
    const targetLabel = 'label' in changes ? changes.label as string : 'Transport';
    const targetAmount = 'amount' in changes ? changes.amount as number : 15000;
    prepareTariffModification({ targetClassId, targetLabel, targetAmount });

    const response = await request(app).put('/api/accounting/tariffs/31').send({
      schoolId: 2,
      academicYearId: 2,
      classId: targetClassId,
      label: targetLabel,
      amount: targetAmount,
    });

    expect(response.status).toBe(200);
    expect(mockState.updated.find((item) => item.table === accountingTariffs)?.values).toMatchObject(expected);
    expect(mockState.updated.some((item) => item.table === accountingCategories)).toBe(false);
    expect(mockState.inserted.some((item) => item.table === financialObligations)).toBe(false);
    expect(mockState.inserted.some((item) => item.table === financialPayments)).toBe(false);
    expect(mockState.inserted.some((item) => item.table === financialPaymentAllocations)).toBe(false);
    expect(mockState.inserted.some((item) => item.table === financialReceipts)).toBe(false);
  });

  it('rejects a tariff modification that duplicates the normalized label in its target class and year', async () => {
    prepareTariffModification({ targetLabel: ' transport ', duplicate: true });

    const response = await request(app).put('/api/accounting/tariffs/31').send({
      schoolId: 2,
      academicYearId: 2,
      classId: 53,
      label: ' TRANSPORT ',
      amount: 15000,
    });

    expect(response.status).toBe(409);
    expect(response.body.error).toContain('existe déjà');
    expect(mockState.updated).toHaveLength(0);
  });

  it('rejects a global academic year that is not assigned to the school admin', async () => {
    mockState.actor = { ...mockState.actor, role: 'school_admin', schoolId: 2, academicYearId: 3 };
    setSelectResults(academicYears, [{ id: 2, schoolId: null }]);

    const response = await request(app).get('/api/accounting/situation?academicYearId=2');

    expect(response.status).toBe(404);
    expect(response.body.error).toBe('Academic year not found in this school');
    expect(mockDb.execute).not.toHaveBeenCalled();
  });

  it('rejects an invalid payment date without a server error', async () => {
    setSelectResults(schools, [{ id: 1 }]);
    const response = await request(app).post('/api/accounting/payments').send({
      ...validPaymentBody(),
      paidAt: 'not-a-date',
    });
    expect(response.status).toBe(400);
  });

  it('keeps a custom uniform fee pending until an explicit approval', async () => {
    setSelectResults(schools, [{ id: 1 }]);
    setSelectResults(academicYears,
      [{ id: 4, schoolId: 1, name: '2026-2027' }],
      [{ id: 4, schoolId: 1, name: '2026-2027' }]);
    setSelectResults(accountingCategories, [{
      id: 8, schoolId: 1, code: 'uniform', label: 'Uniforme', isEnabled: true,
    }]);

    const response = await request(app).post('/api/accounting/fees').send({
      schoolId: 1,
      academicYearId: 4,
      categoryId: 8,
      label: 'Tenue scolaire',
      amount: 15000,
    });

    expect(response.status).toBe(201);
    expect(response.body.status).toBe('pending');
    expect(mockState.inserted.find((item) => item.table === accountingFeeDefinitions)?.values)
      .toMatchObject({ categoryId: 8, status: 'pending', amount: 15000 });
  });

  it('allocates a posted payment to the oldest installment and locks the school year', async () => {
    preparePaymentNotificationScenario();

    const response = await request(app).post('/api/accounting/payments').send(validPaymentBody());

    expect(response.status).toBe(201);
    expect(mockState.inserted.find((item) => item.table === financialPaymentAllocations)?.values)
      .toEqual([{ paymentId: 100, installmentId: 31, obligationId: 21, amount: 10000 }]);
    const lockQueries = mockState.executedSql.map((statement) => new PgDialect().sqlToQuery(statement).sql);
    expect(lockQueries.some((query) => query.includes('FOR UPDATE'))).toBe(true);
    const savedReceiptSnapshot = mockState.inserted.find((item) => item.table === financialReceipts)?.values.snapshot;
    expect(savedReceiptSnapshot).toMatchObject({
      paidBeforePayment: 0,
      totalDue: 30000,
      remainingAfterPayment: 20000,
      allocations: [{
        category: 'Scolarité',
        label: 'Scolarité',
        tariffLabel: 'Frais de scolarité',
        amount: 10000,
      }],
    });
    const receiptAllocationProjection = mockState.selectProjections
      .find((projection) => projection?.category != null && projection?.installmentLabel != null);
    expect(receiptAllocationProjection.tariffLabel).toBe(accountingTariffs.label);
    expect(receiptAllocationProjection.category).toBe(accountingCategories.label);
    expect(JSON.stringify(savedReceiptSnapshot.allocations)).toContain('"tariffLabel":"Frais de scolarité"');
    expect(formatAccountingReceiptAllocationLine(savedReceiptSnapshot.allocations[0]))
      .toBe('Frais de scolarité (échéance 2026-10-01) : 10 000 FCFA');
    const paymentNotification = mockState.inserted.find((item) => item.table === notifications)?.values;
    expect(paymentNotification).toMatchObject({
      userId: 25,
      title: 'Paiement enregistré',
      type: 'info',
      dedupeKey: 'accounting-payment-100',
    });
    expect(paymentNotification.body).toContain('Paiement de 10 000 FCFA enregistré pour Afi Doe.');
    expect(paymentNotification.body).toContain('Frais concernés : Frais de scolarité.');
    expect(paymentNotification.body).toContain('Reste total à payer pour l’année 2026-2027 : 35 000 FCFA.');
    expect(paymentNotification.body).toContain('Reste pour les rubriques réglées : Scolarité : 20 000 FCFA.');
    expect(paymentNotification.body).toContain('Date du paiement : 07/10/2026.');
    expect(dispatchPaymentNotification).toHaveBeenCalledOnce();
    expect(mockState.transactionCommitted).toBe(true);
    expect(dispatchPaymentNotification).toHaveBeenCalledWith(expect.objectContaining({
      parentId: '25',
      title: 'Paiement enregistré',
      message: 'Un paiement a été enregistré. Consultez l’application pour le détail.',
      category: 'info',
      metadata: expect.objectContaining({
        target: 'payment',
        paymentId: '100',
        notificationId: 501,
        attachmentCount: 1,
        attachments: [expect.objectContaining({
          attachmentId: expect.any(Number),
          fileName: 'REC-2026-000015.pdf',
          mimeType: 'application/pdf',
          fileSize: expect.any(Number),
        })],
      }),
      dedupeKey: 'accounting-payment-100',
    }));
  });

  it('does not fail a committed payment when the push relay rejects the request', async () => {
    preparePaymentNotificationScenario();
    dispatchPaymentNotification.mockRejectedValueOnce(
      Object.assign(new Error('Payment notification relay rejected'), { statusCode: 503 }),
    );
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});

    const response = await request(app).post('/api/accounting/payments').send(validPaymentBody());

    expect(response.status).toBe(201);
    expect(response.body.duplicate).toBe(false);
    expect(mockState.transactionCommitted).toBe(true);
    expect(mockState.inserted.some((item) => item.table === financialPayments)).toBe(true);
    expect(dispatchPaymentNotification).toHaveBeenCalledOnce();
    expect(errorLog).toHaveBeenCalledWith('Accounting payment push relay failed', {
      paymentId: 100,
      status: 503,
      errorName: 'Error',
    });
    errorLog.mockRestore();
  });

  it('attaches the generated receipt PDF to the existing payment notification for its parent', async () => {
    preparePaymentNotificationScenario();
    setSelectResults(notifications, [{ id: 501, userId: 25 }]);
    setSelectResults(notificationAttachments, []);

    const response = await request(app).post('/api/accounting/payments').send(validPaymentBody());

    expect(response.status).toBe(201);
    expect(response.body.payment.id).toBe(100);
    expect(response.body.receipt).toMatchObject({ id: 55, paymentId: 100, receiptNumber: 'REC-2026-000015' });
    const paymentNotification = mockState.inserted.find((item) => item.table === notifications)?.values;
    expect(paymentNotification).toMatchObject({
      userId: 25,
      title: 'Paiement enregistré',
      dedupeKey: 'accounting-payment-100',
    });
    const attachment = mockState.inserted.find((item) => item.table === notificationAttachments)?.values;
    expect(attachment).toMatchObject({
      notificationId: 501,
      fileName: 'REC-2026-000015.pdf',
      filePath: 'notification-attachments/REC-2026-000015.pdf',
      mimeType: 'application/pdf',
      uploadedBy: 7,
    });
    expect(fileStorageMock.persistUploadedFile).toHaveBeenCalledOnce();
    const storedFile = fileStorageMock.persistUploadedFile.mock.calls[0][0];
    expect(storedFile.mimetype).toBe('application/pdf');
    expect(Buffer.from(storedFile.buffer!).subarray(0, 4).toString()).toBe('%PDF');
    expect(attachment?.fileSize).toBe(storedFile.buffer?.byteLength);
    expect(dispatchPaymentNotification).toHaveBeenCalledOnce();
    expect(response.body.duplicate).toBe(false);
  });

  it('keeps a recorded payment successful when storing its receipt attachment fails', async () => {
    preparePaymentNotificationScenario();
    setSelectResults(notifications, [{ id: 501, userId: 25 }]);
    setSelectResults(notificationAttachments, []);
    fileStorageMock.persistUploadedFile.mockRejectedValueOnce(new Error('storage unavailable'));
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});

    const response = await request(app).post('/api/accounting/payments').send(validPaymentBody());

    expect(response.status).toBe(201);
    expect(response.body.duplicate).toBe(false);
    expect(mockState.transactionCommitted).toBe(true);
    expect(mockState.inserted.some((item) => item.table === financialPayments)).toBe(true);
    expect(mockState.inserted.some((item) => item.table === notifications)).toBe(true);
    expect(mockState.inserted.some((item) => item.table === notificationAttachments)).toBe(false);
    expect(dispatchPaymentNotification).toHaveBeenCalledOnce();
    expect(dispatchPaymentNotification.mock.calls[0][0].metadata).not.toHaveProperty('attachmentCount');
    expect(errorLog).toHaveBeenCalledWith('Failed to attach accounting receipt PDF to payment notification', {
      paymentId: 100,
      receiptId: 55,
      errorName: 'Error',
    });
    errorLog.mockRestore();
  });

  it('keeps a recorded payment successful when rendering its receipt PDF fails', async () => {
    preparePaymentNotificationScenario();
    setSelectResults(notifications, [{ id: 501, userId: 25 }]);
    setSelectResults(notificationAttachments, []);
    const renderError = new Error('PDF rendering unavailable');
    const renderReceipt = vi.spyOn(PDFDocument, 'create').mockRejectedValueOnce(renderError);
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});

    const response = await request(app).post('/api/accounting/payments').send(validPaymentBody());

    expect(response.status).toBe(201);
    expect(response.body.duplicate).toBe(false);
    expect(mockState.transactionCommitted).toBe(true);
    expect(mockState.inserted.some((item) => item.table === financialPayments)).toBe(true);
    expect(mockState.inserted.some((item) => item.table === notifications)).toBe(true);
    expect(fileStorageMock.persistUploadedFile).not.toHaveBeenCalled();
    expect(mockState.inserted.some((item) => item.table === notificationAttachments)).toBe(false);
    expect(dispatchPaymentNotification).toHaveBeenCalledOnce();
    expect(dispatchPaymentNotification.mock.calls[0][0].metadata).not.toHaveProperty('attachmentCount');
    expect(errorLog).toHaveBeenCalledWith('Failed to attach accounting receipt PDF to payment notification', {
      paymentId: 100,
      receiptId: 55,
      errorName: 'Error',
    });
    renderReceipt.mockRestore();
    errorLog.mockRestore();
  });

  it('does not announce a receipt when attaching it to the notification fails', async () => {
    preparePaymentNotificationScenario();
    setSelectResults(notifications, [{ id: 501, userId: 25 }]);
    setSelectResults(notificationAttachments, []);
    mockDb.transaction
      .mockImplementationOnce(async (callback: (tx: any) => unknown) => {
        const result = await callback(mockDb);
        mockState.transactionCommitted = true;
        return result;
      })
      .mockImplementationOnce(async (callback: (tx: any) => unknown) => callback({
        ...mockDb,
        insert: (table: any) => ({
          values(values: any) {
            if (table === notificationAttachments) {
              throw new Error('attachment association unavailable');
            }
            return mockDb.insert(table).values(values);
          },
        }),
      }));
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});

    const response = await request(app).post('/api/accounting/payments').send(validPaymentBody());

    expect(response.status).toBe(201);
    expect(response.body.duplicate).toBe(false);
    expect(mockState.transactionCommitted).toBe(true);
    expect(mockState.inserted.some((item) => item.table === financialPayments)).toBe(true);
    expect(mockState.inserted.some((item) => item.table === notifications)).toBe(true);
    expect(mockState.inserted.some((item) => item.table === notificationAttachments)).toBe(false);
    expect(fileStorageMock.persistUploadedFile).toHaveBeenCalledOnce();
    expect(fileStorageMock.deleteStoredFile).toHaveBeenCalledOnce();
    expect(dispatchPaymentNotification).toHaveBeenCalledOnce();
    expect(dispatchPaymentNotification.mock.calls[0][0].metadata).not.toHaveProperty('attachmentCount');
    expect(errorLog).toHaveBeenCalledWith('Failed to attach accounting receipt PDF to payment notification', {
      paymentId: 100,
      receiptId: 55,
      errorName: 'Error',
    });
    errorLog.mockRestore();
  });

  it('collects a class-range tariff and another fee with their own receipt lines', async () => {
    setSelectResults(schools, [{ id: 1 }], [{ id: 1, name: 'École', officialName: null, logoPath: null }]);
    setSelectResults(students, [{
      id: 10, firstName: 'Afi', lastName: 'Doe', matricule: 'A10', classId: 2, schoolId: 1,
      isActive: true, className: '6e',
    }], []);
    setSelectResults(academicYears,
      [{ id: 4, schoolId: 1, name: '2026-2027' }],
      [{ id: 4, schoolId: 1, name: '2026-2027' }]);
    setSelectResults(classes,
      [{ id: 2, schoolId: 1, academicYearId: 4, name: '6e' }],
      [
        { classId: 2, className: '6e B', academicYearId: 4, levelOrder: 2 },
        { classId: 1, className: '6e A', academicYearId: 4, levelOrder: 2 },
        { classId: 3, className: '6e C', academicYearId: 4, levelOrder: 2 },
      ],
      [
        { classId: 2, className: '6e B', academicYearId: 4, levelOrder: 2 },
        { classId: 1, className: '6e A', academicYearId: 4, levelOrder: 2 },
        { classId: 3, className: '6e C', academicYearId: 4, levelOrder: 2 },
      ]);
    setSelectResults(financialPayments, []);
    setSelectResults(
      accountingTariffs,
      [{
        id: 5, schoolId: 1, academicYearId: 4, classId: null,
        classFromId: 1, classToId: 3, categoryId: 2,
        label: 'Frais de scolarité', amount: 100000, isEnabled: true,
      }],
      [{ id: 6, schoolId: 1, academicYearId: 4, classId: 2, categoryId: 3, label: 'Cantine', amount: 30000, isEnabled: true }],
      [{ id: 6, schoolId: 1, academicYearId: 4, classId: 2, categoryId: 3, label: 'Cantine', amount: 30000, isEnabled: true }],
    );
    setSelectResults(accountingCategories,
      [{ id: 2, schoolId: 1, code: 'tuition', label: 'Scolarité', isEnabled: true }],
      [{ id: 3, schoolId: 1, code: 'canteen', label: 'Cantine', isEnabled: true }]);
    setSelectResults(financialObligations,
      [{ id: 21, classId: 2, tariffId: 5, feeDefinitionId: null, enrollmentKind: null }],
      [{ id: 22, classId: 2, tariffId: 6, feeDefinitionId: null, enrollmentKind: null }],
      [
        { id: 21, categoryId: 2, classId: 2, tariffId: 5, feeDefinitionId: null, enrollmentKind: null, label: 'Frais de scolarité', amount: 100000, createdAt: new Date() },
        { id: 22, categoryId: 3, classId: 2, tariffId: 6, feeDefinitionId: null, enrollmentKind: null, label: 'Cantine', amount: 30000, createdAt: new Date() },
      ]);
    setSelectResults(financialInstallments, [
      { id: 31, obligationId: 21, label: 'Paiement annuel', orderIndex: 1, amount: 100000, dueDate: '2026-10-07' },
      { id: 32, obligationId: 22, label: 'Cantine octobre', orderIndex: 1, amount: 30000, dueDate: '2026-10-07' },
    ]);
    setSelectResults(financialPaymentAllocations, [], [
      { category: 'Scolarité', label: 'Frais de scolarité', tariffLabel: 'Frais de scolarité', amount: 50000, installmentLabel: 'Paiement annuel', dueDate: '2026-10-07' },
      { category: 'Cantine', label: 'Cantine', tariffLabel: 'Cantine', amount: 15000, installmentLabel: 'Cantine octobre', dueDate: '2026-10-07' },
    ]);

    const response = await request(app).post('/api/accounting/payments').send({
      ...validPaymentBody(),
      allocations: [{ tariffId: 5, amount: 50000 }, { tariffId: 6, amount: 15000 }],
    });

    expect(response.status, JSON.stringify(response.body)).toBe(201);
    expect(mockState.inserted.find((item) => item.table === financialPayments)?.values.amount).toBe(65000);
    expect(mockState.inserted.find((item) => item.table === financialPaymentAllocations)?.values).toEqual([
      { paymentId: 100, installmentId: 31, obligationId: 21, amount: 50000 },
      { paymentId: 100, installmentId: 32, obligationId: 22, amount: 15000 },
    ]);
    expect(mockState.inserted.find((item) => item.table === financialReceipts)?.values.snapshot).toMatchObject({
      payment: { amount: 65000 },
      allocations: [
        { tariffLabel: 'Frais de scolarité', amount: 50000 },
        { tariffLabel: 'Cantine', amount: 15000 },
      ],
    });
    expect(mockState.inserted.filter((item) => item.table === financialReceipts)).toHaveLength(1);
    expect(mockState.inserted.find((item) => item.table === financialPaymentAllocations)?.values)
      .not.toContainEqual(expect.objectContaining({ obligationId: 21, amount: 65000 }));
    expect(mockState.updated).toHaveLength(0);
  });

  it.each([
    { label: 'Cantine', code: 'canteen', categoryId: 3, tariffId: 6, categoryEnabled: false },
    { label: 'Uniforme', code: 'uniform', categoryId: 4, tariffId: 7, categoryEnabled: false },
    {
      label: 'Frais d’inscription',
      code: 'custom:frais d’inscription',
      categoryId: 5,
      tariffId: 8,
      categoryEnabled: true,
    },
    {
      label: 'Inscription',
      code: 'enrollment',
      categoryId: 5,
      tariffId: 9,
      categoryEnabled: true,
      enrollmentKind: 're_enrollment',
    },
  ])('creates a $label obligation from its configured class tariff', async ({
    label,
    code,
    categoryId,
    tariffId,
    categoryEnabled,
    enrollmentKind,
  }) => {
    prepareValidPayment();
    setSelectResults(schools,
      [{ id: 1 }],
      [{ id: 1, name: 'École', officialName: null, logoPath: null }]);
    setSelectResults(financialPayments, []);
    const tariff = {
      id: tariffId,
      schoolId: 1,
      academicYearId: 4,
      classId: 2,
      categoryId,
      label,
      amount: 30000,
      isEnabled: true,
    };
    setSelectResults(accountingTariffs, [tariff], [tariff]);
    setSelectResults(accountingCategories, [{
      id: categoryId,
      schoolId: 1,
      code,
      label,
      isEnabled: categoryEnabled,
    }]);
    setSelectResults(financialObligations,
      [],
      [],
      [{ id: 100, categoryId, tariffId, label, amount: 30000, createdAt: new Date() }]);
    setSelectResults(financialInstallments, [{
      id: 81,
      obligationId: 100,
      label,
      orderIndex: 1,
      amount: 30000,
      dueDate: '2026-10-07',
    }]);
    setSelectResults(financialPaymentAllocations,
      [],
      [{
        category: label,
        label,
        tariffLabel: label,
        amount: 10000,
        installmentLabel: label,
        dueDate: '2026-10-07',
      }]);

    const response = await request(app).post('/api/accounting/payments').send({
      ...validPaymentBody(),
      allocations: [{ tariffId, amount: 10000 }],
      ...(enrollmentKind ? { enrollmentKind } : {}),
    });

    expect(response.status, JSON.stringify(response.body)).toBe(201);
    expect(mockState.inserted.find((item) => item.table === financialObligations)?.values).toMatchObject({
      schoolId: 1,
      studentId: 10,
      academicYearId: 4,
      classId: 2,
      categoryId,
      tariffId,
      label,
      amount: 30000,
      enrollmentKind: enrollmentKind ?? null,
    });
    expect(mockState.inserted.find((item) => item.table === financialPaymentAllocations)?.values)
      .toEqual([{ paymentId: 100, installmentId: 81, obligationId: 100, amount: 10000 }]);
    const categoryCondition = mockState.whereConditions.find((item) =>
      item.table === accountingCategories)?.condition;
    expect(new PgDialect().sqlToQuery(categoryCondition).sql).not.toContain('is_enabled');
  });

  it('reuses an existing enrollment obligation without requiring another kind selection', async () => {
    prepareValidPayment();
    const obligation = {
      id: 100,
      classId: 2,
      categoryId: 5,
      tariffId: 9,
      feeDefinitionId: null,
      enrollmentKind: 're_enrollment',
      label: 'Inscription',
      amount: 30000,
      status: 'active',
      createdAt: new Date(),
    };
    setSelectResults(schools, [{ id: 1 }], [{ id: 1, name: 'École', officialName: null, logoPath: null }]);
    setSelectResults(financialPayments, []);
    setSelectResults(accountingCategories, [{
      id: 5,
      schoolId: 1,
      code: 'enrollment',
      label: 'Inscription',
      isEnabled: true,
    }]);
    setSelectResults(financialObligations, [obligation], [obligation]);
    setSelectResults(financialInstallments, [{
      id: 81,
      obligationId: obligation.id,
      label: 'Inscription',
      orderIndex: 1,
      amount: obligation.amount,
      dueDate: '2026-10-07',
    }]);
    setSelectResults(financialPaymentAllocations, [], [{
      category: 'Inscription',
      label: 'Inscription',
      tariffLabel: 'Inscription',
      amount: 10000,
      installmentLabel: 'Inscription',
      dueDate: '2026-10-07',
    }]);

    const response = await request(app).post('/api/accounting/payments').send({
      ...validPaymentBody(),
      categoryId: 5,
    });

    expect(response.status, JSON.stringify(response.body)).toBe(201);
    expect(mockState.inserted.some((item) => item.table === financialObligations)).toBe(false);
    expect(mockState.inserted.find((item) => item.table === financialPaymentAllocations)?.values)
      .toEqual([{ paymentId: 100, installmentId: 81, obligationId: obligation.id, amount: 10000 }]);
  });

  it('creates a reduced tuition obligation on first payment and keeps the reduced amount in its receipt and audit', async () => {
    prepareRangeTariffPayment([]);
    setSelectResults(accountingCategories,
      [{ id: 2, schoolId: 1, code: 'tuition', label: 'Scolarité', isEnabled: true }],
      [{ id: 2, schoolId: 1, code: 'tuition', label: 'Scolarité', isEnabled: true }]);
    setSelectResults(financialObligations, [], [], [], [{
      id: 100, categoryId: 2, classId: 2, tariffId: 6, feeDefinitionId: null,
      enrollmentKind: null, label: 'Scolarité par plage', amount: 60000, status: 'active',
      classNameSnapshot: '6e B', createdAt: new Date(),
    }]);
    setSelectResults(financialInstallments, [{
      id: 31, obligationId: 100, label: 'Paiement annuel', orderIndex: 1,
      amount: 60000, dueDate: '2026-10-01',
    }]);
    setSelectResults(financialPaymentAllocations, [], [{
      categoryId: 2,
      category: 'Scolarité',
      label: 'Scolarité par plage',
      tariffLabel: 'Scolarité par plage',
      amount: 10000,
      installmentLabel: 'Paiement annuel',
      dueDate: '2026-10-01',
    }]);

    const response = await request(app).post('/api/accounting/payments').send({
      ...validPaymentBody(),
      allocations: [{ tariffId: 6, amount: 10000 }],
      initialTuitionAmount: 60000,
      initialTuitionJustification: 'Arrivée en cours d’année',
    });

    expect(response.status, JSON.stringify(response.body)).toBe(201);
    expect(mockState.inserted.find((item) => item.table === financialObligations)?.values)
      .toMatchObject({ amount: 60000, tariffId: 6 });
    expect(mockState.inserted.find((item) => item.table === financialInstallments)?.values)
      .toEqual([expect.objectContaining({ obligationId: 100, amount: 60000 })]);
    expect(mockState.inserted.find((item) => item.table === financialPaymentAllocations)?.values)
      .toEqual([{ paymentId: 100, installmentId: 31, obligationId: 100, amount: 10000 }]);
    expect(mockState.inserted.find((item) => item.table === financialReceipts)?.values.snapshot.totalDue).toBe(60000);
    const audit = mockState.inserted.find((item) => item.table === auditEvents)?.values;
    expect(audit.description).toContain('referenceAmount=100000 XOF');
    expect(audit.description).toContain('amount=60000 XOF');
    expect(audit.description).toContain('Arrivée en cours d’année');
  });

  it('rejects first-payment tuition individualization without a justification before recording payment', async () => {
    prepareRangeTariffPayment([]);
    setSelectResults(accountingCategories,
      [{ id: 2, schoolId: 1, code: 'tuition', label: 'Scolarité', isEnabled: true }],
      [{ id: 2, schoolId: 1, code: 'tuition', label: 'Scolarité', isEnabled: true }]);
    setSelectResults(financialObligations, [], [], []);

    const response = await request(app).post('/api/accounting/payments').send({
      ...validPaymentBody(),
      allocations: [{ tariffId: 6, amount: 10000 }],
      initialTuitionAmount: 60000,
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/justification/i);
    expect(mockState.inserted.some((item) => item.table === financialObligations)).toBe(false);
    expect(mockState.inserted.some((item) => item.table === financialPayments)).toBe(false);
  });

  it('refuses initial tuition individualization after a class change with an existing obligation', async () => {
    prepareRangeTariffPayment([{
      id: 21, schoolId: 1, studentId: 10, academicYearId: 4, classId: 1, categoryId: 2,
      tariffId: 5, feeDefinitionId: null, enrollmentKind: null, label: 'Scolarité',
      amount: 50000, status: 'active', classNameSnapshot: '6e A', createdAt: new Date(),
    }]);
    setSelectResults(accountingCategories,
      [{ id: 2, schoolId: 1, code: 'tuition', label: 'Scolarité', isEnabled: true }],
      [{ id: 2, schoolId: 1, code: 'tuition', label: 'Scolarité', isEnabled: true }]);

    const response = await request(app).post('/api/accounting/payments').send({
      ...validPaymentBody(),
      allocations: [{ tariffId: 6, amount: 10000 }],
      initialTuitionAmount: 60000,
      initialTuitionJustification: 'Arrivée en cours d’année',
    });

    expect(response.status).toBe(409);
    expect(response.body.error).toMatch(/before any tuition obligation/i);
    expect(mockState.inserted.some((item) => item.table === financialObligations)).toBe(false);
    expect(mockState.inserted.some((item) => item.table === financialPayments)).toBe(false);
    expect(mockState.inserted.some((item) => item.table === financialInstallments)).toBe(false);
  });

  it('does not make a tariff increase payable against an existing obligation or add an installment', async () => {
    prepareValidPayment();
    mockState.approvedClasses.add('1:2');
    setSelectResults(financialPayments, []);
    setSelectResults(
      financialObligations,
      [{ id: 21, classId: 2, tariffId: 5, feeDefinitionId: null, enrollmentKind: null }],
      [{ id: 21, categoryId: 2, classId: 2, tariffId: 5, feeDefinitionId: null, enrollmentKind: null, label: 'Scolarité', amount: 50000, createdAt: new Date() }],
    );
    setSelectResults(accountingCategories, [{ id: 2, schoolId: 1, code: 'tuition', label: 'Scolarité', isEnabled: true }]);
    setSelectResults(
      accountingTariffs,
      [{ id: 5, schoolId: 1, academicYearId: 4, classId: 2, categoryId: 2, amount: 100000, isEnabled: true }],
      [{ id: 5, schoolId: 1, academicYearId: 4, classId: 2, categoryId: 2, amount: 100000, isEnabled: true }],
    );
    setSelectResults(financialInstallments, [
      { id: 31, obligationId: 21, label: 'Paiement unique', orderIndex: 1, amount: 50000, dueDate: '2026-10-01' },
    ]);
    setSelectResults(
      financialPaymentAllocations,
      [{ id: 50, obligationId: 21, installmentId: 31, amount: 10000 }],
      [{ category: 'Scolarité', label: 'Scolarité', amount: 30000, installmentLabel: 'Paiement unique', dueDate: '2026-10-01' }],
    );
    setSelectResults(schools,
      [{ id: 1 }],
      [{ id: 1, name: 'École', officialName: null, logoPath: null }]);
    setSelectResults(students, [{
      id: 10, firstName: 'Afi', lastName: 'Doe', matricule: 'A10', classId: 2, schoolId: 1,
      isActive: true, className: '6e',
    }], []);
    setSelectResults(academicYears,
      [{ id: 4, schoolId: 1, name: '2026-2027' }],
      [{ id: 4, schoolId: 1, name: '2026-2027' }]);
    setSelectResults(classes, [{ id: 2, schoolId: 1, academicYearId: 4, name: '6e' }]);
    setInsertResults(financialPayments, [{
      id: 100,
      ...validPaymentBody(),
      amount: 30000,
      categoryId: 2,
      currency: 'XOF',
      reference: null,
      requestFingerprint: JSON.stringify([10, 4, 30000, 'cash', null, null, 2, null]),
      paidAt: new Date('2026-10-07T12:00:00.000Z'),
      status: 'posted',
    }]);
    setInsertResults(financialReceipts, [{
      id: 55,
      paymentId: 100,
      receiptNumber: 'REC-2026-000015',
      snapshot: { totalDue: 50000, paidBeforePayment: 10000, remainingAfterPayment: 10000 },
    }]);

    const response = await request(app).post('/api/accounting/payments').send({
      ...validPaymentBody(),
      amount: 30000,
      categoryId: 2,
    });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    expect(mockState.inserted.some((item) => item.table === financialInstallments)).toBe(false);
    expect(mockState.inserted.some((item) => item.table === financialObligations)).toBe(false);
    expect(mockState.inserted.some((item) => item.table === financialPayments)).toBe(true);
    expect(response.body.receipt.snapshot).toMatchObject({
      totalDue: 50000,
      paidBeforePayment: 10000,
      remainingAfterPayment: 10000,
    });
    expect(mockState.inserted.some((item) => item.table === financialReceipts)).toBe(true);
    expect(mockState.inserted.some((item) => item.table === financialReceipts && item.values.snapshot.totalDue === 100000)).toBe(false);
  });

  it('reuses the same-class obligation when an exact tariff is replaced by a range tariff', async () => {
    const historicalObligation = {
      id: 21,
      schoolId: 1,
      studentId: 10,
      academicYearId: 4,
      classId: 2,
      categoryId: 2,
      tariffId: 5,
      feeDefinitionId: null,
      enrollmentKind: null,
      label: 'Scolarité',
      amount: 50000,
      createdAt: new Date(),
    };
    prepareRangeTariffPayment([historicalObligation]);

    const response = await request(app).post('/api/accounting/payments').send({
      ...validPaymentBody(),
      allocations: [{ tariffId: 6, amount: 30000 }],
    });

    expect(response.status, JSON.stringify(response.body)).toBe(201);
    expect(mockState.inserted.some((item) => item.table === financialObligations)).toBe(false);
    expect(mockState.inserted.some((item) => item.table === financialInstallments)).toBe(false);
    expect(mockState.inserted.find((item) => item.table === financialPaymentAllocations)?.values).toEqual([
      { paymentId: 100, installmentId: 31, obligationId: 21, amount: 30000 },
    ]);
    expect(mockState.inserted.find((item) => item.table === financialReceipts)?.values.snapshot).toMatchObject({
      totalDue: 50000,
      paidBeforePayment: 10000,
      remainingAfterPayment: 10000,
    });
  });

  it('reuses a tuition obligation after the student changes class without changing its debt or receipt history', async () => {
    const historicalObligation = {
      id: 21,
      schoolId: 1,
      studentId: 10,
      academicYearId: 4,
      classId: 1,
      categoryId: 2,
      tariffId: 5,
      feeDefinitionId: null,
      enrollmentKind: null,
      label: 'Scolarité',
      amount: 50000,
      classNameSnapshot: '6e A',
      createdAt: new Date(),
    };
    prepareRangeTariffPayment([historicalObligation]);

    const response = await request(app).post('/api/accounting/payments').send({
      ...validPaymentBody(),
      allocations: [{ tariffId: 6, amount: 30000 }],
    });

    expect(response.status, JSON.stringify(response.body)).toBe(201);
    expect(mockState.inserted.some((item) => item.table === financialObligations)).toBe(false);
    expect(mockState.inserted.some((item) => item.table === financialInstallments)).toBe(false);
    expect(mockState.updated).toHaveLength(0);
    expect(mockState.deleted).toHaveLength(0);
    expect(mockState.inserted.find((item) => item.table === financialPaymentAllocations)?.values)
      .toEqual([{ paymentId: 100, installmentId: 31, obligationId: 21, amount: 30000 }]);
    expect(mockState.inserted.find((item) => item.table === financialReceipts)?.values.snapshot).toMatchObject({
      totalDue: 50000,
      paidBeforePayment: 10000,
      remainingAfterPayment: 10000,
    });
  });

  it('returns the historical obligation from explicit creation after a class and tariff scope change', async () => {
    mockState.actor = { ...mockState.actor, role: 'school_admin', schoolId: 1, academicYearId: 4 };
    const historicalObligation = {
      id: 21,
      schoolId: 1,
      studentId: 10,
      academicYearId: 4,
      classId: 1,
      categoryId: 2,
      tariffId: 5,
      feeDefinitionId: null,
      enrollmentKind: null,
      label: 'Scolarité',
      amount: 50000,
      classNameSnapshot: '6e A',
      status: 'active',
    };
    const rangeTariff = {
      id: 6, schoolId: 1, academicYearId: 4, classId: null,
      classFromId: 1, classToId: 3, categoryId: 2, label: 'Scolarité par plage',
      amount: 100000, isEnabled: true,
    };
    const exactTariff = {
      id: 5, schoolId: 1, academicYearId: 4, classId: 2,
      classFromId: null, classToId: null, categoryId: 2, label: 'Scolarité exacte',
      amount: 80000, isEnabled: true,
    };
    const classRow = { id: 2, schoolId: 1, academicYearId: 4, name: '6e' };
    const classOrders = [
      { classId: 1, className: '6e A', academicYearId: 4, levelOrder: 2 },
      { classId: 2, className: '6e B', academicYearId: 4, levelOrder: 2 },
      { classId: 3, className: '6e C', academicYearId: 4, levelOrder: 2 },
    ];
    setSelectResults(students, [{
      id: 10, firstName: 'Afi', lastName: 'Doe', classId: 2, schoolId: 1, isActive: true,
    }]);
    setSelectResults(classes, [classRow], classOrders, [classRow]);
    setSelectResults(academicYears, [{ id: 4, schoolId: 1 }], [{ id: 4, schoolId: 1 }]);
    setSelectResults(accountingTariffs, [rangeTariff, exactTariff]);
    setSelectResults(accountingCategories, [{
      id: 2, schoolId: 1, code: 'tuition', label: 'Scolarité', isEnabled: true,
    }]);
    setSelectResults(financialObligations, [historicalObligation]);

    const response = await request(app).post('/api/accounting/obligations').send({
      schoolId: 1,
      studentId: 10,
      academicYearId: 4,
      tariffId: 6,
    });

    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body).toMatchObject({ id: 21, tariffId: 5, classId: 1, classNameSnapshot: '6e A', amount: 50000 });
    expect(mockState.inserted.some((item) => item.table === financialObligations)).toBe(false);
    expect(mockState.inserted.some((item) => item.table === financialInstallments)).toBe(false);
    expect(mockState.whereConditions.some((item) => item.table === accountingScheduleTemplates)).toBe(false);
  });

  it('creates a reduced first tuition obligation and audits both amounts and the justification', async () => {
    prepareExplicitTuitionCreation();

    const response = await request(app).post('/api/accounting/obligations').send({
      schoolId: 1,
      studentId: 10,
      academicYearId: 4,
      tariffId: 5,
      initialTuitionAmount: 60000,
      initialTuitionJustification: 'Arrivée en cours d’année',
    });

    expect(response.status, JSON.stringify(response.body)).toBe(201);
    expect(response.body).toMatchObject({ id: 21, tariffId: 5, amount: 60000 });
    expect(mockState.inserted.find((item) => item.table === financialObligations)?.values)
      .toMatchObject({ tariffId: 5, amount: 60000 });
    expect(mockState.inserted.find((item) => item.table === financialInstallments)?.values)
      .toEqual([expect.objectContaining({ obligationId: 21, amount: 60000 })]);
    const audit = mockState.inserted.find((item) => item.table === auditEvents)?.values;
    expect(audit).toMatchObject({
      action: 'create',
      resourceType: 'financial_obligation',
      resourceId: 21,
      schoolId: 1,
    });
    expect(audit.description).toContain('referenceAmount=120000 XOF');
    expect(audit.description).toContain('amount=60000 XOF');
    expect(audit.description).toContain('Arrivée en cours d’année');
    expect(mockState.inserted.some((item) => item.table === accountingCategories)).toBe(false);
  });

  it('requires a justification before creating reduced tuition', async () => {
    prepareExplicitTuitionCreation();

    const response = await request(app).post('/api/accounting/obligations').send({
      schoolId: 1,
      studentId: 10,
      academicYearId: 4,
      tariffId: 5,
      initialTuitionAmount: 60000,
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/justification/i);
    expect(mockState.inserted.some((item) => item.table === financialObligations)).toBe(false);
    expect(mockState.inserted.some((item) => item.table === auditEvents)).toBe(false);
  });

  it('does not individualize tuition when an obligation already exists for a previous class', async () => {
    prepareExplicitTuitionCreation([{
      id: 19, classId: 1, categoryId: 2, tariffId: 4, status: 'active',
    }]);

    const response = await request(app).post('/api/accounting/obligations').send({
      schoolId: 1,
      studentId: 10,
      academicYearId: 4,
      tariffId: 5,
      initialTuitionAmount: 60000,
      initialTuitionJustification: 'Arrivée en cours d’année',
    });

    expect(response.status).toBe(409);
    expect(response.body.error).toMatch(/before any tuition obligation/i);
    expect(mockState.inserted.some((item) => item.table === financialObligations)).toBe(false);
    expect(mockState.inserted.some((item) => item.table === financialInstallments)).toBe(false);
  });

  it('rejects an ambiguous set of same-scope tariff obligations without writing', async () => {
    prepareRangeTariffPayment([
      {
        id: 21, schoolId: 1, studentId: 10, academicYearId: 4, classId: 2, categoryId: 2,
        tariffId: 5, feeDefinitionId: null, enrollmentKind: null, label: 'Scolarité', amount: 50000,
        createdAt: new Date(),
      },
      {
        id: 22, schoolId: 1, studentId: 10, academicYearId: 4, classId: 2, categoryId: 2,
        tariffId: 4, feeDefinitionId: null, enrollmentKind: null, label: 'Scolarité', amount: 40000,
        createdAt: new Date(),
      },
    ]);

    const response = await request(app).post('/api/accounting/payments').send({
      ...validPaymentBody(),
      allocations: [{ tariffId: 6, amount: 10000 }],
    });

    expect(response.status).toBe(409);
    expect(response.body.error).toMatch(/ambiguously/i);
    expect(mockState.inserted.some((item) => [
      financialObligations,
      financialInstallments,
      financialPayments,
      financialPaymentAllocations,
      financialReceipts,
    ].includes(item.table))).toBe(false);
  });

  it('keeps a fee-definition obligation distinct from a tariff obligation in the same category', async () => {
    prepareValidPayment();
    const tariff = {
      id: 6, schoolId: 1, academicYearId: 4, classId: 2, categoryId: 3,
      label: 'Cantine annuelle', amount: 30000, isEnabled: true,
    };
    const customFeeObligation = {
      id: 70, schoolId: 1, studentId: 10, academicYearId: 4, classId: 2,
      categoryId: 3, tariffId: null, feeDefinitionId: 90, enrollmentKind: null,
      label: 'Cantine exceptionnelle', amount: 5000, status: 'active', createdAt: new Date(),
    };
    const createdTariffObligation = {
      id: 100, schoolId: 1, studentId: 10, academicYearId: 4, classId: 2,
      categoryId: 3, tariffId: 6, feeDefinitionId: null, enrollmentKind: null,
      label: tariff.label, amount: tariff.amount, status: 'active', createdAt: new Date(),
    };
    setSelectResults(financialPayments, []);
    setSelectResults(accountingTariffs, [tariff], [tariff]);
    setSelectResults(accountingCategories, [{
      id: 3, schoolId: 1, code: 'canteen', label: 'Cantine', isEnabled: true,
    }]);
    setSelectResults(financialObligations,
      [customFeeObligation],
      [],
      [customFeeObligation, createdTariffObligation]);
    setSelectResults(financialInstallments, [
      { id: 81, obligationId: 100, label: tariff.label, orderIndex: 1, amount: 30000, dueDate: '2026-10-07' },
    ]);
    setSelectResults(financialPaymentAllocations, [], [{
      categoryId: 3,
      category: 'Cantine',
      label: tariff.label,
      tariffLabel: tariff.label,
      amount: 10000,
      installmentLabel: tariff.label,
      dueDate: '2026-10-07',
    }]);
    setInsertResults(financialPayments, [{
      id: 100,
      ...validPaymentBody(),
      amount: 10000,
      currency: 'XOF',
      reference: null,
      requestFingerprint: 'fee-definition-and-tariff',
      paidAt: new Date('2026-10-07T12:00:00.000Z'),
      status: 'posted',
    }]);
    setInsertResults(financialReceipts, [{
      id: 55, paymentId: 100, receiptNumber: 'REC-2026-000015',
      snapshot: { totalDue: 30000, paidBeforePayment: 0, remainingAfterPayment: 20000 },
    }]);
    setSelectResults(schools, [{ id: 1 }], [{ id: 1, name: 'École', officialName: null, logoPath: null }]);

    const response = await request(app).post('/api/accounting/payments').send({
      ...validPaymentBody(),
      allocations: [{ tariffId: 6, amount: 10000 }],
    });

    expect(response.status, JSON.stringify(response.body)).toBe(201);
    expect(mockState.inserted.find((item) => item.table === financialObligations)?.values).toMatchObject({
      tariffId: 6,
      feeDefinitionId: null,
      amount: 30000,
    });
    expect(mockState.inserted.find((item) => item.table === financialPaymentAllocations)?.values)
      .toEqual([{ paymentId: 100, installmentId: 81, obligationId: 100, amount: 10000 }]);
    expect(mockState.updated).toHaveLength(0);
    expect(mockState.deleted).toHaveLength(0);
  });

  it('rejects a payment greater than the remaining balance without inserting it', async () => {
    prepareValidPayment();
    setSelectResults(financialPayments, []);
    setSelectResults(financialObligations, [{
      id: 21, categoryId: 2, label: 'Frais annuels', amount: 10000, createdAt: new Date(),
    }]);
    setSelectResults(financialInstallments, [
      { id: 31, obligationId: 21, label: 'T1', orderIndex: 1, amount: 10000, dueDate: '2026-10-01' },
    ]);
    setSelectResults(financialPaymentAllocations, []);

    const response = await request(app).post('/api/accounting/payments').send({
      ...validPaymentBody(),
      amount: 10001,
    });

    expect(response.status).toBe(409);
    expect(mockState.inserted.some((item) => item.table === financialPayments)).toBe(false);
  });

  it('returns an existing payment for the same idempotency payload and rejects key reuse', async () => {
    prepareValidPayment();
    const body = validPaymentBody();
    const fingerprint = JSON.stringify([10, 4, 10000, 'cash', null, null, null, null]);
    setSelectResults(financialPayments, [{
      id: 70,
      schoolId: 1,
      studentId: 10,
      academicYearId: 4,
      amount: 10000,
      method: 'cash',
      reference: null,
      requestFingerprint: fingerprint,
      paidAt: new Date(),
    }]);
    setSelectResults(financialReceipts, [{ id: 50, paymentId: 70, receiptNumber: 'REC-2026-000050' }]);
    setSelectResults(notifications, [{ id: 501, userId: 25 }]);
    setSelectResults(notificationAttachments, [{ id: 70, notificationId: 501, fileName: 'REC-2026-000050.pdf' }]);
    const retry = await request(app).post('/api/accounting/payments').send(body);
    expect(retry.status).toBe(200);
    expect(retry.body.duplicate).toBe(true);
    expect(dispatchPaymentNotification).not.toHaveBeenCalled();
    expect(mockState.inserted.some((item) => item.table === financialPayments)).toBe(false);
    expect(mockState.inserted.some((item) => item.table === financialReceipts)).toBe(false);
    expect(mockState.inserted.some((item) => item.table === notifications)).toBe(false);
    expect(mockState.inserted.some((item) => item.table === notificationAttachments)).toBe(false);
    expect(fileStorageMock.persistUploadedFile).not.toHaveBeenCalled();

    prepareValidPayment();
    setSelectResults(financialPayments, [{
      id: 70,
      schoolId: 1,
      studentId: 10,
      academicYearId: 4,
      amount: 10000,
      method: 'cash',
      reference: null,
      requestFingerprint: fingerprint,
      paidAt: new Date(),
    }]);
    const mismatched = await request(app).post('/api/accounting/payments').send({ ...body, amount: 9000 });
    expect(mismatched.status).toBe(409);
  });

  it('does not write notifications while reading the dashboard', async () => {
    prepareDashboardRows();
    const response = await request(app).get('/api/accounting/dashboard?schoolId=1');
    expect(response.status).toBe(200);
    expect(mockState.inserted.some((item) => item.table === notifications)).toBe(false);
  });

  it('returns obligation totals and keeps net cash categories on the selected dashboard year', async () => {
    prepareDashboardTotals();

    const response = await request(app).get('/api/accounting/dashboard?schoolId=1&academicYearId=4');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      total: 9000,
      categories: { tuition: 9000 },
      expected: 30000,
      paid: 9000,
      remaining: 21000,
      studentCount: 1,
      recentPaymentCount: 1,
    });
    const obligationScopes = mockState.whereConditions
      .filter(({ table }) => table === financialObligations)
      .map(({ condition }) => new PgDialect().sqlToQuery(condition).params);
    expect(obligationScopes.some((params) => params.includes(4))).toBe(true);
  });

  it('uses the constituted individualized tuition amount for the dashboard expected total', async () => {
    prepareDashboardTotals(60000);

    const response = await request(app).get('/api/accounting/dashboard?schoolId=1&academicYearId=4');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      expected: 60000,
      paid: 9000,
      remaining: 51000,
    });
  });

  it('lists server-calculated reminder candidates grouped by student within the school and year', async () => {
    prepareReminderCandidateQueries();

    const response = await request(app)
      .get('/api/accounting/reminders/candidates?schoolId=1&academicYearId=4&status=overdue');

    expect(response.status).toBe(200);
    expect(response.body.deliveryChannel).toBe('in_app');
    expect(response.body.reminderPreferencesAvailable).toBe(false);
    expect(response.body.candidates).toHaveLength(1);
    expect(response.body.candidates[0]).toMatchObject({
      studentId: 10,
      firstName: 'Afi',
      lastName: 'Doe',
      totalRemaining: 13000,
      installments: [
        { id: 41, paid: 2000, remaining: 8000, status: 'overdue' },
        { id: 42, paid: 0, remaining: 5000, status: 'overdue' },
      ],
      canSend: true,
    });
    expect(dispatchPaymentNotification).not.toHaveBeenCalled();
  });

  it('allows a super administrator to use an explicitly selected school', async () => {
    prepareReminderCandidateQueries();
    mockState.actor = { ...mockState.actor, role: 'super_admin', schoolId: null };

    const response = await request(app)
      .get('/api/accounting/reminders/candidates?schoolId=1&academicYearId=4&status=overdue');

    expect(response.status).toBe(200);
    expect(response.body.candidates[0].studentId).toBe(10);
  });

  it('marks an existing reminder for the same student and installment set as non-sendable', async () => {
    prepareReminderCandidateQueries();
    const dedupeKey = getAccountingReminderDedupeKey({
      schoolId: 1,
      academicYearId: 4,
      studentId: 10,
      installmentIds: [41, 42],
    });
    setSelectResults(notifications, [{ dedupeKey }]);

    const response = await request(app)
      .get('/api/accounting/reminders/candidates?schoolId=1&academicYearId=4&status=overdue');

    expect(response.status).toBe(200);
    expect(response.body.candidates[0]).toMatchObject({
      alreadyNotified: true,
      canSend: false,
    });
  });

  it('previews selected students and creates one internal notification only after a fresh confirmation', async () => {
    prepareReminderCandidateQueries(true);
    const preview = await request(app).post('/api/accounting/reminders/preview').send({
      schoolId: 1,
      academicYearId: 4,
      status: 'overdue',
      studentIds: [10],
    });

    expect(preview.status).toBe(200);
    expect(preview.body.previewFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(preview.body.candidates).toHaveLength(1);
    expect(preview.body.candidates[0].message).toContain('Total restant pour les échéances rappelées : 13 000 FCFA.');
    expect(mockState.inserted.filter((item) => item.table === notifications)).toHaveLength(0);

    mockState.selectResults.clear();
    prepareReminderCandidateQueries(true);
    setSelectResults(financialObligations, [{ id: 31 }], [reminderObligation]);
    setSelectResults(financialPaymentAllocations, [{ id: 51 }], [reminderAllocation]);
    setSelectResults(financialPayments, []);
    const confirmation = await request(app).post('/api/accounting/reminders/confirm').send({
      schoolId: 1,
      academicYearId: 4,
      status: 'overdue',
      studentIds: [10],
      previewFingerprint: preview.body.previewFingerprint,
    });

    expect(confirmation.status).toBe(200);
    expect(confirmation.body).toMatchObject({
      selectedStudentCount: 1,
      createdNotifications: 1,
      deliveryChannel: 'in_app',
    });
    const sent = mockState.inserted.filter((item) => item.table === notifications);
    expect(sent).toHaveLength(1);
    expect(sent[0].values).toMatchObject({
      userId: 25,
      title: 'Rappel de paiement',
      type: 'info',
    });
    expect(sent[0].values.body).toContain('Afi Doe');
    expect(dispatchPaymentNotification).not.toHaveBeenCalled();
  });

  it('rejects a stale reminder preview without creating notifications', async () => {
    prepareReminderCandidateQueries(true);
    const preview = await request(app).post('/api/accounting/reminders/preview').send({
      schoolId: 1,
      academicYearId: 4,
      status: 'overdue',
      studentIds: [10],
    });
    mockState.selectResults.clear();
    prepareReminderCandidateQueries(true);
    setSelectResults(financialObligations, [{ id: 31 }], [{
      ...reminderObligation,
      tariffLabel: 'Changed fee label',
    }]);
    setSelectResults(financialPaymentAllocations, [{ id: 51 }], [reminderAllocation]);
    setSelectResults(financialPayments, []);

    const confirmation = await request(app).post('/api/accounting/reminders/confirm').send({
      schoolId: 1,
      academicYearId: 4,
      status: 'overdue',
      studentIds: [10],
      previewFingerprint: preview.body.previewFingerprint,
    });

    expect(confirmation.status).toBe(409);
    expect(confirmation.body.code).toBe('ACCOUNTING_REMINDER_PREVIEW_STALE');
    expect(mockState.inserted.filter((item) => item.table === notifications)).toHaveLength(0);
  });

  it('keeps school administrators within their assigned school for reminder requests', async () => {
    prepareReminderCandidateQueries();
    mockState.actor = { ...mockState.actor, role: 'school_admin', schoolId: 1 };

    const response = await request(app)
      .get('/api/accounting/reminders/candidates?schoolId=2&academicYearId=4');

    expect(response.status).toBe(200);
    const obligationScopes = mockState.whereConditions
      .filter(({ table }) => table === financialObligations)
      .map(({ condition }) => new PgDialect().sqlToQuery(condition).params);
    expect(obligationScopes.length).toBeGreaterThan(0);
    expect(obligationScopes.every((params) => params.includes(1) && !params.includes(2))).toBe(true);
  });

  it('rejects the legacy global reminder route without creating notifications', async () => {
    mockState.actor = { ...mockState.actor, role: 'school_admin', schoolId: 1 };
    const response = await request(app).post('/api/accounting/notifications/overdue').send({ schoolId: 1 });
    expect(response.status).toBe(410);
    expect(response.body.code).toBe('MANUAL_REMINDER_PREVIEW_REQUIRED');
    const sent = mockState.inserted.filter((item) => item.table === notifications);
    expect(sent).toHaveLength(0);
  });
});

const validPaymentBody = () => ({
  schoolId: 1,
  studentId: 10,
  academicYearId: 4,
  amount: 10000,
  method: 'cash',
  idempotencyKey: 'payment-attempt-1',
});

const prepareValidPayment = () => {
  setSelectResults(schools, [{ id: 1 }]);
  setSelectResults(students, [{
    id: 10, firstName: 'Afi', lastName: 'Doe', matricule: 'A10', classId: 2, schoolId: 1,
    isActive: true, className: '6e',
  }], []);
  setSelectResults(
    academicYears,
    [{ id: 4, schoolId: 1, name: '2026-2027' }],
    [{ id: 4, schoolId: 1, name: '2026-2027' }],
  );
  setSelectResults(classes, [{ id: 2, schoolId: 1, academicYearId: 4, name: '6e' }]);
  setInsertResults(financialPayments, [{
    id: 100,
    ...validPaymentBody(),
    currency: 'XOF',
    reference: null,
    requestFingerprint: JSON.stringify([10, 4, 10000, 'cash', null, null, null, null]),
    paidAt: new Date('2026-10-07T12:00:00.000Z'),
    status: 'posted',
  }]);
  setInsertResults(financialReceipts, [{
    id: 55,
    paymentId: 100,
    receiptNumber: 'REC-2026-000015',
    snapshot: {
      school: { name: 'École' },
      student: { firstName: 'Afi', lastName: 'Doe' },
      allocations: [{ category: 'Scolarité', label: 'Frais annuels', amount: 10000 }],
      paidBeforePayment: 0,
      totalDue: 30000,
      remainingAfterPayment: 20000,
    },
  }]);
};

const prepareRangeTariffPayment = (
  activeObligations: Array<Record<string, any>>,
  exactTariff?: Record<string, any>,
) => {
  prepareValidPayment();
  const rangeTariff = {
    id: 6,
    schoolId: 1,
    academicYearId: 4,
    classId: null,
    classFromId: 1,
    classToId: 3,
    categoryId: 2,
    label: 'Scolarité par plage',
    amount: 100000,
    isEnabled: true,
  };
  const classOrders = [
    { classId: 1, className: '6e A', academicYearId: 4, levelOrder: 2 },
    { classId: 2, className: '6e B', academicYearId: 4, levelOrder: 2 },
    { classId: 3, className: '6e C', academicYearId: 4, levelOrder: 2 },
  ];
  setSelectResults(schools, [{ id: 1 }], [{ id: 1, name: 'École', officialName: null, logoPath: null }]);
  setSelectResults(financialPayments, []);
  const configuredTariffs = exactTariff ? [rangeTariff, exactTariff] : [rangeTariff];
  setSelectResults(accountingTariffs, configuredTariffs, configuredTariffs);
  setSelectResults(accountingCategories, [{
    id: 2, schoolId: 1, code: 'tuition', label: 'Scolarité', isEnabled: true,
  }]);
  setSelectResults(
    financialObligations,
    activeObligations.map(({ id, classId, tariffId, feeDefinitionId, enrollmentKind }) => ({
      id, classId, tariffId, feeDefinitionId, enrollmentKind,
    })),
    activeObligations,
  );
  setSelectResults(classes,
    [{ id: 2, schoolId: 1, academicYearId: 4, name: '6e' }],
    classOrders,
    classOrders);
  setSelectResults(financialInstallments, [{
    id: 31,
    obligationId: activeObligations[0]?.id,
    label: 'Paiement annuel',
    orderIndex: 1,
    amount: activeObligations[0]?.amount ?? 0,
    dueDate: '2026-10-01',
  }]);
  setSelectResults(financialPaymentAllocations,
    [{ id: 50, obligationId: activeObligations[0]?.id, installmentId: 31, amount: 10000 }],
    [{
      categoryId: 2,
      category: 'Scolarité',
      label: 'Scolarité',
      tariffLabel: 'Scolarité',
      amount: 30000,
      installmentLabel: 'Paiement annuel',
      dueDate: '2026-10-01',
    }]);
  setInsertResults(financialPayments, [{
    id: 100,
    ...validPaymentBody(),
    amount: 30000,
    currency: 'XOF',
    reference: null,
    requestFingerprint: 'range-tariff-payment',
    paidAt: new Date('2026-10-07T12:00:00.000Z'),
    status: 'posted',
  }]);
  setInsertResults(financialReceipts, [{
    id: 55,
    paymentId: 100,
    receiptNumber: 'REC-2026-000015',
    snapshot: { totalDue: 50000, paidBeforePayment: 10000, remainingAfterPayment: 10000 },
  }]);
};

const prepareExplicitTuitionCreation = (priorObligations: Array<Record<string, any>> = []) => {
  mockState.actor = { ...mockState.actor, role: 'school_admin', schoolId: 1, academicYearId: 4 };
  const classRow = { id: 2, schoolId: 1, academicYearId: 4, name: '6e' };
  const tariff = {
    id: 5, schoolId: 1, academicYearId: 4, classId: 2, classFromId: null, classToId: null,
    categoryId: 2, label: 'Scolarité annuelle', amount: 120000, isEnabled: true,
  };
  setSelectResults(students, [{
    id: 10, firstName: 'Afi', lastName: 'Doe', classId: 2, schoolId: 1, isActive: true,
  }]);
  setSelectResults(classes, [classRow], [classRow]);
  setSelectResults(academicYears, [{ id: 4, schoolId: 1 }], [{ id: 4, schoolId: 1 }]);
  setSelectResults(accountingTariffs, [tariff]);
  setSelectResults(accountingCategories, [{
    id: 2, schoolId: 1, code: 'tuition', label: 'Frais de scolarité', isEnabled: true,
  }]);
  setSelectResults(financialObligations, priorObligations, [], []);
  setSelectResults(accountingScheduleTemplates, [{
    installments: [{ label: 'Annuel', dueDate: '2026-10-01', basisPoints: 10000 }],
  }]);
  setInsertResults(financialObligations, [{
    id: 21,
    schoolId: 1,
    studentId: 10,
    academicYearId: 4,
    classId: 2,
    categoryId: 2,
    tariffId: 5,
    feeDefinitionId: null,
    label: tariff.label,
    amount: 60000,
    currency: 'XOF',
    classNameSnapshot: '6e',
    enrollmentKind: null,
    sourceKey: 'tariff-5-student-10',
    status: 'active',
  }]);
};

const preparePaymentNotificationScenario = () => {
  prepareValidPayment();
  setSelectResults(financialPayments, []);
  const obligations = [
    { id: 21, categoryId: 2, tariffId: 5, label: 'Scolarité', amount: 30000, createdAt: new Date() },
    { id: 22, categoryId: 3, tariffId: 6, label: 'Cantine', amount: 15000, createdAt: new Date() },
  ];
  const installments = [
    { id: 31, obligationId: 21, label: 'T1', orderIndex: 1, amount: 10000, dueDate: '2026-10-01' },
    { id: 32, obligationId: 21, label: 'T2', orderIndex: 2, amount: 20000, dueDate: '2027-01-01' },
    { id: 33, obligationId: 22, label: 'Cantine', orderIndex: 1, amount: 15000, dueDate: '2026-10-01' },
  ];
  setSelectResults(financialObligations, [obligations[0]], obligations);
  setSelectResults(financialInstallments, installments, installments);
  setSelectResults(financialPaymentAllocations, [], [{
    categoryId: 2,
    category: 'Scolarité',
    label: 'Scolarité',
    tariffLabel: 'Frais de scolarité',
    amount: 10000,
    installmentLabel: 'T1',
    dueDate: '2026-10-01',
  }], [{ id: 70, obligationId: 21, installmentId: 31, amount: 10000 }]);
  setSelectResults(financialReceipts, [{ id: 55, paymentId: 100, receiptNumber: 'REC-2026-000015', snapshot: {} }]);
  setSelectResults(schools, [{ id: 1 }], [{ id: 1, name: 'École', officialName: null, logoPath: null }]);
  setSelectResults(students, [{
    id: 10, firstName: 'Afi', lastName: 'Doe', matricule: 'A10', classId: 2, schoolId: 1,
    isActive: true, className: '6e',
  }], [{ userId: 25 }]);
  setSelectResults(academicYears, [{ id: 4, schoolId: 1, name: '2026-2027' }], [{ id: 4, schoolId: 1, name: '2026-2027' }]);
  setSelectResults(classes, [{ id: 2, schoolId: 1, academicYearId: 4, name: '6e' }]);
  setSelectResults(notifications, [{ id: 501, userId: 25 }]);
  setSelectResults(notificationAttachments, []);
};

const prepareDashboardRows = () => {
  setSelectResults(schools, [{ id: 1 }]);
  setSelectResults(financialObligations,
    [{ id: 21, studentId: 10, amount: 30000 }],
    [{ id: 21, studentId: 10 }],
  );
  setSelectResults(financialPayments, []);
  setSelectResults(financialPaymentAllocations, [], []);
  setSelectResults(financialInstallments, [
    { id: 31, obligationId: 21, amount: 10000, dueDate: '2026-10-01' },
    { id: 32, obligationId: 21, amount: 20000, dueDate: '2027-01-01' },
  ]);
};

const prepareDashboardTotals = (obligationAmount = 30000) => {
  setSelectResults(schools, [{ id: 1 }]);
  setSelectResults(financialObligations,
    [{ id: 21, studentId: 10, amount: obligationAmount }],
    [{ id: 21, amount: obligationAmount }],
    [{ id: 21, studentId: 10 }],
  );
  setSelectResults(financialPayments, [{
    id: 99,
    amount: 16000,
    method: 'cash',
    paidAt: new Date('2026-10-10T12:00:00.000Z'),
  }]);
  setSelectResults(financialPaymentAllocations,
    [{
      allocationId: 100,
      amount: 16000,
      categoryCode: 'tuition',
      categoryLabel: 'Frais de scolarité',
    }],
    [{ id: 100, obligationId: 21, amount: 16000 }],
    [{ id: 100, installmentId: 31, amount: 16000 }],
  );
  setSelectResults(financialAdjustmentAllocations,
    [{ paymentAllocationId: 100, amount: 7000 }],
    [{ paymentAllocationId: 100, amount: 7000 }],
    [{ paymentAllocationId: 100, amount: 7000 }],
  );
  setSelectResults(financialInstallments, [{
    id: 31,
    obligationId: 21,
    amount: obligationAmount,
    dueDate: '2027-01-01',
  }]);
};
