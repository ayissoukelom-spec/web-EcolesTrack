import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import express from 'express';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as schema from '../src/db/schema.ts';
import { registerAccountingRoutes } from '../src/lib/accountingApi.ts';

const readMigration = (name: string) => readFileSync(path.resolve(process.cwd(), 'drizzle', name), 'utf8');

const requiredTestDb = 'ecoletrack_test';
let schemaName = '';
let pool: Pool;
let app: express.Express;
let testDatabase: NodePgDatabase<typeof schema>;
let legacyTariffPreservedByRangeMigration = false;

const makePool = (options?: string) => new Pool({
  host: process.env.SQL_HOST,
  port: process.env.SQL_PORT ? Number(process.env.SQL_PORT) : 5432,
  user: process.env.SQL_USER,
  password: process.env.SQL_PASSWORD,
  database: requiredTestDb,
  ssl: process.env.SQL_USE_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
  connectionTimeoutMillis: 10000,
  max: 4,
  ...(options ? { options } : {}),
});

describe.sequential('accounting ledger PostgreSQL integration', () => {
  beforeAll(async () => {
    if (process.env.SQL_DB_NAME !== requiredTestDb) {
      throw new Error(`Accounting integration tests require the isolated ${requiredTestDb} database.`);
    }
    if (!process.env.SQL_HOST || !process.env.SQL_USER || !process.env.SQL_PASSWORD) {
      throw new Error('Accounting integration tests require PostgreSQL test credentials.');
    }

    const adminPool = makePool();
    const actualDatabase = await adminPool.query('SELECT current_database() AS name');
    if (actualDatabase.rows[0]?.name !== requiredTestDb) {
      await adminPool.end();
      throw new Error('Refusing accounting integration tests outside the isolated PostgreSQL test database.');
    }
    schemaName = `accounting_it_${randomUUID().replace(/-/g, '')}`;
    await adminPool.query(`CREATE SCHEMA "${schemaName}"`);
    await adminPool.end();

    pool = makePool(`-c search_path=${schemaName}`);
    const client = await pool.connect();
    try {
      await client.query(`
        CREATE TABLE schools (
          id serial PRIMARY KEY, name text NOT NULL, address text, phone text, phone2 text,
          official_name text, abbreviation text, motto text, postal_box text, email text,
          city text, region text, education_direction text, ministry_name text,
          principal_name text, principal_gender text, logo_path text,
          promotion_threshold numeric(5,2) DEFAULT 10.00,
          students_creation_locked boolean DEFAULT false, created_at timestamp DEFAULT now()
        );
        CREATE TABLE academic_years (
          id serial PRIMARY KEY, school_id integer REFERENCES schools(id), name text NOT NULL,
          is_active boolean NOT NULL DEFAULT true, created_at timestamp DEFAULT now()
        );
        CREATE TABLE levels (
          id serial PRIMARY KEY, order_index integer NOT NULL
        );
        CREATE TABLE classes (
          id serial PRIMARY KEY, school_id integer REFERENCES schools(id),
          academic_year_id integer NOT NULL REFERENCES academic_years(id), name text NOT NULL,
          level_id integer REFERENCES levels(id)
        );
        CREATE TABLE school_classes (
          school_id integer NOT NULL REFERENCES schools(id),
          class_id integer NOT NULL REFERENCES classes(id),
          status text NOT NULL
        );
        CREATE TABLE users (id serial PRIMARY KEY);
        CREATE TABLE students (
          id serial PRIMARY KEY, school_id integer NOT NULL REFERENCES schools(id),
          class_id integer REFERENCES classes(id), parent_id integer,
          first_name text NOT NULL, last_name text NOT NULL, matricule text,
          is_active boolean NOT NULL DEFAULT true, withdrawn_at timestamp,
          birth_date text, gender text, school_admin_id integer, enrolled_at timestamp DEFAULT now(),
          photo_data bytea, photo_mime_type text, photo_updated_at timestamp
        );
        CREATE TABLE parents (id serial PRIMARY KEY, user_id integer NOT NULL);
        CREATE TABLE audit_events (
          id serial PRIMARY KEY, actor_user_id integer REFERENCES users(id), actor_role text NOT NULL,
          actor_email text, actor_name text, action text NOT NULL, resource_type text NOT NULL,
          resource_id integer, school_id integer REFERENCES schools(id), description text NOT NULL,
          created_at timestamp DEFAULT now()
        );
        CREATE TABLE notifications (
          id serial PRIMARY KEY, user_id integer NOT NULL, evaluation_id integer, title text NOT NULL,
          body text NOT NULL, type text NOT NULL, is_read boolean NOT NULL DEFAULT false,
          created_at timestamp DEFAULT now()
        );
      `);
      await client.query(readMigration('0138_accounting_ledger.sql'));
      await client.query(`
        INSERT INTO schools (id, name) VALUES (1, 'Migration preservation test');
        INSERT INTO users (id) VALUES (7);
        INSERT INTO academic_years (id, school_id, name) VALUES (1, 1, '2026-2027');
        INSERT INTO levels (id, order_index) VALUES (1, 1);
        INSERT INTO classes (id, school_id, academic_year_id, name, level_id) VALUES (1, 1, 1, '6e', 1);
        INSERT INTO accounting_tariffs (id, school_id, academic_year_id, class_id, category_id, amount)
          SELECT 1, 1, 1, 1, id, 150000
          FROM accounting_categories WHERE school_id = 1 AND code = 'tuition'
      `);
      await client.query(readMigration('0139_accounting_custom_fee_categories.sql'));
      await client.query(readMigration('0140_accounting_tariff_labels.sql'));
      await client.query(readMigration('0141_accounting_tariff_class_ranges.sql'));
      const retainedTariff = await client.query(`
        SELECT id, class_id, class_from_id, class_to_id, amount, label
        FROM accounting_tariffs WHERE id = 1
      `);
      legacyTariffPreservedByRangeMigration = retainedTariff.rows.length === 1
        && retainedTariff.rows[0].class_id === 1
        && retainedTariff.rows[0].class_from_id == null
        && retainedTariff.rows[0].class_to_id == null
        && retainedTariff.rows[0].amount === 150000
        && retainedTariff.rows[0].label === 'Scolarité';
    } finally {
      client.release();
    }

    testDatabase = drizzle(pool, { schema });
    app = express();
    app.use(express.json());
    registerAccountingRoutes(app, {
      database: testDatabase,
      resolveActor: async () => ({
        id: 7,
        role: 'school_admin',
        schoolId: 1,
        email: 'accounting-test@example.invalid',
        name: 'Accounting test',
      }),
      isApprovedClassForSchool: async () => false,
    });
  }, 30000);

  beforeEach(async () => {
    const client = await pool.connect();
    try {
      await client.query(`
        TRUNCATE financial_adjustment_allocations, financial_adjustments,
          financial_payment_allocations, financial_receipts, financial_payments,
          financial_installments, financial_obligations, accounting_fee_definitions,
          accounting_schedule_templates, accounting_tariffs, accounting_categories,
          notifications, audit_events, parents, students, school_classes, classes, levels,
          academic_years, users, schools
        RESTART IDENTITY CASCADE
      `);
      await client.query(`INSERT INTO schools (id, name) VALUES (1, 'École au paiement')`);
      await client.query(`INSERT INTO users (id) VALUES (7)`);
      await client.query(`INSERT INTO academic_years (id, school_id, name) VALUES (1, 1, '2026-2027')`);
      await client.query(`INSERT INTO levels (id, order_index) VALUES (1, 1), (2, 2), (3, 3), (4, 4), (5, 5)`);
      await client.query(`
        INSERT INTO classes (id, school_id, academic_year_id, name, level_id)
        VALUES (1, 1, 1, '6e', 1), (2, 1, 1, '5e', 2), (3, 1, 1, '4e', 3),
          (4, 1, 1, '3e', 4), (5, 1, 1, '2nde', 5)
      `);
      await client.query(`
        INSERT INTO students (id, school_id, class_id, first_name, last_name, matricule)
        VALUES (1, 1, 1, 'Afi', 'Doe', 'A-1')
      `);
      await client.query(`
        INSERT INTO financial_obligations
          (school_id, student_id, academic_year_id, class_id, category_id, label, amount,
           class_name_snapshot, source_key)
        SELECT 1, 1, 1, 1, id, 'Frais annuels', 10000, '6e', 'test-obligation'
        FROM accounting_categories WHERE school_id = 1 AND code = 'tuition'
      `);
      await client.query(`
        INSERT INTO financial_installments (obligation_id, label, order_index, amount, due_date)
        SELECT id, 'Échéance 1', 1, 10000, '2026-10-01'
        FROM financial_obligations WHERE source_key = 'test-obligation'
      `);
    } finally {
      client.release();
    }
  });

  afterAll(async () => {
    await pool?.end();
    if (!schemaName) return;
    const adminPool = makePool();
    const actualDatabase = await adminPool.query('SELECT current_database() AS name');
    if (actualDatabase.rows[0]?.name === requiredTestDb && /^accounting_it_[a-f0-9]{32}$/.test(schemaName)) {
      await adminPool.query(`DROP SCHEMA "${schemaName}" CASCADE`);
    }
    await adminPool.end();
  }, 30000);

  const paymentRequest = (overrides: Record<string, unknown> = {}) => ({
    studentId: 1,
    academicYearId: 1,
    amount: 7000,
    method: 'cash',
    idempotencyKey: `payment-${randomUUID()}`,
    ...overrides,
  });

  it('applies the ledger migration in its disposable schema with expected unique indexes', async () => {
    expect(legacyTariffPreservedByRangeMigration).toBe(true);
    const result = await pool.query(`
      SELECT indexname FROM pg_indexes
      WHERE schemaname = $1
        AND indexname IN (
          'financial_payments_school_idempotency_idx',
          'financial_receipts_school_number_idx',
          'financial_adjustments_source_key_idx',
          'notifications_dedupe_key_idx',
          'accounting_tariffs_school_year_class_category_idx',
          'accounting_tariffs_school_year_class_range_category_idx'
        )
      ORDER BY indexname
    `, [schemaName]);
    expect(result.rows.map((row) => row.indexname)).toEqual([
      'accounting_tariffs_school_year_class_category_idx',
      'accounting_tariffs_school_year_class_range_category_idx',
      'financial_adjustments_source_key_idx',
      'financial_payments_school_idempotency_idx',
      'financial_receipts_school_number_idx',
      'notifications_dedupe_key_idx',
    ]);
    const classScope = await pool.query(`
      SELECT is_nullable FROM information_schema.columns
      WHERE table_schema = $1 AND table_name = 'accounting_tariffs' AND column_name = 'class_id'
    `, [schemaName]);
    expect(classScope.rows[0]?.is_nullable).toBe('YES');
  });

  it('stores one range tariff, applies it by pedagogical order, and collects it normally', async () => {
    await pool.query('UPDATE students SET class_id = 2 WHERE id = 1');
    const individual = await request(app).post('/api/accounting/tariffs').send({
      academicYearId: 1,
      classId: 1,
      label: 'Frais individuel',
      amount: 25000,
    });
    expect(individual.status, JSON.stringify(individual.body)).toBe(201);
    const created = await request(app).post('/api/accounting/tariffs').send({
      academicYearId: 1,
      classFromId: 1,
      classToId: 4,
      label: 'Frais de plage',
      amount: 120000,
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body).toMatchObject({
      classId: null,
      classFromId: 1,
      classToId: 4,
      amount: 120000,
    });

    const restartedApp = express();
    restartedApp.use(express.json());
    registerAccountingRoutes(restartedApp, {
      database: testDatabase,
      resolveActor: async () => ({
        id: 7,
        role: 'school_admin',
        schoolId: 1,
        email: 'accounting-test@example.invalid',
        name: 'Accounting test after refresh',
      }),
      isApprovedClassForSchool: async () => false,
    });
    const listed = await request(restartedApp).get('/api/accounting/tariffs?schoolId=99&academicYearId=1');
    expect(listed.status).toBe(200);
    expect(listed.body).toHaveLength(2);
    expect(listed.body).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: individual.body.id,
        classId: 1,
        className: '6e',
        classFromId: null,
        classToId: null,
        categoryLabel: 'Frais individuel',
        amount: 25000,
      }),
      expect.objectContaining({
      id: created.body.id,
      className: '6e à 3e',
      classFromName: '6e',
      classToName: '3e',
      classId: null,
      classFromId: 1,
      classToId: 4,
      categoryLabel: 'Frais de plage',
      amount: 120000,
      }),
    ]));

    await pool.query('UPDATE students SET class_id = 5 WHERE id = 1');
    const outsideRange = await request(app).post('/api/accounting/obligations').send({
      studentId: 1,
      academicYearId: 1,
      tariffId: created.body.id,
    });
    expect(outsideRange.status).toBe(400);

    await pool.query('UPDATE students SET class_id = 2 WHERE id = 1');
    const situation = await request(app)
      .get(`/api/accounting/situation?academicYearId=1&categoryId=${created.body.categoryId}`);
    expect(situation.status).toBe(200);
    expect(situation.body.rows).toContainEqual(expect.objectContaining({
      classId: 2,
      tariffId: created.body.id,
      due: 120000,
    }));

    const obligation = await request(app).post('/api/accounting/obligations').send({
      studentId: 1,
      academicYearId: 1,
      tariffId: created.body.id,
    });
    expect(obligation.status, JSON.stringify(obligation.body)).toBe(201);
    expect(obligation.body).toMatchObject({ tariffId: created.body.id, classId: 2, amount: 120000 });

    const payment = await request(app).post('/api/accounting/payments').send(paymentRequest({
      amount: 1000,
      allocations: [{ tariffId: created.body.id, amount: 1000 }],
    }));
    expect(payment.status, JSON.stringify(payment.body)).toBe(201);
    expect(payment.body.receipt.snapshot.allocations).toContainEqual(expect.objectContaining({
      amount: 1000,
      label: 'Frais de plage',
    }));
  });

  it('serializes simultaneous payments on one year and prevents allocation beyond the balance', async () => {
    const [first, second] = await Promise.all([
      request(app).post('/api/accounting/payments').send(paymentRequest()),
      request(app).post('/api/accounting/payments').send(paymentRequest()),
    ]);
    expect([first.status, second.status].sort()).toEqual([201, 409]);
    const totals = await pool.query(`
      SELECT count(DISTINCT p.id)::int AS payments, coalesce(sum(a.amount), 0)::int AS allocated
      FROM financial_payments p
      LEFT JOIN financial_payment_allocations a ON a.payment_id = p.id
    `);
    expect(totals.rows[0]).toEqual({ payments: 1, allocated: 7000 });
    const remaining = await pool.query(`
      SELECT i.amount - coalesce(sum(a.amount), 0)::int AS remaining
      FROM financial_installments i
      LEFT JOIN financial_payment_allocations a ON a.installment_id = i.id
      GROUP BY i.id
    `);
    expect(remaining.rows[0].remaining).toBe(3000);
  });

  it('returns the original payment and receipt for a repeated idempotency key', async () => {
    const body = paymentRequest({ amount: 3000, idempotencyKey: 'retry-identical-payment' });
    const first = await request(app).post('/api/accounting/payments').send(body);
    const retry = await request(app).post('/api/accounting/payments').send(body);
    expect(first.status).toBe(201);
    expect(retry.status).toBe(200);
    expect(retry.body.duplicate).toBe(true);
    expect(retry.body.payment.id).toBe(first.body.payment.id);
    expect(retry.body.receipt.id).toBe(first.body.receipt.id);
    const count = await pool.query('SELECT count(*)::int AS count FROM financial_payments');
    expect(count.rows[0].count).toBe(1);
  });

  it('keeps dashboard reads side-effect free and deduplicates explicit overdue reminders', async () => {
    await pool.query(`INSERT INTO parents (id, user_id) VALUES (1, 7)`);
    await pool.query(`UPDATE students SET parent_id = 1 WHERE id = 1`);
    await pool.query(`UPDATE financial_installments SET due_date = '2000-01-01'`);

    const dashboard = await request(app).get('/api/accounting/dashboard?academicYearId=1');
    expect(dashboard.status).toBe(200);
    let count = await pool.query('SELECT count(*)::int AS count FROM notifications');
    expect(count.rows[0].count).toBe(0);

    const firstReminder = await request(app).post('/api/accounting/notifications/overdue')
      .send({ academicYearId: 1 });
    const repeatedReminder = await request(app).post('/api/accounting/notifications/overdue')
      .send({ academicYearId: 1 });
    expect(firstReminder.status).toBe(200);
    expect(repeatedReminder.status).toBe(200);
    count = await pool.query('SELECT count(*)::int AS count FROM notifications');
    expect(count.rows[0].count).toBe(1);
  });

  it('issues unique increasing receipt numbers and renders from the stored historical snapshot', async () => {
    const first = await request(app).post('/api/accounting/payments').send(paymentRequest({
      amount: 3000, idempotencyKey: 'receipt-one',
    }));
    const second = await request(app).post('/api/accounting/payments').send(paymentRequest({
      amount: 3000, idempotencyKey: 'receipt-two',
    }));
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(first.body.receipt.receiptNumber).not.toBe(second.body.receipt.receiptNumber);
    const firstSequence = Number(first.body.receipt.receiptNumber.split('-').at(-1));
    const secondSequence = Number(second.body.receipt.receiptNumber.split('-').at(-1));
    expect(secondSequence).toBeGreaterThan(firstSequence);

    await pool.query(`UPDATE schools SET name = 'Nouveau nom' WHERE id = 1`);
    const stored = await pool.query('SELECT snapshot FROM financial_receipts WHERE id = $1', [first.body.receipt.id]);
    expect(stored.rows[0].snapshot.school.name).toBe('École au paiement');
    const pdf = await request(app).get(`/api/accounting/receipts/${first.body.receipt.id}`);
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toContain('application/pdf');
    expect(Buffer.from(pdf.body).subarray(0, 4).toString()).toBe('%PDF');
  });

  it('rolls back payment, allocation, receipt, and audit rows after a late transactional failure', async () => {
    await pool.query(`
      CREATE FUNCTION reject_receipt_audit() RETURNS trigger AS $$
      BEGIN
        IF NEW.resource_type = 'financial_receipt' THEN
          RAISE EXCEPTION 'integration rollback marker';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER reject_receipt_audit_trigger
      BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION reject_receipt_audit();
    `);
    try {
      const response = await request(app).post('/api/accounting/payments')
        .send(paymentRequest({ amount: 3000, idempotencyKey: 'rollback-payment' }));
      expect(response.status).toBe(500);
      const rows = await pool.query(`
        SELECT
          (SELECT count(*)::int FROM financial_payments) AS payments,
          (SELECT count(*)::int FROM financial_payment_allocations) AS allocations,
          (SELECT count(*)::int FROM financial_receipts) AS receipts,
          (SELECT count(*)::int FROM audit_events) AS audit_events
      `);
      expect(rows.rows[0]).toEqual({ payments: 0, allocations: 0, receipts: 0, audit_events: 0 });
    } finally {
      await pool.query('DROP TRIGGER IF EXISTS reject_receipt_audit_trigger ON audit_events');
      await pool.query('DROP FUNCTION IF EXISTS reject_receipt_audit()');
    }
  });
});
