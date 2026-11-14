import { describe, expect, it, vi } from 'vitest';
import {
  processTuitionProgressReminderPushOutbox,
  type TuitionProgressReminderPushClaim,
  type TuitionProgressReminderPushSource,
} from './tuitionProgressReminderPush.ts';

const claim = (overrides: Partial<TuitionProgressReminderPushClaim> = {}): TuitionProgressReminderPushClaim => ({
  outboxId: 71,
  attemptCount: 1,
  notificationId: 81,
  userId: 91,
  title: 'Rappel de scolarité',
  body: 'La progression des versements est inférieure à l’objectif théorique.',
  dedupeKey: 'tuition-progress-reminder:101',
  controlId: 101,
  schoolId: 7,
  academicYearId: 23,
  cycleId: 4,
  studentId: 31,
  monthStart: '2027-07-01',
  scheduledAt: new Date('2027-07-16T08:00:00.000Z'),
  expiresAt: new Date('2027-07-16T22:59:59.999Z'),
  timeZone: 'Africa/Lome',
  ...overrides,
});

const makeSource = (
  overrides: Partial<TuitionProgressReminderPushSource> = {},
): TuitionProgressReminderPushSource => ({
  markInterruptedSendingUncertain: vi.fn(async () => 0),
  claimDue: vi.fn(async () => [claim()]),
  verifyBeforeSend: vi.fn(async () => 'eligible' as const),
  defer: vi.fn(async () => true),
  markFcmAccepted: vi.fn(async () => true),
  scheduleRetry: vi.fn(async () => true),
  markUncertain: vi.fn(async () => true),
  markFailed: vi.fn(async () => true),
  ...overrides,
});

describe('tuition progress reminder push outbox', () => {
  it('does not send an expired control', async () => {
    const source = makeSource();
    const send = vi.fn();
    const result = await processTuitionProgressReminderPushOutbox({
      source: {
        ...source,
        claimDue: vi.fn(async () => [claim({ expiresAt: new Date('2027-07-16T09:59:59.999Z') })]),
      },
      send,
      clock: () => new Date('2027-07-16T10:00:00.000Z'),
    });

    expect(result.outcomes).toEqual([{ outboxId: 71, status: 'failed' }]);
    expect(send).not.toHaveBeenCalled();
  });

  it('defers in system quiet hours and never submits the push', async () => {
    const source = makeSource();
    const send = vi.fn();
    const result = await processTuitionProgressReminderPushOutbox({
      source: {
        ...source,
        claimDue: vi.fn(async () => [claim({
          expiresAt: new Date('2027-07-17T10:00:00.000Z'),
        })]),
      },
      send,
      clock: () => new Date('2027-07-16T23:00:00.000Z'),
    });

    expect(result.outcomes).toEqual([{ outboxId: 71, status: 'deferred' }]);
    expect(source.defer).toHaveBeenCalledWith(expect.objectContaining({
      nextAttemptAt: new Date('2027-07-17T07:00:00.000Z'),
    }));
    expect(send).not.toHaveBeenCalled();
  });

  it('rechecks accounting and suppresses a push when payment has caught up', async () => {
    const source = makeSource({
      verifyBeforeSend: vi.fn(async () => 'suppressed_paid' as const),
    });
    const send = vi.fn();
    const result = await processTuitionProgressReminderPushOutbox({
      source,
      send,
      clock: () => new Date('2027-07-16T10:00:00.000Z'),
    });

    expect(result.outcomes).toEqual([{ outboxId: 71, status: 'failed' }]);
    expect(source.markFailed).toHaveBeenCalledWith(expect.objectContaining({
      error: 'payment_progress_caught_up_before_push',
    }));
    expect(send).not.toHaveBeenCalled();
  });

  it('records FCM acceptance without claiming actual delivery', async () => {
    const source = makeSource();
    const result = await processTuitionProgressReminderPushOutbox({
      source,
      send: vi.fn(async (_claim: TuitionProgressReminderPushClaim) => ({
        status: 'fcm_accepted' as const,
        acceptedDeviceCount: 1,
      })),
      clock: () => new Date('2027-07-16T10:00:00.000Z'),
    });

    expect(result.outcomes).toEqual([{ outboxId: 71, status: 'fcm_accepted' }]);
    expect(source.markFcmAccepted).toHaveBeenCalledOnce();
    expect(source.markUncertain).not.toHaveBeenCalled();
  });

  it('passes the selected test student and month to both outbox recovery and claiming', async () => {
    const source = makeSource();
    const scope = {
      schoolId: 7,
      academicYearId: 23,
      cycleId: 4,
      studentId: 31,
      monthStart: '2027-07-01',
      stage: 'last' as const,
    };

    await processTuitionProgressReminderPushOutbox({
      source,
      send: vi.fn(async () => ({
        status: 'fcm_accepted' as const,
        acceptedDeviceCount: 1,
      })),
      clock: () => new Date('2027-07-16T10:00:00.000Z'),
      scope,
    });

    expect(source.markInterruptedSendingUncertain).toHaveBeenCalledWith(expect.objectContaining({ scope }));
    expect(source.claimDue).toHaveBeenCalledWith(expect.objectContaining({ scope }));
  });

  it('does not replay a transport outcome that became uncertain after a restart', async () => {
    const send = vi.fn();
    const result = await processTuitionProgressReminderPushOutbox({
      source: makeSource({
        markInterruptedSendingUncertain: vi.fn(async () => 1),
        claimDue: vi.fn(async () => []),
      }),
      send,
      clock: () => new Date('2027-07-16T10:00:00.000Z'),
    });

    expect(result.recoveredUncertainCount).toBe(1);
    expect(result.claimedCount).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });

  it('schedules a safe retry for a known transient transport failure', async () => {
    const source = makeSource();
    const result = await processTuitionProgressReminderPushOutbox({
      source,
      send: vi.fn(async (_claim: TuitionProgressReminderPushClaim) => ({
        status: 'retryable_failure' as const,
        error: 'fcm_transient_failure',
      })),
      clock: () => new Date('2027-07-16T10:00:00.000Z'),
    });

    expect(result.outcomes).toEqual([{ outboxId: 71, status: 'retry_pending' }]);
    expect(source.scheduleRetry).toHaveBeenCalledWith(expect.objectContaining({
      nextAttemptAt: new Date('2027-07-16T10:01:00.000Z'),
      error: 'fcm_transient_failure',
    }));
  });

  it('does not leave an outbox claim sending when no retry can occur before expiration', async () => {
    const source = makeSource({
      claimDue: vi.fn(async () => [claim({
        expiresAt: new Date('2027-07-16T10:00:30.000Z'),
      })]),
    });
    const result = await processTuitionProgressReminderPushOutbox({
      source,
      send: vi.fn(async (_claim: TuitionProgressReminderPushClaim) => ({
        status: 'retryable_failure' as const,
        error: 'fcm_transient_failure',
      })),
      clock: () => new Date('2027-07-16T10:00:00.000Z'),
    });

    expect(result.outcomes).toEqual([{ outboxId: 71, status: 'failed' }]);
    expect(source.markFailed).toHaveBeenCalledWith(expect.objectContaining({
      error: 'control_expires_before_retry',
    }));
    expect(source.scheduleRetry).not.toHaveBeenCalled();
  });
});
