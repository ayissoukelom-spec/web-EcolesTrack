import { describe, expect, it, vi } from 'vitest';
import type {
  AccountingTuitionProgressAdjustment,
  AccountingTuitionProgressAllocation,
  AccountingTuitionProgressDataSource,
  AccountingTuitionProgressObligation,
} from './accountingTuitionProgress.ts';
import { getAccountingTuitionProgressCandidates } from './accountingTuitionProgress.ts';
import type { TuitionProgressPeriod } from './tuitionProgress.ts';
import {
  executeDueTuitionProgressReminderControls,
  type TuitionProgressReminderClaim,
  type TuitionProgressReminderExecutionSource,
} from './tuitionProgressReminderExecution.ts';

const now = new Date('2027-02-20T12:00:00.000Z');
const leaseToken = '00000000-0000-4000-8000-000000000001';

const periods: TuitionProgressPeriod[] = [
  {
    schoolId: 7,
    academicYearId: 23,
    cycleId: 4,
    periodType: 'trimester',
    orderIndex: 1,
    startDate: '2026-09-14',
    endDate: '2026-11-30',
    isActive: true,
  },
  {
    schoolId: 7,
    academicYearId: 23,
    cycleId: 4,
    periodType: 'trimester',
    orderIndex: 2,
    startDate: '2026-12-01',
    endDate: '2027-02-28',
    isActive: true,
  },
  {
    schoolId: 7,
    academicYearId: 23,
    cycleId: 4,
    periodType: 'trimester',
    orderIndex: 3,
    startDate: '2027-03-01',
    endDate: '2027-07-16',
    isActive: true,
  },
];

const obligation = (
  overrides: Partial<AccountingTuitionProgressObligation> = {},
): AccountingTuitionProgressObligation => ({
  id: 101,
  studentId: 33,
  schoolId: 7,
  academicYearId: 23,
  classId: 16,
  categoryId: 2,
  amount: 1000,
  currency: 'XOF',
  studentSchoolId: 7,
  firstName: 'Afi',
  lastName: 'Doe',
  matricule: 'A33',
  classSchoolId: 7,
  classAcademicYearId: 23,
  className: '3e A',
  cycleId: 4,
  ...overrides,
});

const allocation = (
  overrides: Partial<AccountingTuitionProgressAllocation> = {},
): AccountingTuitionProgressAllocation => ({
  id: 51,
  obligationId: 101,
  installmentId: null,
  installmentObligationId: null,
  amount: 600,
  paymentId: 71,
  paymentSchoolId: 7,
  paymentStudentId: 33,
  paymentAcademicYearId: 23,
  paymentStatus: 'posted',
  paidAtDate: '2027-02-19',
  ...overrides,
});

const adjustment = (
  overrides: Partial<AccountingTuitionProgressAdjustment> = {},
): AccountingTuitionProgressAdjustment => ({
  adjustmentId: 91,
  paymentAllocationId: 51,
  adjustmentPaymentId: 71,
  amount: 100,
  kind: 'refund',
  recordedAtDate: '2027-02-01',
  ...overrides,
});

const accountingSource = ({
  periodRows = periods,
  obligations = [obligation()],
  allocations = [allocation()],
  adjustments = [],
}: {
  periodRows?: readonly TuitionProgressPeriod[];
  obligations?: readonly AccountingTuitionProgressObligation[];
  allocations?: readonly AccountingTuitionProgressAllocation[];
  adjustments?: readonly AccountingTuitionProgressAdjustment[];
} = {}): AccountingTuitionProgressDataSource => ({
  loadAcademicYear: vi.fn(async () => ({ id: 23, schoolId: 7 })),
  loadPeriods: vi.fn(async () => periodRows),
  loadTuitionObligations: vi.fn(async () => obligations),
  loadPaymentAllocations: vi.fn(async () => allocations),
  loadPaymentAdjustments: vi.fn(async () => adjustments),
});

const control = (
  overrides: Partial<TuitionProgressReminderClaim> = {},
): TuitionProgressReminderClaim => ({
  id: 501,
  schoolId: 7,
  academicYearId: 23,
  cycleId: 4,
  studentId: 33,
  monthStart: '2027-02-01',
  stage: 'last',
  scheduledAt: new Date('2027-02-20T08:00:00.000Z'),
  expiresAt: new Date('2027-02-20T23:59:59.999Z'),
  timeZone: 'Africa/Lome',
  status: 'checking',
  attemptCount: 1,
  nextAttemptAt: new Date('2027-02-20T08:00:00.000Z'),
  leaseToken,
  leaseExpiresAt: new Date('2027-02-20T12:00:30.000Z'),
  ...overrides,
});

const createExecutionSource = ({
  dueControl = control(),
  initialState = 'scheduled',
  initialLeaseExpiresAt,
}: {
  dueControl?: TuitionProgressReminderClaim;
  initialState?: 'scheduled' | 'retry_pending' | 'checking';
  initialLeaseExpiresAt?: Date;
} = {}) => {
  let state: 'scheduled' | 'retry_pending' | 'checking' | 'expired'
    | 'checked_up_to_date' | 'checked_below_target' | 'skipped_ambiguous'
    | 'skipped_invalid_calendar' = initialState;
  let activeLeaseToken: string | null = null;
  let leaseExpiresAt = initialLeaseExpiresAt ?? dueControl.leaseExpiresAt;
  let nextAttemptAt = dueControl.nextAttemptAt;
  let attemptCount = initialState === 'checking' ? dueControl.attemptCount : 0;
  let decision: Parameters<TuitionProgressReminderExecutionSource['completeControl']>[0]['decision'] | null = null;

  const source: TuitionProgressReminderExecutionSource = {
    expireElapsedControls: vi.fn(async ({ now: currentNow, scope }) => {
      if (dueControl.expiresAt.getTime() <= currentNow.getTime()
        && (scope == null || (
          scope.schoolId === dueControl.schoolId
          && scope.academicYearId === dueControl.academicYearId
          && scope.cycleId === dueControl.cycleId
          && (scope.studentId == null || scope.studentId === dueControl.studentId)
        ))
        && ['scheduled', 'retry_pending', 'checking'].includes(state)) {
        state = 'expired';
        activeLeaseToken = null;
        return 1;
      }
      return 0;
    }),
    claimDueControl: vi.fn(async ({ now: currentNow, leaseToken: requestedToken, leaseExpiresAt: requestedLease, scope }) => {
      if (scope && (
        scope.schoolId !== dueControl.schoolId
        || scope.academicYearId !== dueControl.academicYearId
        || scope.cycleId !== dueControl.cycleId
        || (scope.studentId != null && scope.studentId !== dueControl.studentId)
      )) return null;
      if (dueControl.expiresAt.getTime() <= currentNow.getTime()
        || dueControl.scheduledAt.getTime() > currentNow.getTime()) return null;
      const scheduledOrRetryIsDue = (state === 'scheduled' || state === 'retry_pending')
        && nextAttemptAt.getTime() <= currentNow.getTime();
      const checkingLeaseExpired = state === 'checking'
        && leaseExpiresAt.getTime() <= currentNow.getTime();
      if (!scheduledOrRetryIsDue && !checkingLeaseExpired) return null;

      state = 'checking';
      activeLeaseToken = requestedToken;
      leaseExpiresAt = new Date(Math.min(requestedLease.getTime(), dueControl.expiresAt.getTime()));
      attemptCount += 1;
      return {
        ...dueControl,
        status: 'checking' as const,
        attemptCount,
        nextAttemptAt,
        leaseToken: requestedToken,
        leaseExpiresAt,
      };
    }),
    completeControl: vi.fn(async ({ controlId, leaseToken: requestedToken, decision: completedDecision }) => {
      if (controlId !== dueControl.id || state !== 'checking' || requestedToken !== activeLeaseToken) return false;
      decision = completedDecision;
      state = completedDecision.status;
      activeLeaseToken = null;
      return true;
    }),
    retryControl: vi.fn(async ({ controlId, leaseToken: requestedToken, nextAttemptAt: retryAt }) => {
      if (controlId !== dueControl.id || state !== 'checking' || requestedToken !== activeLeaseToken) return false;
      state = 'retry_pending';
      nextAttemptAt = retryAt;
      activeLeaseToken = null;
      return true;
    }),
  };

  return {
    source,
    getState: () => state,
    getDecision: () => decision,
  };
};

const run = (
  source: ReturnType<typeof createExecutionSource>,
  accounting: AccountingTuitionProgressDataSource,
  clock: () => Date = () => now,
  overrides: Parameters<typeof executeDueTuitionProgressReminderControls>[0] = {},
) => executeDueTuitionProgressReminderControls(overrides, {
  source: source.source,
  calculateAccounting: (input) => getAccountingTuitionProgressCandidates(input, accounting),
  clock,
  createLeaseToken: () => leaseToken,
});

describe('tuition progress reminder execution service', () => {
  it('does not claim a control before its scheduled time', async () => {
    const source = createExecutionSource({
      dueControl: control({
        scheduledAt: new Date('2027-02-20T13:00:00.000Z'),
        nextAttemptAt: new Date('2027-02-20T13:00:00.000Z'),
      }),
    });

    const result = await run(source, accountingSource());

    expect(result.claimedCount).toBe(0);
    expect(source.source.claimDueControl).toHaveBeenCalledOnce();
    expect(source.getState()).toBe('scheduled');
  });

  it('expires elapsed controls without calculating or notifying', async () => {
    const source = createExecutionSource({
      dueControl: control({ expiresAt: new Date('2027-02-20T11:59:59.999Z') }),
    });
    const accounting = accountingSource();

    const result = await run(source, accounting);

    expect(result).toMatchObject({ expiredCount: 1, claimedCount: 0 });
    expect(source.getState()).toBe('expired');
    expect(accounting.loadTuitionObligations).not.toHaveBeenCalled();
  });

  it('does not persist a calculated result after the control expires', async () => {
    const source = createExecutionSource();
    const clockTimes = [
      now,
      now,
      new Date('2027-02-20T23:59:59.999Z'),
    ];

    const result = await run(source, accountingSource(), () => clockTimes.shift() ?? now);

    expect(result.outcomes).toEqual([{ controlId: 501, status: 'expired' }]);
    expect(source.getDecision()).toMatchObject({
      status: 'expired',
      targetAmount: null,
      netPaidAmount: null,
      shortfallAmount: null,
    });
  });

  it('uses net payments paid in advance and records an up-to-date result', async () => {
    const source = createExecutionSource();

    const result = await run(source, accountingSource({
      allocations: [allocation({ amount: 600, paidAtDate: '2027-02-19' })],
    }));

    expect(result.outcomes).toEqual([{ controlId: 501, status: 'checked_up_to_date' }]);
    expect(source.getDecision()).toMatchObject({
      status: 'checked_up_to_date',
      netPaidAmount: 600,
      shortfallAmount: 0,
    });
  });

  it('records a confirmed theoretical shortfall without creating a notification', async () => {
    const source = createExecutionSource();

    const result = await run(source, accountingSource({
      allocations: [allocation({ amount: 300 })],
    }));

    expect(result.outcomes).toEqual([{ controlId: 501, status: 'checked_below_target' }]);
    expect(source.getDecision()).toMatchObject({
      status: 'checked_below_target',
      netPaidAmount: 300,
      shortfallAmount: expect.any(Number),
      lastError: null,
    });
    expect(source.source.completeControl).toHaveBeenCalledOnce();
  });

  it('skips ambiguous payment data without treating it as an insufficiency', async () => {
    const source = createExecutionSource();

    const result = await run(source, accountingSource({
      allocations: [allocation({ paymentSchoolId: 8 })],
    }));

    expect(result.outcomes).toEqual([{ controlId: 501, status: 'skipped_ambiguous' }]);
    expect(source.getDecision()).toMatchObject({
      status: 'skipped_ambiguous',
      targetAmount: null,
      netPaidAmount: null,
      shortfallAmount: null,
    });
  });

  it('makes technical calculation failures retryable', async () => {
    const source = createExecutionSource();
    const accounting = accountingSource();
    vi.mocked(accounting.loadPeriods).mockRejectedValueOnce(new Error('temporary accounting failure'));

    const result = await run(source, accounting);

    expect(result.outcomes).toMatchObject([{ controlId: 501, status: 'retry_pending' }]);
    expect(source.getState()).toBe('retry_pending');
    expect(source.source.retryControl).toHaveBeenCalledWith(expect.objectContaining({
      controlId: 501,
      lastError: 'accounting_calculation_failed',
    }));
  });

  it('allows only one of two concurrent executors to claim a control', async () => {
    const source = createExecutionSource();
    const accounting = accountingSource();

    const [first, second] = await Promise.all([
      run(source, accounting),
      run(source, accounting),
    ]);

    expect(first.claimedCount + second.claimedCount).toBe(1);
    expect(source.source.completeControl).toHaveBeenCalledOnce();
  });

  it('reclaims a checking control after its lease expires', async () => {
    const source = createExecutionSource({
      initialState: 'checking',
      initialLeaseExpiresAt: new Date('2027-02-20T11:59:00.000Z'),
    });

    const result = await run(source, accountingSource());

    expect(result.outcomes).toEqual([{ controlId: 501, status: 'checked_up_to_date' }]);
    expect(source.source.claimDueControl).toHaveBeenCalledTimes(2);
    expect(source.getState()).toBe('checked_up_to_date');
  });

  it('resumes a retry after an interrupted calculation', async () => {
    const source = createExecutionSource();
    const accounting = accountingSource();
    vi.mocked(accounting.loadPeriods).mockRejectedValueOnce(new Error('temporary failure'));

    const first = await run(source, accounting);
    expect(first.outcomes[0]?.status).toBe('retry_pending');
    const retryAt = vi.mocked(source.source.retryControl).mock.calls[0][0].nextAttemptAt;
    const second = await run(source, accounting, () => new Date(retryAt.getTime() + 1_000));

    expect(second.outcomes).toEqual([{ controlId: 501, status: 'checked_up_to_date' }]);
    expect(source.getState()).toBe('checked_up_to_date');
  });

  it('does not calculate a claimed control outside the requested school scope', async () => {
    const source = createExecutionSource();
    vi.mocked(source.source.claimDueControl).mockImplementation(async (request) => ({
      ...control({ schoolId: 8 }),
      leaseToken: request.leaseToken,
      leaseExpiresAt: new Date(Math.min(
        request.leaseExpiresAt.getTime(),
        control().expiresAt.getTime(),
      )),
    }));
    const accounting = accountingSource();

    await expect(run(source, accounting, () => now, {
      scope: { schoolId: 7, academicYearId: 23, cycleId: 4 },
    })).rejects.toThrow('invalid, expired or out-of-scope claim');
    expect(accounting.loadTuitionObligations).not.toHaveBeenCalled();
  });
});
