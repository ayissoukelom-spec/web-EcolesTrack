import { describe, it, expect } from 'vitest';
import { composeAbsenceMessage } from '../composeAbsenceMessage';

describe('composeAbsenceMessage', () => {
  it('builds message with start/end and subject', () => {
    const msg = composeAbsenceMessage({ firstName: 'Josué', date: '2026-08-04', startTime: '08:00', endTime: '10:00', subjectName: 'Mathématiques' });
    expect(msg).toContain('Josué');
    expect(msg).toContain('04/08/2026');
    expect(msg).toContain('08:00 à 10:00');
    expect(msg).toContain('Mathématiques');
    expect(msg).not.toContain('undefined');
  });

  it('builds message with start/end but no subject', () => {
    const msg = composeAbsenceMessage({ firstName: 'Anna', date: '2026-08-04', startTime: '09:00', endTime: '11:00' });
    expect(msg).toContain('Anna');
    expect(msg).toContain('09:00 à 11:00');
    expect(msg).not.toContain('undefined');
  });

  it('builds message for legacy absence with derivedPeriod', () => {
    const msg = composeAbsenceMessage({ firstName: 'Paul', date: '2026-08-04', derivedPeriod: 'morning' });
    expect(msg).toContain('Paul');
    expect(msg).toContain('04/08/2026');
    expect(msg).toContain('Matin');
  });

  it('does not shift date for YYYY-MM-DD strings', () => {
    const msg = composeAbsenceMessage({ firstName: 'Test', date: '2026-08-04' });
    expect(msg).toContain('04/08/2026');
  });
});
