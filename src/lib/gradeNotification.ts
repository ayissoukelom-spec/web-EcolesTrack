export function getGradeNotificationDedupeKey(gradeId: number, editCount: number): string {
  return `grade-${gradeId}-event-${editCount}`;
}
