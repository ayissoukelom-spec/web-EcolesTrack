import {
  planTuitionProgressReminderControls,
  type TuitionProgressReminderScheduleError,
} from './tuitionProgressReminderSchedule.ts';
import type { TuitionProgressPeriod } from './tuitionProgress.ts';

export type TuitionProgressReminderPreparationScope = {
  schoolId: number;
  academicYearId: number;
  cycleId: number;
  studentId?: number;
  monthStart?: string;
};

export type TuitionProgressReminderCalendar = TuitionProgressReminderPreparationScope & {
  academicYearSchoolId: number | null;
  timeZone: string | null;
  periods: readonly TuitionProgressPeriod[];
};

export type TuitionProgressReminderStudentScope = TuitionProgressReminderPreparationScope & {
  studentId: number;
};

export type TuitionProgressReminderControlKey = TuitionProgressReminderStudentScope & {
  monthStart: string;
  stage: 'penultimate' | 'last';
};

export type TuitionProgressReminderControlRecord = TuitionProgressReminderControlKey & {
  scheduledAt: Date;
  expiresAt: Date;
  timeZone: string;
  status: 'scheduled';
  targetAmount: null;
  netPaidAmount: null;
  shortfallAmount: null;
  lastCalculatedAt: null;
  attemptCount: 0;
  lastAttemptAt: null;
  nextAttemptAt: Date;
  leaseToken: null;
  leaseExpiresAt: null;
  lastError: null;
  notificationId: null;
};

export type TuitionProgressReminderPreparationSource = {
  loadCalendar: (
    scope: TuitionProgressReminderPreparationScope,
  ) => Promise<TuitionProgressReminderCalendar | null>;
  loadStudentsWithActiveTuitionObligations: (
    scope: TuitionProgressReminderPreparationScope,
  ) => Promise<readonly TuitionProgressReminderStudentScope[]>;
  loadExistingKeys: (
    scope: TuitionProgressReminderPreparationScope,
    keys: readonly TuitionProgressReminderControlKey[],
  ) => Promise<readonly TuitionProgressReminderControlKey[]>;
  /** Ignore only scope-unique conflicts; propagate all other persistence errors. */
  insertControlsIgnoringScopeDuplicates: (
    records: readonly TuitionProgressReminderControlRecord[],
  ) => Promise<number>;
};

export type PrepareTuitionProgressReminderControlsInput = TuitionProgressReminderPreparationScope & {
  now: Date;
  mode: 'simulate' | 'persist';
};

export type TuitionProgressReminderPreparationError =
  | { code: 'invalid_scope'; message: string }
  | { code: 'invalid_mode'; message: string }
  | { code: 'invalid_current_time'; message: string }
  | { code: 'invalid_month'; message: string }
  | { code: 'calendar_not_found'; message: string }
  | { code: 'calendar_scope_mismatch'; message: string }
  | { code: 'student_scope_mismatch'; message: string }
  | { code: 'existing_control_scope_mismatch'; message: string }
  | { code: 'existing_control_out_of_scope'; message: string }
  | { code: 'invalid_insert_count'; message: string }
  | TuitionProgressReminderScheduleError;

export type PrepareTuitionProgressReminderControlsResult =
  | {
    ok: true;
    mode: 'simulate' | 'persist';
    plannedCount: number;
    existingCount: number;
    emptyReason: 'no_scheduled_control' | 'no_eligible_students' | null;
    recordsToInsert: TuitionProgressReminderControlRecord[];
    insertedCount: number | null;
  }
  | {
    ok: false;
    error: TuitionProgressReminderPreparationError;
  };

const isPositiveSafeInteger = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Number(value) > 0;

const keyOf = (key: TuitionProgressReminderControlKey): string => JSON.stringify([
  key.schoolId,
  key.academicYearId,
  key.cycleId,
  key.studentId,
  key.monthStart,
  key.stage,
]);

const failure = (
  error: TuitionProgressReminderPreparationError,
): PrepareTuitionProgressReminderControlsResult => ({ ok: false, error });

export const prepareTuitionProgressReminderControls = async (
  input: PrepareTuitionProgressReminderControlsInput,
  source: TuitionProgressReminderPreparationSource,
): Promise<PrepareTuitionProgressReminderControlsResult> => {
  const scope = {
    schoolId: input.schoolId,
    academicYearId: input.academicYearId,
    cycleId: input.cycleId,
    studentId: input.studentId,
    monthStart: input.monthStart,
  };
  if (!isPositiveSafeInteger(scope.schoolId)
    || !isPositiveSafeInteger(scope.academicYearId)
    || !isPositiveSafeInteger(scope.cycleId)
    || (input.studentId != null && !isPositiveSafeInteger(input.studentId))) {
    return failure({ code: 'invalid_scope', message: 'School, academic year and cycle are required.' });
  }
  if (input.monthStart != null && !/^\d{4}-(0[1-9]|1[0-2])-01$/.test(input.monthStart)) {
    return failure({ code: 'invalid_month', message: 'A valid month start is required.' });
  }
  if (input.mode !== 'simulate' && input.mode !== 'persist') {
    return failure({ code: 'invalid_mode', message: 'Preparation mode must be simulate or persist.' });
  }
  if (!(input.now instanceof Date) || !Number.isFinite(input.now.getTime())) {
    return failure({ code: 'invalid_current_time', message: 'A valid current timestamp is required.' });
  }

  const calendar = await source.loadCalendar(scope);
  if (!calendar) {
    return failure({ code: 'calendar_not_found', message: 'No calendar exists for this school and cycle.' });
  }
  if (calendar.schoolId !== scope.schoolId
    || calendar.academicYearId !== scope.academicYearId
    || calendar.cycleId !== scope.cycleId) {
    return failure({ code: 'calendar_scope_mismatch', message: 'The loaded calendar is outside the requested scope.' });
  }
  if (typeof calendar.timeZone !== 'string' || calendar.timeZone.trim().length === 0) {
    return failure({
      code: 'invalid_time_zone',
      message: 'A configured IANA time zone is required for this school.',
    });
  }

  const schedule = planTuitionProgressReminderControls({
    ...scope,
    academicYearSchoolId: calendar.academicYearSchoolId,
    periods: calendar.periods,
    timeZone: calendar.timeZone,
    now: input.now,
  });
  if (schedule.ok === false) return failure(schedule.error);
  const scheduledControls = input.monthStart
    ? schedule.controls.filter((control) => control.monthStart === input.monthStart)
    : schedule.controls;
  if (scheduledControls.length === 0) {
    return {
      ok: true,
      mode: input.mode,
      plannedCount: 0,
      existingCount: 0,
      emptyReason: 'no_scheduled_control',
      recordsToInsert: [],
      insertedCount: input.mode === 'simulate' ? null : 0,
    };
  }

  const students = await source.loadStudentsWithActiveTuitionObligations(scope);
  const studentIds = new Set<number>();
  for (const student of students) {
    if (!isPositiveSafeInteger(student.studentId)
      || student.schoolId !== scope.schoolId
      || student.academicYearId !== scope.academicYearId
      || student.cycleId !== scope.cycleId
      || (scope.studentId != null && student.studentId !== scope.studentId)) {
      return failure({
        code: 'student_scope_mismatch',
        message: 'A tuition-obligation student is outside the requested school, year or cycle.',
      });
    }
    studentIds.add(student.studentId);
  }

  const records = new Map<string, TuitionProgressReminderControlRecord>();
  for (const studentId of [...studentIds].sort((left, right) => left - right)) {
    for (const control of scheduledControls) {
      const key: TuitionProgressReminderControlKey = {
        ...scope,
        studentId,
        monthStart: control.monthStart,
        stage: control.stage,
      };
      const record: TuitionProgressReminderControlRecord = {
        ...key,
        scheduledAt: new Date(control.scheduledAt),
        expiresAt: new Date(control.expiresAt),
        timeZone: control.timeZone,
        status: 'scheduled',
        targetAmount: null,
        netPaidAmount: null,
        shortfallAmount: null,
        lastCalculatedAt: null,
        attemptCount: 0,
        lastAttemptAt: null,
        nextAttemptAt: new Date(control.scheduledAt),
        leaseToken: null,
        leaseExpiresAt: null,
        lastError: null,
        notificationId: null,
      };
      records.set(keyOf(key), record);
    }
  }

  const plannedRecords = [...records.values()];
  if (plannedRecords.length === 0) {
    return {
      ok: true,
      mode: input.mode,
      plannedCount: 0,
      existingCount: 0,
      emptyReason: 'no_eligible_students',
      recordsToInsert: [],
      insertedCount: input.mode === 'simulate' ? null : 0,
    };
  }

  const existingKeys = await source.loadExistingKeys(
    scope,
    plannedRecords.map(({ schoolId, academicYearId, cycleId, studentId, monthStart, stage }) => ({
      schoolId,
      academicYearId,
      cycleId,
      studentId,
      monthStart,
      stage,
    })),
  );
  const plannedKeySet = new Set(plannedRecords.map(keyOf));
  const existingKeySet = new Set<string>();
  for (const existing of existingKeys) {
    if (existing.schoolId !== scope.schoolId
      || existing.academicYearId !== scope.academicYearId
      || existing.cycleId !== scope.cycleId
      || !isPositiveSafeInteger(existing.studentId)) {
      return failure({
        code: 'existing_control_scope_mismatch',
        message: 'An existing control is outside the requested school, year or cycle.',
      });
    }
    const key = keyOf(existing);
    if (!plannedKeySet.has(key)) {
      return failure({
        code: 'existing_control_out_of_scope',
        message: 'An existing control does not match the requested students and schedule.',
      });
    }
    existingKeySet.add(key);
  }

  const recordsToInsert = plannedRecords.filter((record) => !existingKeySet.has(keyOf(record)));
  let insertedCount: number | null = null;
  if (input.mode === 'persist') {
    insertedCount = recordsToInsert.length
      ? await source.insertControlsIgnoringScopeDuplicates(recordsToInsert)
      : 0;
    if (!Number.isSafeInteger(insertedCount) || insertedCount < 0 || insertedCount > recordsToInsert.length) {
      return failure({
        code: 'invalid_insert_count',
        message: 'The persistence adapter returned an invalid insert count.',
      });
    }
  }

  return {
    ok: true,
    mode: input.mode,
    plannedCount: plannedRecords.length,
    existingCount: existingKeySet.size,
    emptyReason: null,
    recordsToInsert,
    insertedCount,
  };
};
