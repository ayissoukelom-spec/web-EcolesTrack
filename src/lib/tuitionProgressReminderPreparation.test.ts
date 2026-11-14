import { describe, expect, it, vi } from 'vitest';
import {
  prepareTuitionProgressReminderControls,
  type PrepareTuitionProgressReminderControlsInput,
  type TuitionProgressReminderCalendar,
  type TuitionProgressReminderControlKey,
  type TuitionProgressReminderPreparationSource,
  type TuitionProgressReminderStudentScope,
} from './tuitionProgressReminderPreparation.ts';

const scope = { schoolId: 7, academicYearId: 23, cycleId: 4 };

const calendar = (
  overrides: Partial<TuitionProgressReminderCalendar> = {},
): TuitionProgressReminderCalendar => ({
  ...scope,
  academicYearSchoolId: 7,
  timeZone: 'Africa/Lome',
  periods: [
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
  ],
  ...overrides,
});

const students: TuitionProgressReminderStudentScope[] = [
  { ...scope, studentId: 31 },
  { ...scope, studentId: 32 },
];

const input = (
  overrides: Partial<PrepareTuitionProgressReminderControlsInput> = {},
): PrepareTuitionProgressReminderControlsInput => ({
  ...scope,
  now: new Date('2027-07-14T12:00:00.000Z'),
  mode: 'persist',
  ...overrides,
});

const existingKey = (
  overrides: Partial<TuitionProgressReminderControlKey> = {},
): TuitionProgressReminderControlKey => ({
  ...scope,
  studentId: 31,
  monthStart: '2027-07-01',
  stage: 'penultimate',
  ...overrides,
});

const createSource = ({
  calendarData = calendar(),
  studentRows = students,
  existingKeys = [],
  insertCount,
}: {
  calendarData?: TuitionProgressReminderCalendar | null;
  studentRows?: readonly TuitionProgressReminderStudentScope[];
  existingKeys?: readonly TuitionProgressReminderControlKey[];
  insertCount?: number;
} = {}) => {
  const persistedRecords: Parameters<
    TuitionProgressReminderPreparationSource['insertControlsIgnoringScopeDuplicates']
  >[0][number][] = [];
  const source: TuitionProgressReminderPreparationSource = {
    loadCalendar: vi.fn(async () => calendarData ?? null),
    loadStudentsWithActiveTuitionObligations: vi.fn(async () => studentRows),
    loadExistingKeys: vi.fn(async () => existingKeys),
    insertControlsIgnoringScopeDuplicates: vi.fn(async (records) => {
      persistedRecords.push(...records);
      return insertCount ?? records.length;
    }),
  };
  return { source, persistedRecords };
};

describe('tuition progress reminder preparation service', () => {
  it('prepares and persists scoped controls for students with active obligations', async () => {
    const source = createSource({
      studentRows: [...students, students[0]],
    });

    const result = await prepareTuitionProgressReminderControls(input(), source.source);

    expect(result).toMatchObject({
      ok: true,
      mode: 'persist',
      plannedCount: 4,
      existingCount: 0,
      insertedCount: 4,
    });
    if (!result.ok) return;
    expect(result.recordsToInsert.map((record) => [
      record.schoolId,
      record.academicYearId,
      record.cycleId,
      record.studentId,
      record.monthStart,
      record.stage,
    ])).toEqual([
      [7, 23, 4, 31, '2027-07-01', 'penultimate'],
      [7, 23, 4, 31, '2027-07-01', 'last'],
      [7, 23, 4, 32, '2027-07-01', 'penultimate'],
      [7, 23, 4, 32, '2027-07-01', 'last'],
    ]);
    expect(result.recordsToInsert.every((record) =>
      record.status === 'scheduled'
      && record.timeZone === 'Africa/Lome'
      && record.targetAmount === null
      && record.nextAttemptAt.getTime() === record.scheduledAt.getTime())).toBe(true);
    expect(source.source.insertControlsIgnoringScopeDuplicates).toHaveBeenCalledOnce();
    expect(source.persistedRecords).toHaveLength(4);
  });

  it('limits local test preparation to the selected student and month', async () => {
    const source = createSource({ studentRows: [students[1]] });
    const result = await prepareTuitionProgressReminderControls(input({
      studentId: 32,
      monthStart: '2027-07-01',
    }), source.source);

    expect(result).toMatchObject({ ok: true, plannedCount: 2, insertedCount: 2 });
    expect(source.source.loadStudentsWithActiveTuitionObligations).toHaveBeenCalledWith({
      ...scope,
      studentId: 32,
      monthStart: '2027-07-01',
    });
    if (!result.ok) return;
    expect(result.recordsToInsert.every((record) =>
      record.studentId === 32 && record.monthStart === '2027-07-01')).toBe(true);
  });

  it('simulates preparation without writing and excludes already existing unique keys', async () => {
    const source = createSource({
      existingKeys: [existingKey()],
    });

    const result = await prepareTuitionProgressReminderControls(input({ mode: 'simulate' }), source.source);

    expect(result).toMatchObject({
      ok: true,
      mode: 'simulate',
      plannedCount: 4,
      existingCount: 1,
      insertedCount: null,
    });
    if (!result.ok) return;
    expect(result.recordsToInsert).toHaveLength(3);
    expect(result.recordsToInsert.some((record) => record.studentId === 31 && record.stage === 'penultimate'))
      .toBe(false);
    expect(source.source.insertControlsIgnoringScopeDuplicates).not.toHaveBeenCalled();
    expect(source.persistedRecords).toHaveLength(0);
  });

  it('relies on conflict-safe persistence for a duplicate inserted concurrently', async () => {
    const source = createSource({ insertCount: 2 });

    const result = await prepareTuitionProgressReminderControls(input(), source.source);

    expect(result).toMatchObject({ ok: true, plannedCount: 4, insertedCount: 2 });
  });

  it('does no student or persistence work when every scheduled control is expired', async () => {
    const source = createSource();

    const result = await prepareTuitionProgressReminderControls(input({
      now: new Date('2027-07-17T00:00:00.000Z'),
    }), source.source);

    expect(result).toMatchObject({
      ok: true,
      plannedCount: 0,
      existingCount: 0,
      emptyReason: 'no_scheduled_control',
      insertedCount: 0,
    });
    expect(source.source.loadStudentsWithActiveTuitionObligations).not.toHaveBeenCalled();
    expect(source.source.loadExistingKeys).not.toHaveBeenCalled();
    expect(source.source.insertControlsIgnoringScopeDuplicates).not.toHaveBeenCalled();
  });

  it('distinguishes a scheduled month with no eligible students', async () => {
    const source = createSource({ studentRows: [] });

    const result = await prepareTuitionProgressReminderControls(input(), source.source);

    expect(result).toMatchObject({
      ok: true,
      plannedCount: 0,
      emptyReason: 'no_eligible_students',
      recordsToInsert: [],
    });
    expect(source.source.loadExistingKeys).not.toHaveBeenCalled();
    expect(source.source.insertControlsIgnoringScopeDuplicates).not.toHaveBeenCalled();
  });

  it('rejects a missing school time zone without falling back to the server zone', async () => {
    const source = createSource({ calendarData: calendar({ timeZone: null }) });

    const result = await prepareTuitionProgressReminderControls(input(), source.source);

    expect(result).toMatchObject({ ok: false, error: { code: 'invalid_time_zone' } });
    expect(source.source.loadStudentsWithActiveTuitionObligations).not.toHaveBeenCalled();
    expect(source.source.insertControlsIgnoringScopeDuplicates).not.toHaveBeenCalled();
  });

  it('rejects calendars and students returned for a different scope', async () => {
    const calendarSource = createSource({ calendarData: calendar({ schoolId: 8 }) });
    const studentSource = createSource({
      studentRows: [{ ...scope, schoolId: 8, studentId: 31 }],
    });

    const calendarResult = await prepareTuitionProgressReminderControls(input(), calendarSource.source);
    const studentResult = await prepareTuitionProgressReminderControls(input(), studentSource.source);

    expect(calendarResult).toMatchObject({ ok: false, error: { code: 'calendar_scope_mismatch' } });
    expect(calendarSource.source.loadStudentsWithActiveTuitionObligations).not.toHaveBeenCalled();
    expect(studentResult).toMatchObject({ ok: false, error: { code: 'student_scope_mismatch' } });
    expect(studentSource.source.insertControlsIgnoringScopeDuplicates).not.toHaveBeenCalled();
  });

  it('isolates calendar, student and existing-control reads by year and cycle', async () => {
    for (const calendarData of [
      calendar({ academicYearId: 24 }),
      calendar({ cycleId: 5 }),
    ]) {
      const source = createSource({ calendarData });
      const result = await prepareTuitionProgressReminderControls(input(), source.source);
      expect(result).toMatchObject({ ok: false, error: { code: 'calendar_scope_mismatch' } });
      expect(source.source.loadStudentsWithActiveTuitionObligations).not.toHaveBeenCalled();
    }

    for (const studentRow of [
      { ...scope, academicYearId: 24, studentId: 31 },
      { ...scope, cycleId: 5, studentId: 31 },
    ]) {
      const source = createSource({ studentRows: [studentRow] });
      const result = await prepareTuitionProgressReminderControls(input(), source.source);
      expect(result).toMatchObject({ ok: false, error: { code: 'student_scope_mismatch' } });
      expect(source.source.insertControlsIgnoringScopeDuplicates).not.toHaveBeenCalled();
    }

    for (const existing of [
      existingKey({ academicYearId: 24 }),
      existingKey({ cycleId: 5 }),
    ]) {
      const source = createSource({ existingKeys: [existing] });
      const result = await prepareTuitionProgressReminderControls(input(), source.source);
      expect(result).toMatchObject({ ok: false, error: { code: 'existing_control_scope_mismatch' } });
      expect(source.source.insertControlsIgnoringScopeDuplicates).not.toHaveBeenCalled();
    }
  });

  it('rejects existing keys outside the generated student and schedule scope', async () => {
    const source = createSource({
      existingKeys: [existingKey({ studentId: 99 })],
    });

    const result = await prepareTuitionProgressReminderControls(input(), source.source);

    expect(result).toMatchObject({ ok: false, error: { code: 'existing_control_out_of_scope' } });
    expect(source.source.insertControlsIgnoringScopeDuplicates).not.toHaveBeenCalled();
  });

  it('returns a missing-calendar error without loading students', async () => {
    const source = createSource({ calendarData: null });

    const result = await prepareTuitionProgressReminderControls(input(), source.source);

    expect(result).toMatchObject({ ok: false, error: { code: 'calendar_not_found' } });
    expect(source.source.loadStudentsWithActiveTuitionObligations).not.toHaveBeenCalled();
  });

  it('validates the requested scope and current instant before loading data', async () => {
    const source = createSource();

    const invalidScope = await prepareTuitionProgressReminderControls(input({ schoolId: 0 }), source.source);
    const invalidNow = await prepareTuitionProgressReminderControls(input({ now: new Date(Number.NaN) }), source.source);

    expect(invalidScope).toMatchObject({ ok: false, error: { code: 'invalid_scope' } });
    expect(invalidNow).toMatchObject({ ok: false, error: { code: 'invalid_current_time' } });
    expect(source.source.loadCalendar).not.toHaveBeenCalled();
  });
});
