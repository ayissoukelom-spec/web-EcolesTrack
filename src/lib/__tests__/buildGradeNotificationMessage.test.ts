import { describe, expect, it } from 'vitest';
import { buildGradeNotificationMessage } from '../buildGradeNotificationMessage.ts';

describe('buildGradeNotificationMessage', () => {
  it('formats a reusable grade notification message correctly', () => {
    const message = buildGradeNotificationMessage({
      studentName: 'Afi',
      score: '14',
      maxScore: 20,
      subjectName: 'science de la vie et de la terre',
      evaluationName: 'DS SVT',
    });

    expect(message).toBe('Afi a obtenu une nouvelle note: 14/20 en science de la vie et de la terre : DS SVT');
  });
});
