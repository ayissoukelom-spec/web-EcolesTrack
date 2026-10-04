import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { getGradeNotificationDedupeKey } from '../src/lib/gradeNotification';

/**
 * Test that verifies the event-based deduplication strategy for grade notifications.
 * 
 * Key insight: Each grade operation (creation or modification) has a unique editCount,
 * which ensures that:
 * - Creation (editCount=0) gets key: grade-ID-event-0
 * - First modification (editCount=1) gets key: grade-ID-event-1
 * - Second modification (editCount=2) gets key: grade-ID-event-2
 * - etc.
 *
 * This allows each operation's push notification to be sent independently,
 * while still maintaining idempotence for retries of the same operation.
 */
describe('Grade Notification Deduplication Strategy', () => {
  const gradeId = 42;

  it('creates distinct dedupeKeys for each operation on the same grade', () => {
    const creationKey = getGradeNotificationDedupeKey(gradeId, 0);
    const mod1Key = getGradeNotificationDedupeKey(gradeId, 1);
    const mod2Key = getGradeNotificationDedupeKey(gradeId, 2);
    const mod3Key = getGradeNotificationDedupeKey(gradeId, 3);

    expect(creationKey).toBe(`grade-${gradeId}-event-0`);
    expect(mod1Key).toBe(`grade-${gradeId}-event-1`);
    expect(mod2Key).toBe(`grade-${gradeId}-event-2`);
    expect(mod3Key).toBe(`grade-${gradeId}-event-3`);

    // All keys must be unique
    const allKeys = [creationKey, mod1Key, mod2Key, mod3Key];
    expect(new Set(allKeys).size).toBe(4);
  });

  it('ensures idempotence: same editCount always produces same key', () => {
    const firstCall = getGradeNotificationDedupeKey(gradeId, 1);
    const secondCall = getGradeNotificationDedupeKey(gradeId, 1);

    expect(firstCall).toBe(secondCall);
  });

  it('distinguishes different grades', () => {
    const grade1Key = getGradeNotificationDedupeKey(1, 0);
    const grade2Key = getGradeNotificationDedupeKey(2, 0);

    expect(grade1Key).not.toBe(grade2Key);
  });

  it('handles the full lifecycle correctly', () => {
    /**
     * Scenario:
     * - Teacher creates a grade: editCount=0, push sent, marked completed
     * - Teacher modifies grade: editCount=1, different key, new push sent
     * - Teacher modifies again: editCount=2, different key, new push sent
     * - Retry of modification #2: same key as above, deduped
     */

    const gradeId = 100;
    const creationEvent = { gradeId, editCount: 0, dedupeKey: getGradeNotificationDedupeKey(gradeId, 0) };
    const firstModEvent = { gradeId, editCount: 1, dedupeKey: getGradeNotificationDedupeKey(gradeId, 1) };
    const secondModEvent = { gradeId, editCount: 2, dedupeKey: getGradeNotificationDedupeKey(gradeId, 2) };
    const retrySecondMod = { gradeId, editCount: 2, dedupeKey: getGradeNotificationDedupeKey(gradeId, 2) };

    // Creation has its own key
    expect(creationEvent.dedupeKey).toContain('event-0');

    // First modification has different key
    expect(firstModEvent.dedupeKey).toContain('event-1');
    expect(firstModEvent.dedupeKey).not.toBe(creationEvent.dedupeKey);

    // Second modification has another key
    expect(secondModEvent.dedupeKey).toContain('event-2');
    expect(secondModEvent.dedupeKey).not.toBe(firstModEvent.dedupeKey);
    expect(secondModEvent.dedupeKey).not.toBe(creationEvent.dedupeKey);

    // Retry of second modification uses same key (idempotent)
    expect(retrySecondMod.dedupeKey).toBe(secondModEvent.dedupeKey);
  });
});
