import { getTuitionProgressReminderQuietHoursDecision } from './tuitionProgressReminderQuietHours.ts';
import type { TuitionProgressReminderExecutionScope } from './tuitionProgressReminderExecution.ts';

export type TuitionProgressReminderPushClaim = {
  outboxId: number;
  attemptCount: number;
  notificationId: number;
  userId: number;
  title: string;
  body: string;
  dedupeKey: string;
  controlId: number;
  schoolId: number;
  academicYearId: number;
  cycleId: number;
  studentId: number;
  monthStart: string;
  scheduledAt: Date;
  expiresAt: Date;
  timeZone: string;
};

export type TuitionProgressReminderPushTransportResult =
  | { status: 'fcm_accepted'; acceptedDeviceCount: number }
  | { status: 'deferred' }
  | { status: 'retryable_failure'; error: string }
  | { status: 'uncertain'; error: string }
  | { status: 'no_subscription'; error: string }
  | { status: 'permanent_failure'; error: string };

export type TuitionProgressReminderPushSource = {
  markInterruptedSendingUncertain: (input: {
    olderThan: Date;
    now: Date;
    scope?: TuitionProgressReminderExecutionScope;
  }) => Promise<number>;
  claimDue: (input: {
    now: Date;
    limit: number;
    scope?: TuitionProgressReminderExecutionScope;
  }) => Promise<TuitionProgressReminderPushClaim[]>;
  verifyBeforeSend: (
    claim: TuitionProgressReminderPushClaim,
    now: Date,
  ) => Promise<'eligible' | 'expired' | 'suppressed_paid' | 'invalid_scope' | 'retryable_failure'>;
  defer: (input: {
    claim: TuitionProgressReminderPushClaim;
    now: Date;
    nextAttemptAt: Date;
  }) => Promise<boolean>;
  markFcmAccepted: (input: {
    claim: TuitionProgressReminderPushClaim;
    now: Date;
  }) => Promise<boolean>;
  scheduleRetry: (input: {
    claim: TuitionProgressReminderPushClaim;
    now: Date;
    nextAttemptAt: Date;
    error: string;
  }) => Promise<boolean>;
  markUncertain: (input: {
    claim: TuitionProgressReminderPushClaim;
    now: Date;
    error: string;
  }) => Promise<boolean>;
  markFailed: (input: {
    claim: TuitionProgressReminderPushClaim;
    now: Date;
    error: string;
  }) => Promise<boolean>;
};

export type ProcessTuitionProgressReminderPushResult = {
  recoveredUncertainCount: number;
  claimedCount: number;
  outcomes: Array<{
    outboxId: number;
    status: 'fcm_accepted' | 'retry_pending' | 'uncertain' | 'failed' | 'lease_lost' | 'deferred';
  }>;
};

export type ProcessTuitionProgressReminderPushDependencies = {
  source: TuitionProgressReminderPushSource;
  send: (claim: TuitionProgressReminderPushClaim) => Promise<TuitionProgressReminderPushTransportResult>;
  clock?: () => Date;
  limit?: number;
  staleSendingMs?: number;
  scope?: TuitionProgressReminderExecutionScope;
};

const BASE_RETRY_DELAY_MS = 60_000;
const MAX_RETRY_DELAY_MS = 30 * 60_000;
const DEFAULT_STALE_SENDING_MS = 2 * 60_000;

const isValidDate = (value: unknown): value is Date =>
  value instanceof Date && Number.isFinite(value.getTime());

const validateClaim = (claim: TuitionProgressReminderPushClaim): void => {
  if (!Number.isSafeInteger(claim.outboxId) || claim.outboxId <= 0
    || !Number.isSafeInteger(claim.attemptCount) || claim.attemptCount < 1
    || !Number.isSafeInteger(claim.notificationId) || claim.notificationId <= 0
    || !Number.isSafeInteger(claim.userId) || claim.userId <= 0
    || !Number.isSafeInteger(claim.controlId) || claim.controlId <= 0
    || !Number.isSafeInteger(claim.schoolId) || claim.schoolId <= 0
    || !Number.isSafeInteger(claim.academicYearId) || claim.academicYearId <= 0
    || !Number.isSafeInteger(claim.cycleId) || claim.cycleId <= 0
    || !Number.isSafeInteger(claim.studentId) || claim.studentId <= 0
    || !isValidDate(claim.scheduledAt)
    || !isValidDate(claim.expiresAt)
    || claim.scheduledAt.getTime() > claim.expiresAt.getTime()
    || typeof claim.timeZone !== 'string'
    || !claim.timeZone.trim()
    || !claim.dedupeKey.startsWith(`tuition-progress-reminder:${claim.controlId}`)
    || !claim.title.trim()
    || !claim.body.trim()) {
    throw new Error('The tuition progress push outbox returned an invalid claim.');
  }
};

const retryDelayMs = (attemptCount: number): number =>
  Math.min(BASE_RETRY_DELAY_MS * (2 ** Math.min(attemptCount - 1, 16)), MAX_RETRY_DELAY_MS);

export const processTuitionProgressReminderPushOutbox = async (
  dependencies: ProcessTuitionProgressReminderPushDependencies,
): Promise<ProcessTuitionProgressReminderPushResult> => {
  const clock = dependencies.clock ?? (() => new Date());
  const limit = dependencies.limit ?? 20;
  const staleSendingMs = dependencies.staleSendingMs ?? DEFAULT_STALE_SENDING_MS;
  if (!Number.isSafeInteger(limit) || limit < 1
    || !Number.isSafeInteger(staleSendingMs) || staleSendingMs < 1) {
    throw new Error('The push outbox limit and stale-send interval must be positive safe integers.');
  }
  if (dependencies.scope) {
    const { schoolId, academicYearId, cycleId, studentId, monthStart, stage } = dependencies.scope;
    if (![schoolId, academicYearId, cycleId].every((id) => Number.isSafeInteger(id) && id > 0)
      || (studentId != null && (!Number.isSafeInteger(studentId) || studentId <= 0))
      || (monthStart != null && !/^\d{4}-(0[1-9]|1[0-2])-01$/.test(monthStart))
      || (stage != null && stage !== 'penultimate' && stage !== 'last')) {
      throw new Error('The push outbox scope is invalid.');
    }
  }

  const initialNow = clock();
  if (!isValidDate(initialNow)) throw new Error('The push outbox clock returned an invalid timestamp.');
  const recoveredUncertainCount = await dependencies.source.markInterruptedSendingUncertain({
    olderThan: new Date(initialNow.getTime() - staleSendingMs),
    now: new Date(initialNow),
    scope: dependencies.scope,
  });
  if (!Number.isSafeInteger(recoveredUncertainCount) || recoveredUncertainCount < 0) {
    throw new Error('The push outbox source returned an invalid interrupted-send count.');
  }

  const claims = await dependencies.source.claimDue({
    now: new Date(initialNow),
    limit,
    scope: dependencies.scope,
  });
  if (claims.length > limit || new Set(claims.map((claim) => claim.outboxId)).size !== claims.length) {
    throw new Error('The push outbox source returned too many or duplicate claims.');
  }
  const outcomes: ProcessTuitionProgressReminderPushResult['outcomes'] = [];

  for (const claim of claims) {
    validateClaim(claim);
    let now = clock();
    if (!isValidDate(now)) throw new Error('The push outbox clock returned an invalid timestamp.');

    if (claim.expiresAt.getTime() <= now.getTime()) {
      const saved = await dependencies.source.markFailed({
        claim,
        now,
        error: 'control_expired_before_push',
      });
      outcomes.push({ outboxId: claim.outboxId, status: saved ? 'failed' : 'lease_lost' });
      continue;
    }

    const quietDecision = getTuitionProgressReminderQuietHoursDecision({
      now,
      expiresAt: claim.expiresAt,
      timeZone: claim.timeZone,
    });
    if (quietDecision.kind === 'expired' || quietDecision.kind === 'invalid') {
      const saved = await dependencies.source.markFailed({
        claim,
        now,
        error: quietDecision.kind === 'expired' ? 'control_expired_in_quiet_hours' : 'invalid_quiet_hours_time_zone',
      });
      outcomes.push({ outboxId: claim.outboxId, status: saved ? 'failed' : 'lease_lost' });
      continue;
    }
    if (quietDecision.kind === 'deferred') {
      const saved = await dependencies.source.defer({
        claim,
        now,
        nextAttemptAt: quietDecision.deliverAt,
      });
      outcomes.push({ outboxId: claim.outboxId, status: saved ? 'deferred' : 'lease_lost' });
      continue;
    }

    let verified: Awaited<ReturnType<TuitionProgressReminderPushSource['verifyBeforeSend']>>;
    try {
      verified = await dependencies.source.verifyBeforeSend(claim, now);
    } catch {
      verified = 'retryable_failure';
    }
    if (verified !== 'eligible') {
      now = clock();
      if (!isValidDate(now)) throw new Error('The push outbox clock returned an invalid timestamp.');
      if (verified === 'retryable_failure' && now.getTime() < claim.expiresAt.getTime()) {
        const nextAttemptAt = new Date(Math.min(
          now.getTime() + retryDelayMs(claim.attemptCount),
          claim.expiresAt.getTime(),
        ));
        if (nextAttemptAt.getTime() >= claim.expiresAt.getTime()) {
          const saved = await dependencies.source.markFailed({
            claim,
            now,
            error: 'control_expires_before_retry',
          });
          outcomes.push({ outboxId: claim.outboxId, status: saved ? 'failed' : 'lease_lost' });
          continue;
        }
        const saved = await dependencies.source.scheduleRetry({
          claim,
          now,
          nextAttemptAt,
          error: 'push_preflight_temporarily_unavailable',
        });
        outcomes.push({ outboxId: claim.outboxId, status: saved ? 'retry_pending' : 'lease_lost' });
      } else {
        const error = verified === 'expired'
          ? 'control_expired_before_push'
          : verified === 'suppressed_paid'
            ? 'payment_progress_caught_up_before_push'
            : verified === 'invalid_scope'
              ? 'push_recipient_scope_invalid'
              : 'control_expired_before_retry';
        const saved = await dependencies.source.markFailed({ claim, now, error });
        outcomes.push({ outboxId: claim.outboxId, status: saved ? 'failed' : 'lease_lost' });
      }
      continue;
    }

    now = clock();
    if (!isValidDate(now)) throw new Error('The push outbox clock returned an invalid timestamp.');
    if (now.getTime() >= claim.expiresAt.getTime()) {
      const saved = await dependencies.source.markFailed({
        claim,
        now,
        error: 'control_expired_before_push',
      });
      outcomes.push({ outboxId: claim.outboxId, status: saved ? 'failed' : 'lease_lost' });
      continue;
    }

    let delivery: TuitionProgressReminderPushTransportResult;
    try {
      delivery = await dependencies.send(claim);
    } catch (error) {
      now = clock();
      if (!isValidDate(now)) throw new Error('The push outbox clock returned an invalid timestamp.');
      const saved = await dependencies.source.markUncertain({
        claim,
        now,
        error: error instanceof Error ? error.message.slice(0, 1000) : 'push_transport_outcome_unknown',
      });
      outcomes.push({ outboxId: claim.outboxId, status: saved ? 'uncertain' : 'lease_lost' });
      continue;
    }

    now = clock();
    if (!isValidDate(now)) throw new Error('The push outbox clock returned an invalid timestamp.');
    if (delivery.status === 'fcm_accepted') {
      const saved = await dependencies.source.markFcmAccepted({ claim, now });
      outcomes.push({ outboxId: claim.outboxId, status: saved ? 'fcm_accepted' : 'lease_lost' });
    } else if (delivery.status === 'deferred') {
      const quietDecision = getTuitionProgressReminderQuietHoursDecision({
        now,
        expiresAt: claim.expiresAt,
        timeZone: claim.timeZone,
      });
      if (quietDecision.kind === 'deferred') {
        const saved = await dependencies.source.defer({
          claim,
          now,
          nextAttemptAt: quietDecision.deliverAt,
        });
        outcomes.push({ outboxId: claim.outboxId, status: saved ? 'deferred' : 'lease_lost' });
      } else if (quietDecision.kind === 'allowed') {
        const nextAttemptAt = new Date(Math.min(now.getTime() + BASE_RETRY_DELAY_MS, claim.expiresAt.getTime()));
        if (nextAttemptAt.getTime() >= claim.expiresAt.getTime()) {
          const saved = await dependencies.source.markFailed({
            claim,
            now,
            error: 'control_expires_before_retry',
          });
          outcomes.push({ outboxId: claim.outboxId, status: saved ? 'failed' : 'lease_lost' });
          continue;
        }
        const saved = await dependencies.source.scheduleRetry({
          claim,
          now,
          nextAttemptAt,
          error: 'system_quiet_hours_race',
        });
        outcomes.push({ outboxId: claim.outboxId, status: saved ? 'retry_pending' : 'lease_lost' });
      } else {
        const saved = await dependencies.source.markFailed({
          claim,
          now,
          error: quietDecision.kind === 'expired' ? 'control_expired_in_quiet_hours' : 'invalid_quiet_hours_time_zone',
        });
        outcomes.push({ outboxId: claim.outboxId, status: saved ? 'failed' : 'lease_lost' });
      }
    } else if (delivery.status === 'retryable_failure' && now.getTime() < claim.expiresAt.getTime()) {
      const nextAttemptAt = new Date(Math.min(
        now.getTime() + retryDelayMs(claim.attemptCount),
        claim.expiresAt.getTime(),
      ));
      if (nextAttemptAt.getTime() >= claim.expiresAt.getTime()) {
        const saved = await dependencies.source.markFailed({
          claim,
          now,
          error: 'control_expires_before_retry',
        });
        outcomes.push({ outboxId: claim.outboxId, status: saved ? 'failed' : 'lease_lost' });
        continue;
      }
      const saved = await dependencies.source.scheduleRetry({
        claim,
        now,
        nextAttemptAt,
        error: delivery.error,
      });
      outcomes.push({ outboxId: claim.outboxId, status: saved ? 'retry_pending' : 'lease_lost' });
    } else if (delivery.status === 'uncertain') {
      const saved = await dependencies.source.markUncertain({
        claim,
        now,
        error: delivery.error,
      });
      outcomes.push({ outboxId: claim.outboxId, status: saved ? 'uncertain' : 'lease_lost' });
    } else {
      const saved = await dependencies.source.markFailed({
        claim,
        now,
        error: delivery.error,
      });
      outcomes.push({ outboxId: claim.outboxId, status: saved ? 'failed' : 'lease_lost' });
    }
  }

  return { recoveredUncertainCount, claimedCount: claims.length, outcomes };
};
