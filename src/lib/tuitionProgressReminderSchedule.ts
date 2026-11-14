import {
  calculateTuitionProgress,
  type TuitionProgressErrorCode,
  type TuitionProgressPeriod,
} from './tuitionProgress.ts';

export type TuitionProgressReminderScheduleInput = {
  schoolId: number;
  academicYearId: number;
  academicYearSchoolId: number | null;
  cycleId: number;
  periods: readonly TuitionProgressPeriod[];
  timeZone: string;
  now: Date;
};

export type TuitionProgressReminderControlDate = {
  monthStart: string;
  stage: 'penultimate' | 'last';
  checkDate: string;
  scheduledAt: Date;
  expiresAt: Date;
  timeZone: string;
};

export type TuitionProgressReminderScheduleError =
  | { code: 'invalid_time_zone'; message: string }
  | { code: 'invalid_current_time'; message: string }
  | { code: 'invalid_local_time'; message: string }
  | {
    code: 'invalid_calendar';
    reasonCode: TuitionProgressErrorCode;
    message: string;
  };

export type TuitionProgressReminderScheduleResult =
  | { ok: true; controls: TuitionProgressReminderControlDate[] }
  | { ok: false; error: TuitionProgressReminderScheduleError };

type ZonedDateParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

const LOCAL_CONTROL_HOUR = 8;

const isValidDate = (value: unknown): value is Date =>
  value instanceof Date && Number.isFinite(value.getTime());

const makeUtcDate = (
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
): Date => {
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, second, 0);
  return date;
};

const parseDateOnly = (value: string): ZonedDateParts | null => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = makeUtcDate(year, month, day);
  if (parsed.toISOString().slice(0, 10) !== value) return null;
  return { year, month, day, hour: 0, minute: 0, second: 0 };
};

const formatDateOnly = ({ year, month, day }: ZonedDateParts): string =>
  `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

const partsInTimeZone = (
  instant: Date,
  formatter: Intl.DateTimeFormat,
): ZonedDateParts => {
  const parts = Object.fromEntries(formatter.formatToParts(instant)
    .filter((part) => part.type !== 'literal')
    .map((part) => [part.type, Number(part.value)]));
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute,
    second: parts.second,
  };
};

const wallClockMillis = (parts: ZonedDateParts): number =>
  makeUtcDate(parts.year, parts.month, parts.day, parts.hour, parts.minute, parts.second).getTime();

const candidateInstants = (
  parts: ZonedDateParts,
  formatter: Intl.DateTimeFormat,
): Date[] => {
  const localMillis = wallClockMillis(parts);
  const offsets = new Set<number>();

  for (let hours = -36; hours <= 36; hours += 3) {
    const probe = new Date(localMillis + hours * 60 * 60 * 1000);
    offsets.add(wallClockMillis(partsInTimeZone(probe, formatter)) - probe.getTime());
  }
  return [...offsets].map((offset) => new Date(localMillis - offset));
};

const localDateTimeToInstant = (
  date: string,
  hour: number,
  minute: number,
  formatter: Intl.DateTimeFormat,
): Date | null => {
  const dateParts = parseDateOnly(date);
  if (!dateParts) return null;
  const target = { ...dateParts, hour, minute, second: 0 };
  const matches = candidateInstants(target, formatter).filter((candidate) => {
    const actual = partsInTimeZone(candidate, formatter);
    return actual.year === target.year
      && actual.month === target.month
      && actual.day === target.day
      && actual.hour === target.hour
      && actual.minute === target.minute
      && actual.second === target.second;
  });

  return matches.length === 1 ? matches[0] : null;
};

export const localDateTimeInTimeZoneToInstant = (
  date: string,
  hour: number,
  minute: number,
  timeZone: string,
): Date | null => {
  try {
    const formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    return localDateTimeToInstant(date, hour, minute, formatter);
  } catch {
    return null;
  }
};

const localDateStartToInstant = (
  date: string,
  formatter: Intl.DateTimeFormat,
): Date | null => {
  const dateParts = parseDateOnly(date);
  if (!dateParts) return null;
  const candidates = candidateInstants(dateParts, formatter)
    .filter((candidate) => formatDateOnly(partsInTimeZone(candidate, formatter)) === date)
    .sort((left, right) => left.getTime() - right.getTime());
  return candidates[0] ?? null;
};

const addCalendarDays = (date: string, days: number): string => {
  const parts = parseDateOnly(date);
  if (!parts) return '';
  return new Date(makeUtcDate(parts.year, parts.month, parts.day).getTime() + days * 86_400_000)
    .toISOString()
    .slice(0, 10);
};

const monthOrdinal = (date: string): number => {
  const parts = parseDateOnly(date)!;
  return parts.year * 12 + parts.month - 1;
};

const monthKey = (ordinal: number): string => {
  const year = Math.floor(ordinal / 12);
  const month = (ordinal % 12) + 1;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`;
};

const daysInMonth = (ordinal: number): number => {
  const year = Math.floor(ordinal / 12);
  const month = (ordinal % 12) + 1;
  return makeUtcDate(year, month + 1, 0).getUTCDate();
};

const failure = (
  error: TuitionProgressReminderScheduleError,
): TuitionProgressReminderScheduleResult => ({ ok: false, error });

export const planTuitionProgressReminderControls = (
  input: TuitionProgressReminderScheduleInput,
): TuitionProgressReminderScheduleResult => {
  if (!isValidDate(input.now)) {
    return failure({
      code: 'invalid_current_time',
      message: 'A valid current timestamp is required.',
    });
  }
  if (typeof input.timeZone !== 'string' || input.timeZone.trim().length === 0) {
    return failure({
      code: 'invalid_time_zone',
      message: 'A valid IANA time zone is required.',
    });
  }

  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone: input.timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
  } catch {
    return failure({
      code: 'invalid_time_zone',
      message: 'A valid IANA time zone is required.',
    });
  }

  const localToday = formatDateOnly(partsInTimeZone(input.now, formatter));
  const calendar = calculateTuitionProgress({
    schoolId: input.schoolId,
    academicYearId: input.academicYearId,
    academicYearSchoolId: input.academicYearSchoolId,
    cycleId: input.cycleId,
    periods: input.periods,
    annualNetAmount: 0,
    netPaidAmount: 0,
    assessmentDate: localToday,
  });
  if (calendar.ok === false) {
    return failure({
      code: 'invalid_calendar',
      reasonCode: calendar.error.code,
      message: calendar.error.message,
    });
  }

  const startMonth = monthOrdinal(calendar.startDate);
  const endMonth = monthOrdinal(calendar.endDate);
  const controls: TuitionProgressReminderControlDate[] = [];

  for (let ordinal = startMonth; ordinal <= endMonth; ordinal += 1) {
    const monthStart = `${monthKey(ordinal)}-01`;
    const monthEnd = `${monthKey(ordinal)}-${String(daysInMonth(ordinal)).padStart(2, '0')}`;
    let candidates: Array<{ checkDate: string; stage: 'penultimate' | 'last' }>;

    if (ordinal === endMonth) {
      const lastDates = [calendar.endDate];
      const previousDate = addCalendarDays(calendar.endDate, -1);
      if (previousDate >= calendar.startDate && previousDate >= monthStart) {
        lastDates.unshift(previousDate);
      }
      candidates = lastDates.map((checkDate, index) => {
        const stage: 'penultimate' | 'last' =
          lastDates.length === 1 || index === lastDates.length - 1 ? 'last' : 'penultimate';
        return { checkDate, stage };
      });
    } else {
      const penultimateDate = addCalendarDays(monthEnd, -1);
      candidates = [
        { checkDate: penultimateDate, stage: 'penultimate' as const },
        { checkDate: monthEnd, stage: 'last' as const },
      ].filter(({ checkDate }) => checkDate >= calendar.startDate && checkDate <= calendar.endDate);
    }

    for (const candidate of candidates) {
      const scheduledAt = localDateTimeToInstant(candidate.checkDate, LOCAL_CONTROL_HOUR, 0, formatter);
      const nextDayStart = localDateStartToInstant(addCalendarDays(candidate.checkDate, 1), formatter);
      if (!scheduledAt || !nextDayStart) {
        return failure({
          code: 'invalid_local_time',
          message: `The scheduled time or next local midnight is not unique on ${candidate.checkDate}.`,
        });
      }

      const expiresAt = new Date(nextDayStart.getTime() - 1);
      if (scheduledAt.getTime() > expiresAt.getTime()) {
        return failure({
          code: 'invalid_local_time',
          message: `The scheduled time falls outside the local day on ${candidate.checkDate}.`,
        });
      }
      if (input.now.getTime() <= expiresAt.getTime()) {
        controls.push({
          monthStart,
          stage: candidate.stage,
          checkDate: candidate.checkDate,
          scheduledAt,
          expiresAt,
          timeZone: input.timeZone,
        });
      }
    }
  }

  return { ok: true, controls };
};
