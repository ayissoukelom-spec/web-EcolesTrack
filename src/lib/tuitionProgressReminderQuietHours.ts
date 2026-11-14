import { getTuitionProgressReminderAssessmentDate } from './tuitionProgressReminderNotifications.ts';
import { localDateTimeInTimeZoneToInstant } from './tuitionProgressReminderSchedule.ts';

export const TUITION_PROGRESS_REMINDER_QUIET_HOURS = {
  start: '22:00',
  end: '07:00',
} as const;

export type TuitionProgressReminderQuietHoursDecision =
  | { kind: 'allowed'; deliverAt: Date }
  | { kind: 'deferred'; deliverAt: Date }
  | { kind: 'expired' }
  | { kind: 'invalid' };

const parseTime = (value: string): number | null => {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
};

const nextLocalDate = (date: string): string => {
  const [year, month, day] = date.split('-').map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  return `${String(next.getUTCFullYear()).padStart(4, '0')}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(next.getUTCDate()).padStart(2, '0')}`;
};

export const getTuitionProgressReminderQuietHoursDecision = (input: {
  now: Date;
  expiresAt: Date;
  timeZone: string;
}): TuitionProgressReminderQuietHoursDecision => {
  const { now, expiresAt, timeZone } = input;
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())
    || !(expiresAt instanceof Date) || !Number.isFinite(expiresAt.getTime())
    || expiresAt.getTime() <= now.getTime()) return { kind: 'expired' };

  const localDate = getTuitionProgressReminderAssessmentDate(now, timeZone);
  if (!localDate) return { kind: 'invalid' };
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const values = Object.fromEntries(
    parts.filter((part) => part.type !== 'literal').map((part) => [part.type, Number(part.value)]),
  );
  const currentMinute = values.hour * 60 + values.minute;
  const startMinute = parseTime(TUITION_PROGRESS_REMINDER_QUIET_HOURS.start);
  const endMinute = parseTime(TUITION_PROGRESS_REMINDER_QUIET_HOURS.end);
  if (!Number.isFinite(currentMinute) || startMinute == null || endMinute == null || startMinute === endMinute) {
    return { kind: 'invalid' };
  }

  const isQuiet = startMinute > endMinute
    ? currentMinute >= startMinute || currentMinute < endMinute
    : currentMinute >= startMinute && currentMinute < endMinute;
  if (!isQuiet) return { kind: 'allowed', deliverAt: new Date(now) };

  const releaseDate = currentMinute >= startMinute ? nextLocalDate(localDate) : localDate;
  const [hour, minute] = TUITION_PROGRESS_REMINDER_QUIET_HOURS.end.split(':').map(Number);
  const deliverAt = localDateTimeInTimeZoneToInstant(releaseDate, hour, minute, timeZone);
  if (!deliverAt) return { kind: 'invalid' };
  if (deliverAt.getTime() >= expiresAt.getTime()) return { kind: 'expired' };
  return { kind: 'deferred', deliverAt };
};
