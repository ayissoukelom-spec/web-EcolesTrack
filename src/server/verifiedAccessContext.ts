import type { LocalSchoolRole } from '../lib/localSchoolRoles.ts';

declare const verifiedAccessContextBrand: unique symbol;

interface VerifiedAccessContextBase {
  readonly [verifiedAccessContextBrand]: true;
  readonly identity: {
    readonly userId: number;
  };
}

export interface VerifiedLocalAccessContext extends VerifiedAccessContextBase {
  readonly kind: 'local';
  readonly active: {
    readonly schoolId: number;
    readonly role: LocalSchoolRole;
  };
  readonly membershipId: number;
}

export interface VerifiedGlobalAccessContext extends VerifiedAccessContextBase {
  readonly kind: 'global';
  readonly globalRole: 'super_admin';
}

export type VerifiedAccessContext =
  | VerifiedLocalAccessContext
  | VerifiedGlobalAccessContext;
