export interface TeacherTeachingPair {
  classId: number;
  subjectId: number;
}

export interface ExistingTeacherTeachingPair extends TeacherTeachingPair {
  id: number;
  isActive: boolean;
}

export type TeacherTeachingAssignmentChange =
  | { kind: 'insert'; assignment: TeacherTeachingPair }
  | { kind: 'activate'; id: number }
  | { kind: 'deactivate'; id: number };

export async function normalizeTeacherClassIds(
  requested: unknown,
  isApprovedForSchool: (classId: number) => Promise<boolean>,
): Promise<number[] | null> {
  if (!Array.isArray(requested)) return null;
  const classIds = new Set<number>();
  for (const value of requested) {
    const classId = Number(value);
    if (!Number.isInteger(classId) || classId <= 0 || !await isApprovedForSchool(classId)) return null;
    classIds.add(classId);
  }
  return Array.from(classIds);
}

export function planTeacherClassMembershipSync(
  existing: Array<{ classId: number }>,
  desiredClassIds: number[],
  managedClassIds?: number[],
): { remove: number[]; add: number[] } {
  const existingClassIds = new Set(existing.map((assignment) => assignment.classId));
  const desired = new Set(desiredClassIds);
  const managed = managedClassIds == null ? null : new Set(managedClassIds);
  return {
    remove: Array.from(existingClassIds).filter((classId) => (
      !desired.has(classId) && (managed == null || managed.has(classId))
    )),
    add: Array.from(desired).filter((classId) => !existingClassIds.has(classId)),
  };
}

export function planTeacherTeachingAssignmentSync(
  existing: ExistingTeacherTeachingPair[],
  desired: TeacherTeachingPair[],
  managedAssignments?: TeacherTeachingPair[],
): TeacherTeachingAssignmentChange[] {
  const desiredByKey = new Map<string, TeacherTeachingPair>();
  for (const assignment of desired) {
    desiredByKey.set(`${assignment.classId}:${assignment.subjectId}`, assignment);
  }
  const managedKeys = managedAssignments == null
    ? null
    : new Set(managedAssignments.map((assignment) => `${assignment.classId}:${assignment.subjectId}`));
  const existingByKey = new Map(
    existing.map((assignment) => [`${assignment.classId}:${assignment.subjectId}`, assignment]),
  );
  const changes: TeacherTeachingAssignmentChange[] = [];

  for (const assignment of existing) {
    const key = `${assignment.classId}:${assignment.subjectId}`;
    if (desiredByKey.has(key)) {
      if (!assignment.isActive) changes.push({ kind: 'activate', id: assignment.id });
    } else if (assignment.isActive && (managedKeys == null || managedKeys.has(key))) {
      changes.push({ kind: 'deactivate', id: assignment.id });
    }
  }

  for (const [key, assignment] of desiredByKey) {
    if (!existingByKey.has(key)) {
      changes.push({ kind: 'insert', assignment });
    }
  }

  return changes;
}
