import type { LocalSchoolMembership } from '../lib/localSchoolMembershipContracts.ts';
import { isLocalSchoolRole } from '../lib/localSchoolRoles.ts';
import type {
  AccessSessionClaims,
  AccessSessionGeneration,
  AuthenticatedIdentity,
  ServerAccessSession,
} from './accessContextValidation.ts';
import {
  isAccessSessionGeneration,
  validateAccessSession,
  validateGlobalSuperAdminAccess,
  validateLocalMembership,
} from './accessContextValidation.ts';
import type {
  VerifiedAccessContext,
  VerifiedGlobalAccessContext,
  VerifiedLocalAccessContext,
} from './verifiedAccessContext.ts';

export interface AccessLifecycleSession extends Omit<ServerAccessSession, 'status'> {
  readonly status: 'active' | 'revoked' | 'expired';
  readonly context: VerifiedAccessContext | null;
}

export interface GenerationBoundAccessLifecycleSession extends AccessLifecycleSession {
  readonly observedGeneration: AccessSessionGeneration;
}

export function copyAccessContext(
  context: VerifiedAccessContext | null,
): VerifiedAccessContext | null {
  if (context === null) return null;
  if (context.kind === 'local') {
    return {
      kind: 'local',
      identity: { userId: context.identity.userId },
      active: {
        schoolId: context.active.schoolId,
        role: context.active.role,
      },
      membershipId: context.membershipId,
    } as VerifiedLocalAccessContext;
  }
  return {
    kind: 'global',
    identity: { userId: context.identity.userId },
    globalRole: context.globalRole,
  } as VerifiedGlobalAccessContext;
}

export function copyAccessLifecycleSession(
  session: AccessLifecycleSession,
): AccessLifecycleSession {
  return {
    sessionId: session.sessionId,
    userId: session.userId,
    status: session.status,
    contextVersion: session.contextVersion,
    expiresAtEpochMs: session.expiresAtEpochMs,
    context: copyAccessContext(session.context),
  };
}

export function copyGenerationBoundAccessLifecycleSession(
  session: GenerationBoundAccessLifecycleSession,
): GenerationBoundAccessLifecycleSession {
  return {
    ...copyAccessLifecycleSession(session),
    observedGeneration: session.observedGeneration,
  };
}

export function isValidGenerationBoundAccessLifecycleSession(
  value: unknown,
): value is GenerationBoundAccessLifecycleSession {
  return isValidAccessLifecycleSession(value)
    && isAccessSessionGeneration(
      (value as GenerationBoundAccessLifecycleSession).observedGeneration,
    );
}

export type SessionLifecycleFailureReason =
  | 'invalid_session'
  | 'revoked_session'
  | 'expired_session'
  | 'identity_mismatch'
  | 'session_mismatch'
  | 'version_conflict'
  | 'invalid_context'
  | 'unauthorized_context'
  | 'invalid_identity'
  | 'not_super_admin'
  | 'missing_membership'
  | 'invalid_membership'
  | 'inactive_membership'
  | 'school_mismatch'
  | 'role_mismatch'
  | 'membership_mismatch'
  | 'invalid_selection'
  | 'version_exhausted'
  | 'not_expired';

export type SessionCreationResult =
  | { readonly ok: true; readonly session: AccessLifecycleSession }
  | { readonly ok: false; readonly reason: 'invalid_session' };

export type SessionOperationResult =
  | { readonly ok: true; readonly session: AccessLifecycleSession }
  | { readonly ok: false; readonly reason: SessionLifecycleFailureReason };

export type IdempotentSessionRevocationResult =
  | { readonly status: 'revoked'; readonly session: AccessLifecycleSession }
  | { readonly status: 'already_revoked' }
  | { readonly status: 'already_expired' }
  | { readonly status: 'not_found' }
  | { readonly status: 'identity_mismatch' }
  | { readonly status: 'invalid_session' };

export type ContextTransitionResult =
  | {
      readonly ok: true;
      readonly changed: boolean;
      readonly session: AccessLifecycleSession;
    }
  | { readonly ok: false; readonly reason: SessionLifecycleFailureReason };

/** These values must come from server-side resolution, never from a client selection. */
export type ServerResolvedContextAuthorization =
  | {
      readonly kind: 'local';
      readonly membership: LocalSchoolMembership | null | undefined;
    }
  | {
      readonly kind: 'global';
      readonly serverResolvedGlobalRole: unknown;
    };

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function isSafeEpoch(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value);
}

function isValidContext(
  context: unknown,
  userId: number,
): context is VerifiedAccessContext | null {
  if (context === null) return true;
  if (!context || typeof context !== 'object') return false;

  const candidate = context as VerifiedAccessContext;
  if (!candidate.identity || candidate.identity.userId !== userId) return false;

  if (candidate.kind === 'local') {
    const local = candidate as VerifiedLocalAccessContext;
    return isPositiveSafeInteger(local.active?.schoolId)
      && isLocalSchoolRole(local.active?.role)
      && isPositiveSafeInteger(local.membershipId);
  }

  if (candidate.kind === 'global') {
    const global = candidate as VerifiedGlobalAccessContext;
    return global.globalRole === 'super_admin';
  }

  return false;
}

export function isValidAccessLifecycleSession(value: unknown): value is AccessLifecycleSession {
  if (!value || typeof value !== 'object') return false;

  const session = value as AccessLifecycleSession;
  return typeof session.sessionId === 'string'
    && session.sessionId.trim().length > 0
    && isPositiveSafeInteger(session.userId)
    && (
      session.status === 'active'
      || session.status === 'revoked'
      || session.status === 'expired'
    )
    && Number.isSafeInteger(session.contextVersion)
    && session.contextVersion >= 0
    && isSafeEpoch(session.expiresAtEpochMs)
    && isValidContext(session.context, session.userId);
}

function validateActiveSession(input: {
  readonly identity: AuthenticatedIdentity | null | undefined;
  readonly session: AccessLifecycleSession | null | undefined;
  readonly claims: AccessSessionClaims | null | undefined;
  readonly nowEpochMs: number;
}): SessionLifecycleFailureReason | null {
  const { identity, session, claims, nowEpochMs } = input;

  if (!identity || !isPositiveSafeInteger(identity.userId)) {
    return 'invalid_identity';
  }
  if (!isSafeEpoch(nowEpochMs)) return 'invalid_session';
  if (!isValidAccessLifecycleSession(session)) return 'invalid_session';
  if (session.status === 'revoked') return 'revoked_session';
  if (session.status === 'expired') return 'expired_session';

  const result = validateAccessSession({
    identity,
    session: {
      sessionId: session.sessionId,
      userId: session.userId,
      status: 'active',
      contextVersion: session.contextVersion,
      expiresAtEpochMs: session.expiresAtEpochMs,
    },
    claims,
    nowEpochMs,
  });
  if (result.valid === true) return null;
  return result.reason === 'stale_context' ? 'version_conflict' : result.reason;
}

function areContextsEqual(
  left: VerifiedAccessContext | null,
  right: VerifiedAccessContext,
): boolean {
  if (left === null || left.kind !== right.kind) return false;

  if (left.kind === 'local' && right.kind === 'local') {
    return left.identity.userId === right.identity.userId
      && left.active.schoolId === right.active.schoolId
      && left.active.role === right.active.role
      && left.membershipId === right.membershipId;
  }

  return left.kind === 'global'
    && right.kind === 'global'
    && left.identity.userId === right.identity.userId
    && left.globalRole === right.globalRole;
}

function authorizeTargetContext(input: {
  readonly identity: AuthenticatedIdentity;
  readonly targetContext: VerifiedAccessContext;
  readonly authorization: ServerResolvedContextAuthorization;
}): SessionLifecycleFailureReason | null {
  const { identity, targetContext, authorization } = input;

  if (
    !targetContext
    || !targetContext.identity
    || !isPositiveSafeInteger(targetContext.identity.userId)
    || !isValidContext(targetContext, targetContext.identity.userId)
  ) {
    return 'invalid_context';
  }
  if (targetContext.identity.userId !== identity.userId) return 'identity_mismatch';

  if (targetContext.kind === 'local') {
    if (authorization.kind !== 'local') return 'unauthorized_context';
    const validation = validateLocalMembership({
      identity,
      schoolSelection: { schoolId: targetContext.active.schoolId },
      spaceSelection: { role: targetContext.active.role },
      expectedMembershipId: targetContext.membershipId,
      membership: authorization.membership,
    });
    return validation.valid === true ? null : validation.reason;
  }

  if (authorization.kind !== 'global') return 'unauthorized_context';
  const validation = validateGlobalSuperAdminAccess({
    identity,
    serverResolvedGlobalRole: authorization.serverResolvedGlobalRole,
  });
  return validation.valid === true ? null : validation.reason;
}

export function createAccessSession(input: {
  readonly sessionId: string;
  readonly userId: number;
  readonly expiresAtEpochMs: number;
  readonly nowEpochMs: number;
}): SessionCreationResult {
  const { sessionId, userId, expiresAtEpochMs, nowEpochMs } = input;
  if (
    typeof sessionId !== 'string'
    || sessionId.trim().length === 0
    || !isPositiveSafeInteger(userId)
    || !isSafeEpoch(expiresAtEpochMs)
    || !isSafeEpoch(nowEpochMs)
    || expiresAtEpochMs <= nowEpochMs
  ) {
    return { ok: false, reason: 'invalid_session' };
  }

  return {
    ok: true,
    session: {
      sessionId,
      userId,
      status: 'active',
      contextVersion: 0,
      expiresAtEpochMs,
      context: null,
    },
  };
}

/** Computes a proposed state; persistence requires an atomic session-version check. */
export function transitionAccessSessionContext(input: {
  readonly identity: AuthenticatedIdentity | null | undefined;
  readonly session: AccessLifecycleSession | null | undefined;
  readonly claims: AccessSessionClaims | null | undefined;
  readonly targetContext: VerifiedAccessContext;
  readonly authorization: ServerResolvedContextAuthorization;
  readonly nowEpochMs: number;
}): ContextTransitionResult {
  const { identity, session, claims, targetContext, authorization, nowEpochMs } = input;
  const sessionFailure = validateActiveSession({ identity, session, claims, nowEpochMs });
  if (sessionFailure) return { ok: false, reason: sessionFailure };
  if (!isValidAccessLifecycleSession(session)) return { ok: false, reason: 'invalid_session' };
  if (!identity) return { ok: false, reason: 'invalid_identity' };

  const authorizationFailure = authorizeTargetContext({
    identity,
    targetContext,
    authorization,
  });
  if (authorizationFailure) return { ok: false, reason: authorizationFailure };
  if (areContextsEqual(session.context, targetContext)) {
    return { ok: true, changed: false, session: copyAccessLifecycleSession(session) };
  }
  if (!Number.isSafeInteger(session.contextVersion + 1)) {
    return { ok: false, reason: 'version_exhausted' };
  }

  return {
    ok: true,
    changed: true,
    session: {
      ...session,
      context: copyAccessContext(targetContext),
      contextVersion: session.contextVersion + 1,
    },
  };
}

function terminateAccessSession(
  session: AccessLifecycleSession | null | undefined,
  nowEpochMs: number,
): SessionOperationResult {
  if (!isSafeEpoch(nowEpochMs) || !isValidAccessLifecycleSession(session)) {
    return { ok: false, reason: 'invalid_session' };
  }
  if (session.status === 'revoked') return { ok: false, reason: 'revoked_session' };
  if (session.status === 'expired') return { ok: false, reason: 'expired_session' };
  if (session.expiresAtEpochMs <= nowEpochMs) {
    return { ok: false, reason: 'expired_session' };
  }

  return {
    ok: true,
    session: copyAccessLifecycleSession({ ...session, status: 'revoked' }),
  };
}

export function revokeAccessSession(
  session: AccessLifecycleSession | null | undefined,
  nowEpochMs: number,
): SessionOperationResult {
  return terminateAccessSession(session, nowEpochMs);
}

export function revokeAccessSessionIdempotently(input: {
  readonly session: AccessLifecycleSession | null | undefined;
  readonly expectedSessionId: string;
  readonly expectedUserId: number;
  readonly nowEpochMs: number;
}): IdempotentSessionRevocationResult {
  const { session, expectedSessionId, expectedUserId, nowEpochMs } = input;
  if (session == null) return { status: 'not_found' };
  if (!isValidAccessLifecycleSession(session) || !isSafeEpoch(nowEpochMs)) {
    return { status: 'invalid_session' };
  }
  if (session.sessionId !== expectedSessionId || session.userId !== expectedUserId) {
    return { status: 'identity_mismatch' };
  }
  if (session.status === 'revoked') return { status: 'already_revoked' };
  if (session.status === 'expired' || session.expiresAtEpochMs <= nowEpochMs) {
    return { status: 'already_expired' };
  }

  const revoked = revokeAccessSession(session, nowEpochMs);
  return revoked.ok
    ? { status: 'revoked', session: copyAccessLifecycleSession(revoked.session) }
    : { status: 'invalid_session' };
}

export function logoutAccessSession(
  session: AccessLifecycleSession | null | undefined,
  nowEpochMs: number,
): SessionOperationResult {
  return terminateAccessSession(session, nowEpochMs);
}

export function expireAccessSession(
  session: AccessLifecycleSession | null | undefined,
  nowEpochMs: number,
): SessionOperationResult {
  if (!isSafeEpoch(nowEpochMs) || !isValidAccessLifecycleSession(session)) {
    return { ok: false, reason: 'invalid_session' };
  }
  if (session.status === 'revoked') return { ok: false, reason: 'revoked_session' };
  if (session.status === 'expired') return { ok: false, reason: 'expired_session' };
  if (session.expiresAtEpochMs > nowEpochMs) {
    return { ok: false, reason: 'not_expired' };
  }

  return {
    ok: true,
    session: copyAccessLifecycleSession({ ...session, status: 'expired' }),
  };
}
