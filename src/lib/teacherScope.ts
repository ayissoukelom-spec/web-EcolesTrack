export function getTeacherClassIdSet(
  assignments: Array<{
    classId: number | null | undefined;
    schoolId?: number | null | undefined;
    assignmentSchoolId?: number | null | undefined;
    isApprovedForSchool?: boolean;
  }> = [],
  currentSchoolId?: number | null,
): number[] {
  if (currentSchoolId == null) return [];

  return assignments
    .filter((assignment) => {
      const assignmentSchoolId = assignment.assignmentSchoolId ?? assignment.schoolId ?? currentSchoolId;
      if (assignmentSchoolId !== currentSchoolId) return false;
      if (assignment.schoolId != null) return assignment.schoolId === currentSchoolId;
      return assignment.isApprovedForSchool === true;
    })
    .map((assignment) => assignment.classId)
    .filter((id): id is number => typeof id === 'number');
}
