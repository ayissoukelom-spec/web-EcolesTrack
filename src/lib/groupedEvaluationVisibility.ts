export interface GroupedEvaluationGradeCounts {
  publicationId: number;
  expectedStudentCount: number | null | undefined;
  recordedGradeCount: number | null | undefined;
}

export interface PublicationNotification {
  publicationId?: number | null;
}

export const hasAllExpectedGrades = (
  expectedStudentCount: number | null | undefined,
  recordedGradeCount: number | null | undefined,
): boolean => (
  expectedStudentCount != null
  && recordedGradeCount != null
  && recordedGradeCount === expectedStudentCount
);

export const getCompletedGroupedPublicationIds = (
  evaluationCounts: GroupedEvaluationGradeCounts[],
): Set<number> => {
  const completionByPublication = new Map<number, boolean>();

  for (const evaluation of evaluationCounts) {
    const isComplete = hasAllExpectedGrades(
      evaluation.expectedStudentCount,
      evaluation.recordedGradeCount,
    );
    completionByPublication.set(
      evaluation.publicationId,
      (completionByPublication.get(evaluation.publicationId) ?? true) && isComplete,
    );
  }

  return new Set(
    Array.from(completionByPublication)
      .filter(([, isComplete]) => isComplete)
      .map(([publicationId]) => publicationId),
  );
};

export const filterCompletedGroupedPublicationNotifications = <T extends PublicationNotification>(
  notifications: T[],
  completedPublicationIds: ReadonlySet<number>,
): T[] => notifications.filter((notification) => (
  notification.publicationId == null
  || !completedPublicationIds.has(notification.publicationId)
));
