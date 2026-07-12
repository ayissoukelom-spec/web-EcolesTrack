import type { AuthRequest } from '../middleware/auth.ts';
import { db } from '../db/index.ts';
import { bulletins, parents, students } from '../db/schema.ts';
import { and, eq } from 'drizzle-orm';

// Core ownership check that does NOT read from `req.user`.
// Accepts an already-resolved `actor` (may be null) and a bulletinId.
export const checkBulletinOwnership = async (actor: { id?: number } | null, bulletinId: number): Promise<boolean> => {
  const userId = actor?.id;
  if (!userId) return false;
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

// Compatibility wrapper: given a resolveActor(req) function, return a resolver
// compatible with `requireOwnership(resolver)` which expects `(req) => Promise<boolean>`.
export const isBulletinOwnedByCurrentUser = (resolveActor: (req: AuthRequest) => Promise<any>) => {
  return async (req: AuthRequest): Promise<boolean> => {
    const bulletinId = Number((req.params as any)?.id);
    const actor = await resolveActor(req);
    return checkBulletinOwnership(actor, bulletinId);
  };
};
