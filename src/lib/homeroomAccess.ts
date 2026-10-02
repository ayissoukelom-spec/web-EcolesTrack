import { and, eq, inArray, or, sql } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { classHomeroomAssignments, classTeachers, classes, schoolClasses, students, teachers, userSchools } from '../db/schema.ts';
import { getTeacherClassIdSet } from './teacherScope.ts';

export interface HomeroomActor {
  id?: number | null;
  role: string;
  schoolId?: number | null;
}

export interface HomeroomScope {
  classId: number;
  schoolId: number;
  teacherId: number;
}

async function getTeacherId(actor: HomeroomActor): Promise<number | null> {
  if (actor.role !== 'teacher' || actor.id == null || actor.schoolId == null) return null;
  const [teacher] = await db.select({ id: teachers.id, schoolId: teachers.schoolId })
    .from(teachers)
    .where(eq(teachers.userId, actor.id));
  if (!teacher) return null;
  if (teacher.schoolId === actor.schoolId) return teacher.id;

  const [membership] = await db.select({ id: userSchools.id }).from(userSchools).where(and(
    eq(userSchools.userId, actor.id),
    eq(userSchools.schoolId, actor.schoolId),
    eq(userSchools.role, 'teacher'),
    eq(userSchools.isActive, true),
  ));
  return membership ? teacher.id : null;
}

export async function getTeacherHomeroomScopes(actor: HomeroomActor): Promise<HomeroomScope[]> {
  const teacherId = await getTeacherId(actor);
  if (teacherId == null || actor.schoolId == null) return [];

  const rows = await db.select({
    classId: classHomeroomAssignments.classId,
    schoolId: classHomeroomAssignments.schoolId,
    teacherId: classHomeroomAssignments.teacherId,
    classSchoolId: classes.schoolId,
    schoolClassStatus: schoolClasses.status,
  })
    .from(classHomeroomAssignments)
    .innerJoin(classes, eq(classes.id, classHomeroomAssignments.classId))
    .leftJoin(schoolClasses, and(
      eq(schoolClasses.classId, classes.id),
      eq(schoolClasses.schoolId, classHomeroomAssignments.schoolId),
    ))
    .where(and(
      eq(classHomeroomAssignments.teacherId, teacherId),
      eq(classHomeroomAssignments.schoolId, actor.schoolId),
      or(
        eq(classes.schoolId, actor.schoolId),
        sql`${classes.schoolId} IS NULL`,
      ),
    ));

  return rows
    .filter((row) => {
      return row.classSchoolId === actor.schoolId
        || (row.classSchoolId == null && row.schoolClassStatus === 'approved');
    })
    .map(({ classId, schoolId, teacherId }) => ({ classId, schoolId, teacherId }));
}

export async function getTeacherHomeroomClassIds(actor: HomeroomActor): Promise<number[]> {
  const scopes = await getTeacherHomeroomScopes(actor);
  return scopes.map((scope) => scope.classId);
}

export async function getTeacherReadableClassIds(actor: HomeroomActor): Promise<number[]> {
  if (actor.role !== 'teacher' || actor.id == null || actor.schoolId == null) return [];
  const teacherId = await getTeacherId(actor);
  if (teacherId == null) return [];

  const assignments = await db.select({
    classId: classTeachers.classId,
    assignmentSchoolId: classTeachers.schoolId,
    schoolId: classes.schoolId,
    isApprovedForSchool: schoolClasses.id,
  })
    .from(classTeachers)
    .innerJoin(classes, eq(classTeachers.classId, classes.id))
    .leftJoin(schoolClasses, and(
      eq(schoolClasses.classId, classTeachers.classId),
      eq(schoolClasses.schoolId, actor.schoolId),
      eq(schoolClasses.status, 'approved'),
    ))
    .where(and(
      eq(classTeachers.teacherId, teacherId),
      eq(classTeachers.schoolId, actor.schoolId),
    ));
  const teachingClassIds = getTeacherClassIdSet(assignments.map((assignment) => ({
    classId: assignment.classId,
    schoolId: assignment.schoolId,
    assignmentSchoolId: assignment.assignmentSchoolId,
    isApprovedForSchool: assignment.isApprovedForSchool != null,
  })), actor.schoolId);
  const homeroomClassIds = await getTeacherHomeroomClassIds(actor);
  return Array.from(new Set([...teachingClassIds, ...homeroomClassIds]));
}

export async function getTeacherReadableStudentIds(
  actor: HomeroomActor,
  requestedClassIds?: number[],
): Promise<number[]> {
  const readableClassIds = await getTeacherReadableClassIds(actor);
  const classIds = requestedClassIds == null
    ? readableClassIds
    : readableClassIds.filter((classId) => requestedClassIds.includes(classId));
  if (classIds.length === 0 || actor.schoolId == null) return [];

  const rows = await db.select({ id: students.id }).from(students).where(and(
    inArray(students.classId, classIds),
    eq(students.schoolId, actor.schoolId),
    eq(students.isActive, true),
  ));
  return rows.map((row) => row.id);
}