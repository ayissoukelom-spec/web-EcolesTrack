export interface AuthSchoolFallbackContext {
  teacherSchoolId?: number | null;
  parentSchoolIds?: Array<number | null | undefined>;
}

export interface AuthActorLike {
  role?: string | null;
  id?: number | null;
  schoolId?: number | null;
}

export function getFallbackSchoolIdsForActor(actor: AuthActorLike | null | undefined, context: AuthSchoolFallbackContext = {}) {
  if (!actor) return [] as number[];

  const fallbackIds = new Set<number>();

  if (actor.schoolId != null) {
    fallbackIds.add(actor.schoolId);
  }

  if (actor.role === 'teacher' && context.teacherSchoolId != null) {
    fallbackIds.add(context.teacherSchoolId);
  }

  if (actor.role === 'parent' && Array.isArray(context.parentSchoolIds)) {
    context.parentSchoolIds.filter((id): id is number => id != null).forEach((id) => fallbackIds.add(id));
  }

  return Array.from(fallbackIds);
}
