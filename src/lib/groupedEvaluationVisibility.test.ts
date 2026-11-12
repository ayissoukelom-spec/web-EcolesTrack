import { describe, expect, it } from 'vitest';
import {
  filterCompletedGroupedPublicationNotifications,
  getCompletedGroupedPublicationIds,
  hasAllExpectedGrades,
} from './groupedEvaluationVisibility';

describe('grouped evaluation notification visibility', () => {
  it('keeps scheduled notifications until every class-subject evaluation in the publication is complete', () => {
    const completePublications = getCompletedGroupedPublicationIds([
      { publicationId: 1, expectedStudentCount: 2, recordedGradeCount: 0 },
      { publicationId: 2, expectedStudentCount: 2, recordedGradeCount: 1 },
      { publicationId: 3, expectedStudentCount: 2, recordedGradeCount: 2 },
      { publicationId: 4, expectedStudentCount: 2, recordedGradeCount: 2 },
      { publicationId: 4, expectedStudentCount: 3, recordedGradeCount: 2 },
      { publicationId: 5, expectedStudentCount: 2, recordedGradeCount: 2 },
      { publicationId: 5, expectedStudentCount: 3, recordedGradeCount: 3 },
      { publicationId: 6, expectedStudentCount: 2, recordedGradeCount: 2 },
    ]);

    expect(completePublications).toEqual(new Set([3, 5, 6]));
    expect(completePublications.has(1)).toBe(false);
    expect(completePublications.has(2)).toBe(false);
    expect(completePublications.has(4)).toBe(false);
  });

  it('hides only completed grouped announcements and preserves individual and unrelated notifications', () => {
    const notifications = [
      { id: 1, publicationId: 10 },
      { id: 2, publicationId: 11 },
      { id: 3, publicationId: null, evaluationId: 77 },
      { id: 4 },
    ];
    const visible = filterCompletedGroupedPublicationNotifications(
      notifications,
      new Set([10]),
    );

    expect(visible.map(({ id }) => id)).toEqual([2, 3, 4]);
  });

  it('counts zero and absence grade rows as recorded rows, matching the existing count-based rule', () => {
    const recordedGrades = [{ score: '0' }, { score: 'Abs' }];

    expect(hasAllExpectedGrades(2, recordedGrades.length)).toBe(true);
    expect(hasAllExpectedGrades(3, recordedGrades.length)).toBe(false);
    expect(hasAllExpectedGrades(0, 0)).toBe(true);
    expect(hasAllExpectedGrades(null, 0)).toBe(false);
  });
});
