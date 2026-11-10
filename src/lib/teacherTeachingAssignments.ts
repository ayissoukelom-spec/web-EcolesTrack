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

export function planTeacherTeachingAssignmentSync(
  existing: ExistingTeacherTeachingPair[],
  desired: TeacherTeachingPair[],
): TeacherTeachingAssignmentChange[] {
  const desiredByKey = new Map<string, TeacherTeachingPair>();
  for (const assignment of desired) {
    desiredByKey.set(`${assignment.classId}:${assignment.subjectId}`, assignment);
  }
  const existingByKey = new Map(
    existing.map((assignment) => [`${assignment.classId}:${assignment.subjectId}`, assignment]),
  );
  const changes: TeacherTeachingAssignmentChange[] = [];

  for (const assignment of existing) {
    const key = `${assignment.classId}:${assignment.subjectId}`;
    if (desiredByKey.has(key)) {
      if (!assignment.isActive) changes.push({ kind: 'activate', id: assignment.id });
    } else if (assignment.isActive) {
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
