import { and, eq, isNotNull, isNull, or } from 'drizzle-orm';
import type { db as applicationDb } from '../db/index.ts';
import {
  academicYears,
  accountingCategories,
  classes,
  cycles,
  financialObligations,
  levels,
  schoolCycles,
  schoolClasses,
  schoolTerms,
  schools,
  students,
  tuitionProgressReminderControls,
} from '../db/schema.ts';
import type {
  TuitionProgressReminderControlKey,
  TuitionProgressReminderControlRecord,
  TuitionProgressReminderPreparationSource,
} from './tuitionProgressReminderPreparation.ts';

export type TuitionProgressReminderDrizzleDatabase = typeof applicationDb;

const keyOf = (key: TuitionProgressReminderControlKey): string => JSON.stringify([
  key.schoolId,
  key.academicYearId,
  key.cycleId,
  key.studentId,
  key.monthStart,
  key.stage,
]);

const isPositiveSafeInteger = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Number(value) > 0;

const validateRecords = (records: readonly TuitionProgressReminderControlRecord[]) => {
  if (records.length === 0) return null;
  const first = records[0];
  if (!isPositiveSafeInteger(first.schoolId)
    || !isPositiveSafeInteger(first.academicYearId)
    || !isPositiveSafeInteger(first.cycleId)) {
    throw new Error('Reminder controls require a valid school, academic year and cycle.');
  }

  const seenKeys = new Set<string>();
  for (const record of records) {
    if (record.schoolId !== first.schoolId
      || record.academicYearId !== first.academicYearId
      || record.cycleId !== first.cycleId
      || !isPositiveSafeInteger(record.studentId)) {
      throw new Error('A reminder-control batch cannot mix school, year, cycle or student scopes.');
    }
    if (!/^\d{4}-\d{2}-01$/.test(record.monthStart)
      || record.stage !== 'penultimate' && record.stage !== 'last') {
      throw new Error('Reminder controls require a valid month start and stage.');
    }
    if (!(record.scheduledAt instanceof Date)
      || !Number.isFinite(record.scheduledAt.getTime())
      || !(record.expiresAt instanceof Date)
      || !Number.isFinite(record.expiresAt.getTime())
      || record.scheduledAt.getTime() > record.expiresAt.getTime()) {
      throw new Error('Reminder controls require a valid scheduled and expiration time.');
    }
    if (typeof record.timeZone !== 'string' || record.timeZone.trim().length === 0) {
      throw new Error('Reminder controls require a configured IANA time zone.');
    }
    try {
      new Intl.DateTimeFormat('en', { timeZone: record.timeZone });
    } catch {
      throw new Error('Reminder controls require a valid IANA time zone.');
    }
    const key = keyOf(record);
    if (seenKeys.has(key)) throw new Error('A reminder-control batch contains a duplicate scope key.');
    seenKeys.add(key);
  }
  return first;
};

export const createTuitionProgressReminderDrizzleSource = (
  database: TuitionProgressReminderDrizzleDatabase,
  clock: () => Date = () => new Date(),
): TuitionProgressReminderPreparationSource => ({
  loadCalendar: async (scope) => {
    const [school] = await database.select({
      id: schools.id,
      timeZone: schools.timeZone,
    }).from(schools).where(eq(schools.id, scope.schoolId)).limit(1);
    if (!school || school.id !== scope.schoolId) return null;

    const [academicYear] = await database.select({
      id: academicYears.id,
      schoolId: academicYears.schoolId,
    }).from(academicYears).where(eq(academicYears.id, scope.academicYearId)).limit(1);
    if (!academicYear
      || academicYear.id !== scope.academicYearId
      || (academicYear.schoolId != null && academicYear.schoolId !== scope.schoolId)) return null;

    const [cycle] = await database.select({
      id: cycles.id,
      isActive: cycles.isActive,
    }).from(cycles).where(eq(cycles.id, scope.cycleId)).limit(1);
    if (!cycle || cycle.id !== scope.cycleId || !cycle.isActive) return null;

    const configuredCycles = await database.select({
      cycleId: schoolCycles.cycleId,
      isActive: schoolCycles.isActive,
    }).from(schoolCycles).where(eq(schoolCycles.schoolId, scope.schoolId));
    if (configuredCycles.length > 0
      && !configuredCycles.some((row) => row.cycleId === scope.cycleId && row.isActive)) {
      return null;
    }

    const periodRows = await database.select({
      schoolId: schoolTerms.schoolId,
      academicYearId: schoolTerms.academicYearId,
      cycleId: schoolTerms.cycleId,
      periodType: schoolTerms.periodType,
      orderIndex: schoolTerms.orderIndex,
      startDate: schoolTerms.startDate,
      endDate: schoolTerms.endDate,
      isActive: schoolTerms.isActive,
    }).from(schoolTerms).where(and(
      eq(schoolTerms.academicYearId, scope.academicYearId),
      eq(schoolTerms.cycleId, scope.cycleId),
      or(isNull(schoolTerms.schoolId), eq(schoolTerms.schoolId, scope.schoolId)),
    ));
    const periods = periodRows.filter((period) =>
      period.academicYearId === scope.academicYearId
      && period.cycleId === scope.cycleId
      && (period.schoolId == null || period.schoolId === scope.schoolId));

    return {
      schoolId: scope.schoolId,
      academicYearId: academicYear.id,
      academicYearSchoolId: academicYear.schoolId,
      cycleId: scope.cycleId,
      timeZone: school.timeZone,
      periods,
    };
  },

  loadStudentsWithActiveTuitionObligations: async (scope) =>
    database.selectDistinct({
      studentId: students.id,
      schoolId: students.schoolId,
      academicYearId: financialObligations.academicYearId,
      cycleId: levels.cycleId,
    }).from(financialObligations)
      .innerJoin(accountingCategories, eq(accountingCategories.id, financialObligations.categoryId))
      .innerJoin(students, eq(students.id, financialObligations.studentId))
      .innerJoin(classes, eq(classes.id, financialObligations.classId))
      .leftJoin(schoolClasses, and(
        eq(schoolClasses.classId, classes.id),
        eq(schoolClasses.schoolId, scope.schoolId),
        eq(schoolClasses.status, 'approved'),
      ))
      .innerJoin(levels, eq(levels.id, classes.levelId))
      .where(and(
        eq(financialObligations.schoolId, scope.schoolId),
        eq(financialObligations.academicYearId, scope.academicYearId),
        eq(financialObligations.status, 'active'),
        eq(accountingCategories.schoolId, scope.schoolId),
        eq(accountingCategories.code, 'tuition'),
        eq(students.schoolId, scope.schoolId),
        eq(students.isActive, true),
        or(
          eq(classes.schoolId, scope.schoolId),
          and(isNull(classes.schoolId), isNotNull(schoolClasses.id)),
        ),
        eq(classes.academicYearId, scope.academicYearId),
        eq(levels.cycleId, scope.cycleId),
        ...(scope.studentId == null ? [] : [eq(students.id, scope.studentId)]),
      )),

  loadExistingKeys: async (scope, keys) => {
    if (keys.length === 0) return [];
    if (keys.some((key) => key.schoolId !== scope.schoolId
      || key.academicYearId !== scope.academicYearId
      || key.cycleId !== scope.cycleId)) {
      throw new Error('Existing-control lookup keys must match the requested school, year and cycle.');
    }
    const requestedKeys = new Set(keys.map(keyOf));
    const rows = await database.select({
      schoolId: tuitionProgressReminderControls.schoolId,
      academicYearId: tuitionProgressReminderControls.academicYearId,
      cycleId: tuitionProgressReminderControls.cycleId,
      studentId: tuitionProgressReminderControls.studentId,
      monthStart: tuitionProgressReminderControls.monthStart,
      stage: tuitionProgressReminderControls.stage,
    }).from(tuitionProgressReminderControls).where(and(
      eq(tuitionProgressReminderControls.schoolId, scope.schoolId),
      eq(tuitionProgressReminderControls.academicYearId, scope.academicYearId),
      eq(tuitionProgressReminderControls.cycleId, scope.cycleId),
    ));
    return rows.filter((row) => requestedKeys.has(keyOf(row)));
  },

  insertControlsIgnoringScopeDuplicates: async (records) => {
    const batch = validateRecords(records);
    if (!batch) return 0;

    const now = clock();
    if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
      throw new Error('The reminder-control persistence clock must return a valid timestamp.');
    }
    const activeRecords = records.filter((record) => record.expiresAt.getTime() >= now.getTime());
    if (activeRecords.length === 0) return 0;

    const inserted = await database.insert(tuitionProgressReminderControls)
      .values(activeRecords)
      .onConflictDoNothing({
        target: [
          tuitionProgressReminderControls.schoolId,
          tuitionProgressReminderControls.academicYearId,
          tuitionProgressReminderControls.cycleId,
          tuitionProgressReminderControls.studentId,
          tuitionProgressReminderControls.monthStart,
          tuitionProgressReminderControls.stage,
        ],
      })
      .returning({ id: tuitionProgressReminderControls.id });
    return inserted.length;
  },
});
