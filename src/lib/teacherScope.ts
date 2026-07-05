export function getTeacherClassIdSet(
  assignments: Array<{ classId: number | null | undefined; schoolId?: number | null | undefined }> = [],
  currentSchoolId?: number | null,
): number[] {
  return assignments
    .filter((assignment) => {
      if (currentSchoolId == null) return true;
      return assignment.schoolId == null || assignment.schoolId === currentSchoolId;
    })
    .map((assignment) => assignment.classId)
    .filter((id): id is number => typeof id === 'number');
}
