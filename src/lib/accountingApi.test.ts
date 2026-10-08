import express from 'express';
import request from 'supertest';
import { PgDialect } from 'drizzle-orm/pg-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  accountingCategories,
  accountingFeeDefinitions,
  accountingTariffs,
  academicYears,
  classes,
  financialInstallments,
  financialObligations,
  financialPaymentAllocations,
  financialPayments,
  financialReceipts,
  notifications,
  schools,
  students,
} from '../db/schema.ts';

const dbMock = vi.hoisted(() => ({
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  execute: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock('../db/index.ts', () => ({ db: dbMock }));

import { formatAccountingReceiptAllocationLine, registerAccountingRoutes } from './accountingApi.ts';

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
mockDb.transaction.mockImplementation((callback: (tx: any) => unknown) => callback(mockDb));

describe('accounting API', () => {
  let app: express.Express;

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
    mockState.actor = { id: 7, role: 'super_admin', schoolId: null, academicYearId: null, email: 'admin@example.com', name: 'Admin' };
    app = express();
    app.use(express.json());
    registerAccountingRoutes(app, {
      resolveActor: async () => mockState.actor,
      isApprovedClassForSchool: async (classId, schoolId) => mockState.approvedClasses.has(`${schoolId}:${classId}`),
    });
  });

  it('rejects roles outside the existing administrative roles', async () => {
    mockState.actor = { ...mockState.actor, role: 'teacher' };
    const response = await request(app).get('/api/accounting/categories?schoolId=3');
    expect(response.status).toBe(403);
    expect(mockDb.select).not.toHaveBeenCalled();
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

  it('creates a custom tariff category instead of reusing the reserved enrollment category by label', async () => {
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
    setInsertResults(accountingCategories, [{
      id: 6,
      schoolId: 1,
      code: 'custom:frais d’inscription',
      label: 'Frais d’inscription',
      isEnabled: true,
    }]);
    setSelectResults(accountingTariffs, []);

    const response = await request(app).post('/api/accounting/tariffs').send({
      schoolId: 1,
      academicYearId: 4,
      classId: 2,
      label: 'Frais d’inscription',
      amount: 25000,
    });

    expect(response.status, JSON.stringify(response.body)).toBe(201);
    expect(mockState.inserted.find((item) => item.table === accountingCategories)?.values).toMatchObject({
      schoolId: 1,
      code: 'custom:frais d’inscription',
      label: 'Frais d’inscription',
      isEnabled: true,
    });
    expect(mockState.inserted.find((item) => item.table === accountingTariffs)?.values).toMatchObject({
      schoolId: 1,
      academicYearId: 4,
      classId: 2,
      categoryId: 6,
      label: 'Frais d’inscription',
      amount: 25000,
    });
    expect(response.body).toMatchObject({
      academicYearId: 4,
      classId: 2,
      categoryId: 6,
      label: 'Frais d’inscription',
      amount: 25000,
    });
  });

  it('stores a pedagogical class range as one tariff configuration', async () => {
    mockState.actor = { ...mockState.actor, role: 'school_admin', schoolId: 1 };
    setSelectResults(classes,
      [{ id: 6, schoolId: 1, academicYearId: 4, name: '6ème' }],
      [{ id: 3, schoolId: 1, academicYearId: 4, name: '3ème' }],
      [
        { classId: 6, orderIndex: 1 },
        { classId: 3, orderIndex: 4 },
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

  it('reports the exact tariff and scope when a configured enrollment-category tariff is rejected', async () => {
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
    const diagnostic = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const response = await request(app).post('/api/accounting/payments').send({
      ...validPaymentBody(),
      allocations: [{ tariffId: enrollmentTariff.id, amount: 12000 }],
    });

    expect(response.status).toBe(409);
    expect(diagnostic).toHaveBeenCalledWith('Rejected enrollment category during tariff payment', {
      tariffId: 88,
      categoryId: 5,
      categoryCode: 'enrollment',
      academicYearId: 4,
      classId: 2,
      studentId: 10,
      enrollmentId: null,
      configuredAmount: 25000,
      tariffFound: true,
    });
    const tariffWhere = mockState.whereConditions
      .filter((item) => item.table === accountingTariffs)[1]?.condition;
    const tariffQuery = new PgDialect().sqlToQuery(tariffWhere);
    expect(tariffQuery.params).toContain(enrollmentTariff.id);
    expect(tariffQuery.params).toContain(enrollmentTariff.categoryId);
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

  it('renders a receipt PDF from its stored snapshot', async () => {
    setSelectResults(financialReceipts, [{
      id: 5,
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

    const response = await request(app).get('/api/accounting/receipts/5');
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('application/pdf');
    expect(Buffer.from(response.body).subarray(0, 4).toString()).toBe('%PDF');
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
      due: 150000,
      paid: 0,
      remaining: 150000,
      status: 'unpaid',
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
    expect(query.sql).toContain('student_obligations.tariff_obligation_amount');
    expect(query.sql).toContain('COALESCE(tariff.amount');
    expect(query.sql).toContain('COALESCE(tariff.label, category.label)');
    expect(query.sql).toContain('configured_tariff.class_id = student.class_id');
    expect(query.sql).toContain('student_level.order_index BETWEEN range_start_level.order_index AND range_end_level.order_index');
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

  it('filters by the global student balance across categories and caps paid amounts per category', async () => {
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
      expect.objectContaining({ studentId: 12, studentDue: 150, studentPaid: 50, studentRemaining: 100, studentStatus: 'partial' }),
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
      }),
    ]));
    const query = new PgDialect().sqlToQuery(mockState.executedSql[0]);
    expect(query.sql).toContain('school_class.status = \'approved\'');
    expect(query.params).toContain(53);
  });

  it('returns category detail rows for a class PDF while retaining global student totals', async () => {
    mockState.actor = { ...mockState.actor, role: 'school_admin', schoolId: 2, academicYearId: 2 };
    mockState.approvedClasses.add('2:53');
    setSelectResults(academicYears, [{ id: 2, schoolId: null }], [{ id: 2, schoolId: null }]);
    setSelectResults(classes, [{ id: 53, schoolId: null, academicYearId: 2, name: '5ème' }]);
    mockDb.execute.mockImplementationOnce((statement: any) => {
      mockState.executedSql.push(statement);
      return Promise.resolve({ rows: [
        { studentId: 10, firstName: 'Kossi', lastName: 'Afi', classId: 53, className: '5ème', categoryId: 1, categoryCode: 'tuition', categoryLabel: 'Scolarité', due: 100000, paid: 100000 },
        { studentId: 10, firstName: 'Kossi', lastName: 'Afi', classId: 53, className: '5ème', categoryId: 2, categoryCode: 'enrollment', categoryLabel: 'Inscription', due: 10000, paid: 0 },
        { studentId: 10, firstName: 'Kossi', lastName: 'Afi', classId: 53, className: '5ème', categoryId: 3, categoryCode: 'canteen', categoryLabel: 'Cantine', due: 20000, paid: 10000 },
      ] });
    });

    const response = await request(app)
      .get('/api/accounting/situation?academicYearId=2&classId=53&includeAllCategories=true&status=partial&includeInactive=true');

    expect(response.status, response.body.error).toBe(200);
    expect(response.body.rows).toHaveLength(3);
    expect(response.body.rows.map((row: any) => row.categoryLabel)).toEqual(['Scolarité', 'Inscription', 'Cantine']);
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
    prepareValidPayment();
    setSelectResults(
      financialPayments,
      [],
    );
    setSelectResults(financialObligations, [{
      id: 21, categoryId: 2, tariffId: 5, label: 'Scolarité', amount: 30000, createdAt: new Date(),
    }]);
    setSelectResults(financialInstallments, [
      { id: 31, obligationId: 21, label: 'T1', orderIndex: 1, amount: 10000, dueDate: '2026-10-01' },
      { id: 32, obligationId: 21, label: 'T2', orderIndex: 2, amount: 20000, dueDate: '2027-01-01' },
    ]);
    setSelectResults(
      financialPaymentAllocations,
      [],
      [{
        category: 'Scolarité',
        label: 'Scolarité',
        tariffLabel: 'Frais de scolarité',
        amount: 10000,
        installmentLabel: 'T1',
        dueDate: '2026-10-01',
      }],
    );
    setSelectResults(financialReceipts, [{ id: 55, paymentId: 100, receiptNumber: 'REC-2026-000015', snapshot: {} }]);
    setSelectResults(
      schools,
      [{ id: 1 }],
      [{ id: 1, name: 'École', officialName: null, logoPath: null }],
    );
    setSelectResults(students, [{
      id: 10, firstName: 'Afi', lastName: 'Doe', matricule: 'A10', classId: 2, schoolId: 1,
      isActive: true, className: '6e',
    }]);
    setSelectResults(
      academicYears,
      [{ id: 4, schoolId: 1, name: '2026-2027' }],
      [{ id: 4, schoolId: 1, name: '2026-2027' }],
    );
    setSelectResults(classes, [{ id: 2, schoolId: 1, academicYearId: 4, name: '6e' }]);

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
        { classId: 2, academicYearId: 4, orderIndex: 3 },
        { classId: 1, academicYearId: 4, orderIndex: 1 },
        { classId: 3, academicYearId: 4, orderIndex: 4 },
      ],
      [
        { classId: 2, academicYearId: 4, orderIndex: 3 },
        { classId: 1, academicYearId: 4, orderIndex: 1 },
        { classId: 3, academicYearId: 4, orderIndex: 4 },
      ]);
    setSelectResults(financialPayments, []);
    setSelectResults(
      accountingTariffs,
      [{
        id: 5, schoolId: 1, academicYearId: 4, classId: null,
        classFromId: 1, classToId: 3, categoryId: 2,
        label: 'Frais de scolarité', amount: 100000, isEnabled: true,
      }],
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
      [{ id: 21, tariffId: 5 }],
      [{ id: 22, tariffId: 6 }],
      [
        { id: 21, categoryId: 2, tariffId: 5, label: 'Frais de scolarité', amount: 100000, createdAt: new Date() },
        { id: 22, categoryId: 3, tariffId: 6, label: 'Cantine', amount: 30000, createdAt: new Date() },
      ]);
    setSelectResults(financialInstallments,
      [{ id: 31, obligationId: 21, label: 'Paiement annuel', orderIndex: 1, amount: 100000, dueDate: '2026-10-07' }],
      [{ id: 32, obligationId: 22, label: 'Cantine octobre', orderIndex: 1, amount: 30000, dueDate: '2026-10-07' }],
      [
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
  ])('creates a $label obligation from its configured class tariff', async ({
    label,
    code,
    categoryId,
    tariffId,
    categoryEnabled,
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
    });
    expect(mockState.inserted.find((item) => item.table === financialPaymentAllocations)?.values)
      .toEqual([{ paymentId: 100, installmentId: 81, obligationId: 100, amount: 10000 }]);
    const categoryCondition = mockState.whereConditions.find((item) =>
      item.table === accountingCategories)?.condition;
    expect(new PgDialect().sqlToQuery(categoryCondition).sql).not.toContain('is_enabled');
  });

  it('makes the increased current tariff payable without changing historical payments', async () => {
    prepareValidPayment();
    mockState.approvedClasses.add('1:2');
    setSelectResults(financialPayments, []);
    setSelectResults(
      financialObligations,
      [{ id: 21, tariffId: 5 }],
      [{ id: 21, categoryId: 2, tariffId: 5, label: 'Scolarité', amount: 50000, createdAt: new Date() }],
    );
    setSelectResults(accountingCategories, [{ id: 2, schoolId: 1, code: 'tuition', label: 'Scolarité', isEnabled: true }]);
    setSelectResults(
      accountingTariffs,
      [{ id: 5, schoolId: 1, academicYearId: 4, classId: 2, categoryId: 2, amount: 100000, isEnabled: true }],
      [{ id: 5, schoolId: 1, academicYearId: 4, classId: 2, categoryId: 2, amount: 100000, isEnabled: true }],
    );
    setSelectResults(
      financialInstallments,
      [{ id: 31, obligationId: 21, label: 'Paiement unique', orderIndex: 1, amount: 50000, dueDate: '2026-10-01' }],
      [
        { id: 31, obligationId: 21, label: 'Paiement unique', orderIndex: 1, amount: 50000, dueDate: '2026-10-01' },
        { id: 32, obligationId: 21, label: 'Complément du tarif actuel', orderIndex: 2, amount: 50000, dueDate: '2026-10-07' },
      ],
    );
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
      snapshot: { totalDue: 100000, paidBeforePayment: 10000, remainingAfterPayment: 60000 },
    }]);

    const response = await request(app).post('/api/accounting/payments').send({
      ...validPaymentBody(),
      amount: 30000,
      categoryId: 2,
    });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    expect(mockState.inserted.filter((item) => item.table === financialInstallments))
      .toContainEqual(expect.objectContaining({
        values: expect.objectContaining({ obligationId: 21, amount: 50000, label: 'Complément du tarif actuel' }),
      }));
    expect(mockState.inserted.some((item) => item.table === financialObligations)).toBe(false);
    expect(mockState.inserted.some((item) => item.table === financialPayments)).toBe(true);
    expect(response.body.receipt.snapshot).toMatchObject({
      totalDue: 100000,
      paidBeforePayment: 10000,
      remainingAfterPayment: 60000,
    });
    expect(mockState.inserted.some((item) => item.table === financialReceipts)).toBe(true);
    expect(mockState.inserted.some((item) => item.table === financialReceipts && item.values.snapshot.totalDue === 50000)).toBe(false);
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
    const retry = await request(app).post('/api/accounting/payments').send(body);
    expect(retry.status).toBe(200);
    expect(retry.body.duplicate).toBe(true);
    expect(mockState.inserted.some((item) => item.table === financialPayments)).toBe(false);

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

  it('creates deduplicated due notifications only through the explicit POST route', async () => {
    prepareDashboardRows();
    setSelectResults(students, [{ studentId: 10, userId: 25 }]);
    const response = await request(app).post('/api/accounting/notifications/overdue').send({ schoolId: 1 });
    expect(response.status).toBe(200);
    const sent = mockState.inserted.filter((item) => item.table === notifications);
    expect(sent.length).toBeGreaterThan(0);
    expect(sent.every((item) => typeof item.values.dedupeKey === 'string')).toBe(true);
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
