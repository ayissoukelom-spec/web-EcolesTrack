import type { LocalSchoolRole } from './localSchoolRoles.ts';

export interface LocalSchoolMembership {
  membershipId: number;
  userId: number;
  schoolId: number;
  role: LocalSchoolRole;
  status: 'active' | 'revoked';
}

export interface SchoolContextSelectionRequest {
  schoolId: number;
}

export interface SpaceContextSelectionRequest {
  role: LocalSchoolRole;
}

export interface GrantLocalSchoolMembershipRequest {
  schoolId: number;
  role: LocalSchoolRole;
}
