import type { LocalSchoolMembership } from '../lib/localSchoolMembershipContracts.ts';
import type { ServerAccessSession, SessionValidationResult } from './accessContextValidation.ts';
import {
  validateAccessSession,
  validateGlobalSuperAdminAccess,
  validateLocalMembership,
} from './accessContextValidation.ts';
import type {
  AccessLifecycleSession,
  ServerResolvedContextAuthorization,
  SessionLifecycleFailureReason,
} from './accessSessionLifecycle.ts';
import { isValidAccessLifecycleSession } from './accessSessionLifecycle.ts';
import type { VerifiedAccessContext } from './verifiedAccessContext.ts';

/** User-wide revocation generations remain server-side and are not JWT claims. */
export interface AccessJwtClaims {
  readonly sub: string;
  readonly sid: string;
  readonly cv: number;
  readonly jti: string;
  readonly iat: number;
  readonly exp: number;
  readonly iss: string;
  readonly aud: string | readonly string[];
}

export interface AccessJwtValidationOptions {
  readonly issuer: string;
  readonly audience: string;
  readonly nowEpochSeconds: number;
}

export type AccessJwtValidationResult =
  | { readonly valid: true; readonly claims: AccessJwtClaims }
  | {
      readonly valid: false;
      readonly reason:
        | 'invalid_shape'
        | 'invalid_identity'
        | 'invalid_session_id'
        | 'invalid_context_version'
        | 'invalid_token_id'
        | 'invalid_timestamps'
        | 'expired_token'
        | 'invalid_issuer'
        | 'invalid_audience'
        | 'untrusted_authority_claim';
    };

export type AccessSessionContextResult =
  | { readonly allowed: true; readonly context: VerifiedAccessContext | null }
  | {
      readonly allowed: false;
      readonly status: 401 | 403 | 409;
      readonly code:
        | 'ACCESS_SESSION_INVALID'
        | 'ACCESS_SESSION_EXPIRED'
        | 'ACCESS_SESSION_REVOKED'
        | 'ACCESS_SESSION_IDENTITY_MISMATCH'
        | 'CONTEXT_VERSION_STALE'
        | 'ACCESS_CONTEXT_REQUIRED'
        | 'ACCESS_MEMBERSHIP_NOT_FOUND'
        | 'ACCESS_MEMBERSHIP_INACTIVE'
        | 'ACCESS_GLOBAL_ROLE_INVALID';
    };

export interface AccessAuthError {
  readonly status: 401 | 403 | 409;
  readonly code:
    | 'ACCESS_TOKEN_INVALID'
    | 'ACCESS_SESSION_NOT_FOUND'
    | 'ACCESS_SESSION_INVALID'
    | 'ACCESS_SESSION_EXPIRED'
    | 'ACCESS_SESSION_REVOKED'
    | 'ACCESS_SESSION_IDENTITY_MISMATCH'
    | 'CONTEXT_VERSION_STALE'
    | 'ACCESS_CONTEXT_REQUIRED'
    | 'ACCESS_MEMBERSHIP_NOT_FOUND'
    | 'ACCESS_MEMBERSHIP_INACTIVE'
    | 'ACCESS_GLOBAL_ROLE_INVALID';
}

type AccessContextAuthError = {
  readonly status: 401 | 403 | 409;
  readonly code: Extract<AccessSessionContextResult, { readonly allowed: false }>['code'];
};

export const DEFAULT_ACCESS_JWT_ISSUER = 'ecoletrack-web';
export const DEFAULT_ACCESS_JWT_AUDIENCE = 'ecoletrack-web-api';

const REQUIRED_CLAIMS = [
  'aud',
  'cv',
  'exp',
  'iat',
  'iss',
  'jti',
  'sid',
  'sub',
] as const;

const AUTHORITY_CLAIMS = new Set([
  'role',
  'appRole',
  'schoolId',
  'membershipId',
  'permissions',
]);

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function isNonEmptyIdentifier(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.trim() === value
    && value.length <= 256;
}

function isAudience(value: unknown, expectedAudience: string): value is string | string[] {
  if (typeof value === 'string') return value === expectedAudience;
  return Array.isArray(value)
    && value.length > 0
    && value.every((entry) => typeof entry === 'string' && entry.length > 0)
    && value.includes(expectedAudience);
}

/**
 * Validates the decoded payload after cryptographic signature verification.
 * The allowlist intentionally excludes role, school, membership and permission claims.
 */
export function validateAccessJwtClaims(
  payload: unknown,
  options: AccessJwtValidationOptions,
): AccessJwtValidationResult {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { valid: false, reason: 'invalid_shape' };
  }

  const record = payload as Record<string, unknown>;
  if (Object.keys(record).some((key) => AUTHORITY_CLAIMS.has(key))) {
    return { valid: false, reason: 'untrusted_authority_claim' };
  }
  if (
    Object.keys(record).length !== REQUIRED_CLAIMS.length
    || REQUIRED_CLAIMS.some((claim) => !Object.hasOwn(record, claim))
  ) {
    return { valid: false, reason: 'invalid_shape' };
  }

  if (
    typeof record.sub !== 'string'
    || !/^[1-9]\d*$/.test(record.sub)
    || !Number.isSafeInteger(Number(record.sub))
  ) {
    return { valid: false, reason: 'invalid_identity' };
  }
  if (!isNonEmptyIdentifier(record.sid)) {
    return { valid: false, reason: 'invalid_session_id' };
  }
  if (!Number.isSafeInteger(record.cv) || (record.cv as number) < 0) {
    return { valid: false, reason: 'invalid_context_version' };
  }
  if (!isNonEmptyIdentifier(record.jti)) {
    return { valid: false, reason: 'invalid_token_id' };
  }
  if (
    !isPositiveSafeInteger(record.iat)
    || !isPositiveSafeInteger(record.exp)
    || (record.exp as number) <= (record.iat as number)
    || !isPositiveSafeInteger(options.nowEpochSeconds)
  ) {
    return { valid: false, reason: 'invalid_timestamps' };
  }
  if ((record.iat as number) > options.nowEpochSeconds || (record.exp as number) <= options.nowEpochSeconds) {
    return { valid: false, reason: 'expired_token' };
  }
  if (typeof options.issuer !== 'string' || !options.issuer || record.iss !== options.issuer) {
    return { valid: false, reason: 'invalid_issuer' };
  }
  if (
    typeof options.audience !== 'string'
    || !options.audience
    || !isAudience(record.aud, options.audience)
  ) {
    return { valid: false, reason: 'invalid_audience' };
  }

  return {
    valid: true,
    claims: {
      sub: record.sub,
      sid: record.sid as string,
      cv: record.cv as number,
      jti: record.jti as string,
      iat: record.iat as number,
      exp: record.exp as number,
      iss: record.iss as string,
      aud: record.aud as string | string[],
    },
  };
}

export function validateAccessJwtSession(input: {
  readonly claims: AccessJwtClaims;
  readonly session: AccessLifecycleSession;
  readonly nowEpochSeconds: number;
  readonly authorization?: ServerResolvedContextAuthorization;
}): AccessSessionContextResult {
  if (!isValidAccessLifecycleSession(input.session)) {
    return { allowed: false, status: 401, code: 'ACCESS_SESSION_INVALID' };
  }
  if (input.session.status === 'expired') {
    return { allowed: false, status: 401, code: 'ACCESS_SESSION_EXPIRED' };
  }
  const result = validateAccessSession({
    identity: { userId: Number(input.claims.sub) },
    session: {
      sessionId: input.session.sessionId,
      userId: input.session.userId,
      status: input.session.status,
      contextVersion: input.session.contextVersion,
      expiresAtEpochMs: input.session.expiresAtEpochMs,
    },
    claims: {
      userId: Number(input.claims.sub),
      sessionId: input.claims.sid,
      contextVersion: input.claims.cv,
    },
    nowEpochMs: input.nowEpochSeconds * 1000,
  });
  if (result.valid === false) {
    return { allowed: false, ...mapSessionFailure(result.reason) };
  }

  if (input.session.context === null) return { allowed: true, context: null };
  if (!input.authorization) {
    return input.session.context.kind === 'local'
      ? { allowed: false, status: 403, code: 'ACCESS_MEMBERSHIP_NOT_FOUND' }
      : { allowed: false, status: 403, code: 'ACCESS_GLOBAL_ROLE_INVALID' };
  }
  const contextFailure = validateServerResolvedContext({
    userId: Number(input.claims.sub),
    context: input.session.context,
    authorization: input.authorization,
  });
  if (contextFailure) return { allowed: false, ...mapContextFailure(contextFailure) };
  return { allowed: true, context: input.session.context };
}

export function requireVerifiedAccessContext(
  session: AccessLifecycleSession,
  routeRequiresContext: boolean,
): AccessSessionContextResult {
  if (session.status === 'revoked') {
    return { allowed: false, status: 401, code: 'ACCESS_SESSION_REVOKED' };
  }
  if (session.status === 'expired') {
    return { allowed: false, status: 401, code: 'ACCESS_SESSION_EXPIRED' };
  }
  if (routeRequiresContext && session.context === null) {
    return { allowed: false, status: 403, code: 'ACCESS_CONTEXT_REQUIRED' };
  }
  return { allowed: true, context: session.context };
}

export function mapAccessSessionFailure(
  reason: SessionLifecycleFailureReason | 'session_not_found' | 'invalid_token' | 'stale_context',
): AccessAuthError {
  if (reason === 'session_not_found') return { status: 401, code: 'ACCESS_SESSION_NOT_FOUND' };
  if (reason === 'invalid_token') return { status: 401, code: 'ACCESS_TOKEN_INVALID' };
  if (reason === 'stale_context') return mapSessionFailure(reason);
  if (
    reason === 'expired_session'
    || reason === 'revoked_session'
    || reason === 'identity_mismatch'
    || reason === 'session_mismatch'
    || reason === 'invalid_session'
  ) {
    return mapSessionFailure(reason);
  }
  if (reason === 'version_conflict') return mapSessionFailure('stale_context');
  return mapContextFailure(reason);
}

function mapSessionFailure(
  reason: Extract<SessionValidationResult, { readonly valid: false }>['reason'],
): AccessContextAuthError {
  switch (reason) {
    case 'expired_session':
      return { status: 401, code: 'ACCESS_SESSION_EXPIRED' };
    case 'revoked_session':
      return { status: 401, code: 'ACCESS_SESSION_REVOKED' };
    case 'identity_mismatch':
    case 'session_mismatch':
      return { status: 401, code: 'ACCESS_SESSION_IDENTITY_MISMATCH' };
    case 'stale_context':
      return { status: 409, code: 'CONTEXT_VERSION_STALE' };
    default:
      return { status: 401, code: 'ACCESS_SESSION_INVALID' };
  }
}

function validateServerResolvedContext(input: {
  readonly userId: number;
  readonly context: VerifiedAccessContext;
  readonly authorization: ServerResolvedContextAuthorization;
}): SessionLifecycleFailureReason | null {
  const { context, authorization } = input;
  if (context.identity.userId !== input.userId) return 'identity_mismatch';

  if (context.kind === 'local') {
    if (authorization.kind !== 'local') {
      return authorization.kind === 'global' ? 'unauthorized_context' : 'missing_membership';
    }
    const membership: LocalSchoolMembership | null | undefined = authorization.membership;
    const result = validateLocalMembership({
      identity: { userId: input.userId },
      schoolSelection: { schoolId: context.active.schoolId },
      spaceSelection: { role: context.active.role },
      expectedMembershipId: context.membershipId,
      membership,
    });
    return result.valid === false ? result.reason : null;
  }

  if (authorization.kind !== 'global') return 'unauthorized_context';
  const globalResult = validateGlobalSuperAdminAccess({
    identity: { userId: input.userId },
    serverResolvedGlobalRole: authorization.serverResolvedGlobalRole,
  });
  return globalResult.valid ? null : 'not_super_admin';
}

function mapContextFailure(reason: SessionLifecycleFailureReason): AccessContextAuthError {
  if (reason === 'inactive_membership') {
    return { status: 403, code: 'ACCESS_MEMBERSHIP_INACTIVE' };
  }
  if (reason === 'missing_membership') {
    return { status: 403, code: 'ACCESS_MEMBERSHIP_NOT_FOUND' };
  }
  if (reason === 'identity_mismatch') {
    return { status: 401, code: 'ACCESS_SESSION_IDENTITY_MISMATCH' };
  }
  if (reason === 'not_super_admin') {
    return { status: 403, code: 'ACCESS_GLOBAL_ROLE_INVALID' };
  }
  return { status: 403, code: 'ACCESS_SESSION_INVALID' };
}
