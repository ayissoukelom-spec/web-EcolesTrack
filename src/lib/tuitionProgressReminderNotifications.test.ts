import { describe, expect, it, vi } from 'vitest';
import {
  academicYears,
  cycles,
  notifications,
  schoolCycles,
  schools,
  students,
  tuitionProgressReminderControls,
} from '../db/schema.ts';
import {
  assessTuitionProgressReminderNotification,
  buildTuitionProgressReminderInAppNotification,
  createTuitionProgressReminderInAppNotifications,
  getTuitionProgressReminderNotificationDedupeKey,
  type TuitionProgressReminderNotificationControl,
} from './tuitionProgressReminderNotifications.ts';
import {
  createTuitionProgressReminderInAppNotificationDrizzleSource,
  type TuitionProgressReminderInAppNotificationDatabase,
} from './tuitionProgressReminderNotificationsDrizzle.ts';
import type { AccountingTuitionProgressResult } from './accountingTuitionProgress.ts';

const now = new Date('2027-07-16T10:00:00.000Z');

const control = (
  overrides: Partial<TuitionProgressReminderNotificationControl> = {},
): TuitionProgressReminderNotificationControl => ({
  id: 501,
  schoolId: 7,
  academicYearId: 23,
  cycleId: 4,
  studentId: 31,
  monthStart: '2027-07-01',
  scheduledAt: new Date('2027-07-16T08:00:00.000Z'),
  expiresAt: new Date('2027-07-16T22:59:59.999Z'),
  timeZone: 'Africa/Lome',
  status: 'checked_below_target',
  notificationId: null,
  ...overrides,
});

const readyAccounting = (
  studentStatus: 'below_target' | 'up_to_date' = 'below_target',
): AccountingTuitionProgressResult => ({
  status: 'ready',
  schoolId: 7,
  academicYearId: 23,
  cycleId: 4,
  calendar: {
    system: 'trimester',
    startDate: '2026-09-01',
    endDate: '2027-07-31',
    durationDays: 334,
  },
  students: [{
    studentId: 31,
    firstName: 'Awa',
    lastName: 'Mensah',
    matricule: 'E-31',
    className: '6e A',
    status: studentStatus,
    annualNetAmount: 90000,
    netPaidAmount: studentStatus === 'below_target' ? 10000 : 30000,
    month: '2027-07',
    expectedCumulativeAmount: 30000,
    shortfallAmount: studentStatus === 'below_target' ? 20000 : 0,
  }],
});

const makeDatabase = (options: {
  control?: Partial<TuitionProgressReminderNotificationControl>;
  recipients?: Array<{
    userId: number;
    studentId: number;
    firstName: string;
    lastName: string;
    studentSchoolId: number;
    studentIsActive: boolean;
    parentUserId: number;
    parentSchoolId: number;
    membershipUserId: number;
    membershipSchoolId: number;
    membershipRole: string;
    membershipIsActive: boolean | null;
    userRole?: string;
    userIsDeleted: boolean;
  }>;
  insertedNotifications?: Array<{ id: number; userId: number }>;
  existingNotifications?: Array<{ id: number; userId: number; dedupeKey?: string }>;
} = {}) => {
  const controlRow = { ...control(), ...options.control };
  const selectRows = new Map<unknown, unknown[]>([
    [tuitionProgressReminderControls, [{ id: controlRow.id }, controlRow, controlRow]],
    [schools, [{ id: 7, timeZone: 'Africa/Lome', isSuspended: false }]],
    [academicYears, [{ id: 23, schoolId: 7, isActive: true }]],
    [cycles, [{ id: 4, isActive: true }]],
    [schoolCycles, [{ id: 70, isActive: true }]],
    [students, options.recipients ?? [{
      userId: 90,
      studentId: 31,
      firstName: 'Awa',
      lastName: 'Mensah',
      studentSchoolId: 7,
      studentIsActive: true,
      parentUserId: 90,
      parentSchoolId: 7,
      membershipUserId: 90,
      membershipSchoolId: 7,
      membershipRole: 'parent',
      membershipIsActive: true,
      userRole: 'parent',
      userIsDeleted: false,
    }]],
    [notifications, options.existingNotifications ?? [{ id: 801, userId: 90, dedupeKey: 'tuition-progress-reminder:501' }]],
  ]);
  const selectCounts = new Map<unknown, number>();
  const insertValues: Array<Record<string, unknown>> = [];
  const updateValues: Array<Record<string, unknown>> = [];
  const createSelectBuilder = () => {
    let table: unknown;
    const builder: any = {
      from(value: unknown) {
        table = value;
        return builder;
      },
      innerJoin() { return builder; },
      leftJoin() { return builder; },
      where() { return builder; },
      orderBy() { return builder; },
      limit() { return builder; },
      for() { return builder; },
      then(resolve: (rows: unknown[]) => unknown, reject: (error: unknown) => unknown) {
        const rows = selectRows.get(table) ?? [];
        const count = selectCounts.get(table) ?? 0;
        selectCounts.set(table, count + 1);
        const selected = table === tuitionProgressReminderControls
          ? rows[count] == null ? [] : [rows[count]]
          : rows;
        return Promise.resolve(selected).then(resolve, reject);
      },
    };
    return builder;
  };
  const database = {
    select: vi.fn(() => createSelectBuilder()),
    selectDistinct: vi.fn(() => createSelectBuilder()),
    insert: vi.fn(() => ({
      values(values: Record<string, unknown>) {
        insertValues.push(values);
        return {
          onConflictDoNothing: () => ({
            returning: async () => options.insertedNotifications ?? [{ id: 801, userId: 90 }],
          }),
        };
      },
    })),
    update: vi.fn(() => ({
      set(values: Record<string, unknown>) {
        updateValues.push(values);
        return {
          where: () => ({
            returning: async () => {
              Object.assign(controlRow, values);
              return [{ id: controlRow.id }];
            },
          }),
        };
      },
    })),
    execute: vi.fn(async () => ({ rows: [] })),
    transaction: vi.fn(async (callback: (transaction: unknown) => unknown) => callback(database)),
  } as unknown as TuitionProgressReminderInAppNotificationDatabase;

  return { database, controlRow, insertValues, updateValues };
};

const runWith = async (
  mock: ReturnType<typeof makeDatabase>,
  accounting: AccountingTuitionProgressResult = readyAccounting(),
) => {
  const calculateAccounting = vi.fn(async () => accounting);
  const source = createTuitionProgressReminderInAppNotificationDrizzleSource({
    database: mock.database,
    clock: () => now,
    calculateAccounting: calculateAccounting as never,
  });
  const result = await createTuitionProgressReminderInAppNotifications({
    now,
    clock: () => now,
    source,
  });
  return { result, calculateAccounting };
};

describe('tuition progress reminder in-app notifications', () => {
  it('rechecks payments transactionally and suppresses a notification when the target is now met', async () => {
    const mock = makeDatabase();
    const { result, calculateAccounting } = await runWith(mock, readyAccounting('up_to_date'));

    expect(result.results).toEqual([{ controlId: 501, status: 'suppressed_paid' }]);
    expect(calculateAccounting).toHaveBeenCalledOnce();
    expect(mock.database.transaction).toHaveBeenCalledOnce();
    expect(mock.insertValues).toHaveLength(0);
    expect(mock.controlRow).toMatchObject({
      status: 'suppressed_paid',
      targetAmount: 30000,
      netPaidAmount: 30000,
      shortfallAmount: 0,
      notificationId: null,
    });
  });

  it('creates one in-app notification for the currently authorized parent and links it idempotently', async () => {
    const mock = makeDatabase();
    const { result } = await runWith(mock);

    expect(result).toMatchObject({
      processedCount: 1,
      createdCount: 1,
      pushQueuedCount: 0,
      pushUnavailableDeviceCount: 1,
      results: [{ controlId: 501, status: 'created' }],
    });
    expect(mock.insertValues).toHaveLength(1);
    const formatAmount = (amount: number) => new Intl.NumberFormat('fr-FR', {
      maximumFractionDigits: 0,
    }).format(amount);
    expect(mock.insertValues[0]).toMatchObject({
      userId: 90,
      title: 'Rappel de scolarité',
      body: [
        'Cher parent, au 16/07/2027, voici la situation des versements de scolarité de votre enfant Awa Mensah :',
        '',
        `• Scolarité annuelle : ${formatAmount(90000)} FCFA`,
        `• Montant déjà versé : ${formatAmount(10000)} FCFA`,
        `• Montant recommandé à ce jour : ${formatAmount(30000)} FCFA`,
        `• Complément de versement conseillé : ${formatAmount(20000)} FCFA`,
        '',
        'Nous vous invitons à verser ce complément pour être à jour par rapport au rythme recommandé de paiement.',
        '',
        'Si vous avez récemment effectué un versement non encore enregistré, veuillez vous rapprocher de l’établissement.',
        '',
        'Merci pour votre collaboration.',
      ].join('\n'),
      type: 'info',
      dedupeKey: 'tuition-progress-reminder:501',
    });
    expect(mock.insertValues[0].body).toContain('Complément de versement conseillé');
    expect(mock.insertValues[0].body).toContain('rythme recommandé de paiement');
    expect(mock.controlRow).toMatchObject({
      status: 'checked_below_target',
      notificationId: 801,
      targetAmount: 30000,
      netPaidAmount: 10000,
      shortfallAmount: 20000,
    });
  });

  it('fails closed when there is no authorized parent in the current school-scoped relationship', async () => {
    const mock = makeDatabase({ recipients: [] });
    const { result, calculateAccounting } = await runWith(mock);

    expect(result.results).toEqual([{ controlId: 501, status: 'skipped_no_recipient' }]);
    expect(calculateAccounting).not.toHaveBeenCalled();
    expect(mock.insertValues).toHaveLength(0);
    expect(mock.controlRow).toMatchObject({
      status: 'skipped_no_recipient',
      notificationId: null,
    });
  });

  it('refuses a recipient whose parent record belongs to another school', async () => {
    const mock = makeDatabase({
      recipients: [{
        userId: 90,
        studentId: 31,
        firstName: 'Awa',
        lastName: 'Mensah',
        studentSchoolId: 7,
        studentIsActive: true,
        parentUserId: 90,
        parentSchoolId: 8,
        membershipUserId: 90,
        membershipSchoolId: 7,
        membershipRole: 'parent',
        membershipIsActive: true,
        userIsDeleted: false,
      }],
    });
    const { result } = await runWith(mock);

    expect(result.results).toEqual([{ controlId: 501, status: 'skipped_no_recipient' }]);
    expect(mock.insertValues).toHaveLength(0);
  });

  it('accepts a multifunction user when the school-scoped parent relationship is valid', async () => {
    const mock = makeDatabase({
      recipients: [{
        userId: 90,
        studentId: 31,
        firstName: 'Awa',
        lastName: 'Mensah',
        studentSchoolId: 7,
        studentIsActive: true,
        parentUserId: 90,
        parentSchoolId: 7,
        membershipUserId: 90,
        membershipSchoolId: 7,
        membershipRole: 'parent',
        membershipIsActive: true,
        userRole: 'school_admin',
        userIsDeleted: false,
      }],
    });
    const { result } = await runWith(mock);

    expect(result.results).toEqual([{ controlId: 501, status: 'created' }]);
    expect(mock.insertValues).toHaveLength(1);
    expect(mock.insertValues[0].userId).toBe(90);
  });

  it('does not notify a disabled account even when the student relationship still exists', async () => {
    const mock = makeDatabase({
      recipients: [{
        userId: 90,
        studentId: 31,
        firstName: 'Awa',
        lastName: 'Mensah',
        studentSchoolId: 7,
        studentIsActive: true,
        parentUserId: 90,
        parentSchoolId: 7,
        membershipUserId: 90,
        membershipSchoolId: 7,
        membershipRole: 'parent',
        membershipIsActive: true,
        userIsDeleted: true,
      }],
    });
    const { result } = await runWith(mock);

    expect(result.results).toEqual([{ controlId: 501, status: 'skipped_no_recipient' }]);
    expect(mock.insertValues).toHaveLength(0);
  });

  it('links an existing dedupe-key notification only when its recipient matches', async () => {
    const mock = makeDatabase({
      insertedNotifications: [],
      existingNotifications: [{ id: 800, userId: 90 }],
    });
    const { result } = await runWith(mock);

    expect(result.results).toEqual([{ controlId: 501, status: 'already_created' }]);
    expect(mock.controlRow.notificationId).toBe(800);
  });

  it('expires a control without calculating or creating a notification', async () => {
    const mock = makeDatabase({
      control: { expiresAt: new Date('2027-07-16T09:59:59.999Z') },
    });
    const { result, calculateAccounting } = await runWith(mock);

    expect(result.results).toEqual([{ controlId: 501, status: 'expired' }]);
    expect(calculateAccounting).not.toHaveBeenCalled();
    expect(mock.insertValues).toHaveLength(0);
    expect(mock.controlRow.status).toBe('expired');
  });

  it('rejects ambiguous accounting results and never describes a theoretical gap as a contract default', () => {
    const currentAccounting = readyAccounting();
    if (currentAccounting.status !== 'ready') throw new Error('Expected ready accounting fixture.');
    const ambiguous: AccountingTuitionProgressResult = {
      ...currentAccounting,
      students: [{
        studentId: 31,
        firstName: 'Awa',
        lastName: 'Mensah',
        matricule: 'E-31',
        className: '6e A',
        status: 'excluded_ambiguous',
        reasonCode: 'multiple_active_tuition_obligations',
        reason: 'ambiguous',
      }],
    };
    expect(assessTuitionProgressReminderNotification({
      control: control(),
      now,
      accounting: ambiguous,
    })).toMatchObject({ status: 'skipped_ambiguous' });

    const assessment = assessTuitionProgressReminderNotification({
      control: control(),
      now,
      accounting: readyAccounting(),
    });
    expect(assessment.status).toBe('below_target');
    if (assessment.status === 'below_target') {
      expect(buildTuitionProgressReminderInAppNotification(assessment).body)
        .toContain('Montant recommandé à ce jour :');
    }
    expect(getTuitionProgressReminderNotificationDedupeKey(501))
      .toBe('tuition-progress-reminder:501');
  });
});
