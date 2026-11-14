import { randomBytes, randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { and, eq, inArray, sql } from 'drizzle-orm';
import * as schema from '../src/db/schema.ts';
import {
  academicYears,
  accountingCategories,
  classes,
  cycles,
  financialObligations,
  financialPaymentAllocations,
  financialPayments,
  levels,
  notificationDeliveryOutbox,
  notifications,
  parents,
  schoolCycles,
  schoolTerms,
  schools,
  students,
  tuitionProgressReminderControls,
  userSchools,
  users,
} from '../src/db/schema.ts';
import {
  createTuitionProgressReminderDrizzleSource,
} from '../src/lib/tuitionProgressReminderDrizzle.ts';
import {
  createTuitionProgressReminderExecutionDrizzleSource,
} from '../src/lib/tuitionProgressReminderExecutionDrizzle.ts';
import {
  createTuitionProgressReminderInAppNotificationDrizzleSource,
  createTuitionProgressReminderPushDrizzleSource,
} from '../src/lib/tuitionProgressReminderNotificationsDrizzle.ts';
import { executeDueTuitionProgressReminderControls } from '../src/lib/tuitionProgressReminderExecution.ts';
import { prepareTuitionProgressReminderControls } from '../src/lib/tuitionProgressReminderPreparation.ts';
import { processTuitionProgressReminderPushOutbox } from '../src/lib/tuitionProgressReminderPush.ts';
import type { TuitionProgressReminderDrizzleDatabase } from '../src/lib/tuitionProgressReminderDrizzle.ts';
import type { TuitionProgressReminderPushClaim } from '../src/lib/tuitionProgressReminderPush.ts';
import type { AccountingTuitionProgressExecutor } from '../src/lib/accountingApi.ts';
import type {
  AccountingTuitionProgressInput,
  AccountingTuitionProgressResult,
} from '../src/lib/accountingTuitionProgress.ts';

const CONFIRMATION = 'ISOLATED_TEST_DATABASE_ONLY';
const TEST_DATABASE_PATTERN = /^ecoletrack_tuition_reminder_test_[a-z0-9_]+$/i;
const FIXED_NOW = new Date('2027-07-15T08:30:00.000Z');
const QUIET_HOURS_NOW = new Date('2027-07-15T22:30:00.000Z');
const PERIODS = [
  { orderIndex: 1, startDate: '2026-09-01', endDate: '2026-11-30', name: 'Trimestre 1' },
  { orderIndex: 2, startDate: '2026-12-01', endDate: '2027-02-28', name: 'Trimestre 2' },
  { orderIndex: 3, startDate: '2027-03-01', endDate: '2027-07-16', name: 'Trimestre 3' },
] as const;
const STUDENT_CASES = [
  'paid-up',
  'below-target',
  'paid-before-in-app',
  'paid-before-push',
  'disabled-parent',
  'inactive-parent-link',
  'quiet-hours',
] as const;

type StudentCase = (typeof STUDENT_CASES)[number];
type DatabaseOperations = Pick<
  TuitionProgressReminderDrizzleDatabase,
  'insert' | 'select' | 'update' | 'delete' | 'execute'
>;
type TestConfig = {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  expectedAddress: string;
  sharedStagingDatabase: string;
  productionDatabase: string;
  ssl: boolean;
};
type Fixture = {
  runId: string;
  schoolId: number;
  academicYearId: number;
  cycleId: number;
  levelId: number;
  classId: number;
  categoryId: number;
  students: Record<StudentCase, { id: number; userId: number; parentId: number; obligationId: number }>;
  deviceIds: string[];
};

const fail = (message: string): never => {
  throw new Error(message);
};

const assert: (condition: unknown, message: string) => asserts condition = (condition, message) => {
  if (!condition) fail(message);
};

const requiredEnvironment = (name: string): string => {
  const value = process.env[name]?.trim();
  if (!value) fail(`Required runner setting is missing: ${name}`);
  return value;
};

const normalizedAddress = (address: string): string => {
  const normalized = address.toLowerCase();
  return normalized.startsWith('::ffff:') ? normalized.slice('::ffff:'.length) : normalized;
};

const readConfig = (): TestConfig => {
  if (process.env.ECOLETRACK_REMINDER_TEST_CONFIRMATION !== CONFIRMATION) {
    fail(`Set ECOLETRACK_REMINDER_TEST_CONFIRMATION=${CONFIRMATION} to opt in.`);
  }
  const host = requiredEnvironment('ECOLETRACK_REMINDER_TEST_SQL_HOST');
  const port = Number(requiredEnvironment('ECOLETRACK_REMINDER_TEST_SQL_PORT'));
  const user = requiredEnvironment('ECOLETRACK_REMINDER_TEST_SQL_USER');
  const password = requiredEnvironment('ECOLETRACK_REMINDER_TEST_SQL_PASSWORD');
  const database = requiredEnvironment('ECOLETRACK_REMINDER_TEST_SQL_DATABASE');
  const expectedAddress = requiredEnvironment('ECOLETRACK_REMINDER_TEST_SQL_ADDRESS');
  const sharedStagingDatabase = requiredEnvironment('ECOLETRACK_REMINDER_SHARED_STAGING_SQL_DATABASE');
  const productionDatabase = requiredEnvironment('ECOLETRACK_REMINDER_PRODUCTION_SQL_DATABASE');
  const sslSetting = requiredEnvironment('ECOLETRACK_REMINDER_TEST_SQL_SSL');

  if (!Number.isInteger(port) || port < 1 || port > 65_535) fail('The test PostgreSQL port is invalid.');
  if (!TEST_DATABASE_PATTERN.test(database)) {
    fail('The database name must start with ecoletrack_tuition_reminder_test_.');
  }
  if (database !== database.toLowerCase()) fail('Use a lowercase PostgreSQL test database name.');
  if (!isIP(expectedAddress)) fail('The test PostgreSQL server address must be an IP address.');
  if (database.toLowerCase() === sharedStagingDatabase.toLowerCase()
    || database.toLowerCase() === productionDatabase.toLowerCase()) {
    fail('The configured test database must differ from shared staging and production.');
  }
  if (sslSetting !== 'true' && sslSetting !== 'false') {
    fail('ECOLETRACK_REMINDER_TEST_SQL_SSL must be explicitly true or false.');
  }

  return {
    host,
    port,
    user,
    password,
    database,
    expectedAddress: normalizedAddress(expectedAddress),
    sharedStagingDatabase,
    productionDatabase,
    ssl: sslSetting === 'true',
  };
};

const REQUIRED_TABLES = [
  'schools',
  'academic_years',
  'cycles',
  'school_cycles',
  'school_terms',
  'levels',
  'classes',
  'users',
  'user_schools',
  'parents',
  'students',
  'accounting_categories',
  'financial_obligations',
  'financial_installments',
  'financial_payments',
  'financial_payment_allocations',
  'financial_adjustments',
  'financial_adjustment_allocations',
  'notifications',
  'notification_delivery_outbox',
  'tuition_progress_reminder_controls',
  'mobile_parent_devices',
  'mobile_notification_preferences',
] as const;

const REQUIRED_COLUMNS: Record<string, readonly string[]> = {
  schools: ['time_zone', 'is_suspended'],
  academic_years: ['school_id', 'is_active'],
  cycles: ['is_active'],
  school_cycles: ['school_id', 'cycle_id', 'is_active'],
  school_terms: ['school_id', 'academic_year_id', 'cycle_id', 'period_type', 'order_index', 'start_date', 'end_date', 'is_active'],
  levels: ['cycle_id'],
  classes: ['school_id', 'academic_year_id', 'level_id', 'name'],
  users: ['uid', 'email', 'name', 'last_name', 'first_name', 'role', 'school_id', 'phone', 'is_deleted'],
  user_schools: ['user_id', 'school_id', 'role', 'is_active'],
  parents: ['user_id', 'school_id'],
  students: ['school_id', 'class_id', 'is_active', 'first_name', 'last_name', 'matricule', 'parent_id'],
  accounting_categories: ['school_id', 'code', 'label'],
  financial_obligations: [
    'school_id', 'student_id', 'academic_year_id', 'class_id', 'category_id',
    'amount', 'currency', 'class_name_snapshot', 'source_key', 'status',
  ],
  financial_installments: ['obligation_id', 'amount', 'due_date'],
  financial_payments: [
    'school_id', 'student_id', 'academic_year_id', 'amount', 'currency',
    'method', 'request_fingerprint', 'paid_at', 'status', 'idempotency_key',
  ],
  financial_payment_allocations: ['payment_id', 'obligation_id', 'installment_id', 'amount'],
  financial_adjustments: ['payment_id', 'kind', 'amount', 'reason', 'source_key', 'created_at'],
  financial_adjustment_allocations: ['adjustment_id', 'payment_allocation_id', 'amount'],
  notifications: ['user_id', 'title', 'body', 'type', 'dedupe_key'],
  notification_delivery_outbox: [
    'notification_id', 'channel', 'status', 'attempt_count', 'next_attempt_at',
    'last_error', 'transport_state', 'fcm_accepted_at', 'updated_at',
  ],
  tuition_progress_reminder_controls: [
    'school_id', 'academic_year_id', 'cycle_id', 'student_id', 'month_start',
    'stage', 'scheduled_at', 'expires_at', 'time_zone', 'status', 'target_amount',
    'net_paid_amount', 'shortfall_amount', 'attempt_count', 'next_attempt_at',
    'lease_token', 'lease_expires_at', 'notification_id',
  ],
  mobile_parent_devices: ['parent_id', 'device_id', 'platform', 'push_token', 'app_version', 'last_seen_at'],
  mobile_notification_preferences: ['parent_id', 'push_enabled'],
};

const REQUIRED_CONSTRAINTS = [
  'tuition_progress_reminder_controls_school_fk',
  'tuition_progress_reminder_controls_academic_year_fk',
  'tuition_progress_reminder_controls_cycle_fk',
  'tuition_progress_reminder_controls_student_fk',
  'tuition_progress_reminder_controls_notification_fk',
  'tuition_progress_reminder_controls_notification_unique',
  'tuition_progress_reminder_controls_scope_unique',
  'tuition_progress_reminder_controls_month_start_check',
  'tuition_progress_reminder_controls_stage_check',
  'tuition_progress_reminder_controls_status_check',
  'tuition_progress_reminder_controls_time_zone_check',
  'tuition_progress_reminder_controls_expiration_check',
  'tuition_progress_reminder_controls_attempt_count_check',
  'tuition_progress_reminder_controls_lease_check',
  'tuition_progress_reminder_controls_amounts_check',
  'tuition_progress_reminder_controls_target_nonnegative_check',
  'tuition_progress_reminder_controls_paid_nonnegative_check',
  'tuition_progress_reminder_controls_shortfall_nonnegative_check',
  'notification_delivery_outbox_notification_id_notifications_id_fk',
  'notification_delivery_outbox_notification_channel_unique',
  'notification_delivery_outbox_channel_check',
  'notification_delivery_outbox_status_check',
  'notification_delivery_outbox_attempt_count_check',
  'notification_delivery_outbox_transport_state_check',
] as const;

const REQUIRED_INDEXES = [
  'tuition_progress_reminder_controls_due_idx',
  'tuition_progress_reminder_controls_expired_lease_idx',
  'notifications_dedupe_key_idx',
  'notification_delivery_outbox_notification_channel_unique',
  'notification_delivery_outbox_pending_idx',
  'notification_delivery_outbox_sending_updated_idx',
  'mobile_parent_devices_device_idx',
] as const;

const EMPTY_TABLES = [
  'schools',
  'academic_years',
  'school_cycles',
  'school_terms',
  'classes',
  'users',
  'user_schools',
  'parents',
  'students',
  'accounting_categories',
  'financial_obligations',
  'financial_payments',
  'financial_payment_allocations',
  'notifications',
  'notification_delivery_outbox',
  'tuition_progress_reminder_controls',
  'mobile_parent_devices',
  'mobile_notification_preferences',
] as const;

const verifySchema = async (client: import('pg').PoolClient): Promise<void> => {
  const relations = await client.query<{ relname: string }>(
    `SELECT c.relname
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')`,
  );
  const relationNames = new Set(relations.rows.map((row) => row.relname));
  const missingTables = REQUIRED_TABLES.filter((table) => !relationNames.has(table));
  if (missingTables.length) fail(`Required PostgreSQL tables are missing: ${missingTables.join(', ')}`);

  const columns = await client.query<{ table_name: string; column_name: string; data_type: string }>(
    `SELECT table_name, column_name, data_type
       FROM information_schema.columns
      WHERE table_schema = 'public'`,
  );
  const columnRows = new Set(columns.rows.map((row) => `${row.table_name}.${row.column_name}`));
  const missingColumns = Object.entries(REQUIRED_COLUMNS)
    .flatMap(([table, names]) => names
      .filter((name) => !columnRows.has(`${table}.${name}`))
      .map((name) => `${table}.${name}`));
  if (missingColumns.length) fail(`Required PostgreSQL columns are missing: ${missingColumns.join(', ')}`);

  const expectedTypes: Record<string, string> = {
    'schools.time_zone': 'text',
    'tuition_progress_reminder_controls.month_start': 'date',
    'tuition_progress_reminder_controls.scheduled_at': 'timestamp with time zone',
    'tuition_progress_reminder_controls.expires_at': 'timestamp with time zone',
    'tuition_progress_reminder_controls.lease_token': 'uuid',
    'notification_delivery_outbox.transport_state': 'text',
    'notification_delivery_outbox.fcm_accepted_at': 'timestamp with time zone',
  };
  const actualTypes = new Map(columns.rows.map((row) => [`${row.table_name}.${row.column_name}`, row.data_type]));
  const typeMismatches = Object.entries(expectedTypes)
    .filter(([column, type]) => actualTypes.get(column) !== type)
    .map(([column, type]) => `${column} (expected ${type}, got ${actualTypes.get(column) ?? 'missing'})`);
  if (typeMismatches.length) fail(`PostgreSQL column types are incompatible: ${typeMismatches.join(', ')}`);

  const constraints = await client.query<{ conname: string }>(
    `SELECT conname
       FROM pg_constraint
      WHERE connamespace = 'public'::regnamespace`,
  );
  const constraintNames = new Set(constraints.rows.map((row) => row.conname));
  const missingConstraints = REQUIRED_CONSTRAINTS.filter((name) => !constraintNames.has(name));
  if (missingConstraints.length) {
    fail(`Required PostgreSQL constraints are missing: ${missingConstraints.join(', ')}`);
  }

  const indexes = await client.query<{ indexname: string }>(
    `SELECT indexname FROM pg_indexes WHERE schemaname = 'public'`,
  );
  const indexNames = new Set(indexes.rows.map((row) => row.indexname));
  const missingIndexes = REQUIRED_INDEXES.filter((name) => !indexNames.has(name));
  if (missingIndexes.length) fail(`Required PostgreSQL indexes are missing: ${missingIndexes.join(', ')}`);
};

const verifyEmptyTestDatabase = async (client: import('pg').PoolClient): Promise<void> => {
  const counts = await Promise.all(EMPTY_TABLES.map(async (table) => {
    const result = await client.query<{ count: string }>(`SELECT count(*)::text AS count FROM public."${table}"`);
    return { table, count: Number(result.rows[0]?.count ?? '-1') };
  }));
  const nonEmpty = counts.filter(({ count }) => count !== 0);
  if (nonEmpty.length) {
    fail(`The isolated test database must be empty; rows were found in: ${
      nonEmpty.map(({ table, count }) => `${table}=${count}`).join(', ')
    }`);
  }
};

const inspectTarget = async (config: TestConfig): Promise<void> => {
  const pool = createTargetPool(config, 'ecoletrack_tuition_reminder_test_preflight');
  try {
    const client = await pool.connect();
    try {
      await client.query('BEGIN READ ONLY');
      const identity = await client.query<{
        database_name: string;
        user_name: string;
        server_address: string | null;
        server_port: number;
        is_superuser: boolean;
      }>(`SELECT current_database() AS database_name,
                 current_user AS user_name,
                 inet_server_addr()::text AS server_address,
                 inet_server_port() AS server_port,
                 r.rolsuper AS is_superuser
            FROM pg_roles r
           WHERE r.rolname = current_user`);
      const target = identity.rows[0];
      if (!target || target.database_name !== config.database || target.user_name !== config.user) {
        fail('The connected PostgreSQL database or user does not match the explicitly configured target.');
      }
      if (!target.server_address
        || normalizedAddress(target.server_address) !== config.expectedAddress
        || target.server_port !== config.port) {
        fail('The connected PostgreSQL server address or port does not match the required isolated test target.');
      }
      if (target.database_name === config.sharedStagingDatabase
        || target.database_name === config.productionDatabase) {
        fail('The connected database is shared staging or production; refusing to continue.');
      }
      if (target.is_superuser) fail('The integration runner refuses to use a PostgreSQL superuser.');

      await verifySchema(client);
      await verifyEmptyTestDatabase(client);
      await client.query('ROLLBACK');
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // The connection is released below; preserve the preflight failure.
      }
      throw error;
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
};

const createTargetPool = (config: TestConfig, applicationName: string): Pool => new Pool({
  host: config.host,
  port: config.port,
  user: config.user,
  password: config.password,
  database: config.database,
  ssl: config.ssl ? { rejectUnauthorized: true } : false,
  max: 1,
  connectionTimeoutMillis: 8_000,
  statement_timeout: 8_000,
  application_name: applicationName,
});

const newPhone = (used: Set<string>): string => {
  let phone = '';
  do {
    const suffix = String(randomBytes(4).readUInt32BE(0) % 10_000_000).padStart(7, '0');
    phone = `+2289${suffix}`;
  } while (used.has(phone));
  used.add(phone);
  return phone;
};

const createFixture = async (database: DatabaseOperations): Promise<Fixture> => {
  const runId = randomUUID();
  const suffix = runId.replace(/-/g, '').slice(0, 10);
  const [school] = await database.insert(schools).values({
    name: `Synthetic tuition reminder ${suffix}`,
    timeZone: 'Africa/Lome',
  }).returning({ id: schools.id });
  assert(school, 'Could not create the synthetic school.');

  const [cycle] = await database.insert(cycles).values({
    code: `reminder_${suffix}`,
    name: `Synthetic reminder cycle ${suffix}`,
    isActive: true,
  }).returning({ id: cycles.id });
  assert(cycle, 'Could not create the synthetic cycle.');

  const [level] = await database.insert(levels).values({
    cycleId: cycle.id,
    code: `reminder_level_${suffix}`,
    name: `Synthetic reminder level ${suffix}`,
    orderIndex: 1,
    isActive: true,
  }).returning({ id: levels.id });
  assert(level, 'Could not create the synthetic level.');

  const [academicYear] = await database.insert(academicYears).values({
    schoolId: school.id,
    name: `Synthetic ${suffix}`,
    isActive: true,
  }).returning({ id: academicYears.id });
  assert(academicYear, 'Could not create the synthetic academic year.');

  await database.insert(schoolCycles).values({
    schoolId: school.id,
    cycleId: cycle.id,
    isActive: true,
  });

  await database.insert(schoolTerms).values(PERIODS.map((period) => ({
    schoolId: school.id,
    academicYearId: academicYear.id,
    cycleId: cycle.id,
    periodType: 'trimester',
    name: period.name,
    orderIndex: period.orderIndex,
    startDate: period.startDate,
    endDate: period.endDate,
    isActive: true,
  })));

  const [classRow] = await database.insert(classes).values({
    schoolId: school.id,
    academicYearId: academicYear.id,
    levelId: level.id,
    name: `Synthetic ${suffix}`,
  }).returning({ id: classes.id });
  assert(classRow, 'Could not create the synthetic class.');

  const [category] = await database.insert(accountingCategories).values({
    schoolId: school.id,
    code: 'tuition',
    label: `Synthetic tuition ${suffix}`,
    isEnabled: true,
  }).returning({ id: accountingCategories.id });
  assert(category, 'Could not create the synthetic tuition category.');

  const result = {} as Fixture['students'];
  const usedPhones = new Set<string>();
  for (const [index, caseName] of STUDENT_CASES.entries()) {
    const uid = `reminder-test-${runId}-${index}`;
    const phone = newPhone(usedPhones);
    const [user] = await database.insert(users).values({
      uid,
      email: `${uid}@example.invalid`,
      name: `Synthetic Parent ${index}`,
      lastName: `Test ${suffix}`,
      firstNames: `Parent ${index}`,
      role: 'school_admin',
      schoolId: school.id,
      academicYearId: academicYear.id,
      phone,
      isDeleted: false,
    }).returning({ id: users.id });
    assert(user, `Could not create the synthetic user for ${caseName}.`);

    await database.insert(userSchools).values([
      { userId: user.id, schoolId: school.id, role: 'parent', isActive: true },
      { userId: user.id, schoolId: school.id, role: 'school_admin', isActive: true },
    ]);

    const [parent] = await database.insert(parents).values({
      userId: user.id,
      phone,
      schoolId: school.id,
    }).returning({ id: parents.id });
    assert(parent, `Could not create the synthetic parent profile for ${caseName}.`);

    const [student] = await database.insert(students).values({
      schoolId: school.id,
      classId: classRow.id,
      isActive: true,
      firstName: `Synthetic Student ${index}`,
      lastName: `Test ${suffix}`,
      matricule: `TR-${suffix}-${index}`,
      parentId: parent.id,
    }).returning({ id: students.id });
    assert(student, `Could not create the synthetic student for ${caseName}.`);

    const [obligation] = await database.insert(financialObligations).values({
      schoolId: school.id,
      studentId: student.id,
      academicYearId: academicYear.id,
      classId: classRow.id,
      categoryId: category.id,
      label: `Synthetic tuition obligation ${caseName}`,
      amount: 90_000,
      currency: 'XOF',
      classNameSnapshot: `Synthetic ${suffix}`,
      sourceKey: `tuition-reminder-test:${runId}:${caseName}`,
      status: 'active',
    }).returning({ id: financialObligations.id });
    assert(obligation, `Could not create the synthetic obligation for ${caseName}.`);

    result[caseName] = {
      id: student.id,
      userId: user.id,
      parentId: parent.id,
      obligationId: obligation.id,
    };
  }

  const fixture: Fixture = {
    runId,
    schoolId: school.id,
    academicYearId: academicYear.id,
    cycleId: cycle.id,
    levelId: level.id,
    classId: classRow.id,
    categoryId: category.id,
    students: result,
    deviceIds: [],
  };
  return fixture;
};

const addFullPayment = async (
  database: TuitionProgressReminderDrizzleDatabase,
  fixture: Fixture,
  studentCase: StudentCase,
  paidAt: Date,
): Promise<void> => {
  const student = fixture.students[studentCase];
  const paymentKey = `${fixture.runId}:${studentCase}:${paidAt.toISOString()}`;
  const [payment] = await database.insert(financialPayments).values({
    schoolId: fixture.schoolId,
    studentId: student.id,
    academicYearId: fixture.academicYearId,
    amount: 90_000,
    currency: 'XOF',
    method: 'cash',
    requestFingerprint: paymentKey,
    paidAt,
    status: 'posted',
    idempotencyKey: paymentKey,
  }).returning({ id: financialPayments.id });
  assert(payment, `Could not create the synthetic payment for ${studentCase}.`);
  await database.insert(financialPaymentAllocations).values({
    paymentId: payment.id,
    obligationId: student.obligationId,
    amount: 90_000,
  });
};

const createSyntheticDevice = async (
  database: TuitionProgressReminderDrizzleDatabase,
  fixture: Fixture,
  studentCase: StudentCase,
): Promise<void> => {
  const deviceId = `tuition-reminder-test:${fixture.runId}:${studentCase}`;
  const token = `test-only-disabled-transport:${fixture.runId}:${studentCase}`;
  await database.execute(sql`
    INSERT INTO mobile_parent_devices
      (parent_id, device_id, platform, push_token, app_version, last_seen_at)
    VALUES
      (${String(fixture.students[studentCase].userId)}, ${deviceId}, 'android', ${token}, 'test-only', ${FIXED_NOW})
  `);
  fixture.deviceIds.push(deviceId);
};

const controlFor = async (
  database: TuitionProgressReminderDrizzleDatabase,
  fixture: Fixture,
  studentCase: StudentCase,
) => {
  const [control] = await database.select({
    id: tuitionProgressReminderControls.id,
    status: tuitionProgressReminderControls.status,
    scheduledAt: tuitionProgressReminderControls.scheduledAt,
    stage: tuitionProgressReminderControls.stage,
    notificationId: tuitionProgressReminderControls.notificationId,
  }).from(tuitionProgressReminderControls).where(and(
    eq(tuitionProgressReminderControls.schoolId, fixture.schoolId),
    eq(tuitionProgressReminderControls.academicYearId, fixture.academicYearId),
    eq(tuitionProgressReminderControls.cycleId, fixture.cycleId),
    eq(tuitionProgressReminderControls.studentId, fixture.students[studentCase].id),
    eq(tuitionProgressReminderControls.monthStart, '2027-07-01'),
    eq(tuitionProgressReminderControls.stage, 'penultimate'),
  )).limit(1);
  assert(control, `The scheduled control is missing for ${studentCase}.`);
  return control;
};

const verifyTargetAgain = async (
  database: TuitionProgressReminderDrizzleDatabase,
  config: TestConfig,
): Promise<void> => {
  const client = await database.$client.connect();
  try {
    await client.query('BEGIN READ ONLY');
    const result = await client.query<{
      database_name: string;
      user_name: string;
      server_address: string | null;
      server_port: number;
      is_superuser: boolean;
    }>(`SELECT current_database() AS database_name,
               current_user AS user_name,
               inet_server_addr()::text AS server_address,
               inet_server_port() AS server_port,
               r.rolsuper AS is_superuser
          FROM pg_roles r
         WHERE r.rolname = current_user`);
    const target = result.rows[0];
    if (!target || !target.server_address
      || target.database_name !== config.database
      || target.user_name !== config.user
      || normalizedAddress(target.server_address) !== config.expectedAddress
      || target.server_port !== config.port
      || target.is_superuser
      || target.database_name === config.sharedStagingDatabase
      || target.database_name === config.productionDatabase) {
      fail('The application database pool does not resolve to the preflight-verified isolated PostgreSQL target.');
    }
    await verifySchema(client);
    await verifyEmptyTestDatabase(client);
    await client.query('ROLLBACK');
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Preserve the verification failure.
    }
    throw error;
  } finally {
    client.release();
  }
};

const cleanupFixture = async (
  database: TuitionProgressReminderDrizzleDatabase,
  fixture: Fixture,
): Promise<void> => {
  const controls = await database.select({
    id: tuitionProgressReminderControls.id,
    notificationId: tuitionProgressReminderControls.notificationId,
  }).from(tuitionProgressReminderControls).where(and(
    eq(tuitionProgressReminderControls.schoolId, fixture.schoolId),
    eq(tuitionProgressReminderControls.academicYearId, fixture.academicYearId),
    eq(tuitionProgressReminderControls.cycleId, fixture.cycleId),
  ));
  const controlIds = controls.map((row) => row.id);
  const linkedNotificationIds = controls
    .map((row) => row.notificationId)
    .filter((id): id is number => id != null);
  const runNotificationRows = controlIds.length
    ? await database.select({ id: notifications.id }).from(notifications)
      .where(inArray(notifications.dedupeKey, controlIds.map((id) => `tuition-progress-reminder:${id}`)))
    : [];
  const notificationIds = [...new Set([
    ...linkedNotificationIds,
    ...runNotificationRows.map((row) => row.id),
  ])];

  if (fixture.deviceIds.length) {
    await database.execute(sql`
      DELETE FROM mobile_parent_devices
       WHERE device_id = ANY(${fixture.deviceIds}::text[])
    `);
  }
  if (notificationIds.length) {
    await database.delete(notificationDeliveryOutbox)
      .where(inArray(notificationDeliveryOutbox.notificationId, notificationIds));
  }
  if (controlIds.length) {
    await database.delete(tuitionProgressReminderControls)
      .where(inArray(tuitionProgressReminderControls.id, controlIds));
  }
  if (notificationIds.length) {
    await database.delete(notifications).where(inArray(notifications.id, notificationIds));
  }

  const studentsInFixture = Object.values(fixture.students).map(({ id }) => id);
  const parentsInFixture = Object.values(fixture.students).map(({ parentId }) => parentId);
  const usersInFixture = Object.values(fixture.students).map(({ userId }) => userId);
  const obligationIds = Object.values(fixture.students).map(({ obligationId }) => obligationId);

  if (obligationIds.length) {
    const allocations = await database.select({ id: financialPaymentAllocations.id })
      .from(financialPaymentAllocations)
      .innerJoin(financialObligations, eq(financialObligations.id, financialPaymentAllocations.obligationId))
      .where(inArray(financialObligations.id, obligationIds));
    if (allocations.length) {
      await database.delete(financialPaymentAllocations)
        .where(inArray(financialPaymentAllocations.id, allocations.map((row) => row.id)));
    }
    await database.delete(financialPayments)
      .where(and(
        eq(financialPayments.schoolId, fixture.schoolId),
        inArray(financialPayments.studentId, studentsInFixture),
      ));
    await database.delete(financialObligations)
      .where(inArray(financialObligations.id, obligationIds));
  }

  if (studentsInFixture.length) {
    await database.delete(students).where(inArray(students.id, studentsInFixture));
  }
  if (parentsInFixture.length) {
    await database.delete(parents).where(inArray(parents.id, parentsInFixture));
  }
  if (usersInFixture.length) {
    await database.delete(userSchools).where(inArray(userSchools.userId, usersInFixture));
    await database.delete(users).where(inArray(users.id, usersInFixture));
  }
  await database.delete(classes).where(eq(classes.id, fixture.classId));
  await database.delete(schoolTerms).where(and(
    eq(schoolTerms.schoolId, fixture.schoolId),
    eq(schoolTerms.academicYearId, fixture.academicYearId),
    eq(schoolTerms.cycleId, fixture.cycleId),
  ));
  await database.delete(schoolCycles).where(and(
    eq(schoolCycles.schoolId, fixture.schoolId),
    eq(schoolCycles.cycleId, fixture.cycleId),
  ));
  await database.delete(accountingCategories).where(eq(accountingCategories.id, fixture.categoryId));
  await database.delete(academicYears).where(eq(academicYears.id, fixture.academicYearId));
  await database.delete(levels).where(eq(levels.id, fixture.levelId));
  await database.delete(cycles).where(eq(cycles.id, fixture.cycleId));
  await database.delete(schools).where(eq(schools.id, fixture.schoolId));
};

const runScenarios = async (
  database: TuitionProgressReminderDrizzleDatabase,
  fixture: Fixture,
  calculateAccounting: (
    input: AccountingTuitionProgressInput,
    transaction: AccountingTuitionProgressExecutor,
  ) => Promise<AccountingTuitionProgressResult>,
): Promise<void> => {
  await addFullPayment(database, fixture, 'paid-up', new Date('2027-07-14T12:00:00.000Z'));

  const scope = {
    schoolId: fixture.schoolId,
    academicYearId: fixture.academicYearId,
    cycleId: fixture.cycleId,
  };
  const preparationSource = createTuitionProgressReminderDrizzleSource(database, () => FIXED_NOW);
  const simulation = await prepareTuitionProgressReminderControls({
    ...scope,
    now: FIXED_NOW,
    mode: 'simulate',
  }, preparationSource);
  assert(simulation.ok, 'The simulate preparation failed.');
  assert(simulation.plannedCount === STUDENT_CASES.length * 2, 'The schedule did not produce both monthly reminders for every synthetic student.');
  assert(simulation.recordsToInsert.every((record) =>
    record.timeZone === 'Africa/Lome'
    && record.scheduledAt.getUTCHours() === 8
    && record.scheduledAt.getUTCMinutes() === 0), 'The simulated schedule is not 08:00 Africa/Lome.');
  const beforePersist = await database.select({ id: tuitionProgressReminderControls.id })
    .from(tuitionProgressReminderControls);
  assert(beforePersist.length === 0, 'Simulate mode unexpectedly persisted reminder controls.');

  const persisted = await prepareTuitionProgressReminderControls({
    ...scope,
    now: FIXED_NOW,
    mode: 'persist',
  }, preparationSource);
  assert(persisted.ok && persisted.insertedCount === STUDENT_CASES.length * 2, 'The synthetic reminder controls were not persisted.');
  const repeatedPersist = await prepareTuitionProgressReminderControls({
    ...scope,
    now: FIXED_NOW,
    mode: 'persist',
  }, preparationSource);
  assert(repeatedPersist.ok && repeatedPersist.insertedCount === 0, 'Repeated preparation was not idempotent.');

  const monthlyControls = await database.select({
    studentId: tuitionProgressReminderControls.studentId,
    stage: tuitionProgressReminderControls.stage,
    scheduledAt: tuitionProgressReminderControls.scheduledAt,
  }).from(tuitionProgressReminderControls).where(and(
    eq(tuitionProgressReminderControls.schoolId, fixture.schoolId),
    eq(tuitionProgressReminderControls.academicYearId, fixture.academicYearId),
    eq(tuitionProgressReminderControls.cycleId, fixture.cycleId),
  ));
  for (const studentCase of STUDENT_CASES) {
    const matching = monthlyControls.filter((control) => control.studentId === fixture.students[studentCase].id);
    assert(matching.length === 2, `Expected two monthly controls for ${studentCase}.`);
    assert(matching.some((control) => control.stage === 'penultimate'
      && control.scheduledAt.toISOString() === '2027-07-15T08:00:00.000Z'), `The penultimate reminder time is incorrect for ${studentCase}.`);
    assert(matching.some((control) => control.stage === 'last'
      && control.scheduledAt.toISOString() === '2027-07-16T08:00:00.000Z'), `The last reminder time is incorrect for ${studentCase}.`);
  }

  const executionSource = createTuitionProgressReminderExecutionDrizzleSource(database);
  for (const studentCase of STUDENT_CASES) {
    const execution = await executeDueTuitionProgressReminderControls({
      scope: { ...scope, studentId: fixture.students[studentCase].id },
      limit: 1,
    }, {
      source: executionSource,
      calculateAccounting: (input) => database.transaction((transaction) =>
        calculateAccounting(input, transaction)),
      clock: () => FIXED_NOW,
    });
    assert(execution.claimedCount === 1, `No due control was executed for ${studentCase}.`);
  }

  const paidUpControl = await database.select({
    status: tuitionProgressReminderControls.status,
    targetAmount: tuitionProgressReminderControls.targetAmount,
    netPaidAmount: tuitionProgressReminderControls.netPaidAmount,
    shortfallAmount: tuitionProgressReminderControls.shortfallAmount,
  }).from(tuitionProgressReminderControls).where(and(
    eq(tuitionProgressReminderControls.schoolId, fixture.schoolId),
    eq(tuitionProgressReminderControls.academicYearId, fixture.academicYearId),
    eq(tuitionProgressReminderControls.cycleId, fixture.cycleId),
    eq(tuitionProgressReminderControls.studentId, fixture.students['paid-up'].id),
    eq(tuitionProgressReminderControls.monthStart, '2027-07-01'),
    eq(tuitionProgressReminderControls.stage, 'penultimate'),
  )).limit(1);
  assert(paidUpControl[0]?.status === 'checked_up_to_date'
    && paidUpControl[0].targetAmount != null
    && paidUpControl[0].netPaidAmount === 90_000
    && paidUpControl[0].shortfallAmount === 0, 'Accounting amounts for the fully paid student were not persisted correctly.');
  for (const studentCase of STUDENT_CASES.filter((studentCase) => studentCase !== 'paid-up')) {
    const control = await database.select({
      status: tuitionProgressReminderControls.status,
      targetAmount: tuitionProgressReminderControls.targetAmount,
      netPaidAmount: tuitionProgressReminderControls.netPaidAmount,
      shortfallAmount: tuitionProgressReminderControls.shortfallAmount,
    }).from(tuitionProgressReminderControls).where(and(
      eq(tuitionProgressReminderControls.schoolId, fixture.schoolId),
      eq(tuitionProgressReminderControls.academicYearId, fixture.academicYearId),
      eq(tuitionProgressReminderControls.cycleId, fixture.cycleId),
      eq(tuitionProgressReminderControls.studentId, fixture.students[studentCase].id),
      eq(tuitionProgressReminderControls.monthStart, '2027-07-01'),
      eq(tuitionProgressReminderControls.stage, 'penultimate'),
    )).limit(1);
    assert(control[0]?.status === 'checked_below_target'
      && control[0].targetAmount != null
      && control[0].netPaidAmount === 0
      && control[0].shortfallAmount === control[0].targetAmount,
    `${studentCase} accounting amounts were not classified and persisted correctly.`);
  }

  const inAppSource = createTuitionProgressReminderInAppNotificationDrizzleSource({
    database,
    clock: () => FIXED_NOW,
    calculateAccounting: (input, transaction) => calculateAccounting(input, transaction),
  });

  const belowControl = await controlFor(database, fixture, 'below-target');
  const created = await inAppSource.processControl({ controlId: belowControl.id, now: FIXED_NOW });
  const duplicate = await inAppSource.processControl({ controlId: belowControl.id, now: FIXED_NOW });
  assert(created === 'created' && duplicate === 'already_created', 'In-app notification creation is not idempotent.');
  await createSyntheticDevice(database, fixture, 'below-target');
  const queued = await inAppSource.queuePushForControl({ controlId: belowControl.id, now: FIXED_NOW });
  const duplicateQueue = await inAppSource.queuePushForControl({ controlId: belowControl.id, now: FIXED_NOW });
  assert(queued === 'queued' && duplicateQueue === 'already_queued', 'Push outbox queueing is not idempotent.');

  const paidBeforeInApp = await controlFor(database, fixture, 'paid-before-in-app');
  await addFullPayment(database, fixture, 'paid-before-in-app', new Date('2027-07-15T08:25:00.000Z'));
  assert(
    await inAppSource.processControl({ controlId: paidBeforeInApp.id, now: FIXED_NOW }) === 'suppressed_paid',
    'A payment made before in-app creation did not suppress the notification.',
  );

  const paidBeforePush = await controlFor(database, fixture, 'paid-before-push');
  assert(
    await inAppSource.processControl({ controlId: paidBeforePush.id, now: FIXED_NOW }) === 'created',
    'The pre-push payment scenario did not create its in-app notification.',
  );
  await createSyntheticDevice(database, fixture, 'paid-before-push');
  assert(
    await inAppSource.queuePushForControl({ controlId: paidBeforePush.id, now: FIXED_NOW }) === 'queued',
    'The pre-push payment scenario was not placed in the outbox.',
  );
  await addFullPayment(database, fixture, 'paid-before-push', new Date('2027-07-15T08:40:00.000Z'));

  const disabledParent = fixture.students['disabled-parent'];
  await database.update(users).set({ isDeleted: true }).where(eq(users.id, disabledParent.userId));
  const disabledControl = await controlFor(database, fixture, 'disabled-parent');
  assert(
    await inAppSource.processControl({ controlId: disabledControl.id, now: FIXED_NOW }) === 'skipped_no_recipient',
    'A disabled parent account was not rejected.',
  );

  const invalidLink = fixture.students['inactive-parent-link'];
  await database.update(userSchools).set({ isActive: false }).where(and(
    eq(userSchools.userId, invalidLink.userId),
    eq(userSchools.schoolId, fixture.schoolId),
    eq(userSchools.role, 'parent'),
  ));
  const invalidLinkControl = await controlFor(database, fixture, 'inactive-parent-link');
  assert(
    await inAppSource.processControl({ controlId: invalidLinkControl.id, now: FIXED_NOW }) === 'skipped_no_recipient',
    'An inactive parent-school relationship was not rejected.',
  );

  const quietControl = await controlFor(database, fixture, 'quiet-hours');
  assert(
    await inAppSource.processControl({ controlId: quietControl.id, now: FIXED_NOW }) === 'created',
    'The quiet-hours scenario did not create its in-app notification.',
  );
  await createSyntheticDevice(database, fixture, 'quiet-hours');
  const eveningQueueTime = new Date('2027-07-15T21:00:00.000Z');
  assert(
    await inAppSource.queuePushForControl({ controlId: quietControl.id, now: eveningQueueTime }) === 'queued',
    'The quiet-hours scenario was not placed in the outbox before quiet hours.',
  );

  const pushSource = createTuitionProgressReminderPushDrizzleSource(database, (input, transaction) =>
    calculateAccounting(input, transaction));
  const sendCalls: TuitionProgressReminderPushClaim[] = [];
  const runPushAt = (now: Date) => processTuitionProgressReminderPushOutbox({
    source: pushSource,
    clock: () => now,
    limit: 10,
    send: async (claim) => {
      sendCalls.push(claim);
      return { status: 'retryable_failure', error: 'test_transport_disabled' };
    },
  });

  const firstPushPass = await runPushAt(new Date('2027-07-15T08:50:00.000Z'));
  assert(firstPushPass.claimedCount === 2, 'The due outbox pass did not claim the two expected messages.');
  assert(sendCalls.length === 1 && sendCalls[0].studentId === fixture.students['below-target'].id,
    'The push transport stub was called for an ineligible or paid student.');

  const linkedControls = await database.select({
    studentId: tuitionProgressReminderControls.studentId,
    notificationId: tuitionProgressReminderControls.notificationId,
  }).from(tuitionProgressReminderControls).where(and(
    eq(tuitionProgressReminderControls.schoolId, fixture.schoolId),
    eq(tuitionProgressReminderControls.academicYearId, fixture.academicYearId),
    eq(tuitionProgressReminderControls.cycleId, fixture.cycleId),
  ));
  const outboxRows = linkedControls.flatMap(({ studentId, notificationId }) =>
    notificationId == null ? [] : [{ studentId, notificationId }]);
  const belowOutbox = outboxRows.find((row) => row.studentId === fixture.students['below-target'].id);
  const paidOutbox = outboxRows.find((row) => row.studentId === fixture.students['paid-before-push'].id);
  assert(belowOutbox && paidOutbox, 'Expected push outbox rows were not linked to the synthetic controls.');
  const [belowDelivery] = await database.select({
    status: notificationDeliveryOutbox.status,
    attemptCount: notificationDeliveryOutbox.attemptCount,
    transportState: notificationDeliveryOutbox.transportState,
  }).from(notificationDeliveryOutbox).where(eq(notificationDeliveryOutbox.notificationId, belowOutbox.notificationId));
  assert(belowDelivery?.status === 'pending'
    && belowDelivery.attemptCount === 1
    && belowDelivery.transportState == null, 'A retryable mock transport error did not leave the outbox safely retryable.');
  const [paidDelivery] = await database.select({
    status: notificationDeliveryOutbox.status,
    lastError: notificationDeliveryOutbox.lastError,
  }).from(notificationDeliveryOutbox).where(eq(notificationDeliveryOutbox.notificationId, paidOutbox.notificationId));
  assert(paidDelivery?.status === 'failed'
    && paidDelivery.lastError === 'payment_progress_caught_up_before_push',
  'The payment made before push emission did not suppress the push.');

  const quietOutboxPass = await runPushAt(QUIET_HOURS_NOW);
  assert(quietOutboxPass.claimedCount === 2, 'The due outbox rows were not claimed for quiet-hours expiry handling.');
  assert(sendCalls.length === 1, 'The transport stub was called during system quiet hours.');
  const quietControlAfter = await controlFor(database, fixture, 'quiet-hours');
  assert(quietControlAfter.notificationId != null, 'The quiet-hours notification is missing.');
  const [quietDelivery] = await database.select({
    status: notificationDeliveryOutbox.status,
    lastError: notificationDeliveryOutbox.lastError,
  }).from(notificationDeliveryOutbox)
    .where(eq(notificationDeliveryOutbox.notificationId, quietControlAfter.notificationId));
  assert(quietDelivery?.status === 'failed'
    && quietDelivery.lastError === 'control_expired_in_quiet_hours',
  'The quiet-hours push was not prevented when the next permitted time exceeded expiry.');

  const allNotifications = await database.select({
    id: notifications.id,
    title: notifications.title,
    body: notifications.body,
    dedupeKey: notifications.dedupeKey,
  }).from(notifications).where(sql`${notifications.dedupeKey} LIKE 'tuition-progress-reminder:%'`);
  assert(allNotifications.length === 3, 'Unexpected number of in-app notifications were created.');
  assert(allNotifications.every((notification) =>
    notification.title.trim().length > 0
    && notification.body.trim().length > 0
    && notification.dedupeKey != null), 'A synthetic in-app notification is missing content or its dedupe key.');
};

const main = async (): Promise<void> => {
  const config = readConfig();
  await inspectTarget(config);
  const runnerPool = createTargetPool(config, 'ecoletrack_tuition_reminder_test_runner');
  const database = drizzle(runnerPool, { schema });

  let applicationDatabase: TuitionProgressReminderDrizzleDatabase | null = null;
  let fixture: Fixture | null = null;
  let targetVerified = false;
  try {
    await verifyTargetAgain(database, config);
    targetVerified = true;
    process.env.SQL_HOST = config.host;
    process.env.SQL_PORT = String(config.port);
    process.env.SQL_USER = config.user;
    process.env.SQL_PASSWORD = config.password;
    process.env.SQL_DB_NAME = config.database;

    const databaseModule = await import('../src/db/index.ts');
    applicationDatabase = databaseModule.db;
    await verifyTargetAgain(applicationDatabase, config);
    const accountingApi = await import('../src/lib/accountingApi.ts');
    const calculateAccounting = (
      input: Parameters<typeof accountingApi.loadAccountingTuitionProgressCandidatesInTransaction>[0],
      transaction: AccountingTuitionProgressExecutor,
    ) => accountingApi.loadAccountingTuitionProgressCandidatesInTransaction(input, transaction);

    fixture = await database.transaction((transaction) => createFixture(transaction));
    await runScenarios(database, fixture, calculateAccounting);
    console.log('PostgreSQL tuition-reminder integration checks passed; transport was mocked and no FCM request was made.');
  } finally {
    try {
      if (targetVerified && fixture) await cleanupFixture(database, fixture);
    } finally {
      try {
        await database.$client.end();
      } finally {
        if (applicationDatabase) await applicationDatabase.$client.end();
      }
    }
  }
};

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown runner failure.';
  console.error(`PostgreSQL tuition-reminder integration checks failed: ${message}`);
  process.exitCode = 1;
});
