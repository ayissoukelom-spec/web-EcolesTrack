import { db } from '../db/index.ts';
import { students, classes, classTeachers, schoolClasses, teachers } from '../db/schema.ts';
import { eq, and, inArray, sql } from 'drizzle-orm';
import { getTeacherClassIdSet } from './teacherScope.ts';

type Actor = { id?: number; role: string; schoolId?: number | null; simulated?: boolean };

export async function isApprovedClassForSchool(classId: number, targetSchoolId: number | null) {
  if (targetSchoolId == null) return false;
  const [cls] = await db.select().from(classes).where(eq(classes.id, classId));
  if (!cls) return false;
  if (cls.schoolId === targetSchoolId) return true;
  if (cls.schoolId != null) return false;
  const [schoolClass] = await db.select().from(schoolClasses).where(
    and(
      eq(schoolClasses.classId, classId),
      eq(schoolClasses.schoolId, targetSchoolId),
      eq(schoolClasses.status, 'approved'),
    ),
  );
  return !!schoolClass;
}

async function computeTeacherClassIds(actor: Actor): Promise<number[]> {
  if (!actor.id) return [];
  // Resolve teacher profile id from user id
  const [teacherRow] = await db.select({ id: teachers.id }).from(teachers).where(eq(teachers.userId, actor.id));
  if (!teacherRow) return [];
  const teacherId = teacherRow.id as number;
  const rows = await db
    .select({ classId: classTeachers.classId, schoolId: classes.schoolId })
    .from(classTeachers)
    .innerJoin(classes, eq(classTeachers.classId, classes.id))
    .where(eq(classTeachers.teacherId, teacherId));

  // Reuse shared logic from teacherScope to build class id list with same filtering rules
  const assignmentRows: Array<{ classId: number | null | undefined; schoolId?: number | null | undefined }> = (rows as any).map((r: any) => ({ classId: r.classId ?? r.class_id, schoolId: r.schoolId ?? r.school_id }));
  const currentSchoolId = actor.schoolId ?? null;
  return getTeacherClassIdSet(assignmentRows, currentSchoolId);
}

export async function getAuthorizedStudentIds(actor: Actor, opts?: { classIds?: number[] }): Promise<number[]> {
  // super_admin: full access — return all student ids (optionally filtered by classIds)
  if (actor.role === 'super_admin') {
    if (opts?.classIds && opts.classIds.length > 0) {
      const rows = await db.select({ id: students.id }).from(students).where(inArray(students.classId, opts.classIds));
      return (rows as any).map((r: any) => r.id);
    }
    const rows = await db.select({ id: students.id }).from(students);
    return (rows as any).map((r: any) => r.id);
  }

  // Non-super users: if caller provided classIds, use them; otherwise compute teacher classes
  let allowedClassIds: number[] = [];
  if (opts?.classIds && opts.classIds.length > 0) {
    allowedClassIds = opts.classIds;
  } else {
    allowedClassIds = await computeTeacherClassIds(actor);
  }

  if (!allowedClassIds || allowedClassIds.length === 0) return [];

  const actorSchoolId = actor.schoolId ?? null;
  const rows = await db.select({ id: students.id }).from(students).where(and(inArray(students.classId, allowedClassIds), eq(students.schoolId, actorSchoolId)));
  return (rows as any).map((r: any) => r.id);
}

export async function getAuthorizedStudents(actor: Actor, opts?: { classIds?: number[] }) {
  const ids = await getAuthorizedStudentIds(actor, opts);
  if (ids.length === 0) return [];
  const rows = await db.select({
    id: students.id,
    firstName: students.firstName,
    lastName: students.lastName,
    schoolId: students.schoolId,
    classId: students.classId,
    parentId: students.parentId,
    enrolledAt: students.enrolledAt,
  }).from(students).where(inArray(students.id, ids));
  return rows;
}

export async function findStudentSchoolMismatch() {
  const rows = await db.execute(sql`
    SELECT s.*, c.school_id AS class_school_id
    FROM students s
    JOIN classes c ON c.id = s.class_id
    WHERE s.school_id IS NOT NULL AND c.school_id IS NOT NULL AND s.school_id <> c.school_id
  `);
  return rows.rows ?? rows;
}

export function generateTriggerSQL() {
  return `-- Trigger function to enforce students.school_id matches classes.school_id (or class is global+approved)
CREATE OR REPLACE FUNCTION enforce_student_school_match() RETURNS trigger AS $$
DECLARE
  cls_school_id integer;
  approved boolean;
BEGIN
  SELECT school_id INTO cls_school_id FROM classes WHERE id = NEW.class_id;
  IF cls_school_id IS NOT NULL THEN
    IF NEW.school_id IS NULL OR NEW.school_id <> cls_school_id THEN
      RAISE EXCEPTION 'student.school_id must match class.school_id';
    END IF;
  ELSE
    -- class is global (school_id IS NULL): allow only if approved in school_classes
    SELECT EXISTS(SELECT 1 FROM school_classes sc WHERE sc.class_id = NEW.class_id AND sc.school_id = NEW.school_id AND sc.status = 'approved') INTO approved;
    IF NOT approved THEN
      RAISE EXCEPTION 'global class not approved for the target school';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tr_enforce_student_school_match
BEFORE INSERT OR UPDATE ON students
FOR EACH ROW EXECUTE FUNCTION enforce_student_school_match();`;
}

export default { getAuthorizedStudents, getAuthorizedStudentIds, findStudentSchoolMismatch, generateTriggerSQL };
