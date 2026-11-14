import { and, eq, isNotNull, isNull, or } from 'drizzle-orm';
import type { TuitionProgressReminderDrizzleDatabase } from './tuitionProgressReminderDrizzle.ts';
import { createTuitionProgressReminderDrizzleSource } from './tuitionProgressReminderDrizzle.ts';
import { createTuitionProgressReminderExecutionDrizzleSource } from './tuitionProgressReminderExecutionDrizzle.ts';
import {
  executeDueTuitionProgressReminderControls,
  type ExecuteTuitionProgressReminderControlsResult,
} from './tuitionProgressReminderExecution.ts';
import type {
  AccountingTuitionProgressInput,
  AccountingTuitionProgressResult,
} from './accountingTuitionProgress.ts';
import type { AccountingTuitionProgressExecutor } from './accountingApi.ts';
import { prepareTuitionProgressReminderControls } from './tuitionProgressReminderPreparation.ts';
import {
  createTuitionProgressReminderInAppNotifications,
  type TuitionProgressReminderInAppNotificationBatch,
} from './tuitionProgressReminderNotifications.ts';
import {
  createTuitionProgressReminderInAppNotificationDrizzleSource,
  createTuitionProgressReminderPushDrizzleSource,
} from './tuitionProgressReminderNotificationsDrizzle.ts';
import {
  processTuitionProgressReminderPushOutbox,
  type ProcessTuitionProgressReminderPushResult,
  type TuitionProgressReminderPushClaim,
  type TuitionProgressReminderPushTransportResult,
} from './tuitionProgressReminderPush.ts';
import {
  academicYears,
  cycles,
  schoolTerms,
  schools,
} from '../db/schema.ts';

export type TuitionProgressReminderScope = {
  schoolId: number;
  academicYearId: number;
  cycleId: number;
};

export type TuitionProgressReminderRuntimeOptions = {
  database: TuitionProgressReminderDrizzleDatabase;
  calculateAccounting: (
    input: AccountingTuitionProgressInput,
  ) => Promise<AccountingTuitionProgressResult>;
  calculateAccountingInTransaction?: (
    input: AccountingTuitionProgressInput,
    transaction: AccountingTuitionProgressExecutor,
  ) => Promise<AccountingTuitionProgressResult>;
  enableInAppNotifications?: boolean;
  enablePushNotifications?: boolean;
  sendPush?: (claim: TuitionProgressReminderPushClaim) => Promise<TuitionProgressReminderPushTransportResult>;
  clock?: () => Date;
};

export type TuitionProgressReminderPreparationFailure = {
  scope: TuitionProgressReminderScope;
  code: string;
};

export type TuitionProgressReminderRuntimeResult = {
  preparedScopeCount: number;
  preparedControlCount: number;
  preparationFailures: TuitionProgressReminderPreparationFailure[];
  execution: ExecuteTuitionProgressReminderControlsResult;
  inAppNotifications: TuitionProgressReminderInAppNotificationBatch | null;
  pushNotifications: ProcessTuitionProgressReminderPushResult | null;
};

const loadPreparationScopes = async (
  database: TuitionProgressReminderDrizzleDatabase,
): Promise<TuitionProgressReminderScope[]> => database.selectDistinct({
  schoolId: schools.id,
  academicYearId: academicYears.id,
  cycleId: schoolTerms.cycleId,
}).from(schools)
  .innerJoin(academicYears, or(
    eq(academicYears.schoolId, schools.id),
    isNull(academicYears.schoolId),
  ))
  .innerJoin(schoolTerms, and(
    eq(schoolTerms.academicYearId, academicYears.id),
    or(eq(schoolTerms.schoolId, schools.id), isNull(schoolTerms.schoolId)),
  ))
  .innerJoin(cycles, eq(cycles.id, schoolTerms.cycleId))
  .where(and(
    eq(schools.isSuspended, false),
    isNotNull(schools.timeZone),
    eq(academicYears.isActive, true),
    eq(schoolTerms.isActive, true),
    eq(cycles.isActive, true),
  ));

export const runTuitionProgressReminderRuntimePass = async (
  options: TuitionProgressReminderRuntimeOptions,
  shouldPrepare = true,
): Promise<TuitionProgressReminderRuntimeResult> => {
  const clock = options.clock ?? (() => new Date());
  const preparationFailures: TuitionProgressReminderPreparationFailure[] = [];
  let preparedScopeCount = 0;
  let preparedControlCount = 0;

  if (shouldPrepare) {
    const scopes = await loadPreparationScopes(options.database);
    const preparationSource = createTuitionProgressReminderDrizzleSource(options.database);
    for (const scope of scopes) {
      const prepared = await prepareTuitionProgressReminderControls({
        ...scope,
        now: clock(),
        mode: 'persist',
      }, preparationSource);
      if (prepared.ok === false) {
        preparationFailures.push({ scope, code: prepared.error.code });
        continue;
      }
      preparedScopeCount += 1;
      preparedControlCount += prepared.insertedCount ?? 0;
    }
  }

  const execution = await executeDueTuitionProgressReminderControls({}, {
    source: createTuitionProgressReminderExecutionDrizzleSource(options.database),
    calculateAccounting: options.calculateAccounting,
    clock,
  });
  let inAppNotifications: TuitionProgressReminderInAppNotificationBatch | null = null;
  if (options.enableInAppNotifications) {
    if (!options.calculateAccountingInTransaction) {
      throw new Error('In-app tuition reminders require transaction-scoped accounting recalculation.');
    }
    inAppNotifications = await createTuitionProgressReminderInAppNotifications({
      now: clock(),
      source: createTuitionProgressReminderInAppNotificationDrizzleSource({
        database: options.database,
        clock,
        calculateAccounting: options.calculateAccountingInTransaction,
      }),
      clock,
    });
  }
  let pushNotifications: ProcessTuitionProgressReminderPushResult | null = null;
  if (options.enablePushNotifications) {
    if (!options.calculateAccountingInTransaction || !options.sendPush) {
      throw new Error('Push tuition reminders require transaction-scoped accounting recalculation and a push transport.');
    }
    pushNotifications = await processTuitionProgressReminderPushOutbox({
      source: createTuitionProgressReminderPushDrizzleSource(
        options.database,
        options.calculateAccountingInTransaction,
      ),
      send: options.sendPush,
      clock,
    });
  }
  return {
    preparedScopeCount,
    preparedControlCount,
    preparationFailures,
    execution,
    inAppNotifications,
    pushNotifications,
  };
};

export const isTuitionProgressReminderRuntimeEnabled = (
  environment: Record<string, string | undefined>,
): boolean => environment.ECOLETRACK_TUITION_PROGRESS_REMINDERS_ENABLED === 'true'
  && environment.ECOLETRACK_TUITION_PROGRESS_REMINDERS_0800_CONFIRMED === 'true';

export const isTuitionProgressReminderInAppNotificationsEnabled = (
  environment: Record<string, string | undefined>,
): boolean => isTuitionProgressReminderRuntimeEnabled(environment)
  && environment.ECOLETRACK_TUITION_PROGRESS_REMINDERS_IN_APP_NOTIFICATIONS_ENABLED === 'true';

export const isTuitionProgressReminderPushNotificationsEnabled = (
  environment: Record<string, string | undefined>,
): boolean => isTuitionProgressReminderInAppNotificationsEnabled(environment)
  && environment.ECOLETRACK_TUITION_PROGRESS_REMINDERS_PUSH_ENABLED === 'true';
