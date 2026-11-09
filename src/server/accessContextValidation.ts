import type {
  LocalSchoolMembership,
  SchoolContextSelectionRequest,
  SpaceContextSelectionRequest,
} from '../lib/localSchoolMembershipContracts.ts';
import { isLocalSchoolRole } from '../lib/localSchoolRoles.ts';

export interface AuthenticatedIdentity {
  readonly userId: number;
}

/** A canonical non-negative decimal generation; strings avoid integer precision loss. */
export type AccessSessionGeneration = string;

export interface GenerationBoundAuthenticatedIdentity extends AuthenticatedIdentity {
  readonly expectedGeneration: AccessSessionGeneration;
}

export interface ServerAccessSession {
  readonly sessionId: string;
  readonly userId: number;
  readonly status: 'active' | 'expired' | 'revoked';
  readonly contextVersion: number;
  readonly expiresAtEpochMs: number;
}

export interface GenerationBoundServerAccessSession extends ServerAccessSession {
  readonly observedGeneration: AccessSessionGeneration;
}

export interface AccessSessionClaims {
  readonly sessionId: string;
  readonly userId: number;
  readonly contextVersion: number;
}

export type AccessSessionGenerationValidationResult =
  | { readonly valid: true; readonly generation: AccessSessionGeneration }
  | {
      readonly valid: false;
      readonly reason: 'invalid_generation' | 'stale_generation';
    };

export type AccessSessionGenerationIncrementResult =
  | { readonly ok: true; readonly generation: AccessSessionGeneration }
  | { readonly ok: false; readonly reason: 'invalid_generation' | 'generation_exhausted' };

export type MembershipValidationResult =
  | { readonly valid: true; readonly membership: LocalSchoolMembership }
  | {
      readonly valid: false;
      readonly reason:
        | 'missing_membership'
        | 'invalid_membership'
        | 'inactive_membership'
        | 'identity_mismatch'
        | 'school_mismatch'
        | 'role_mismatch'
        | 'membership_mismatch'
        | 'invalid_selection';
    };

export type SessionValidationResult =
  | { readonly valid: true }
  | {
      readonly valid: false;
      readonly reason:
        | 'invalid_session'
        | 'revoked_session'
        | 'expired_session'
        | 'identity_mismatch'
        | 'session_mismatch'
        | 'stale_context';
    };

export type GenerationBoundSessionValidationResult =
  | SessionValidationResult
  | {
      readonly valid: false;
      readonly reason: 'invalid_generation' | 'stale_generation';
    };

const MAX_ACCESS_SESSION_GENERATION = '9223372036854775807';

export function isAccessSessionGeneration(value: unknown): value is AccessSessionGeneration {
  return typeof value === 'string'
    && /^(?:0|[1-9]\d*)$/.test(value)
    && value.length <= MAX_ACCESS_SESSION_GENERATION.length
    && (
      value.length < MAX_ACCESS_SESSION_GENERATION.length
      || value <= MAX_ACCESS_SESSION_GENERATION
    );
}

export function validateAccessSessionGeneration(input: {
  readonly observedGeneration: unknown;
  readonly currentGeneration: unknown;
}): AccessSessionGenerationValidationResult {
  if (
    !isAccessSessionGeneration(input.observedGeneration)
    || !isAccessSessionGeneration(input.currentGeneration)
  ) {
    return { valid: false, reason: 'invalid_generation' };
  }
  if (input.observedGeneration !== input.currentGeneration) {
    return { valid: false, reason: 'stale_generation' };
  }
  return { valid: true, generation: input.observedGeneration };
}

export function incrementAccessSessionGeneration(
  currentGeneration: unknown,
): AccessSessionGenerationIncrementResult {
  if (!isAccessSessionGeneration(currentGeneration)) {
    return { ok: false, reason: 'invalid_generation' };
  }
  if (currentGeneration === MAX_ACCESS_SESSION_GENERATION) {
    return { ok: false, reason: 'generation_exhausted' };
  }
  return {
    ok: true,
    generation: (BigInt(currentGeneration) + 1n).toString(),
  };
}

export type GlobalAccessValidationResult =
  | { readonly valid: true }
  | { readonly valid: false; readonly reason: 'invalid_identity' | 'not_super_admin' };

function isPositiveSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

export function validateLocalMembership(input: {
  readonly identity: AuthenticatedIdentity | null | undefined;
  readonly schoolSelection: SchoolContextSelectionRequest | null | undefined;
  readonly spaceSelection: SpaceContextSelectionRequest | null | undefined;
  readonly expectedMembershipId: number;
  readonly membership: LocalSchoolMembership | null | undefined;
}): MembershipValidationResult {
  const {
    identity,
    schoolSelection,
    spaceSelection,
    expectedMembershipId,
    membership,
  } = input;

  if (!identity || !schoolSelection || !spaceSelection) {
    return { valid: false, reason: 'invalid_selection' };
  }
  if (!membership) return { valid: false, reason: 'missing_membership' };
  if (membership.status !== 'active') return { valid: false, reason: 'inactive_membership' };
  if (
    !isPositiveSafeInteger(expectedMembershipId)
    || !isPositiveSafeInteger(membership.membershipId)
  ) {
    return { valid: false, reason: 'invalid_selection' };
  }
  if (
    !isPositiveSafeInteger(membership.userId)
    || !isPositiveSafeInteger(membership.schoolId)
    || !isLocalSchoolRole(membership.role)
  ) {
    return { valid: false, reason: 'invalid_membership' };
  }
  if (!isPositiveSafeInteger(identity.userId)) {
    return { valid: false, reason: 'invalid_selection' };
  }
  if (
    !isPositiveSafeInteger(schoolSelection.schoolId)
    || !isLocalSchoolRole(spaceSelection.role)
  ) {
    return { valid: false, reason: 'invalid_selection' };
  }
  if (membership.userId !== identity.userId) {
    return { valid: false, reason: 'identity_mismatch' };
  }
  if (membership.schoolId !== schoolSelection.schoolId) {
    return { valid: false, reason: 'school_mismatch' };
  }
  if (membership.role !== spaceSelection.role) {
    return { valid: false, reason: 'role_mismatch' };
  }
  if (membership.membershipId !== expectedMembershipId) {
    return { valid: false, reason: 'membership_mismatch' };
  }

  return { valid: true, membership };
}

export function validateAccessSession(input: {
  readonly identity: AuthenticatedIdentity | null | undefined;
  readonly session: ServerAccessSession | null | undefined;
  readonly claims: AccessSessionClaims | null | undefined;
  readonly nowEpochMs: number;
}): SessionValidationResult {
  const { identity, session, claims, nowEpochMs } = input;

  if (!identity || !session || !claims) {
    return { valid: false, reason: 'invalid_session' };
  }
  if (
    !isPositiveSafeInteger(identity.userId)
    || !isPositiveSafeInteger(session.userId)
    || !isPositiveSafeInteger(claims.userId)
    || !session.sessionId
    || !claims.sessionId
    || !Number.isSafeInteger(session.contextVersion)
    || session.contextVersion < 0
    || !Number.isSafeInteger(claims.contextVersion)
    || claims.contextVersion < 0
    || !Number.isFinite(session.expiresAtEpochMs)
    || !Number.isFinite(nowEpochMs)
  ) {
    return { valid: false, reason: 'invalid_session' };
  }
  if (session.status === 'revoked') return { valid: false, reason: 'revoked_session' };
  if (session.status === 'expired') return { valid: false, reason: 'expired_session' };
  if (session.expiresAtEpochMs <= nowEpochMs) {
    return { valid: false, reason: 'expired_session' };
  }
  if (session.userId !== identity.userId || claims.userId !== identity.userId) {
    return { valid: false, reason: 'identity_mismatch' };
  }
  if (session.sessionId !== claims.sessionId) {
    return { valid: false, reason: 'session_mismatch' };
  }
  if (session.contextVersion !== claims.contextVersion) {
    return { valid: false, reason: 'stale_context' };
  }

  return { valid: true };
}

export function validateGenerationBoundAccessSession(input: {
  readonly identity: AuthenticatedIdentity | null | undefined;
  readonly session: GenerationBoundServerAccessSession | null | undefined;
  readonly claims: AccessSessionClaims | null | undefined;
  readonly currentGeneration: unknown;
  readonly nowEpochMs: number;
}): GenerationBoundSessionValidationResult {
  const sessionValidation = validateAccessSession({
    identity: input.identity,
    session: input.session,
    claims: input.claims,
    nowEpochMs: input.nowEpochMs,
  });
  if (sessionValidation.valid === false) return sessionValidation;

  const generationValidation = validateAccessSessionGeneration({
    observedGeneration: input.session?.observedGeneration,
    currentGeneration: input.currentGeneration,
  });
  return generationValidation.valid === true
    ? { valid: true }
    : { valid: false, reason: generationValidation.reason };
}

export function validateGlobalSuperAdminAccess(input: {
  readonly identity: AuthenticatedIdentity | null | undefined;
  readonly serverResolvedGlobalRole: unknown;
}): GlobalAccessValidationResult {
  if (!input.identity || !isPositiveSafeInteger(input.identity.userId)) {
    return { valid: false, reason: 'invalid_identity' };
  }
  if (input.serverResolvedGlobalRole !== 'super_admin') {
    return { valid: false, reason: 'not_super_admin' };
  }

  return { valid: true };
}
