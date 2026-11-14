import { and, asc, eq, exists, gt, inArray, isNull, lte, notExists, or, sql } from 'drizzle-orm';
import type { TuitionProgressReminderDrizzleDatabase } from './tuitionProgressReminderDrizzle.ts';
import type { AccountingTuitionProgressExecutor } from './accountingApi.ts';
import type {
  AccountingTuitionProgressInput,
  AccountingTuitionProgressResult,
} from './accountingTuitionProgress.ts';
import {
  assessTuitionProgressReminderNotification,
  buildTuitionProgressReminderInAppNotification,
  getTuitionProgressReminderAssessmentDate,
  getTuitionProgressReminderNotificationDedupeKey,
  type TuitionProgressReminderInAppNotificationSource,
  type TuitionProgressReminderNotificationControl,
} from './tuitionProgressReminderNotifications.ts';
import { getTuitionProgressReminderQuietHoursDecision } from './tuitionProgressReminderQuietHours.ts';
import type { TuitionProgressReminderExecutionScope } from './tuitionProgressReminderExecution.ts';
import type {
  TuitionProgressReminderPushClaim,
  TuitionProgressReminderPushSource,
} from './tuitionProgressReminderPush.ts';
import {
  academicYears,
  accountingCategories,
  classes,
  cycles,
  financialAdjustmentAllocations,
  financialAdjustments,
  financialObligations,
  financialPaymentAllocations,
  financialPayments,
  levels,
  notifications,
  notificationDeliveryOutbox,
  parents,
  schoolCycles,
  schools,
  students,
  tuitionProgressReminderControls,
  userSchools,
  users,
} from '../db/schema.ts';

export type TuitionProgressReminderInAppNotificationDatabase =
  TuitionProgressReminderDrizzleDatabase;

export type TuitionProgressReminderInAppNotificationDependencies = {
  database: TuitionProgressReminderInAppNotificationDatabase;
  clock?: () => Date;
  calculateAccounting: (
    input: AccountingTuitionProgressInput,
    transaction: AccountingTuitionProgressExecutor,
  ) => Promise<AccountingTuitionProgressResult>;
};

const isValidDate = (value: unknown): value is Date =>
  value instanceof Date && Number.isFinite(value.getTime());

const isPositiveSafeInteger = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Number(value) > 0;

const mapControl = (row: TuitionProgressReminderNotificationControl): TuitionProgressReminderNotificationControl => row;

const controlScopeConditions = (
  scope: TuitionProgressReminderExecutionScope | undefined,
) => {
  if (!scope) return [];
  return [
    eq(tuitionProgressReminderControls.schoolId, scope.schoolId),
    eq(tuitionProgressReminderControls.academicYearId, scope.academicYearId),
    eq(tuitionProgressReminderControls.cycleId, scope.cycleId),
    ...(scope.studentId == null ? [] : [eq(tuitionProgressReminderControls.studentId, scope.studentId)]),
    ...(scope.monthStart == null ? [] : [eq(tuitionProgressReminderControls.monthStart, scope.monthStart)]),
    ...(scope.stage == null ? [] : [eq(tuitionProgressReminderControls.stage, scope.stage)]),
  ];
};

const saveStatus = async (
  transaction: AccountingTuitionProgressExecutor,
  controlId: number,
  now: Date,
  status: 'expired' | 'suppressed_paid' | 'skipped_ambiguous' | 'skipped_invalid_calendar' | 'skipped_no_recipient',
  lastError: string | null,
  amounts?: { targetAmount: number; netPaidAmount: number; shortfallAmount: number },
): Promise<void> => {
  await transaction.update(tuitionProgressReminderControls).set({
    status,
    targetAmount: amounts?.targetAmount ?? null,
    netPaidAmount: amounts?.netPaidAmount ?? null,
    shortfallAmount: amounts?.shortfallAmount ?? null,
    lastCalculatedAt: now,
    lastError,
    updatedAt: now,
  }).where(eq(tuitionProgressReminderControls.id, controlId)).returning({
    id: tuitionProgressReminderControls.id,
  });
};

const lockCurrentTuitionAccounting = async (
  transaction: AccountingTuitionProgressExecutor,
  control: TuitionProgressReminderNotificationControl,
): Promise<void> => {
  const obligationRows = await transaction.select({
    id: financialObligations.id,
  }).from(financialObligations)
    .innerJoin(accountingCategories, and(
      eq(accountingCategories.id, financialObligations.categoryId),
      eq(accountingCategories.schoolId, control.schoolId),
      eq(accountingCategories.code, 'tuition'),
    ))
    .where(and(
      eq(financialObligations.schoolId, control.schoolId),
      eq(financialObligations.academicYearId, control.academicYearId),
      eq(financialObligations.studentId, control.studentId),
      eq(financialObligations.status, 'active'),
    ))
    .for('update', { of: [financialObligations] });
  const obligationIds = obligationRows.map((row) => row.id);
  if (!obligationIds.length) return;

  const allocationRefs = await transaction.select({
    id: financialPaymentAllocations.id,
    paymentId: financialPaymentAllocations.paymentId,
  }).from(financialPaymentAllocations)
    .where(inArray(financialPaymentAllocations.obligationId, obligationIds));
  const paymentIds = [...new Set(allocationRefs.map((row) => row.paymentId))];
  if (paymentIds.length) {
    await transaction.select({ id: financialPayments.id })
      .from(financialPayments)
      .where(inArray(financialPayments.id, paymentIds))
      .for('update');
  }

  const allocations = await transaction.select({
    id: financialPaymentAllocations.id,
  }).from(financialPaymentAllocations)
    .where(inArray(financialPaymentAllocations.obligationId, obligationIds))
    .for('update');
  const allocationIds = allocations.map((row) => row.id);
  if (!allocationIds.length) return;

  const adjustmentRows = await transaction.select({
    id: financialAdjustmentAllocations.id,
    adjustmentId: financialAdjustmentAllocations.adjustmentId,
  }).from(financialAdjustmentAllocations)
    .where(inArray(financialAdjustmentAllocations.paymentAllocationId, allocationIds))
    .for('update');
  const adjustmentIds = [...new Set(adjustmentRows.map((row) => row.adjustmentId))];
  if (adjustmentIds.length) {
    await transaction.select({ id: financialAdjustments.id })
      .from(financialAdjustments)
      .where(inArray(financialAdjustments.id, adjustmentIds))
      .for('update');
  }
};

type AuthorizedReminderRecipient = {
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
  userIsDeleted: boolean;
};

const findAuthorizedRecipient = async (
  transaction: AccountingTuitionProgressExecutor,
  control: TuitionProgressReminderNotificationControl,
): Promise<AuthorizedReminderRecipient[]> =>
  transaction.select({
    userId: users.id,
    studentId: students.id,
    firstName: students.firstName,
    lastName: students.lastName,
    studentSchoolId: students.schoolId,
    studentIsActive: students.isActive,
    parentUserId: parents.userId,
    parentSchoolId: parents.schoolId,
    membershipUserId: userSchools.userId,
    membershipSchoolId: userSchools.schoolId,
    membershipRole: userSchools.role,
    membershipIsActive: userSchools.isActive,
    userIsDeleted: users.isDeleted,
  }).from(students)
    .innerJoin(parents, and(
      eq(parents.id, students.parentId),
      eq(parents.schoolId, control.schoolId),
    ))
    .innerJoin(userSchools, and(
      eq(userSchools.userId, parents.userId),
      eq(userSchools.schoolId, control.schoolId),
      eq(userSchools.role, 'parent'),
    ))
    .innerJoin(users, and(
      eq(users.id, parents.userId),
      eq(users.isDeleted, false),
    ))
    .innerJoin(financialObligations, and(
      eq(financialObligations.studentId, students.id),
      eq(financialObligations.schoolId, control.schoolId),
      eq(financialObligations.academicYearId, control.academicYearId),
      eq(financialObligations.status, 'active'),
    ))
    .innerJoin(accountingCategories, and(
      eq(accountingCategories.id, financialObligations.categoryId),
      eq(accountingCategories.schoolId, control.schoolId),
      eq(accountingCategories.code, 'tuition'),
    ))
    .innerJoin(classes, and(
      eq(classes.id, financialObligations.classId),
      or(eq(classes.schoolId, control.schoolId), isNull(classes.schoolId)),
      eq(classes.academicYearId, control.academicYearId),
    ))
    .innerJoin(levels, and(
      eq(levels.id, classes.levelId),
      eq(levels.cycleId, control.cycleId),
    ))
    .where(and(
      eq(students.id, control.studentId),
      eq(students.schoolId, control.schoolId),
      eq(students.isActive, true),
      sql`${userSchools.isActive} IS DISTINCT FROM FALSE`,
    ))
    .limit(2)
    .for('share', { of: [students, parents, userSchools, users] });

const processControl = async (
  transaction: AccountingTuitionProgressExecutor,
  controlId: number,
  clock: () => Date,
  calculateAccounting: TuitionProgressReminderInAppNotificationDependencies['calculateAccounting'],
): Promise<Awaited<ReturnType<TuitionProgressReminderInAppNotificationSource['processControl']>>> => {
  const [row] = await transaction.select({
    id: tuitionProgressReminderControls.id,
    schoolId: tuitionProgressReminderControls.schoolId,
    academicYearId: tuitionProgressReminderControls.academicYearId,
    cycleId: tuitionProgressReminderControls.cycleId,
    studentId: tuitionProgressReminderControls.studentId,
    monthStart: tuitionProgressReminderControls.monthStart,
    scheduledAt: tuitionProgressReminderControls.scheduledAt,
    expiresAt: tuitionProgressReminderControls.expiresAt,
    timeZone: tuitionProgressReminderControls.timeZone,
    status: tuitionProgressReminderControls.status,
    notificationId: tuitionProgressReminderControls.notificationId,
  }).from(tuitionProgressReminderControls)
    .where(eq(tuitionProgressReminderControls.id, controlId))
    .for('update');
  if (!row) return 'not_due';
  const control = mapControl(row);
  let now = clock();
  if (!isValidDate(now)) throw new Error('The in-app reminder clock returned an invalid timestamp.');

  if (control.status !== 'checked_below_target' || control.notificationId != null) {
    return 'already_created';
  }
  if (control.expiresAt.getTime() <= now.getTime()) {
    await saveStatus(transaction, control.id, now, 'expired', 'control_expired');
    return 'expired';
  }
  if (control.scheduledAt.getTime() > now.getTime()) return 'not_due';

  const assessmentDate = getTuitionProgressReminderAssessmentDate(now, control.timeZone);
  if (!assessmentDate || control.monthStart !== `${assessmentDate.slice(0, 7)}-01`) {
    await saveStatus(transaction, control.id, now, 'skipped_invalid_calendar', 'invalid_control_calendar');
    return 'skipped_invalid_calendar';
  }

  const [school] = await transaction.select({
    id: schools.id,
    timeZone: schools.timeZone,
    isSuspended: schools.isSuspended,
  }).from(schools).where(eq(schools.id, control.schoolId)).for('share');
  const [academicYear] = await transaction.select({
    id: academicYears.id,
    schoolId: academicYears.schoolId,
    isActive: academicYears.isActive,
  }).from(academicYears).where(eq(academicYears.id, control.academicYearId)).for('update');
  const [cycle] = await transaction.select({
    id: cycles.id,
    isActive: cycles.isActive,
  }).from(cycles).where(eq(cycles.id, control.cycleId)).for('share');
  const [schoolCycle] = await transaction.select({
    id: schoolCycles.id,
    isActive: schoolCycles.isActive,
  }).from(schoolCycles).where(and(
    eq(schoolCycles.schoolId, control.schoolId),
    eq(schoolCycles.cycleId, control.cycleId),
  )).for('share');

  if (!school || school.isSuspended
    || !school.timeZone || school.timeZone.trim() !== control.timeZone
    || !getTuitionProgressReminderAssessmentDate(now, school.timeZone)
    || !academicYear || !academicYear.isActive
    || (academicYear.schoolId != null && academicYear.schoolId !== control.schoolId)
    || !cycle || !cycle.isActive
    || !schoolCycle || !schoolCycle.isActive) {
    await saveStatus(transaction, control.id, now, 'skipped_invalid_calendar', 'current_school_calendar_unavailable');
    return 'skipped_invalid_calendar';
  }

  await lockCurrentTuitionAccounting(transaction, control);
  const recipients = await findAuthorizedRecipient(transaction, control);
  if (recipients.length !== 1
    || recipients[0].studentId !== control.studentId
    || !isPositiveSafeInteger(recipients[0].userId)
    || recipients[0].studentSchoolId !== control.schoolId
    || recipients[0].studentIsActive !== true
    || recipients[0].parentUserId !== recipients[0].userId
    || recipients[0].parentSchoolId !== control.schoolId
    || recipients[0].membershipUserId !== recipients[0].userId
    || recipients[0].membershipSchoolId !== control.schoolId
    || recipients[0].membershipRole !== 'parent'
    || recipients[0].membershipIsActive === false
    || recipients[0].userIsDeleted !== false) {
    await saveStatus(transaction, control.id, now, 'skipped_no_recipient', 'authorized_parent_unavailable');
    return 'skipped_no_recipient';
  }

  now = clock();
  if (!isValidDate(now)) throw new Error('The in-app reminder clock returned an invalid timestamp.');
  if (control.expiresAt.getTime() <= now.getTime()) {
    await saveStatus(transaction, control.id, now, 'expired', 'control_expired');
    return 'expired';
  }
  const currentAssessmentDate = getTuitionProgressReminderAssessmentDate(now, control.timeZone);
  if (currentAssessmentDate !== assessmentDate) {
    await saveStatus(transaction, control.id, now, 'skipped_invalid_calendar', 'assessment_date_changed');
    return 'skipped_invalid_calendar';
  }

  const accounting = await calculateAccounting({
    schoolId: control.schoolId,
    academicYearId: control.academicYearId,
    cycleId: control.cycleId,
    assessmentDate,
  }, transaction);
  now = clock();
  if (!isValidDate(now)) throw new Error('The in-app reminder clock returned an invalid timestamp.');
  if (control.expiresAt.getTime() <= now.getTime()) {
    await saveStatus(transaction, control.id, now, 'expired', 'control_expired');
    return 'expired';
  }
  const assessment = assessTuitionProgressReminderNotification({ control, now, accounting });

  if (assessment.status === 'expired') {
    await saveStatus(transaction, control.id, now, 'expired', 'control_expired');
    return 'expired';
  }
  if (assessment.status === 'not_due' || assessment.status === 'already_created') {
    return assessment.status;
  }
  if (assessment.status === 'skipped_invalid_calendar') {
    await saveStatus(transaction, control.id, now, 'skipped_invalid_calendar', 'current_assessment_date_invalid');
    return assessment.status;
  }
  if (assessment.status === 'skipped_ambiguous') {
    await saveStatus(transaction, control.id, now, 'skipped_ambiguous', assessment.lastError);
    return assessment.status;
  }
  if (assessment.status === 'suppressed_paid') {
    await saveStatus(transaction, control.id, now, 'suppressed_paid', 'payment_progress_caught_up_before_notification', {
      targetAmount: assessment.targetAmount,
      netPaidAmount: assessment.netPaidAmount,
      shortfallAmount: assessment.shortfallAmount,
    });
    return assessment.status;
  }

  now = clock();
  if (!isValidDate(now)) throw new Error('The in-app reminder clock returned an invalid timestamp.');
  if (control.expiresAt.getTime() <= now.getTime()) {
    await saveStatus(transaction, control.id, now, 'expired', 'control_expired');
    return 'expired';
  }
  if (getTuitionProgressReminderAssessmentDate(now, control.timeZone) !== assessment.assessmentDate) {
    await saveStatus(transaction, control.id, now, 'skipped_invalid_calendar', 'assessment_date_changed');
    return 'skipped_invalid_calendar';
  }

  const message = buildTuitionProgressReminderInAppNotification(assessment);
  const dedupeKey = getTuitionProgressReminderNotificationDedupeKey(control.id);
  const [inserted] = await transaction.insert(notifications).values({
    userId: recipients[0].userId,
    title: message.title,
    body: message.body,
    type: 'info',
    dedupeKey,
  }).onConflictDoNothing().returning({
    id: notifications.id,
    userId: notifications.userId,
  });
  let notification = inserted;
  if (!notification) {
    [notification] = await transaction.select({
      id: notifications.id,
      userId: notifications.userId,
    }).from(notifications).where(eq(notifications.dedupeKey, dedupeKey)).for('update');
  }
  if (!notification || notification.userId !== recipients[0].userId) {
    throw new Error('The idempotent tuition reminder notification conflicts with its authorized recipient.');
  }

  const updated = await transaction.update(tuitionProgressReminderControls).set({
    status: 'checked_below_target',
    targetAmount: assessment.targetAmount,
    netPaidAmount: assessment.netPaidAmount,
    shortfallAmount: assessment.shortfallAmount,
    lastCalculatedAt: now,
    lastError: null,
    notificationId: notification.id,
    updatedAt: now,
  }).where(and(
    eq(tuitionProgressReminderControls.id, control.id),
    eq(tuitionProgressReminderControls.status, 'checked_below_target'),
    isNull(tuitionProgressReminderControls.notificationId),
    gt(tuitionProgressReminderControls.expiresAt, now),
    lte(tuitionProgressReminderControls.scheduledAt, now),
  )).returning({ id: tuitionProgressReminderControls.id });
  if (updated.length !== 1) {
    throw new Error('The tuition reminder control changed before its notification could be linked.');
  }
  return inserted ? 'created' : 'already_created';
};

export const createTuitionProgressReminderInAppNotificationDrizzleSource = (
  dependencies: TuitionProgressReminderInAppNotificationDependencies,
): TuitionProgressReminderInAppNotificationSource => ({
  listDueControlIds: async ({ now, limit, scope }) => {
    if (!isValidDate(now) || !Number.isSafeInteger(limit) || limit < 1) {
      throw new Error('A valid current timestamp and positive limit are required.');
    }
    const due = await dependencies.database.select({
      id: tuitionProgressReminderControls.id,
    }).from(tuitionProgressReminderControls).where(and(
      eq(tuitionProgressReminderControls.status, 'checked_below_target'),
      lte(tuitionProgressReminderControls.scheduledAt, now),
      or(
        isNull(tuitionProgressReminderControls.notificationId),
        notExists(dependencies.database.select({ id: notificationDeliveryOutbox.id })
          .from(notificationDeliveryOutbox)
          .where(and(
            eq(notificationDeliveryOutbox.notificationId, tuitionProgressReminderControls.notificationId),
            eq(notificationDeliveryOutbox.channel, 'push'),
          ))),
      ),
      ...controlScopeConditions(scope),
    )).orderBy(asc(tuitionProgressReminderControls.expiresAt), asc(tuitionProgressReminderControls.id))
      .limit(limit);
    return due.map((row) => row.id);
  },
  processControl: async ({ controlId, now }) => {
    if (!isPositiveSafeInteger(controlId) || !isValidDate(now)) {
      throw new Error('A valid control ID and current timestamp are required.');
    }
    return dependencies.database.transaction((transaction) =>
      processControl(
        transaction,
        controlId,
        dependencies.clock ?? (() => now),
        dependencies.calculateAccounting,
      ));
  },
  queuePushForControl: async ({ controlId, now, testDeviceId }) => {
    if (!isPositiveSafeInteger(controlId) || !isValidDate(now)) {
      throw new Error('A valid control ID and current timestamp are required.');
    }
    if (testDeviceId != null && (typeof testDeviceId !== 'string' || !/^\d{1,32}$/.test(testDeviceId))) {
      throw new Error('A valid test-device ID is required.');
    }
    return dependencies.database.transaction(async (transaction) => {
      const [row] = await transaction.select({
        id: tuitionProgressReminderControls.id,
        schoolId: tuitionProgressReminderControls.schoolId,
        academicYearId: tuitionProgressReminderControls.academicYearId,
        cycleId: tuitionProgressReminderControls.cycleId,
        studentId: tuitionProgressReminderControls.studentId,
        monthStart: tuitionProgressReminderControls.monthStart,
        scheduledAt: tuitionProgressReminderControls.scheduledAt,
        expiresAt: tuitionProgressReminderControls.expiresAt,
        timeZone: tuitionProgressReminderControls.timeZone,
        status: tuitionProgressReminderControls.status,
        notificationId: tuitionProgressReminderControls.notificationId,
      }).from(tuitionProgressReminderControls)
        .where(eq(tuitionProgressReminderControls.id, controlId))
        .for('update');
      if (!row || row.status !== 'checked_below_target' || row.notificationId == null) return 'invalid_scope';
      const control = mapControl(row);
      if (control.expiresAt.getTime() <= now.getTime()) return 'expired';
      if (control.scheduledAt.getTime() > now.getTime()) return 'invalid_scope';

      const [school] = await transaction.select({
        id: schools.id,
        timeZone: schools.timeZone,
        isSuspended: schools.isSuspended,
      }).from(schools).where(eq(schools.id, control.schoolId)).for('share');
      const [academicYear] = await transaction.select({
        id: academicYears.id,
        schoolId: academicYears.schoolId,
        isActive: academicYears.isActive,
      }).from(academicYears).where(eq(academicYears.id, control.academicYearId)).for('update');
      const [cycle] = await transaction.select({
        id: cycles.id,
        isActive: cycles.isActive,
      }).from(cycles).where(eq(cycles.id, control.cycleId)).for('share');
      const [schoolCycle] = await transaction.select({
        id: schoolCycles.id,
        isActive: schoolCycles.isActive,
      }).from(schoolCycles).where(and(
        eq(schoolCycles.schoolId, control.schoolId),
        eq(schoolCycles.cycleId, control.cycleId),
      )).for('share');
      if (!school || school.isSuspended
        || !school.timeZone || school.timeZone.trim() !== control.timeZone
        || !academicYear || !academicYear.isActive
        || (academicYear.schoolId != null && academicYear.schoolId !== control.schoolId)
        || !cycle || !cycle.isActive
        || !schoolCycle || !schoolCycle.isActive) return 'invalid_scope';

      await lockCurrentTuitionAccounting(transaction, control);
      const recipients = await findAuthorizedRecipient(transaction, control);
      const [notification] = await transaction.select({
        id: notifications.id,
        userId: notifications.userId,
      }).from(notifications).where(and(
        eq(notifications.id, control.notificationId),
        eq(notifications.dedupeKey, getTuitionProgressReminderNotificationDedupeKey(control.id)),
      )).for('share');
      if (recipients.length !== 1 || !notification
        || recipients[0].userId !== notification.userId
        || recipients[0].studentId !== control.studentId
        || recipients[0].studentSchoolId !== control.schoolId
        || recipients[0].studentIsActive !== true
        || recipients[0].membershipIsActive === false
        || recipients[0].userIsDeleted !== false) return 'invalid_scope';

      const assessmentDate = getTuitionProgressReminderAssessmentDate(now, control.timeZone);
      if (!assessmentDate || control.monthStart !== `${assessmentDate.slice(0, 7)}-01`) return 'invalid_scope';
      const accounting = await dependencies.calculateAccounting({
        schoolId: control.schoolId,
        academicYearId: control.academicYearId,
        cycleId: control.cycleId,
        assessmentDate,
      }, transaction);
      const assessment = assessTuitionProgressReminderNotification({
        control: { ...control, notificationId: null },
        now,
        accounting,
      });
      if (assessment.status === 'expired') return 'expired';
      if (assessment.status === 'suppressed_paid') return 'suppressed_paid';
      if (assessment.status !== 'below_target') return 'invalid_scope';

      const deviceRows = await transaction.execute(sql<{ id: number }>`
        SELECT d.id
        FROM mobile_parent_devices AS d
        LEFT JOIN mobile_notification_preferences AS p ON p.parent_id = d.parent_id
        WHERE d.parent_id = ${String(notification.userId)}
          AND NULLIF(BTRIM(d.push_token), '') IS NOT NULL
          AND COALESCE(p.push_enabled, true) = true
          AND (${testDeviceId ?? null}::text IS NULL OR d.id::text = ${testDeviceId ?? null})
        ORDER BY d.last_seen_at DESC NULLS LAST, d.id DESC
        LIMIT 1
      `);
      if (deviceRows.rows.length === 0) return 'unavailable_device';

      const quietDecision = getTuitionProgressReminderQuietHoursDecision({
        now,
        expiresAt: control.expiresAt,
        timeZone: control.timeZone,
      });
      if (quietDecision.kind === 'expired') return 'expired';
      if (quietDecision.kind === 'invalid') return 'invalid_scope';
      const nextAttemptAt = quietDecision.deliverAt;
      const [existing] = await transaction.select({
        id: notificationDeliveryOutbox.id,
      }).from(notificationDeliveryOutbox).where(and(
        eq(notificationDeliveryOutbox.notificationId, notification.id),
        eq(notificationDeliveryOutbox.channel, 'push'),
      )).for('update');
      if (existing) return 'already_queued';

      const [inserted] = await transaction.insert(notificationDeliveryOutbox).values({
        notificationId: notification.id,
        channel: 'push',
        status: 'pending',
        attemptCount: 0,
        nextAttemptAt,
        lastError: null,
        transportState: null,
        updatedAt: now,
      }).onConflictDoNothing().returning({
        id: notificationDeliveryOutbox.id,
      });
      return inserted ? 'queued' : 'already_queued';
    });
  },
});

export const createTuitionProgressReminderPushDrizzleSource = (
  database: TuitionProgressReminderInAppNotificationDatabase,
  calculateAccounting: TuitionProgressReminderInAppNotificationDependencies['calculateAccounting'],
): TuitionProgressReminderPushSource => ({
  markInterruptedSendingUncertain: async ({ olderThan, now, scope }) => {
    if (!isValidDate(olderThan) || !isValidDate(now) || olderThan.getTime() > now.getTime()) {
      throw new Error('A valid stale-send cutoff is required.');
    }
    const updated = await database.update(notificationDeliveryOutbox).set({
      transportState: 'uncertain',
      lastError: 'push_worker_interrupted_outcome_unknown',
      updatedAt: now,
    }).where(and(
      eq(notificationDeliveryOutbox.channel, 'push'),
      eq(notificationDeliveryOutbox.status, 'sending'),
      isNull(notificationDeliveryOutbox.transportState),
      lte(notificationDeliveryOutbox.updatedAt, olderThan),
      sql`EXISTS (
        SELECT 1 FROM notifications
        WHERE notifications.id = ${notificationDeliveryOutbox.notificationId}
          AND notifications.dedupe_key LIKE 'tuition-progress-reminder:%'
      )`,
      ...(scope == null ? [] : [exists(database.select({ id: tuitionProgressReminderControls.id })
        .from(tuitionProgressReminderControls)
        .innerJoin(notifications, eq(notifications.id, tuitionProgressReminderControls.notificationId))
        .where(and(
          eq(notifications.id, notificationDeliveryOutbox.notificationId),
          ...controlScopeConditions(scope),
        )))]),
    )).returning({ id: notificationDeliveryOutbox.id });
    return updated.length;
  },

  claimDue: async ({ now, limit, scope }) => {
    if (!isValidDate(now) || !Number.isSafeInteger(limit) || limit < 1) {
      throw new Error('A valid current timestamp and positive push limit are required.');
    }
    return database.transaction(async (transaction) => {
      const candidates = await transaction.select({
        outboxId: notificationDeliveryOutbox.id,
        notificationId: notifications.id,
        userId: notifications.userId,
        title: notifications.title,
        body: notifications.body,
        dedupeKey: notifications.dedupeKey,
        controlId: tuitionProgressReminderControls.id,
        schoolId: tuitionProgressReminderControls.schoolId,
        academicYearId: tuitionProgressReminderControls.academicYearId,
        cycleId: tuitionProgressReminderControls.cycleId,
        studentId: tuitionProgressReminderControls.studentId,
        monthStart: tuitionProgressReminderControls.monthStart,
        scheduledAt: tuitionProgressReminderControls.scheduledAt,
        expiresAt: tuitionProgressReminderControls.expiresAt,
        timeZone: tuitionProgressReminderControls.timeZone,
        attemptCount: notificationDeliveryOutbox.attemptCount,
      }).from(notificationDeliveryOutbox)
        .innerJoin(notifications, eq(notifications.id, notificationDeliveryOutbox.notificationId))
        .innerJoin(tuitionProgressReminderControls, eq(
          tuitionProgressReminderControls.notificationId,
          notifications.id,
        ))
        .where(and(
          eq(notificationDeliveryOutbox.channel, 'push'),
          eq(notificationDeliveryOutbox.status, 'pending'),
          lte(notificationDeliveryOutbox.nextAttemptAt, now),
          lte(tuitionProgressReminderControls.scheduledAt, now),
          gt(tuitionProgressReminderControls.expiresAt, now),
          sql`${notifications.dedupeKey} LIKE 'tuition-progress-reminder:%'`,
          ...controlScopeConditions(scope),
        ))
        .orderBy(asc(notificationDeliveryOutbox.nextAttemptAt), asc(notificationDeliveryOutbox.id))
        .limit(limit)
        .for('update', { of: [notificationDeliveryOutbox], skipLocked: true });

      const claims: TuitionProgressReminderPushClaim[] = [];
      for (const candidate of candidates) {
        const [claimed] = await transaction.update(notificationDeliveryOutbox).set({
          status: 'sending',
          attemptCount: sql`${notificationDeliveryOutbox.attemptCount} + 1`,
          lastError: null,
          updatedAt: now,
        }).where(and(
          eq(notificationDeliveryOutbox.id, candidate.outboxId),
          eq(notificationDeliveryOutbox.status, 'pending'),
          lte(notificationDeliveryOutbox.nextAttemptAt, now),
        )).returning({ attemptCount: notificationDeliveryOutbox.attemptCount });
        if (!claimed) continue;
        claims.push({ ...candidate, attemptCount: claimed.attemptCount });
      }
      return claims;
    });
  },

  verifyBeforeSend: async (claim, now) => {
    if (!isValidDate(now)) throw new Error('A valid current timestamp is required for push verification.');
    return database.transaction(async (transaction) => {
      const [controlRow] = await transaction.select({
        id: tuitionProgressReminderControls.id,
        schoolId: tuitionProgressReminderControls.schoolId,
        academicYearId: tuitionProgressReminderControls.academicYearId,
        cycleId: tuitionProgressReminderControls.cycleId,
        studentId: tuitionProgressReminderControls.studentId,
        monthStart: tuitionProgressReminderControls.monthStart,
        scheduledAt: tuitionProgressReminderControls.scheduledAt,
        expiresAt: tuitionProgressReminderControls.expiresAt,
        timeZone: tuitionProgressReminderControls.timeZone,
        status: tuitionProgressReminderControls.status,
        notificationId: tuitionProgressReminderControls.notificationId,
      }).from(tuitionProgressReminderControls)
        .where(and(
          eq(tuitionProgressReminderControls.id, claim.controlId),
          eq(tuitionProgressReminderControls.notificationId, claim.notificationId),
        )).for('update');
      if (!controlRow || controlRow.status !== 'checked_below_target') return 'invalid_scope';
      const control = mapControl(controlRow);
      if (control.expiresAt.getTime() <= now.getTime()) return 'expired';

      const [school] = await transaction.select({
        id: schools.id,
        timeZone: schools.timeZone,
        isSuspended: schools.isSuspended,
      }).from(schools).where(eq(schools.id, control.schoolId)).for('share');
      const [academicYear] = await transaction.select({
        id: academicYears.id,
        schoolId: academicYears.schoolId,
        isActive: academicYears.isActive,
      }).from(academicYears).where(eq(academicYears.id, control.academicYearId)).for('update');
      const [cycle] = await transaction.select({
        id: cycles.id,
        isActive: cycles.isActive,
      }).from(cycles).where(eq(cycles.id, control.cycleId)).for('share');
      const [schoolCycle] = await transaction.select({
        id: schoolCycles.id,
        isActive: schoolCycles.isActive,
      }).from(schoolCycles).where(and(
        eq(schoolCycles.schoolId, control.schoolId),
        eq(schoolCycles.cycleId, control.cycleId),
      )).for('share');
      if (!school || school.isSuspended
        || !school.timeZone || school.timeZone.trim() !== control.timeZone
        || !academicYear || !academicYear.isActive
        || (academicYear.schoolId != null && academicYear.schoolId !== control.schoolId)
        || !cycle || !cycle.isActive
        || !schoolCycle || !schoolCycle.isActive) return 'invalid_scope';

      const [notification] = await transaction.select({
        id: notifications.id,
        userId: notifications.userId,
        dedupeKey: notifications.dedupeKey,
      }).from(notifications).where(eq(notifications.id, claim.notificationId)).for('share');
      if (!notification || notification.userId !== claim.userId
        || notification.dedupeKey !== getTuitionProgressReminderNotificationDedupeKey(control.id)) {
        return 'invalid_scope';
      }
      const recipients = await findAuthorizedRecipient(transaction, control);
      if (recipients.length !== 1
        || recipients[0].userId !== notification.userId
        || recipients[0].studentId !== control.studentId
        || recipients[0].studentSchoolId !== control.schoolId
        || recipients[0].studentIsActive !== true
        || recipients[0].membershipIsActive === false
        || recipients[0].userIsDeleted !== false) return 'invalid_scope';

      await lockCurrentTuitionAccounting(transaction, control);
      const assessmentDate = getTuitionProgressReminderAssessmentDate(now, control.timeZone);
      if (!assessmentDate || control.monthStart !== `${assessmentDate.slice(0, 7)}-01`) return 'invalid_scope';
      const accounting = await calculateAccounting({
        schoolId: control.schoolId,
        academicYearId: control.academicYearId,
        cycleId: control.cycleId,
        assessmentDate,
      }, transaction);
      const assessment = assessTuitionProgressReminderNotification({
        control: { ...control, notificationId: null },
        now,
        accounting,
      });
      if (assessment.status === 'below_target') return 'eligible';
      if (assessment.status === 'suppressed_paid') return 'suppressed_paid';
      if (assessment.status === 'expired') return 'expired';
      return 'invalid_scope';
    });
  },

  defer: async ({ claim, now, nextAttemptAt }) => {
    if (!isValidDate(now) || !isValidDate(nextAttemptAt)
      || nextAttemptAt.getTime() >= claim.expiresAt.getTime()) return false;
    const updated = await database.update(notificationDeliveryOutbox).set({
      status: 'pending',
      nextAttemptAt,
      lastError: 'system_quiet_hours',
      updatedAt: now,
    }).where(and(
      eq(notificationDeliveryOutbox.id, claim.outboxId),
      eq(notificationDeliveryOutbox.status, 'sending'),
      eq(notificationDeliveryOutbox.attemptCount, claim.attemptCount),
      isNull(notificationDeliveryOutbox.transportState),
    )).returning({ id: notificationDeliveryOutbox.id });
    return updated.length > 0;
  },

  markFcmAccepted: async ({ claim, now }) => {
    if (!isValidDate(now)) return false;
    const updated = await database.update(notificationDeliveryOutbox).set({
      status: 'sent',
      transportState: 'fcm_accepted',
      fcmAcceptedAt: now,
      sentAt: now,
      lastError: null,
      updatedAt: now,
    }).where(and(
      eq(notificationDeliveryOutbox.id, claim.outboxId),
      eq(notificationDeliveryOutbox.status, 'sending'),
      eq(notificationDeliveryOutbox.attemptCount, claim.attemptCount),
      isNull(notificationDeliveryOutbox.transportState),
    )).returning({ id: notificationDeliveryOutbox.id });
    return updated.length > 0;
  },

  scheduleRetry: async ({ claim, now, nextAttemptAt, error }) => {
    if (!isValidDate(now) || !isValidDate(nextAttemptAt)
      || nextAttemptAt.getTime() >= claim.expiresAt.getTime()) return false;
    const updated = await database.update(notificationDeliveryOutbox).set({
      status: 'pending',
      nextAttemptAt,
      lastError: error.slice(0, 1000),
      updatedAt: now,
    }).where(and(
      eq(notificationDeliveryOutbox.id, claim.outboxId),
      eq(notificationDeliveryOutbox.status, 'sending'),
      eq(notificationDeliveryOutbox.attemptCount, claim.attemptCount),
      isNull(notificationDeliveryOutbox.transportState),
    )).returning({ id: notificationDeliveryOutbox.id });
    return updated.length > 0;
  },

  markUncertain: async ({ claim, now, error }) => {
    if (!isValidDate(now)) return false;
    const updated = await database.update(notificationDeliveryOutbox).set({
      transportState: 'uncertain',
      lastError: error.slice(0, 1000),
      updatedAt: now,
    }).where(and(
      eq(notificationDeliveryOutbox.id, claim.outboxId),
      eq(notificationDeliveryOutbox.status, 'sending'),
      eq(notificationDeliveryOutbox.attemptCount, claim.attemptCount),
      isNull(notificationDeliveryOutbox.transportState),
    )).returning({ id: notificationDeliveryOutbox.id });
    return updated.length > 0;
  },

  markFailed: async ({ claim, now, error }) => {
    if (!isValidDate(now)) return false;
    const updated = await database.update(notificationDeliveryOutbox).set({
      status: 'failed',
      lastError: error.slice(0, 1000),
      updatedAt: now,
    }).where(and(
      eq(notificationDeliveryOutbox.id, claim.outboxId),
      eq(notificationDeliveryOutbox.status, 'sending'),
      eq(notificationDeliveryOutbox.attemptCount, claim.attemptCount),
      isNull(notificationDeliveryOutbox.transportState),
    )).returning({ id: notificationDeliveryOutbox.id });
    return updated.length > 0;
  },
});
