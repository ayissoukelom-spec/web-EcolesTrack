export const LOCAL_SCHOOL_ROLES = [
  'parent',
  'teacher',
  'school_admin',
  'surveillant',
] as const;

export type LocalSchoolRole = (typeof LOCAL_SCHOOL_ROLES)[number];

export function isLocalSchoolRole(value: unknown): value is LocalSchoolRole {
  return typeof value === 'string'
    && LOCAL_SCHOOL_ROLES.some((role) => role === value);
}

export function canGrantUserFunction(input: {
  actorId: number;
  actorRole: string;
  actorSchoolId: number | null;
  targetUserId: number;
  targetSchoolId: number | null;
  role: unknown;
}): boolean {
  if (
    !Number.isSafeInteger(input.actorId) || input.actorId <= 0
    || !Number.isSafeInteger(input.targetUserId) || input.targetUserId <= 0
  ) return false;

  if (input.role === 'super_admin') {
    return input.actorRole === 'super_admin' && input.targetSchoolId === null;
  }
  if (!isLocalSchoolRole(input.role) || input.targetSchoolId == null) return false;
  if (input.actorRole === 'super_admin') return true;
  return input.actorRole === 'school_admin'
    && input.actorSchoolId != null
    && input.actorSchoolId === input.targetSchoolId
    && input.actorId !== input.targetUserId
    && ['parent', 'teacher', 'surveillant'].includes(input.role);
}
