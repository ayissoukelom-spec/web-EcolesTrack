import { and, asc, eq, gt, gte, inArray, lte, or, sql } from 'drizzle-orm';
import type { TuitionProgressReminderDrizzleDatabase } from './tuitionProgressReminderDrizzle.ts';
import {
  tuitionProgressReminderControls,
} from '../db/schema.ts';
import type {
  TuitionProgressReminderExecutionScope,
  TuitionProgressReminderExecutionSource,
} from './tuitionProgressReminderExecution.ts';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const isPositiveSafeInteger = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Number(value) > 0;

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

const scopeConditions = (scope: TuitionProgressReminderExecutionScope | undefined) => {
  if (!scope) return [];
  const conditions = [
    eq(tuitionProgressReminderControls.schoolId, scope.schoolId),
    eq(tuitionProgressReminderControls.academicYearId, scope.academicYearId),
    eq(tuitionProgressReminderControls.cycleId, scope.cycleId),
  ];
  if (scope.studentId != null) {
    conditions.push(eq(tuitionProgressReminderControls.studentId, scope.studentId));
  }
  if (scope.monthStart != null) {
    conditions.push(eq(tuitionProgressReminderControls.monthStart, scope.monthStart));
  }
  if (scope.stage != null) {
    conditions.push(eq(tuitionProgressReminderControls.stage, scope.stage));
  }
  return conditions;
};

const validateNow = (now: Date): void => {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new Error('Reminder execution requires a valid current timestamp.');
  }
};

export const createTuitionProgressReminderExecutionDrizzleSource = (
  database: TuitionProgressReminderDrizzleDatabase,
): TuitionProgressReminderExecutionSource => ({
  expireElapsedControls: async ({ now, scope }) => {
    validateNow(now);
    validateScope(scope);
    const expired = await database.update(tuitionProgressReminderControls).set({
      status: 'expired',
      leaseToken: null,
      leaseExpiresAt: null,
      lastError: 'control_expired',
      updatedAt: now,
    }).where(and(
      inArray(tuitionProgressReminderControls.status, ['scheduled', 'retry_pending', 'checking']),
      lte(tuitionProgressReminderControls.expiresAt, now),
      ...scopeConditions(scope),
    )).returning({ id: tuitionProgressReminderControls.id });
    return expired.length;
  },

  claimDueControl: async ({ now, leaseToken, leaseExpiresAt, scope }) => {
    validateNow(now);
    validateScope(scope);
    if (!UUID_PATTERN.test(leaseToken)
      || !(leaseExpiresAt instanceof Date)
      || !Number.isFinite(leaseExpiresAt.getTime())
      || leaseExpiresAt.getTime() <= now.getTime()) {
      throw new Error('A valid lease token and future lease deadline are required.');
    }

    const scheduledOrRetryDue = and(
      inArray(tuitionProgressReminderControls.status, ['scheduled', 'retry_pending']),
      lte(tuitionProgressReminderControls.nextAttemptAt, now),
    );
    const checkingLeaseExpired = and(
      eq(tuitionProgressReminderControls.status, 'checking'),
      lte(tuitionProgressReminderControls.leaseExpiresAt, now),
    );
    const eligibility = and(
      lte(tuitionProgressReminderControls.scheduledAt, now),
      gt(tuitionProgressReminderControls.expiresAt, now),
      or(scheduledOrRetryDue, checkingLeaseExpired),
      ...scopeConditions(scope),
    );

    return database.transaction(async (transaction) => {
      const [candidate] = await transaction.select({
        id: tuitionProgressReminderControls.id,
      }).from(tuitionProgressReminderControls)
        .where(eligibility)
        .orderBy(asc(tuitionProgressReminderControls.nextAttemptAt), asc(tuitionProgressReminderControls.id))
        .limit(1)
        .for('update', { skipLocked: true });
      if (!candidate) return null;

      const [claim] = await transaction.update(tuitionProgressReminderControls).set({
        status: 'checking',
        attemptCount: sql`${tuitionProgressReminderControls.attemptCount} + 1`,
        lastAttemptAt: now,
        leaseToken,
        leaseExpiresAt: sql<Date>`LEAST(${leaseExpiresAt}, ${tuitionProgressReminderControls.expiresAt})`,
        lastError: null,
        updatedAt: now,
      }).where(and(
        eq(tuitionProgressReminderControls.id, candidate.id),
        eligibility,
      )).returning({
        id: tuitionProgressReminderControls.id,
        schoolId: tuitionProgressReminderControls.schoolId,
        academicYearId: tuitionProgressReminderControls.academicYearId,
        cycleId: tuitionProgressReminderControls.cycleId,
        studentId: tuitionProgressReminderControls.studentId,
        monthStart: tuitionProgressReminderControls.monthStart,
        stage: tuitionProgressReminderControls.stage,
        scheduledAt: tuitionProgressReminderControls.scheduledAt,
        expiresAt: tuitionProgressReminderControls.expiresAt,
        timeZone: tuitionProgressReminderControls.timeZone,
        status: tuitionProgressReminderControls.status,
        attemptCount: tuitionProgressReminderControls.attemptCount,
        nextAttemptAt: tuitionProgressReminderControls.nextAttemptAt,
        leaseToken: tuitionProgressReminderControls.leaseToken,
        leaseExpiresAt: tuitionProgressReminderControls.leaseExpiresAt,
      });
      return claim ? { ...claim, status: 'checking' as const } : null;
    });
  },

  completeControl: async ({
    controlId,
    leaseToken,
    nextAttemptAt,
    lastCalculatedAt,
    decision,
  }) => {
    validateNow(lastCalculatedAt);
    const temporalGuard = decision.status === 'expired'
      ? lte(tuitionProgressReminderControls.expiresAt, lastCalculatedAt)
      : and(
        gt(tuitionProgressReminderControls.expiresAt, lastCalculatedAt),
        gt(tuitionProgressReminderControls.leaseExpiresAt, lastCalculatedAt),
      );
    const completed = await database.update(tuitionProgressReminderControls).set({
      status: decision.status,
      targetAmount: decision.targetAmount,
      netPaidAmount: decision.netPaidAmount,
      shortfallAmount: decision.shortfallAmount,
      lastCalculatedAt,
      nextAttemptAt,
      leaseToken: null,
      leaseExpiresAt: null,
      lastError: decision.lastError,
      updatedAt: lastCalculatedAt,
    }).where(and(
      eq(tuitionProgressReminderControls.id, controlId),
      eq(tuitionProgressReminderControls.status, 'checking'),
      eq(tuitionProgressReminderControls.leaseToken, leaseToken),
      temporalGuard,
    )).returning({ id: tuitionProgressReminderControls.id });
    return completed.length > 0;
  },

  retryControl: async ({
    controlId,
    leaseToken,
    now,
    nextAttemptAt,
    lastError,
  }) => {
    validateNow(now);
    validateNow(nextAttemptAt);
    const retried = await database.update(tuitionProgressReminderControls).set({
      status: 'retry_pending',
      nextAttemptAt,
      leaseToken: null,
      leaseExpiresAt: null,
      lastError,
      updatedAt: now,
    }).where(and(
      eq(tuitionProgressReminderControls.id, controlId),
      eq(tuitionProgressReminderControls.status, 'checking'),
      eq(tuitionProgressReminderControls.leaseToken, leaseToken),
      gt(tuitionProgressReminderControls.leaseExpiresAt, now),
      gt(tuitionProgressReminderControls.expiresAt, now),
      gte(tuitionProgressReminderControls.expiresAt, nextAttemptAt),
    )).returning({ id: tuitionProgressReminderControls.id });
    return retried.length > 0;
  },
});
