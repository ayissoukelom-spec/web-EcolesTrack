export interface UserSchoolMembership {
  schoolId: number;
  isActive?: boolean | null;
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

  const activeMembership = memberships.find((membership) => membership.isActive);
  if (activeMembership?.schoolId != null) {
    return activeMembership.schoolId;
  }

  if (userSchoolId != null && available.includes(userSchoolId)) {
    return userSchoolId;
  }

  return available[0] ?? null;
}
