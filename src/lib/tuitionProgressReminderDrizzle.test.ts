import { describe, expect, it, vi } from 'vitest';
import {
  academicYears,
  cycles,
  financialObligations,
  schoolClasses,
  schoolCycles,
  schoolTerms,
  schools,
  tuitionProgressReminderControls,
} from '../db/schema.ts';
import {
  prepareTuitionProgressReminderControls,
  type PrepareTuitionProgressReminderControlsInput,
  type TuitionProgressReminderControlRecord,
  type TuitionProgressReminderPreparationSource,
} from './tuitionProgressReminderPreparation.ts';
import {
  createTuitionProgressReminderDrizzleSource,
  type TuitionProgressReminderDrizzleDatabase,
} from './tuitionProgressReminderDrizzle.ts';

const scope = { schoolId: 7, academicYearId: 23, cycleId: 4 };

type TestTerm = {
  schoolId: number | null;
  academicYearId: number;
  cycleId: number;
  periodType: string;
  orderIndex: number;
  startDate: string;
  endDate: string;
  isActive: boolean;
};

const terms: TestTerm[] = [
  {
    schoolId: 7,
    academicYearId: 23,
    cycleId: 4,
    periodType: 'trimester',
    orderIndex: 1,
    startDate: '2026-09-01',
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

const studentRows = [
  { studentId: 31, schoolId: 7, academicYearId: 23, cycleId: 4 },
  { studentId: 32, schoolId: 7, academicYearId: 23, cycleId: 4 },
];

const input = (
  overrides: Partial<PrepareTuitionProgressReminderControlsInput> = {},
): PrepareTuitionProgressReminderControlsInput => ({
  ...scope,
  now: new Date('2027-07-14T12:00:00.000Z'),
  mode: 'persist',
  ...overrides,
});

const makeRecord = (
  overrides: Partial<TuitionProgressReminderControlRecord> = {},
): TuitionProgressReminderControlRecord => ({
  ...scope,
  studentId: 31,
  monthStart: '2027-07-01',
  stage: 'last',
  scheduledAt: new Date('2027-07-16T08:00:00.000Z'),
  expiresAt: new Date('2027-07-16T23:59:59.999Z'),
  timeZone: 'Africa/Lome',
  status: 'scheduled',
  targetAmount: null,
  netPaidAmount: null,
  shortfallAmount: null,
  lastCalculatedAt: null,
  attemptCount: 0,
  lastAttemptAt: null,
  nextAttemptAt: new Date('2027-07-16T08:00:00.000Z'),
  leaseToken: null,
  leaseExpiresAt: null,
  lastError: null,
  notificationId: null,
  ...overrides,
});

const createDatabase = ({
  schoolRows = [{ id: 7, timeZone: 'Africa/Lome' }],
  yearRows = [{ id: 23, schoolId: 7 }],
  cycleRows = [{ id: 4, isActive: true }],
  schoolCycleRows = [{ cycleId: 4, isActive: true }],
  termRows = terms,
  obligationStudentRows = studentRows,
  controlRows = [],
  insertedCount,
  insertError,
}: {
  schoolRows?: Array<{ id: number; timeZone: string | null }>;
  yearRows?: Array<{ id: number; schoolId: number | null }>;
  cycleRows?: Array<{ id: number; isActive: boolean }>;
  schoolCycleRows?: Array<{ cycleId: number; isActive: boolean }>;
  termRows?: TestTerm[];
  obligationStudentRows?: Array<{ studentId: number; schoolId: number; academicYearId: number; cycleId: number }>;
  controlRows?: Array<{
    schoolId: number;
    academicYearId: number;
    cycleId: number;
    studentId: number;
    monthStart: string;
    stage: 'penultimate' | 'last';
  }>;
  insertedCount?: number;
  insertError?: Error;
} = {}) => {
  const whereCalls: Array<{ table: unknown; expression: unknown }> = [];
  const joinCalls: Array<{ table: unknown; expression: unknown }> = [];
  const insertCalls: Array<{
    table: unknown;
    records: readonly TuitionProgressReminderControlRecord[];
    target: unknown;
  }> = [];

  const createSelectBuilder = (distinct: boolean) => {
    let table: unknown;
    const builder: any = {
      from(value: unknown) {
        table = value;
        return builder;
      },
      innerJoin() {
        return builder;
      },
      leftJoin(value: unknown, expression: unknown) {
        joinCalls.push({ table: value, expression });
        return builder;
      },
      where(expression: unknown) {
        whereCalls.push({ table, expression });
        return builder;
      },
      limit() {
        return builder;
      },
      then(resolve: (rows: unknown[]) => unknown, reject: (error: unknown) => unknown) {
        const rows = table === schools
          ? schoolRows
          : table === academicYears
            ? yearRows
            : table === cycles
              ? cycleRows
              : table === schoolCycles
                ? schoolCycleRows
                : table === schoolTerms
                  ? termRows
                  : table === financialObligations && distinct
                    ? obligationStudentRows
                    : table === tuitionProgressReminderControls
                      ? controlRows
                      : [];
        return Promise.resolve(rows).then(resolve, reject);
      },
    };
    return builder;
  };

  const database = {
    select: vi.fn(() => createSelectBuilder(false)),
    selectDistinct: vi.fn(() => createSelectBuilder(true)),
    insert: vi.fn((table: unknown) => ({
      values: (records: readonly TuitionProgressReminderControlRecord[]) => ({
        onConflictDoNothing: ({ target }: { target: unknown }) => {
          insertCalls.push({ table, records, target });
          return {
            returning: async () => {
              if (insertError) throw insertError;
              const inserted = insertedCount ?? records.length;
              return Array.from({ length: inserted }, (_value, index) => ({ id: index + 1 }));
            },
          };
        },
      }),
    })),
  } as unknown as TuitionProgressReminderDrizzleDatabase;

  return { database, whereCalls, joinCalls, insertCalls };
};

const sourceFor = (
  database: TuitionProgressReminderDrizzleDatabase,
  now = new Date('2027-07-14T12:00:00.000Z'),
): TuitionProgressReminderPreparationSource =>
  createTuitionProgressReminderDrizzleSource(database, () => now);

describe('tuition progress reminder Drizzle adapter', () => {
  it('loads the configured school time zone and cycle-specific school periods', async () => {
    const mock = createDatabase();
    const source = sourceFor(mock.database);

    const result = await source.loadCalendar(scope);

    expect(result).toMatchObject({
      schoolId: 7,
      academicYearId: 23,
      academicYearSchoolId: 7,
      cycleId: 4,
      timeZone: 'Africa/Lome',
      periods: terms,
    });
    expect(mock.whereCalls.some((call) => call.table === schoolTerms)).toBe(true);
    expect(mock.whereCalls.some((call) => call.table === schoolCycles)).toBe(true);
  });

  it('does not invent a time zone for a school without one', async () => {
    const mock = createDatabase({ schoolRows: [{ id: 7, timeZone: null }] });
    const source = sourceFor(mock.database);

    const result = await prepareTuitionProgressReminderControls(input(), source);

    expect(result).toMatchObject({ ok: false, error: { code: 'invalid_time_zone' } });
    expect(mock.insertCalls).toHaveLength(0);
  });

  it('rejects an incomplete calendar without writing controls', async () => {
    const mock = createDatabase({ termRows: terms.slice(0, 2) });

    const result = await prepareTuitionProgressReminderControls(input(), sourceFor(mock.database));

    expect(result).toMatchObject({ ok: false, error: { code: 'invalid_calendar' } });
    expect(mock.insertCalls).toHaveLength(0);
  });

  it('does not create controls for students without active tuition obligations', async () => {
    const mock = createDatabase({ obligationStudentRows: [] });

    const result = await prepareTuitionProgressReminderControls(input(), sourceFor(mock.database));

    expect(result).toMatchObject({
      ok: true,
      plannedCount: 0,
      emptyReason: 'no_eligible_students',
      recordsToInsert: [],
      insertedCount: 0,
    });
    expect(mock.database.selectDistinct).toHaveBeenCalledOnce();
    expect(mock.insertCalls).toHaveLength(0);
  });

  it('resolves student cycles through school-owned classes or approved shared classes', async () => {
    const mock = createDatabase();
    const source = sourceFor(mock.database);

    await source.loadStudentsWithActiveTuitionObligations(scope);

    expect(mock.joinCalls.some((join) => join.table === schoolClasses)).toBe(true);
    expect(mock.whereCalls.some((call) => call.table === financialObligations)).toBe(true);
  });

  it('rejects student rows that cross school, year or cycle scope', async () => {
    const mock = createDatabase({
      obligationStudentRows: [{ studentId: 31, schoolId: 8, academicYearId: 23, cycleId: 4 }],
    });

    const result = await prepareTuitionProgressReminderControls(input(), sourceFor(mock.database));

    expect(result).toMatchObject({ ok: false, error: { code: 'student_scope_mismatch' } });
    expect(mock.insertCalls).toHaveLength(0);
  });

  it('keeps existing-control lookup scoped and ignores rows outside the planned key set', async () => {
    const mock = createDatabase({
      controlRows: [{
        schoolId: 8,
        academicYearId: 23,
        cycleId: 4,
        studentId: 31,
        monthStart: '2027-07-01',
        stage: 'penultimate',
      }],
    });

    const result = await prepareTuitionProgressReminderControls(input(), sourceFor(mock.database));

    expect(result).toMatchObject({ ok: true, plannedCount: 4, existingCount: 0, insertedCount: 4 });
    expect(mock.whereCalls.some((call) => call.table === tuitionProgressReminderControls)).toBe(true);
    expect(mock.insertCalls).toHaveLength(1);
  });

  it('skips controls already stored for the exact student and schedule key', async () => {
    const mock = createDatabase({
      controlRows: [{
        schoolId: 7,
        academicYearId: 23,
        cycleId: 4,
        studentId: 31,
        monthStart: '2027-07-01',
        stage: 'penultimate',
      }],
    });

    const result = await prepareTuitionProgressReminderControls(input(), sourceFor(mock.database));

    expect(result).toMatchObject({ ok: true, plannedCount: 4, existingCount: 1, insertedCount: 3 });
    expect(mock.insertCalls[0].records).toHaveLength(3);
    expect(mock.insertCalls[0].records.some((record) => record.studentId === 31 && record.stage === 'penultimate'))
      .toBe(false);
  });

  it('uses the full unique key and treats a uniqueness conflict as an ignored insert', async () => {
    const mock = createDatabase({ insertedCount: 0 });

    const result = await prepareTuitionProgressReminderControls(input(), sourceFor(mock.database));

    expect(result).toMatchObject({ ok: true, plannedCount: 4, insertedCount: 0 });
    expect(mock.insertCalls).toHaveLength(1);
    expect(mock.insertCalls[0].table).toBe(tuitionProgressReminderControls);
    expect(mock.insertCalls[0].target).toEqual([
      tuitionProgressReminderControls.schoolId,
      tuitionProgressReminderControls.academicYearId,
      tuitionProgressReminderControls.cycleId,
      tuitionProgressReminderControls.studentId,
      tuitionProgressReminderControls.monthStart,
      tuitionProgressReminderControls.stage,
    ]);
  });

  it('propagates persistence errors unrelated to the unique key', async () => {
    const error = Object.assign(new Error('foreign key failure'), {
      code: '23503',
      constraint: 'tuition_progress_reminder_controls_student_fk',
    });
    const mock = createDatabase({ insertError: error });

    await expect(prepareTuitionProgressReminderControls(input(), sourceFor(mock.database)))
      .rejects.toBe(error);
  });

  it('does not write in simulation mode', async () => {
    const mock = createDatabase();

    const result = await prepareTuitionProgressReminderControls(
      input({ mode: 'simulate' }),
      sourceFor(mock.database),
    );

    expect(result).toMatchObject({
      ok: true,
      mode: 'simulate',
      plannedCount: 4,
      insertedCount: null,
    });
    expect(mock.insertCalls).toHaveLength(0);
  });

  it('does not persist controls already expired at write time', async () => {
    const mock = createDatabase();
    const source = sourceFor(mock.database, new Date('2027-07-17T00:00:00.000Z'));

    const insertedCount = await source.insertControlsIgnoringScopeDuplicates([makeRecord()]);

    expect(insertedCount).toBe(0);
    expect(mock.insertCalls).toHaveLength(0);
  });

  it('preserves active school-cycle assignments and refuses a disabled cycle', async () => {
    const mock = createDatabase({ schoolCycleRows: [{ cycleId: 4, isActive: false }] });
    const result = await sourceFor(mock.database).loadCalendar(scope);

    expect(result).toBeNull();
  });
});

it('prepares the selected November control from a shared school year and shared periods without consuming it in repeated simulations', async () => {
  const commonTerms: TestTerm[] = [
    {
      schoolId: null,
      academicYearId: 23,
      cycleId: 4,
      periodType: 'trimester',
      orderIndex: 1,
      startDate: '2026-09-14',
      endDate: '2026-12-23',
      isActive: true,
    },
    {
      schoolId: null,
      academicYearId: 23,
      cycleId: 4,
      periodType: 'trimester',
      orderIndex: 2,
      startDate: '2027-01-05',
      endDate: '2027-03-20',
      isActive: true,
    },
    {
      schoolId: null,
      academicYearId: 23,
      cycleId: 4,
      periodType: 'trimester',
      orderIndex: 3,
      startDate: '2027-04-01',
      endDate: '2027-07-16',
      isActive: true,
    },
  ];
  const now = new Date('2026-11-30T08:00:00.000Z');
  const mock = createDatabase({
    yearRows: [{ id: 23, schoolId: null }],
    termRows: commonTerms,
    obligationStudentRows: [{ studentId: 57, schoolId: 7, academicYearId: 23, cycleId: 4 }],
  });
  const source = sourceFor(mock.database, now);
  const input: PrepareTuitionProgressReminderControlsInput = {
    ...scope,
    studentId: 57,
    monthStart: '2026-11-01',
    now,
    mode: 'simulate',
  };

  const first = await prepareTuitionProgressReminderControls(input, source);
  const repeated = await prepareTuitionProgressReminderControls(input, source);

  expect(first).toMatchObject({
    ok: true,
    mode: 'simulate',
    plannedCount: 1,
    existingCount: 0,
    insertedCount: null,
  });
  expect(repeated).toEqual(first);
  if (!first.ok) return;
  expect(first.recordsToInsert).toMatchObject([{
    schoolId: 7,
    academicYearId: 23,
    cycleId: 4,
    studentId: 57,
    monthStart: '2026-11-01',
    stage: 'last',
    scheduledAt: now,
    timeZone: 'Africa/Lome',
  }]);
  expect(mock.insertCalls).toHaveLength(0);
});

it('does not load a school-specific academic year for a different school', async () => {
  const mock = createDatabase({ yearRows: [{ id: 23, schoolId: 8 }] });

  const result = await sourceFor(mock.database).loadCalendar(scope);

  expect(result).toBeNull();
});
