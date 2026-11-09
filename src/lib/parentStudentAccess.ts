import { and, eq, sql } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { parents, schools, students, userSchools } from '../db/schema.ts';

export async function getParentChildStudentIds(
  userId: number | null | undefined,
  schoolId: number | null | undefined,
): Promise<number[]> {
  if (userId == null || schoolId == null) return [];

  const [school] = await db.select({ id: schools.id })
    .from(schools)
    .where(eq(schools.id, schoolId))
    .limit(1);
  if (!school) return [];

  const [membership] = await db.select({ id: userSchools.id })
    .from(userSchools)
    .where(and(
      eq(userSchools.userId, userId),
      eq(userSchools.schoolId, schoolId),
      eq(userSchools.role, 'parent'),
      sql`${userSchools.isActive} IS DISTINCT FROM FALSE`,
    ));
  if (!membership) return [];

  const parentRows = await db.select({ id: parents.id, schoolId: parents.schoolId })
    .from(parents)
    .where(and(
      eq(parents.userId, userId),
      eq(parents.schoolId, schoolId),
    ));
  const childIds = new Set<number>();

  for (const parent of parentRows) {
    const linkedStudents = await db.select({ id: students.id })
      .from(students)
      .where(and(
        eq(students.parentId, parent.id),
        eq(students.schoolId, schoolId),
      ));

    for (const student of linkedStudents) childIds.add(student.id);
  }

  return Array.from(childIds);
}