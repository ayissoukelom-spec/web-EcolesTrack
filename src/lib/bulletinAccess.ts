import type { AuthRequest } from '../middleware/auth.ts';
import { db } from '../db/index.ts';
import { bulletins, parents, students } from '../db/schema.ts';
import { and, eq } from 'drizzle-orm';

export const isBulletinOwnedByCurrentUser = async (req: AuthRequest): Promise<boolean> => {
  const userId = req.user?.id;
  if (!userId) return false;

  const bulletinId = Number((req.params as any)?.id);
  if (!Number.isInteger(bulletinId) || bulletinId <= 0) return false;

  const [row] = await db
    .select({
      studentId: bulletins.studentId,
      parentUserId: parents.userId,
    })
    .from(bulletins)
    .innerJoin(students, eq(bulletins.studentId, students.id))
    .leftJoin(parents, eq(students.parentId, parents.id))
    .where(eq(bulletins.id, bulletinId));

  if (!row) return false;
  if (row.parentUserId === userId) return true;

  const [parentLink] = await db
    .select({ id: parents.id })
    .from(parents)
    .where(and(eq(parents.userId, userId), eq(parents.studentId, row.studentId)));

  return !!parentLink;
};
