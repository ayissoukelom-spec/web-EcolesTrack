import { describe, it, expect } from 'vitest';
import composeAbsenceMessage from '../composeAbsenceMessage';

describe('Absence notification flow (simulated)', () => {
  it('db body and notification payload message are identical and contain no undefined', () => {
    const firstName = 'Josué';
    const date = '2026-08-04';
    const startTime = '08:00';
    const endTime = '10:00';
    const subjectName = 'Mathématiques';
    const derivedPeriod = undefined;

    const messageBody = composeAbsenceMessage({ firstName, date, startTime, endTime, subjectName, derivedPeriod });

    // Simulate DB insert object
    const dbInsert = {
      userId: 123,
      title: `Nouvelle absence pour ${firstName}`,
      body: messageBody,
      type: 'absence'
    };

    // Simulate notification payload
    const notificationPayload = {
      parentId: 123,
      title: `Nouvelle absence pour ${firstName}`,
      message: messageBody,
      category: 'absence',
      metadata: {
        startTime,
        endTime,
        subjectName,
        derivedPeriod
      }
    };

    expect(dbInsert.body).toBe(notificationPayload.message);
    expect(dbInsert.body).not.toMatch(/undefined|null/);
    expect(dbInsert.body).toContain('04/08/2026');
    expect(dbInsert.body).toContain('08:00 à 10:00');
    expect(dbInsert.body).toContain('Mathématiques');
  });

  it('handles missing subject and still avoids undefined', () => {
    const msg = composeAbsenceMessage({ firstName: 'Anna', date: '2026-08-04', startTime: '09:00', endTime: '11:00' });
    expect(msg).toContain('09:00 à 11:00');
    expect(msg).not.toMatch(/undefined|null/);
  });

  it('handles legacy absence with derivedPeriod', () => {
    const msg = composeAbsenceMessage({ firstName: 'Paul', date: '2026-08-04', derivedPeriod: 'morning' });
    expect(msg).toContain('Matin');
    expect(msg).not.toMatch(/undefined|null/);
  });
});
