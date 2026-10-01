import { and, eq, inArray, isNotNull, or, sql } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { classTeachers, classes, schoolClasses, schoolSubjects, students, subjects, teacherSubjects, teachers, userSchools } from '../db/schema.ts';
import { getTeacherHomeroomScopes, type HomeroomActor } from './homeroomAccess.ts';
import { isSubjectAssignedToTeacher } from './subjectMatching.ts';
import { getTeacherClassIdSet } from './teacherScope.ts';

export interface TeacherAuthorizationScope {
  teacherId: number;
  schoolId: number;
  specialization: string | null;
  teachingClassIds: Set<number>;
  homeroomClassIds: Set<number>;
  subjectIds: Set<number>;
}

export interface TeacherEvaluationScope {
  schoolId: number | null;
  classId: number;
  subjectId: number | null;
  subject: string;
}

export async function getTeacherAuthorizationScope(actor: HomeroomActor): Promise<TeacherAuthorizationScope | null> {
  if (actor.role !== 'teacher' || actor.id == null || actor.schoolId == null) return null;

  const [teacher] = await db.select({
    id: teachers.id,
    schoolId: teachers.schoolId,
    specialization: teachers.specialization,
  }).from(teachers).where(eq(teachers.userId, actor.id));
  if (!teacher) return null;

  if (teacher.schoolId !== actor.schoolId) {
    const [membership] = await db.select({ id: userSchools.id }).from(userSchools).where(and(
      eq(userSchools.userId, actor.id),
      eq(userSchools.schoolId, actor.schoolId),
      eq(userSchools.role, 'teacher'),
      eq(userSchools.isActive, true),
    ));
    if (!membership) return null;
  }

  const assignmentRows = await db.select({
    classId: classTeachers.classId,
    classSchoolId: classes.schoolId,
    isApprovedForSchool: sql<boolean>`${schoolClasses.id} IS NOT NULL`,
  }).from(classTeachers)
    .innerJoin(classes, eq(classes.id, classTeachers.classId))
    .leftJoin(schoolClasses, and(
      eq(schoolClasses.classId, classes.id),
      eq(schoolClasses.schoolId, actor.schoolId),
      eq(schoolClasses.status, 'approved'),
    ))
    .where(eq(classTeachers.teacherId, teacher.id));

  const teachingClassIds = new Set(getTeacherClassIdSet(assignmentRows.map((row) => ({
    classId: row.classId,
    schoolId: row.classSchoolId,
    assignmentSchoolId: actor.schoolId,
    isApprovedForSchool: row.isApprovedForSchool,
  })), actor.schoolId));
  const homeroomScopes = await getTeacherHomeroomScopes(actor);
  const homeroomClassIds = new Set(homeroomScopes.map((scope) => scope.classId));
  const subjectRows = await db.select({ subjectId: teacherSubjects.subjectId })
    .from(teacherSubjects)
    .innerJoin(subjects, eq(subjects.id, teacherSubjects.subjectId))
    .leftJoin(schoolSubjects, and(
      eq(schoolSubjects.subjectId, subjects.id),
      eq(schoolSubjects.schoolId, actor.schoolId),
      eq(schoolSubjects.status, 'approved'),
    ))
    .where(and(
      eq(teacherSubjects.teacherId, teacher.id),
      or(
        eq(subjects.schoolId, actor.schoolId),
        isNotNull(schoolSubjects.id),
      ),
    ));

  return {
    teacherId: teacher.id,
    schoolId: actor.schoolId,
    specialization: teacher.specialization,
    teachingClassIds,
    homeroomClassIds,
    subjectIds: new Set(subjectRows.map((row) => row.subjectId)),
  };
}

export function canTeacherReadEvaluation(scope: TeacherAuthorizationScope, evaluation: TeacherEvaluationScope): boolean {
  if (evaluation.schoolId !== scope.schoolId) return false;
  if (scope.homeroomClassIds.has(evaluation.classId)) return true;
  if (!scope.teachingClassIds.has(evaluation.classId)) return false;
  return evaluation.subjectId != null
    ? scope.subjectIds.has(evaluation.subjectId)
    : isSubjectAssignedToTeacher(evaluation.subject, scope.specialization);
}

export function canTeacherWriteEvaluation(scope: TeacherAuthorizationScope, evaluation: TeacherEvaluationScope): boolean {
  if (evaluation.schoolId !== scope.schoolId || !scope.teachingClassIds.has(evaluation.classId)) return false;
  return evaluation.subjectId != null
    ? scope.subjectIds.has(evaluation.subjectId)
    : isSubjectAssignedToTeacher(evaluation.subject, scope.specialization);
}

export async function getTeacherReadableStudentIds(
  scope: TeacherAuthorizationScope,
  requestedClassIds?: number[],
): Promise<number[]> {
  const readableClassIds = new Set([...scope.teachingClassIds, ...scope.homeroomClassIds]);
  const classIds = requestedClassIds == null
    ? Array.from(readableClassIds)
    : requestedClassIds.filter((classId) => readableClassIds.has(classId));
  if (classIds.length === 0) return [];

  const rows = await db.select({ id: students.id })
    .from(students)
    .where(and(
      inArray(students.classId, classIds),
      eq(students.schoolId, scope.schoolId),
      eq(students.isActive, true),
    ));
  return rows.map((row) => row.id);
}