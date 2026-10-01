export interface TeacherTeachingAssignment {
  id: number;
  teacherId: number;
  schoolId: number;
  classId: number;
  subjectId: number;
  isActive: boolean;
}

export interface TeachingAssignmentAbsence {
  teachingAssignmentId?: number | null;
  classId?: number | null;
  subjectId?: number | null;
}

export function isTeacherTeachingAssignment(
  assignment: TeacherTeachingAssignment,
  teacherId: number,
  schoolId: number,
  classId: number,
  subjectId: number,
): boolean {
  return assignment.teacherId === teacherId
    && assignment.schoolId === schoolId
    && assignment.classId === classId
    && assignment.subjectId === subjectId
    && assignment.isActive;
}

export function canTeacherAccessAbsence(
  absence: TeachingAssignmentAbsence,
  teacherId: number,
  assignments: readonly TeacherTeachingAssignment[],
): boolean {
  const assignmentId = absence.teachingAssignmentId;
  return assignmentId != null && assignments.some((assignment) =>
    assignment.id === assignmentId
      && assignment.teacherId === teacherId
      && assignment.isActive
      && (absence.classId == null || absence.classId === assignment.classId)
      && (absence.subjectId == null || absence.subjectId === assignment.subjectId),
  );
}

export function resolveTeacherTeachingAssignmentId(
  assignments: readonly Pick<TeacherTeachingAssignment, 'id' | 'classId' | 'subjectId' | 'isActive'>[],
  classId: number,
  subjectId: number,
): number | null {
  const matches = assignments.filter((assignment) => assignment.isActive
    && assignment.classId === classId
    && assignment.subjectId === subjectId);
  return matches.length === 1 ? matches[0].id : null;
}