import { describe, expect, it, vi } from 'vitest';
import {
  getAccountingTuitionProgressCandidates,
  type AccountingTuitionProgressAllocation,
  type AccountingTuitionProgressDataSource,
  type AccountingTuitionProgressObligation,
} from './accountingTuitionProgress.ts';
import {
  DEFAULT_SCHOOL_TIME_ZONE,
  isValidIanaTimeZone,
} from './schoolTimeZone.ts';
import {
  assessTuitionProgressReminderNotification,
  buildTuitionProgressReminderInAppNotification,
  createTuitionProgressReminderInAppNotifications,
  getTuitionProgressReminderNotificationDedupeKey,
  type TuitionProgressReminderInAppNotificationSource,
  type TuitionProgressReminderNotificationControl,
} from './tuitionProgressReminderNotifications.ts';
import {
  type PrepareTuitionProgressReminderControlsInput,
  type TuitionProgressReminderCalendar,
  type TuitionProgressReminderPreparationSource,
  prepareTuitionProgressReminderControls,
} from './tuitionProgressReminderPreparation.ts';
import {
  processTuitionProgressReminderPushOutbox,
  type TuitionProgressReminderPushClaim,
  type TuitionProgressReminderPushSource,
} from './tuitionProgressReminderPush.ts';
import {
  getTuitionProgressReminderQuietHoursDecision,
} from './tuitionProgressReminderQuietHours.ts';
import {
  planTuitionProgressReminderControls,
  type TuitionProgressReminderScheduleInput,
} from './tuitionProgressReminderSchedule.ts';
import {
  executeDueTuitionProgressReminderControls,
  type TuitionProgressReminderClaim,
  type TuitionProgressReminderExecutionSource,
} from './tuitionProgressReminderExecution.ts';
import type { TuitionProgressPeriod } from './tuitionProgress.ts';

const scope = { schoolId: 7, academicYearId: 23, cycleId: 4 };
const studentId = 33;
const scheduledAt = new Date('2027-07-15T08:00:00.000Z');
const expiresAt = new Date('2027-07-15T23:59:59.999Z');
const leaseToken = '00000000-0000-4000-8000-000000000001';

const periods: TuitionProgressPeriod[] = [
  {
    ...scope,
    periodType: 'trimester',
    orderIndex: 1,
    startDate: '2026-09-01',
    endDate: '2026-11-30',
    isActive: true,
  },
  {
    ...scope,
    periodType: 'trimester',
    orderIndex: 2,
    startDate: '2026-12-01',
    endDate: '2027-02-28',
    isActive: true,
  },
  {
    ...scope,
    periodType: 'trimester',
    orderIndex: 3,
    startDate: '2027-03-01',
    endDate: '2027-07-16',
    isActive: true,
  },
];

const obligation: AccountingTuitionProgressObligation = {
  id: 101,
  studentId,
  schoolId: scope.schoolId,
  academicYearId: scope.academicYearId,
  classId: 16,
  categoryId: 2,
  amount: 90_000,
  currency: 'XOF',
  studentSchoolId: scope.schoolId,
  firstName: 'Afi',
  lastName: 'Doe',
  matricule: 'A33',
  classSchoolId: scope.schoolId,
  classAcademicYearId: scope.academicYearId,
  className: '3e A',
  cycleId: scope.cycleId,
};

const fullPayment: AccountingTuitionProgressAllocation = {
  id: 51,
  obligationId: obligation.id,
  installmentId: null,
  installmentObligationId: null,
  amount: obligation.amount,
  paymentId: 71,
  paymentSchoolId: scope.schoolId,
  paymentStudentId: studentId,
  paymentAcademicYearId: scope.academicYearId,
  paymentStatus: 'posted',
  paidAtDate: '2027-07-15',
};

const createAccountingFixture = () => {
  let allocations: readonly AccountingTuitionProgressAllocation[] = [];
  const source: AccountingTuitionProgressDataSource = {
    loadAcademicYear: async (schoolId, academicYearId) => ({ id: academicYearId, schoolId }),
    loadPeriods: async () => periods,
    loadTuitionObligations: async () => [obligation],
    loadPaymentAllocations: async () => allocations,
    loadPaymentAdjustments: async () => [],
  };
  return {
    source,
    setPayments: (payments: readonly AccountingTuitionProgressAllocation[]) => {
      allocations = payments;
    },
    calculate: (assessmentDate: string) => getAccountingTuitionProgressCandidates({
      ...scope,
      assessmentDate,
    }, source),
  };
};

const makeScheduledClaim = (overrides: Partial<TuitionProgressReminderClaim> = {}): TuitionProgressReminderClaim => ({
  ...scope,
  id: 501,
  studentId,
  monthStart: '2027-07-01',
  stage: 'penultimate',
  scheduledAt,
  expiresAt,
  timeZone: 'Africa/Lome',
  status: 'checking',
  attemptCount: 1,
  nextAttemptAt: scheduledAt,
  leaseToken,
  leaseExpiresAt: new Date('2027-07-15T08:00:30.000Z'),
  ...overrides,
});

const makeExecutionSource = (
  dueControl: TuitionProgressReminderClaim,
): TuitionProgressReminderExecutionSource => {
  let state: 'scheduled' | 'checking' | 'checked_up_to_date' | 'checked_below_target' | 'expired' = 'scheduled';
  let activeLease: string | null = null;
  return {
    expireElapsedControls: async ({ now }) => {
      if (state === 'scheduled' && dueControl.expiresAt.getTime() <= now.getTime()) {
        state = 'expired';
        return 1;
      }
      return 0;
    },
    claimDueControl: async ({ now, leaseToken: token, leaseExpiresAt: leaseExpiry, scope: requestedScope }) => {
      if (state !== 'scheduled'
        || dueControl.scheduledAt.getTime() > now.getTime()
        || dueControl.expiresAt.getTime() <= now.getTime()
        || (requestedScope != null && (
          requestedScope.schoolId !== dueControl.schoolId
          || requestedScope.academicYearId !== dueControl.academicYearId
          || requestedScope.cycleId !== dueControl.cycleId
          || (requestedScope.studentId != null && requestedScope.studentId !== dueControl.studentId)
        ))) return null;
      state = 'checking';
      activeLease = token;
      return {
        ...dueControl,
        status: 'checking',
        attemptCount: 1,
        nextAttemptAt: dueControl.scheduledAt,
        leaseToken: token,
        leaseExpiresAt: new Date(Math.min(leaseExpiry.getTime(), dueControl.expiresAt.getTime())),
      };
    },
    completeControl: async ({ controlId, leaseToken: token, decision }) => {
      if (controlId !== dueControl.id || state !== 'checking' || token !== activeLease) return false;
      state = decision.status === 'checked_up_to_date' || decision.status === 'checked_below_target'
        ? decision.status
        : 'expired';
      activeLease = null;
      return true;
    },
    retryControl: async () => false,
  };
};

const runExecution = (
  accounting: ReturnType<typeof createAccountingFixture>,
  dueControl = makeScheduledClaim(),
) => executeDueTuitionProgressReminderControls({
  scope: { ...scope, studentId },
}, {
  source: makeExecutionSource(dueControl),
  calculateAccounting: (input) => getAccountingTuitionProgressCandidates(input, accounting.source),
  clock: () => scheduledAt,
  createLeaseToken: () => leaseToken,
});

const makeNotificationControl = (
  overrides: Partial<TuitionProgressReminderNotificationControl> = {},
): TuitionProgressReminderNotificationControl => ({
  id: 501,
  ...scope,
  studentId,
  monthStart: '2027-07-01',
  scheduledAt,
  expiresAt,
  timeZone: 'Africa/Lome',
  status: 'checked_below_target',
  notificationId: null,
  ...overrides,
});

const makeInAppSource = (
  accounting: ReturnType<typeof createAccountingFixture>,
  options: { recipientAuthorized?: boolean; control?: TuitionProgressReminderNotificationControl } = {},
) => {
  const control = options.control ?? makeNotificationControl();
  const recipientAuthorized = options.recipientAuthorized ?? true;
  const notifications = new Map<string, { id: number; title: string; body: string }>();
  const outbox = new Set<number>();
  const source: TuitionProgressReminderInAppNotificationSource = {
    listDueControlIds: async () => [control.id],
    processControl: async ({ now }) => {
      if (control.notificationId != null) return 'already_created';
      if (control.expiresAt.getTime() <= now.getTime()) return 'expired';
      if (!recipientAuthorized) return 'skipped_no_recipient';
      const current = await accounting.calculate(now.toISOString().slice(0, 10));
      const assessment = assessTuitionProgressReminderNotification({ control, now, accounting: current });
      if (assessment.status === 'already_created') return 'already_created';
      if (assessment.status === 'suppressed_paid') return 'suppressed_paid';
      if (assessment.status === 'expired') return 'expired';
      if (assessment.status === 'not_due') return 'not_due';
      if (assessment.status === 'skipped_invalid_calendar') return 'skipped_invalid_calendar';
      if (assessment.status === 'skipped_ambiguous') return 'skipped_ambiguous';
      const dedupeKey = getTuitionProgressReminderNotificationDedupeKey(control.id);
      const existing = notifications.get(dedupeKey);
      if (existing) {
        control.notificationId = existing.id;
        return 'already_created';
      }
      const message = buildTuitionProgressReminderInAppNotification(assessment);
      const id = notifications.size + 801;
      notifications.set(dedupeKey, { id, ...message });
      control.notificationId = id;
      return 'created';
    },
    queuePushForControl: async ({ now }) => {
      if (control.notificationId == null) return 'invalid_scope';
      const quietDecision = getTuitionProgressReminderQuietHoursDecision({
        now,
        expiresAt: control.expiresAt,
        timeZone: control.timeZone,
      });
      if (quietDecision.kind === 'expired') return 'expired';
      if (quietDecision.kind === 'invalid') return 'invalid_scope';
      if (outbox.has(control.notificationId)) return 'already_queued';
      outbox.add(control.notificationId);
      return 'queued';
    },
  };
  return { source, control, notifications, outbox };
};

const makePushClaim = (
  notification: { id: number; title: string; body: string },
): TuitionProgressReminderPushClaim => ({
  outboxId: 71,
  attemptCount: 1,
  notificationId: notification.id,
  userId: 90,
  ...notification,
  dedupeKey: getTuitionProgressReminderNotificationDedupeKey(501),
  controlId: 501,
  ...scope,
  studentId,
  monthStart: '2027-07-01',
  scheduledAt,
  expiresAt,
  timeZone: 'Africa/Lome',
});

const makePushSource = (
  claim: TuitionProgressReminderPushClaim,
  verifyBeforeSend: TuitionProgressReminderPushSource['verifyBeforeSend'],
) => {
  const source: TuitionProgressReminderPushSource = {
    markInterruptedSendingUncertain: vi.fn(async () => 0),
    claimDue: vi.fn(async () => [claim]),
    verifyBeforeSend,
    defer: vi.fn(async () => true),
    markFcmAccepted: vi.fn(async () => true),
    scheduleRetry: vi.fn(async () => true),
    markUncertain: vi.fn(async () => true),
    markFailed: vi.fn(async () => true),
  };
  return source;
};

const scheduleInput = (
  overrides: Partial<TuitionProgressReminderScheduleInput> = {},
): TuitionProgressReminderScheduleInput => ({
  ...scope,
  academicYearSchoolId: scope.schoolId,
  periods,
  timeZone: 'Africa/Lome',
  now: scheduledAt,
  ...overrides,
});

describe('isolated tuition progress reminder functional harness', () => {
  it('uses the existing accounting calculation to distinguish paid and below-target students', async () => {
    const paid = createAccountingFixture();
    paid.setPayments([fullPayment]);
    const paidResult = await runExecution(paid);
    expect(paidResult.outcomes).toMatchObject([{ status: 'checked_up_to_date' }]);

    const belowTarget = createAccountingFixture();
    const belowTargetResult = await runExecution(belowTarget);
    expect(belowTargetResult.outcomes).toMatchObject([{ status: 'checked_below_target' }]);
  });

  it('simulates exactly two monthly controls at 08:00 Africa/Lome without persistence', async () => {
    const calendar: TuitionProgressReminderCalendar = {
      ...scope,
      academicYearSchoolId: scope.schoolId,
      timeZone: 'Africa/Lome',
      periods,
    };
    const insertControlsIgnoringScopeDuplicates = vi.fn(async (records: readonly unknown[]) => records.length);
    const source: TuitionProgressReminderPreparationSource = {
      loadCalendar: async () => calendar,
      loadStudentsWithActiveTuitionObligations: async () => [{ ...scope, studentId }],
      loadExistingKeys: async () => [],
      insertControlsIgnoringScopeDuplicates,
    };

    const prepared = await prepareTuitionProgressReminderControls({
      ...scope,
      now: scheduledAt,
      mode: 'simulate',
    } satisfies PrepareTuitionProgressReminderControlsInput, source);

    expect(prepared).toMatchObject({ ok: true, mode: 'simulate', plannedCount: 2, insertedCount: null });
    if (!prepared.ok) return;
    expect(prepared.recordsToInsert.map(({ stage, scheduledAt: date, timeZone }) => ({
      stage,
      scheduledAt: date,
      timeZone,
    }))).toEqual([
      { stage: 'penultimate', scheduledAt, timeZone: 'Africa/Lome' },
      { stage: 'last', scheduledAt: new Date('2027-07-16T08:00:00.000Z'), timeZone: 'Africa/Lome' },
    ]);
    expect(insertControlsIgnoringScopeDuplicates).not.toHaveBeenCalled();

    const plan = planTuitionProgressReminderControls(scheduleInput());
    expect(plan.ok).toBe(true);
    if (plan.ok) {
      expect(plan.controls.filter((item) => item.monthStart === '2027-07-01')).toHaveLength(2);
      expect(plan.controls.filter((item) => item.monthStart === '2027-07-01')
        .every((item) => item.scheduledAt.getUTCHours() === 8)).toBe(true);
    }
  });

  it('suppresses an in-app notification when payment posts after the check but before creation', async () => {
    const accounting = createAccountingFixture();
    expect((await runExecution(accounting)).outcomes[0]?.status).toBe('checked_below_target');
    accounting.setPayments([fullPayment]);
    const inApp = makeInAppSource(accounting);

    const result = await createTuitionProgressReminderInAppNotifications({
      now: scheduledAt,
      clock: () => scheduledAt,
      source: inApp.source,
    });

    expect(result.results).toEqual([{ controlId: 501, status: 'suppressed_paid' }]);
    expect(inApp.notifications.size).toBe(0);
    expect(inApp.outbox.size).toBe(0);
  });

  it('rechecks payment before push and never calls the injected transport when paid', async () => {
    const accounting = createAccountingFixture();
    const inApp = makeInAppSource(accounting);
    const created = await createTuitionProgressReminderInAppNotifications({
      now: scheduledAt,
      clock: () => scheduledAt,
      source: inApp.source,
    });
    expect(created.createdCount).toBe(1);
    const notification = [...inApp.notifications.values()][0];
    expect(notification).toBeDefined();

    accounting.setPayments([fullPayment]);
    const claim = makePushClaim(notification!);
    const pushSource = makePushSource(claim, async (_claim, now) => {
      const current = await accounting.calculate(now.toISOString().slice(0, 10));
      const assessment = assessTuitionProgressReminderNotification({
        control: { ...inApp.control, notificationId: null },
        now,
        accounting: current,
      });
      return assessment.status === 'suppressed_paid' ? 'suppressed_paid' : 'eligible';
    });
    const send = vi.fn(async () => ({ status: 'retryable_failure' as const, error: 'test_transport_not_sent' }));

    const result = await processTuitionProgressReminderPushOutbox({
      source: pushSource,
      send,
      clock: () => new Date('2027-07-15T10:00:00.000Z'),
    });

    expect(result.outcomes).toEqual([{ outboxId: 71, status: 'failed' }]);
    expect(pushSource.markFailed).toHaveBeenCalledWith(expect.objectContaining({
      error: 'payment_progress_caught_up_before_push',
    }));
    expect(send).not.toHaveBeenCalled();
  });

  it('does not create or queue a notification for a disabled parent or invalid relationship', async () => {
    const accounting = createAccountingFixture();
    const inApp = makeInAppSource(accounting, { recipientAuthorized: false });
    const result = await createTuitionProgressReminderInAppNotifications({
      now: scheduledAt,
      clock: () => scheduledAt,
      source: inApp.source,
    });

    expect(result.results).toEqual([{ controlId: 501, status: 'skipped_no_recipient' }]);
    expect(inApp.notifications.size).toBe(0);
    expect(inApp.outbox.size).toBe(0);
  });

  it('keeps notification and outbox creation idempotent across repeated processing', async () => {
    const inApp = makeInAppSource(createAccountingFixture());
    const input = { now: scheduledAt, clock: () => scheduledAt, source: inApp.source };

    const first = await createTuitionProgressReminderInAppNotifications(input);
    const second = await createTuitionProgressReminderInAppNotifications(input);

    expect(first.createdCount).toBe(1);
    expect(second.results).toEqual([{ controlId: 501, status: 'already_created' }]);
    expect(inApp.notifications.size).toBe(1);
    expect(inApp.outbox.size).toBe(1);
  });

  it('builds the detailed indicative reminder content from calculated amounts', async () => {
    const inApp = makeInAppSource(createAccountingFixture());
    await createTuitionProgressReminderInAppNotifications({
      now: scheduledAt,
      clock: () => scheduledAt,
      source: inApp.source,
    });
    const notification = [...inApp.notifications.values()][0];

    expect(notification?.title).toBe('Rappel de scolarité');
    expect(notification?.body).toContain('Afi Doe');
    expect(notification?.body).toContain('au 15/07/2027');
    expect(notification?.body).toContain(
      `Scolarité annuelle : ${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(90000)} FCFA`,
    );
    expect(notification?.body).toContain('Montant déjà versé : 0 FCFA');
    expect(notification?.body).toContain('Montant recommandé à ce jour :');
    expect(notification?.body).toContain('Complément de versement conseillé :');
    expect(notification?.body).toContain('rythme recommandé de paiement');
  });

  it('defers only when quiet-hours release precedes expiration and never sends after expiration', async () => {
    expect(getTuitionProgressReminderQuietHoursDecision({
      now: new Date('2027-07-15T22:00:00.000Z'),
      expiresAt: new Date('2027-07-16T23:59:59.999Z'),
      timeZone: 'Africa/Lome',
    })).toEqual({
      kind: 'deferred',
      deliverAt: new Date('2027-07-16T07:00:00.000Z'),
    });

    const claim = makePushClaim({
      id: 801,
      title: 'Rappel de scolarité',
      body: 'Message de test',
    });
    const pushSource = makePushSource(claim, async () => 'eligible');
    const send = vi.fn();
    const result = await processTuitionProgressReminderPushOutbox({
      source: pushSource,
      send,
      clock: () => new Date('2027-07-15T22:00:00.000Z'),
    });

    expect(result.outcomes).toEqual([{ outboxId: 71, status: 'failed' }]);
    expect(pushSource.markFailed).toHaveBeenCalledWith(expect.objectContaining({
      error: 'control_expired_in_quiet_hours',
    }));
    expect(send).not.toHaveBeenCalled();
  });

  it('keeps the validated Africa/Lome default for new schools', () => {
    expect(DEFAULT_SCHOOL_TIME_ZONE).toBe('Africa/Lome');
    expect(isValidIanaTimeZone(DEFAULT_SCHOOL_TIME_ZONE)).toBe(true);
  });
});
