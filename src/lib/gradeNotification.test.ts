import { describe, expect, it } from 'vitest';
import { getGradeNotificationDedupeKey } from './gradeNotification';

describe('getGradeNotificationDedupeKey', () => {
  it('uses a stable key for the same grade event version', () => {
    expect(getGradeNotificationDedupeKey(41, 0)).toBe(getGradeNotificationDedupeKey(41, 0));
  });

  it('assigns a distinct key to every modification and grade', () => {
    const creationKey = getGradeNotificationDedupeKey(41, 0);
    const firstModificationKey = getGradeNotificationDedupeKey(41, 1);
    const secondModificationKey = getGradeNotificationDedupeKey(41, 2);
    const otherGradeKey = getGradeNotificationDedupeKey(42, 0);

    expect(new Set([creationKey, firstModificationKey, secondModificationKey, otherGradeKey]).size).toBe(4);
  });
});
