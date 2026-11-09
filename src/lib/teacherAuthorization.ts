import { and, eq, inArray, isNotNull, or, sql } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { classes, schoolClasses, schoolSubjects, students, subjects, teacherClassSubjects, teachers, userSchools } from '../db/schema.ts';
import { getTeacherHomeroomScopes, type HomeroomActor } from './homeroomAccess.ts';

export interface TeacherAuthorizationScope {
  teacherId: number;
  schoolId: number;
  specialization: string | null;
  teachingClassIds: Set<number>;
  homeroomClassIds: Set<number>;
  subjectIds: Set<number>;
  teachingAssignmentKeys: Set<string>;
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
  }).from(teachers).where(and(
    eq(teachers.userId, actor.id),
    eq(teachers.schoolId, actor.schoolId),
  ));
  if (!teacher) return null;

  const [membership] = await db.select({ id: userSchools.id }).from(userSchools).where(and(
    eq(userSchools.userId, actor.id),
    eq(userSchools.schoolId, actor.schoolId),
    eq(userSchools.role, 'teacher'),
    sql`${userSchools.isActive} IS DISTINCT FROM FALSE`,
  ));
  if (!membership) return null;

  const assignmentRows = await db.select({
    classId: teacherClassSubjects.classId,
    subjectId: teacherClassSubjects.subjectId,
  }).from(teacherClassSubjects)
    .innerJoin(classes, eq(classes.id, teacherClassSubjects.classId))
    .innerJoin(subjects, eq(subjects.id, teacherClassSubjects.subjectId))
    .leftJoin(schoolClasses, and(
      eq(schoolClasses.classId, teacherClassSubjects.classId),
      eq(schoolClasses.schoolId, actor.schoolId),
      eq(schoolClasses.status, 'approved'),
    ))
    .leftJoin(schoolSubjects, and(
      eq(schoolSubjects.subjectId, teacherClassSubjects.subjectId),
      eq(schoolSubjects.schoolId, actor.schoolId),
      eq(schoolSubjects.status, 'approved'),
    ))
    .where(and(
      eq(teacherClassSubjects.teacherId, teacher.id),
      eq(teacherClassSubjects.schoolId, actor.schoolId),
      eq(teacherClassSubjects.isActive, true),
      or(
        eq(classes.schoolId, actor.schoolId),
        isNotNull(schoolClasses.id),
      ),
      or(
        eq(subjects.schoolId, actor.schoolId),
        isNotNull(schoolSubjects.id),
      ),
    ));

  const homeroomScopes = await getTeacherHomeroomScopes(actor);
  const homeroomClassIds = new Set(homeroomScopes.map((scope) => scope.classId));
  const teachingClassIds = new Set(assignmentRows.map((assignment) => assignment.classId));
  const subjectIds = new Set(assignmentRows.map((assignment) => assignment.subjectId));
  const teachingAssignmentKeys = new Set(assignmentRows.map((assignment) =>
    `${assignment.classId}:${assignment.subjectId}`,
  ));

  return {
    teacherId: teacher.id,
    schoolId: actor.schoolId,
    specialization: teacher.specialization,
    teachingClassIds,
    homeroomClassIds,
    subjectIds,
    teachingAssignmentKeys,
  };
}

export function canTeacherReadEvaluation(scope: TeacherAuthorizationScope, evaluation: TeacherEvaluationScope): boolean {
  return evaluation.schoolId === scope.schoolId
    && evaluation.subjectId != null
    && scope.teachingAssignmentKeys.has(`${evaluation.classId}:${evaluation.subjectId}`);
}

export function canTeacherWriteEvaluation(scope: TeacherAuthorizationScope, evaluation: TeacherEvaluationScope): boolean {
  return evaluation.schoolId === scope.schoolId
    && evaluation.subjectId != null
    && scope.teachingAssignmentKeys.has(`${evaluation.classId}:${evaluation.subjectId}`);
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