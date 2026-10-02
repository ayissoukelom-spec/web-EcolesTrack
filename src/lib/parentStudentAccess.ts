import { and, eq } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { parents, students } from '../db/schema.ts';

export async function getParentChildStudentIds(userId: number | null | undefined): Promise<number[]> {
  if (userId == null) return [];

  const parentRows = await db.select({ id: parents.id, schoolId: parents.schoolId })
    .from(parents)
    .where(eq(parents.userId, userId));
  const childIds = new Set<number>();

  for (const parent of parentRows) {
    if (parent.schoolId == null) continue;

    const linkedStudents = await db.select({ id: students.id })
      .from(students)
      .where(and(
        eq(students.parentId, parent.id),
        eq(students.schoolId, parent.schoolId),
      ));

    for (const student of linkedStudents) childIds.add(student.id);
  }

  return Array.from(childIds);
}