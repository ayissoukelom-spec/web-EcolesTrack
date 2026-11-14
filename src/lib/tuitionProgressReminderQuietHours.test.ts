import { describe, expect, it } from 'vitest';
import { getTuitionProgressReminderQuietHoursDecision } from './tuitionProgressReminderQuietHours.ts';

describe('tuition progress reminder system quiet hours', () => {
  it('allows delivery outside 22:00–07:00 in the school time zone', () => {
    expect(getTuitionProgressReminderQuietHoursDecision({
      now: new Date('2027-01-15T21:59:00.000Z'),
      expiresAt: new Date('2027-01-15T23:59:59.999Z'),
      timeZone: 'Africa/Lome',
    })).toMatchObject({
      kind: 'allowed',
      deliverAt: new Date('2027-01-15T21:59:00.000Z'),
    });
  });

  it('defers a quiet-hours delivery to 07:00 local time', () => {
    expect(getTuitionProgressReminderQuietHoursDecision({
      now: new Date('2027-01-15T23:30:00.000Z'),
      expiresAt: new Date('2027-01-16T23:59:59.999Z'),
      timeZone: 'Africa/Lome',
    })).toEqual({
      kind: 'deferred',
      deliverAt: new Date('2027-01-16T07:00:00.000Z'),
    });
  });

  it('calculates the release instant across a daylight-saving transition', () => {
    expect(getTuitionProgressReminderQuietHoursDecision({
      now: new Date('2027-03-14T06:30:00.000Z'),
      expiresAt: new Date('2027-03-14T20:00:00.000Z'),
      timeZone: 'America/New_York',
    })).toEqual({
      kind: 'deferred',
      deliverAt: new Date('2027-03-14T11:00:00.000Z'),
    });
  });

  it('does not defer beyond a control expiration and rejects invalid time zones', () => {
    expect(getTuitionProgressReminderQuietHoursDecision({
      now: new Date('2027-01-15T23:30:00.000Z'),
      expiresAt: new Date('2027-01-16T06:59:59.999Z'),
      timeZone: 'Africa/Lome',
    })).toEqual({ kind: 'expired' });
    expect(getTuitionProgressReminderQuietHoursDecision({
      now: new Date('2027-01-15T23:30:00.000Z'),
      expiresAt: new Date('2027-01-16T23:59:59.999Z'),
      timeZone: 'Invalid/Zone',
    })).toEqual({ kind: 'invalid' });
  });
});
