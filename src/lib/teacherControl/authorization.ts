import { and, eq } from 'drizzle-orm';
import { db } from '../../db/index.ts';
import { schools, teacherClassSubjects, teachers, userSchools } from '../../db/schema.ts';

export type TeacherControlRole = 'teacher' | 'school_admin' | 'super_admin';

export interface TeacherControlActor {
  id?: number | null;
  role: string;
  schoolId: number | null;
}

export interface TeacherControlMembership {
  role: string;
  isActive?: boolean | null;
}

export interface TeacherControlSchool {
  id: number;
  name: string;
  isSuspended: boolean;
}

export type TeacherControlSchoolAccess =
  | { allowed: true; schoolId: number; schoolName: string; role: TeacherControlRole }
  | { allowed: false; reason: 'unsupported_role' | 'missing_actor' | 'missing_school' | 'inactive_membership' | 'wrong_school' | 'school_suspended' };

export function authorizeTeacherControlSchool(
  actor: TeacherControlActor,
  schoolId: number | null,
  membership: TeacherControlMembership | null,
  school: TeacherControlSchool | null,
): TeacherControlSchoolAccess {
  if (actor.role !== 'teacher' && actor.role !== 'school_admin' && actor.role !== 'super_admin') {
    return { allowed: false, reason: 'unsupported_role' };
  }
  if (actor.id == null) return { allowed: false, reason: 'missing_actor' };
  if (schoolId == null || !Number.isSafeInteger(schoolId) || schoolId <= 0) {
    return { allowed: false, reason: 'missing_school' };
  }
  if (!school || school.id !== schoolId) return { allowed: false, reason: 'missing_school' };

  if (actor.role !== 'super_admin') {
    if (actor.schoolId !== schoolId) return { allowed: false, reason: 'wrong_school' };
    if (!membership || membership.role !== actor.role || membership.isActive === false) {
      return { allowed: false, reason: 'inactive_membership' };
    }
    if (school.isSuspended) return { allowed: false, reason: 'school_suspended' };
  }

  return {
    allowed: true,
    schoolId,
    schoolName: school.name,
    role: actor.role,
  };
}

export async function resolveTeacherControlSchoolAccess(
  actor: TeacherControlActor,
  selectedSchoolId?: number | null,
): Promise<TeacherControlSchoolAccess> {
  if (actor.role !== 'teacher' && actor.role !== 'school_admin' && actor.role !== 'super_admin') {
    return { allowed: false, reason: 'unsupported_role' };
  }

  const schoolId = actor.role === 'super_admin' ? selectedSchoolId ?? null : actor.schoolId;
  let membership: TeacherControlMembership | null = null;
  if (actor.id != null && schoolId != null && actor.role !== 'super_admin') {
    const [matchedMembership] = await db.select({
      role: userSchools.role,
      isActive: userSchools.isActive,
    }).from(userSchools).where(and(
      eq(userSchools.userId, actor.id),
      eq(userSchools.schoolId, schoolId),
      eq(userSchools.role, actor.role),
    )).limit(1);
    membership = matchedMembership ?? null;
  }

  const [schoolRow] = schoolId == null
    ? []
    : await db.select({
      id: schools.id,
      name: schools.name,
      isSuspended: schools.isSuspended,
    }).from(schools).where(eq(schools.id, schoolId)).limit(1);

  return authorizeTeacherControlSchool(
    actor,
    schoolId,
    membership,
    schoolRow ? { ...schoolRow, isSuspended: Boolean(schoolRow.isSuspended) } : null,
  );
}

export interface ActiveTeacherControlAssignment {
  id: number;
  teacherId: number;
  schoolId: number;
  classId: number;
  subjectId: number;
  isActive: boolean;
}

export function isExactActiveTeacherControlAssignment(
  assignment: ActiveTeacherControlAssignment | null | undefined,
  expected: Omit<ActiveTeacherControlAssignment, 'id' | 'isActive'>,
): assignment is ActiveTeacherControlAssignment {
  return assignment != null
    && assignment.isActive
    && assignment.teacherId === expected.teacherId
    && assignment.schoolId === expected.schoolId
    && assignment.classId === expected.classId
    && assignment.subjectId === expected.subjectId;
}

export async function findActiveTeacherControlAssignment(input: {
  actor: TeacherControlActor;
  schoolId: number;
  classId: number;
  subjectId: number;
}): Promise<ActiveTeacherControlAssignment | null> {
  if (input.actor.role !== 'teacher' || input.actor.id == null || input.actor.schoolId !== input.schoolId) {
    return null;
  }
  const schoolAccess = await resolveTeacherControlSchoolAccess(input.actor);
  if (schoolAccess.allowed !== true || schoolAccess.role !== 'teacher') return null;

  const [teacher] = await db.select({ id: teachers.id })
    .from(teachers)
    .where(and(
      eq(teachers.userId, input.actor.id),
      eq(teachers.schoolId, input.schoolId),
    ))
    .limit(1);
  if (!teacher) return null;

  const [assignment] = await db.select({
    id: teacherClassSubjects.id,
    teacherId: teacherClassSubjects.teacherId,
    schoolId: teacherClassSubjects.schoolId,
    classId: teacherClassSubjects.classId,
    subjectId: teacherClassSubjects.subjectId,
    isActive: teacherClassSubjects.isActive,
  }).from(teacherClassSubjects).where(and(
    eq(teacherClassSubjects.teacherId, teacher.id),
    eq(teacherClassSubjects.schoolId, input.schoolId),
    eq(teacherClassSubjects.classId, input.classId),
    eq(teacherClassSubjects.subjectId, input.subjectId),
    eq(teacherClassSubjects.isActive, true),
  )).limit(1);

  return isExactActiveTeacherControlAssignment(assignment, {
    teacherId: teacher.id,
    schoolId: input.schoolId,
    classId: input.classId,
    subjectId: input.subjectId,
  }) ? assignment : null;
}
