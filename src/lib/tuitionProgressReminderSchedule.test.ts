import { describe, expect, it } from 'vitest';
import {
  planTuitionProgressReminderControls,
  type TuitionProgressReminderScheduleInput,
} from './tuitionProgressReminderSchedule.ts';
import type { TuitionProgressPeriod } from './tuitionProgress.ts';

const addDays = (date: string, days: number): string =>
  new Date(Date.parse(`${date}T00:00:00.000Z`) + days * 86_400_000).toISOString().slice(0, 10);

const periodsForRange = (startDate: string, endDate: string): TuitionProgressPeriod[] => {
  const totalDays = (Date.parse(`${endDate}T00:00:00.000Z`) - Date.parse(`${startDate}T00:00:00.000Z`))
    / 86_400_000 + 1;
  const firstLength = Math.floor(totalDays / 3);
  const secondLength = Math.floor(totalDays / 3);
  const firstEnd = addDays(startDate, firstLength - 1);
  const secondStart = addDays(firstEnd, 1);
  const secondEnd = addDays(secondStart, secondLength - 1);
  const thirdStart = addDays(secondEnd, 1);

  return [
    { schoolId: 7, academicYearId: 23, cycleId: 4, periodType: 'trimester', orderIndex: 1, startDate, endDate: firstEnd, isActive: true },
    { schoolId: 7, academicYearId: 23, cycleId: 4, periodType: 'trimester', orderIndex: 2, startDate: secondStart, endDate: secondEnd, isActive: true },
    { schoolId: 7, academicYearId: 23, cycleId: 4, periodType: 'trimester', orderIndex: 3, startDate: thirdStart, endDate, isActive: true },
  ];
};

const plan = (
  startDate: string,
  endDate: string,
  overrides: Partial<TuitionProgressReminderScheduleInput> = {},
) => planTuitionProgressReminderControls({
  schoolId: 7,
  academicYearId: 23,
  academicYearSchoolId: 7,
  cycleId: 4,
  periods: periodsForRange(startDate, endDate),
  timeZone: 'Africa/Lome',
  now: new Date('2026-01-01T00:00:00.000Z'),
  ...overrides,
});

describe('tuition progress reminder scheduling', () => {
  it('uses the penultimate and last calendar days for 28, 29, 30 and 31-day months', () => {
    const result = plan('2027-01-01', '2027-12-31');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const datesByMonth = new Map<string, string[]>();
    for (const control of result.controls) {
      const dates = datesByMonth.get(control.monthStart) ?? [];
      dates.push(control.checkDate);
      datesByMonth.set(control.monthStart, dates);
    }

    expect(datesByMonth.get('2027-02-01')).toEqual(['2027-02-27', '2027-02-28']);
    expect(datesByMonth.get('2027-04-01')).toEqual(['2027-04-29', '2027-04-30']);
    expect(datesByMonth.get('2027-05-01')).toEqual(['2027-05-30', '2027-05-31']);
  });

  it('handles February in a leap year', () => {
    const result = plan('2028-01-01', '2028-12-31');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.controls.filter((control) => control.monthStart === '2028-02-01')
      .map((control) => control.checkDate)).toEqual(['2028-02-28', '2028-02-29']);
  });

  it('uses the two last dates of a partial final month across school years', () => {
    const result = plan('2026-09-01', '2027-07-16');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.controls.filter((control) => control.monthStart === '2027-07-01'))
      .toMatchObject([
        { checkDate: '2027-07-15', stage: 'penultimate' },
        { checkDate: '2027-07-16', stage: 'last' },
      ]);
    expect(result.controls.some((control) => control.checkDate > '2027-07-16')).toBe(false);
    expect(result.controls.some((control) => control.checkDate < '2026-09-01')).toBe(false);
  });

  it('schedules shared-semester controls by dates when historical order indexes are equal', () => {
    const periods: TuitionProgressPeriod[] = [
      {
        schoolId: null,
        academicYearId: 2,
        cycleId: 2,
        periodType: 'semester',
        orderIndex: 1,
        startDate: '2027-01-05',
        endDate: '2027-03-30',
        isActive: true,
      },
      {
        schoolId: null,
        academicYearId: 2,
        cycleId: 2,
        periodType: 'semester',
        orderIndex: 1,
        startDate: '2026-09-14',
        endDate: '2026-12-23',
        isActive: true,
      },
    ];

    const result = plan('2026-09-14', '2027-03-30', {
      academicYearId: 2,
      academicYearSchoolId: null,
      cycleId: 2,
      periods,
      now: new Date('2026-11-14T10:52:58.683Z'),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.controls.filter((control) => control.monthStart === '2026-11-01'))
      .toMatchObject([
        { checkDate: '2026-11-29', stage: 'penultimate' },
        { checkDate: '2026-11-30', stage: 'last' },
      ]);
  });

  it('creates only one last-stage control when the final month contains one school day', () => {
    const oneDayResult = plan('2026-09-01', '2027-07-01');

    expect(oneDayResult.ok).toBe(true);
    if (!oneDayResult.ok) return;
    expect(oneDayResult.controls.filter((control) => control.monthStart === '2027-07-01'))
      .toMatchObject([{ checkDate: '2027-07-01', stage: 'last' }]);
  });

  it('keeps dates inside the actual period and returns no duplicate or overfull month', () => {
    const result = plan('2026-09-30', '2027-01-31');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.controls.every((control) =>
      control.checkDate >= '2026-09-30' && control.checkDate <= '2027-01-31')).toBe(true);
    expect(new Set(result.controls.map((control) => `${control.monthStart}:${control.stage}`)).size)
      .toBe(result.controls.length);
    for (const month of new Set(result.controls.map((control) => control.monthStart))) {
      expect(result.controls.filter((control) => control.monthStart === month).length).toBeLessThanOrEqual(2);
    }
  });

  it('uses the establishment time zone and schedules at 08:00 local time', () => {
    const result = plan('2027-01-01', '2027-01-31', {
      timeZone: 'America/New_York',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.controls[0].scheduledAt.toISOString()).toBe('2027-01-30T13:00:00.000Z');
    expect(result.controls[0].timeZone).toBe('America/New_York');
    expect(result.controls[0].expiresAt.toISOString()).toBe('2027-01-31T04:59:59.999Z');
  });

  it('uses the correct local-day end across spring and fall daylight-saving changes', () => {
    const spring = plan('2026-09-01', '2027-03-14', {
      timeZone: 'America/New_York',
    });
    const fall = plan('2027-01-01', '2027-11-07', {
      timeZone: 'America/New_York',
    });

    expect(spring.ok).toBe(true);
    expect(fall.ok).toBe(true);
    if (!spring.ok || !fall.ok) return;
    expect(spring.controls.find((control) => control.checkDate === '2027-03-14'))
      .toMatchObject({
        scheduledAt: new Date('2027-03-14T12:00:00.000Z'),
        expiresAt: new Date('2027-03-15T03:59:59.999Z'),
      });
    expect(fall.controls.find((control) => control.checkDate === '2027-11-07'))
      .toMatchObject({
        scheduledAt: new Date('2027-11-07T13:00:00.000Z'),
        expiresAt: new Date('2027-11-08T04:59:59.999Z'),
      });
  });

  it('omits controls whose local-day expiration has passed without catch-up', () => {
    const result = plan('2027-07-01', '2027-07-31', {
      now: new Date('2027-08-01T00:00:00.000Z'),
    });

    expect(result).toEqual({ ok: true, controls: [] });
  });

  it('rejects invalid time zones, current timestamps and calendars', () => {
    expect(plan('2027-01-01', '2027-12-31', { timeZone: 'Unknown/Zone' }))
      .toMatchObject({ ok: false, error: { code: 'invalid_time_zone' } });
    expect(plan('2027-01-01', '2027-12-31', { timeZone: '' }))
      .toMatchObject({ ok: false, error: { code: 'invalid_time_zone' } });
    expect(plan('2027-01-01', '2027-12-31', { now: new Date(Number.NaN) }))
      .toMatchObject({ ok: false, error: { code: 'invalid_current_time' } });
    expect(plan('2027-01-01', '2027-12-31', {
      periods: [{ schoolId: 7, academicYearId: 23, cycleId: 4, isActive: true }],
    })).toMatchObject({ ok: false, error: { code: 'invalid_calendar' } });
  });
});
