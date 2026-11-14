import { randomUUID } from 'node:crypto';
import {
  type AccountingTuitionProgressInput,
  type AccountingTuitionProgressResult,
  type AccountingTuitionProgressStudent,
} from './accountingTuitionProgress.ts';

export type TuitionProgressReminderExecutionScope = {
  schoolId: number;
  academicYearId: number;
  cycleId: number;
  studentId?: number;
  monthStart?: string;
  stage?: 'penultimate' | 'last';
};

export type TuitionProgressReminderClaim = Omit<TuitionProgressReminderExecutionScope, 'studentId'> & {
  studentId: number;
  id: number;
  monthStart: string;
  stage: 'penultimate' | 'last';
  scheduledAt: Date;
  expiresAt: Date;
  timeZone: string;
  status: 'checking';
  attemptCount: number;
  nextAttemptAt: Date;
  leaseToken: string;
  leaseExpiresAt: Date;
};

export type TuitionProgressReminderDecisionStatus =
  | 'checked_up_to_date'
  | 'checked_below_target'
  | 'skipped_ambiguous'
  | 'skipped_invalid_calendar'
  | 'expired';

export type TuitionProgressReminderDecision = {
  status: TuitionProgressReminderDecisionStatus;
  targetAmount: number | null;
  netPaidAmount: number | null;
  shortfallAmount: number | null;
  lastError: string | null;
};

export type TuitionProgressReminderExecutionSource = {
  expireElapsedControls: (input: {
    now: Date;
    scope?: TuitionProgressReminderExecutionScope;
  }) => Promise<number>;
  /** Atomically claims one due row or reclaims a checking row whose lease expired. */
  claimDueControl: (input: {
    now: Date;
    leaseToken: string;
    leaseExpiresAt: Date;
    scope?: TuitionProgressReminderExecutionScope;
  }) => Promise<TuitionProgressReminderClaim | null>;
  /** Must compare both the control ID and lease token before changing a claimed row. */
  completeControl: (input: {
    controlId: number;
    leaseToken: string;
    nextAttemptAt: Date;
    lastCalculatedAt: Date;
    decision: TuitionProgressReminderDecision;
  }) => Promise<boolean>;
  retryControl: (input: {
    controlId: number;
    leaseToken: string;
    now: Date;
    nextAttemptAt: Date;
    lastError: string;
  }) => Promise<boolean>;
};

export type ExecuteTuitionProgressReminderControlsInput = {
  scope?: TuitionProgressReminderExecutionScope;
  limit?: number;
  leaseDurationMs?: number;
};

export type TuitionProgressReminderExecutionOutcome =
  {
    controlId: number;
    status: TuitionProgressReminderDecisionStatus | 'retry_pending' | 'lease_lost';
    error?: unknown;
  };

export type ExecuteTuitionProgressReminderControlsResult = {
  expiredCount: number;
  claimedCount: number;
  outcomes: TuitionProgressReminderExecutionOutcome[];
};

export type TuitionProgressReminderExecutionDependencies = {
  calculateAccounting: (
    input: AccountingTuitionProgressInput,
  ) => Promise<AccountingTuitionProgressResult>;
  source: TuitionProgressReminderExecutionSource;
  clock?: () => Date;
  createLeaseToken?: () => string;
};

const DEFAULT_LIMIT = 25;
const DEFAULT_LEASE_DURATION_MS = 30_000;
const BASE_RETRY_DELAY_MS = 1_000;
const MAX_RETRY_DELAY_MS = 5 * 60_000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const isPositiveSafeInteger = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Number(value) > 0;

const isValidDate = (value: unknown): value is Date =>
  value instanceof Date && Number.isFinite(value.getTime());

const validateScope = (scope: TuitionProgressReminderExecutionScope | undefined): void => {
  if (!scope) return;
  if (!isPositiveSafeInteger(scope.schoolId)
    || !isPositiveSafeInteger(scope.academicYearId)
    || !isPositiveSafeInteger(scope.cycleId)
    || (scope.studentId != null && !isPositiveSafeInteger(scope.studentId))
    || (scope.monthStart != null && !/^\d{4}-(0[1-9]|1[0-2])-01$/.test(scope.monthStart))
    || (scope.stage != null && scope.stage !== 'penultimate' && scope.stage !== 'last')) {
    throw new Error('Reminder execution scope must contain valid school, year and cycle identifiers.');
  }
};

const scopeMatches = (
  claim: TuitionProgressReminderClaim,
  scope: TuitionProgressReminderExecutionScope | undefined,
): boolean => !scope
  || (claim.schoolId === scope.schoolId
    && claim.academicYearId === scope.academicYearId
    && claim.cycleId === scope.cycleId
    && (scope.studentId == null || claim.studentId === scope.studentId)
    && (scope.monthStart == null || claim.monthStart === scope.monthStart)
    && (scope.stage == null || claim.stage === scope.stage));

const assessmentDateInTimeZone = (instant: Date, timeZone: string): string | null => {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(instant);
    const values = Object.fromEntries(
      parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]),
    );
    if (!values.year || !values.month || !values.day) return null;
    return `${values.year.padStart(4, '0')}-${values.month}-${values.day}`;
  } catch {
    return null;
  }
};

const validateClaim = (
  claim: TuitionProgressReminderClaim,
  expectedToken: string,
  now: Date,
  scope: TuitionProgressReminderExecutionScope | undefined,
): void => {
  if (!isPositiveSafeInteger(claim.id)
    || !isPositiveSafeInteger(claim.schoolId)
    || !isPositiveSafeInteger(claim.academicYearId)
    || !isPositiveSafeInteger(claim.cycleId)
    || !isPositiveSafeInteger(claim.studentId)
    || claim.status !== 'checking'
    || claim.leaseToken !== expectedToken
    || !UUID_PATTERN.test(claim.leaseToken)
    || !isValidDate(claim.scheduledAt)
    || !isValidDate(claim.expiresAt)
    || !isValidDate(claim.nextAttemptAt)
    || !isValidDate(claim.leaseExpiresAt)
    || claim.scheduledAt.getTime() > now.getTime()
    || claim.nextAttemptAt.getTime() > now.getTime()
    || claim.expiresAt.getTime() <= now.getTime()
    || claim.leaseExpiresAt.getTime() <= now.getTime()
    || claim.leaseExpiresAt.getTime() > claim.expiresAt.getTime()
    || !Number.isSafeInteger(claim.attemptCount)
    || claim.attemptCount < 1
    || (claim.stage !== 'penultimate' && claim.stage !== 'last')
    || typeof claim.timeZone !== 'string'
    || claim.timeZone.trim().length === 0
    || !scopeMatches(claim, scope)) {
    throw new Error('The due-control source returned an invalid, expired or out-of-scope claim.');
  }
}

const evaluateStudent = (
  student: AccountingTuitionProgressStudent | undefined,
): TuitionProgressReminderDecision => {
  if (!student) {
    return {
      status: 'skipped_ambiguous',
      targetAmount: null,
      netPaidAmount: null,
      shortfallAmount: null,
      lastError: 'student_missing_from_accounting_result',
    };
  }
  if (student.status === 'excluded_ambiguous') {
    return {
      status: 'skipped_ambiguous',
      targetAmount: null,
      netPaidAmount: null,
      shortfallAmount: null,
      lastError: student.reasonCode,
    };
  }
  if (student.status === 'outside_school_year') {
    return {
      status: 'skipped_invalid_calendar',
      targetAmount: null,
      netPaidAmount: null,
      shortfallAmount: null,
      lastError: 'assessment_outside_school_year',
    };
  }

  const targetAmount = student.expectedCumulativeAmount;
  const netPaidAmount = student.netPaidAmount;
  const shortfallAmount = student.shortfallAmount;
  if (![targetAmount, netPaidAmount, shortfallAmount].every((amount) =>
    Number.isSafeInteger(amount) && amount >= 0)
    || shortfallAmount !== Math.max(targetAmount - netPaidAmount, 0)
    || (student.status === 'below_target') !== (shortfallAmount > 0)) {
    throw new Error('The accounting service returned inconsistent tuition-progress amounts.');
  }

  return {
    status: student.status === 'up_to_date' ? 'checked_up_to_date' : 'checked_below_target',
    targetAmount,
    netPaidAmount,
    shortfallAmount,
    lastError: null,
  };
};

const calculateDecision = async (
  claim: TuitionProgressReminderClaim,
  calculateAccounting: TuitionProgressReminderExecutionDependencies['calculateAccounting'],
): Promise<TuitionProgressReminderDecision> => {
  const assessmentDate = assessmentDateInTimeZone(claim.scheduledAt, claim.timeZone);
  if (!assessmentDate) {
    return {
      status: 'skipped_invalid_calendar',
      targetAmount: null,
      netPaidAmount: null,
      shortfallAmount: null,
      lastError: 'invalid_assessment_time_zone',
    };
  }
  if (claim.monthStart !== `${assessmentDate.slice(0, 7)}-01`) {
    return {
      status: 'skipped_invalid_calendar',
      targetAmount: null,
      netPaidAmount: null,
      shortfallAmount: null,
      lastError: 'schedule_month_mismatch',
    };
  }

  const result = await calculateAccounting({
    schoolId: claim.schoolId,
    academicYearId: claim.academicYearId,
    cycleId: claim.cycleId,
    assessmentDate,
  });
  if (result.status === 'calendar_invalid') {
    return {
      status: 'skipped_invalid_calendar',
      targetAmount: null,
      netPaidAmount: null,
      shortfallAmount: null,
      lastError: result.reasonCode,
    };
  }
  if (result.schoolId !== claim.schoolId
    || result.academicYearId !== claim.academicYearId
    || result.cycleId !== claim.cycleId) {
    throw new Error('The accounting service returned results outside the claimed control scope.');
  }
  return evaluateStudent(result.students.find((student) => student.studentId === claim.studentId));
};

const retryDelay = (attemptCount: number): number =>
  Math.min(BASE_RETRY_DELAY_MS * (2 ** Math.min(attemptCount - 1, 16)), MAX_RETRY_DELAY_MS);

export const executeDueTuitionProgressReminderControls = async (
  input: ExecuteTuitionProgressReminderControlsInput,
  dependencies: TuitionProgressReminderExecutionDependencies,
): Promise<ExecuteTuitionProgressReminderControlsResult> => {
  validateScope(input.scope);
  const limit = input.limit ?? DEFAULT_LIMIT;
  const leaseDurationMs = input.leaseDurationMs ?? DEFAULT_LEASE_DURATION_MS;
  if (!Number.isSafeInteger(limit) || limit < 1
    || !Number.isSafeInteger(leaseDurationMs) || leaseDurationMs < 1) {
    throw new Error('Reminder execution limit and lease duration must be positive safe integers.');
  }

  const clock = dependencies.clock ?? (() => new Date());
  const createLeaseToken = dependencies.createLeaseToken ?? randomUUID;
  const initialNow = clock();
  if (!isValidDate(initialNow)) throw new Error('The reminder execution clock returned an invalid timestamp.');
  const expiredCount = await dependencies.source.expireElapsedControls({
    now: new Date(initialNow),
    scope: input.scope,
  });
  if (!Number.isSafeInteger(expiredCount) || expiredCount < 0) {
    throw new Error('The due-control source returned an invalid expired-control count.');
  }

  const outcomes: TuitionProgressReminderExecutionOutcome[] = [];
  while (outcomes.length < limit) {
    const now = clock();
    if (!isValidDate(now)) throw new Error('The reminder execution clock returned an invalid timestamp.');
    const leaseToken = createLeaseToken();
    if (typeof leaseToken !== 'string' || !UUID_PATTERN.test(leaseToken)) {
      throw new Error('The reminder execution lease-token factory must return a UUID.');
    }

    const claim = await dependencies.source.claimDueControl({
      now: new Date(now),
      leaseToken,
      leaseExpiresAt: new Date(now.getTime() + leaseDurationMs),
      scope: input.scope,
    });
    if (!claim) break;
    validateClaim(claim, leaseToken, now, input.scope);
    outcomes.push(await processClaim(claim, dependencies.calculateAccounting, dependencies.source, clock));
  }

  return { expiredCount, claimedCount: outcomes.length, outcomes };
};

const processClaim = async (
  claim: TuitionProgressReminderClaim,
  calculateAccounting: TuitionProgressReminderExecutionDependencies['calculateAccounting'],
  source: TuitionProgressReminderExecutionSource,
  clock: () => Date,
): Promise<TuitionProgressReminderExecutionOutcome> => {
  let decision: TuitionProgressReminderDecision;
  try {
    decision = await calculateDecision(claim, calculateAccounting);
  } catch (error) {
    const now = clock();
    if (!isValidDate(now)) throw new Error('The reminder execution clock returned an invalid timestamp.');
    if (now.getTime() >= claim.expiresAt.getTime()) {
      const saved = await source.completeControl({
        controlId: claim.id,
        leaseToken: claim.leaseToken,
        nextAttemptAt: claim.nextAttemptAt,
        lastCalculatedAt: now,
        decision: {
          status: 'expired',
          targetAmount: null,
          netPaidAmount: null,
          shortfallAmount: null,
          lastError: null,
        },
      });
      return { controlId: claim.id, status: saved ? 'expired' : 'lease_lost', error };
    }
    const nextAttemptAt = new Date(Math.min(
      now.getTime() + retryDelay(claim.attemptCount),
      claim.expiresAt.getTime(),
    ));
    const saved = await source.retryControl({
      controlId: claim.id,
      leaseToken: claim.leaseToken,
      now,
      nextAttemptAt,
      lastError: 'accounting_calculation_failed',
    });
    return {
      controlId: claim.id,
      status: saved ? 'retry_pending' : 'lease_lost',
      error,
    };
  }

  const completedAt = clock();
  if (!isValidDate(completedAt)) throw new Error('The reminder execution clock returned an invalid timestamp.');
  if (completedAt.getTime() >= claim.expiresAt.getTime()) {
    decision = {
      status: 'expired',
      targetAmount: null,
      netPaidAmount: null,
      shortfallAmount: null,
      lastError: null,
    };
  }
  const saved = await source.completeControl({
    controlId: claim.id,
    leaseToken: claim.leaseToken,
    nextAttemptAt: claim.nextAttemptAt,
    lastCalculatedAt: completedAt,
    decision,
  });
  return { controlId: claim.id, status: saved ? decision.status : 'lease_lost' };
};
