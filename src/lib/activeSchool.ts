import { isLocalSchoolRole } from './localSchoolRoles';

export interface UserSchoolMembership {
  schoolId: number;
  role?: string | null;
  isActive?: boolean | null;
}

export function resolveLegacyMembershipSchool(
  memberships: UserSchoolMembership[],
  role: string,
  preferredSchoolId?: number | null,
): number | null {
  if (!isLocalSchoolRole(role)) return null;

  const roleMemberships = memberships.filter((membership) => (
    membership.role === role
  ));
  const activeSchoolIds = [...new Set(roleMemberships
    .filter((membership) => membership.isActive === true)
    .map((membership) => membership.schoolId))];
  if (activeSchoolIds.length === 1) return activeSchoolIds[0];

  if (preferredSchoolId != null) {
    return roleMemberships.some((membership) => membership.schoolId === preferredSchoolId)
      ? preferredSchoolId
      : null;
  }

  const schoolIds = [...new Set(roleMemberships.map((membership) => membership.schoolId))];
  return schoolIds.length === 1 ? schoolIds[0] : null;
}

export interface ActiveSchoolSelectionInput {
  userSchoolId?: number | null;
  memberships: UserSchoolMembership[];
  requestedSchoolId?: number | null;
  isSuperAdmin?: boolean;
}

export function resolveActiveSchoolSelection(input: ActiveSchoolSelectionInput): number | null {
  const { memberships, requestedSchoolId, isSuperAdmin, userSchoolId } = input;

  if (isSuperAdmin) {
    return requestedSchoolId ?? userSchoolId ?? null;
  }

  const available = memberships
    .map((membership) => membership.schoolId)
    .filter((schoolId): schoolId is number => typeof schoolId === 'number');

  if (requestedSchoolId != null && available.includes(requestedSchoolId)) {
    return requestedSchoolId;
  }

  const activeSchoolIds = [...new Set(memberships
    .filter((membership) => membership.isActive === true)
    .map((membership) => membership.schoolId)
    .filter((schoolId): schoolId is number => typeof schoolId === 'number'))];
  if (activeSchoolIds.length === 1) {
    return activeSchoolIds[0];
  }

  if (userSchoolId != null && available.includes(userSchoolId)) {
    return userSchoolId;
  }

  const uniqueAvailableSchoolIds = [...new Set(available)];
  return uniqueAvailableSchoolIds.length === 1 ? uniqueAvailableSchoolIds[0] : null;
}
