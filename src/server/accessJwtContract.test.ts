import { describe, expect, it } from 'vitest';
import type { LocalSchoolMembership } from '../lib/localSchoolMembershipContracts.ts';
import type { AccessSessionClaims } from './accessContextValidation.ts';
import type { AccessLifecycleSession } from './accessSessionLifecycle.ts';
import {
  createAccessSession,
  transitionAccessSessionContext,
} from './accessSessionLifecycle.ts';
import {
  DEFAULT_ACCESS_JWT_AUDIENCE,
  DEFAULT_ACCESS_JWT_ISSUER,
  mapAccessSessionFailure,
  requireVerifiedAccessContext,
  validateAccessJwtClaims,
  validateAccessJwtSession,
} from './accessJwtContract.ts';
import type { AccessJwtClaims } from './accessJwtContract.ts';
import type { VerifiedGlobalAccessContext, VerifiedLocalAccessContext } from './verifiedAccessContext.ts';

const nowSeconds = 1_800_000_000;
const nowMs = nowSeconds * 1000;
const identity = { userId: 12 } as const;
const membership: LocalSchoolMembership = {
  membershipId: 31,
  userId: identity.userId,
  schoolId: 7,
  role: 'teacher',
  status: 'active',
};

function validPayload(overrides: Record<string, unknown> = {}) {
  return {
    sub: '12',
    sid: 'access-session-a',
    cv: 0,
    jti: 'jwt-id-a',
    iat: nowSeconds - 1,
    exp: nowSeconds + 300,
    iss: DEFAULT_ACCESS_JWT_ISSUER,
    aud: DEFAULT_ACCESS_JWT_AUDIENCE,
    ...overrides,
  };
}

function decodedClaims(payload: Record<string, unknown> = validPayload()): AccessJwtClaims {
  const result = validateAccessJwtClaims(payload, {
    issuer: DEFAULT_ACCESS_JWT_ISSUER,
    audience: DEFAULT_ACCESS_JWT_AUDIENCE,
    nowEpochSeconds: nowSeconds,
  });
  if (result.valid === false) throw new Error(`Invalid claims fixture: ${result.reason}`);
  return result.claims;
}

function makeSession(
  sessionId = 'access-session-a',
  contextVersion = 0,
  context: AccessLifecycleSession['context'] = null,
): AccessLifecycleSession {
  const result = createAccessSession({
    sessionId,
    userId: identity.userId,
    expiresAtEpochMs: (nowSeconds + 600) * 1000,
    nowEpochMs: nowMs,
  });
  if (!result.ok) throw new Error('Expected valid session fixture');
  return { ...result.session, contextVersion, context };
}

function makeLocalContext(): VerifiedLocalAccessContext {
  return {
    kind: 'local',
    identity: { userId: identity.userId },
    active: { schoolId: membership.schoolId, role: membership.role },
    membershipId: membership.membershipId,
  } as VerifiedLocalAccessContext;
}

function makeGlobalContext(): VerifiedGlobalAccessContext {
  return {
    kind: 'global',
    identity: { userId: identity.userId },
    globalRole: 'super_admin',
  } as VerifiedGlobalAccessContext;
}

function sessionClaims(sessionId = 'access-session-a', contextVersion = 0): AccessSessionClaims {
  return { userId: identity.userId, sessionId, contextVersion };
}

describe('access JWT contract', () => {
  it('accepts the strict session-bound claim contract with existing issuer/audience defaults', () => {
    const result = validateAccessJwtClaims(validPayload(), {
      issuer: DEFAULT_ACCESS_JWT_ISSUER,
      audience: DEFAULT_ACCESS_JWT_AUDIENCE,
      nowEpochSeconds: nowSeconds,
    });

    expect(result).toEqual({ valid: true, claims: validPayload() });
  });

  it.each([
    [null, 'invalid_shape'],
    [[], 'invalid_shape'],
    [{ ...validPayload(), sub: '0' }, 'invalid_identity'],
    [{ ...validPayload(), sub: '01' }, 'invalid_identity'],
    [{ ...validPayload(), sub: String(Number.MAX_SAFE_INTEGER + 1) }, 'invalid_identity'],
    [{ ...validPayload(), sub: 12 }, 'invalid_identity'],
    [{ ...validPayload(), sid: '' }, 'invalid_session_id'],
    [{ ...validPayload(), sid: ' session ' }, 'invalid_session_id'],
    [{ ...validPayload(), cv: undefined }, 'invalid_context_version'],
    [{ ...validPayload(), cv: -1 }, 'invalid_context_version'],
    [{ ...validPayload(), cv: 0.5 }, 'invalid_context_version'],
    [{ ...validPayload(), cv: Number.MAX_SAFE_INTEGER + 1 }, 'invalid_context_version'],
    [{ ...validPayload(), jti: '' }, 'invalid_token_id'],
    [{ ...validPayload(), iat: 0 }, 'invalid_timestamps'],
    [{ ...validPayload(), exp: nowSeconds - 1 }, 'invalid_timestamps'],
    [{ ...validPayload(), exp: nowSeconds - 1, iat: nowSeconds - 2 }, 'expired_token'],
    [{ ...validPayload(), iat: nowSeconds + 1 }, 'expired_token'],
    [{ ...validPayload(), iss: 'other-issuer' }, 'invalid_issuer'],
    [{ ...validPayload(), aud: 'other-api' }, 'invalid_audience'],
    [{ ...validPayload(), aud: [] }, 'invalid_audience'],
    [{ ...validPayload(), role: 'super_admin' }, 'untrusted_authority_claim'],
    [{ ...validPayload(), schoolId: 3 }, 'untrusted_authority_claim'],
    [{ ...validPayload(), permissions: ['admin'] }, 'untrusted_authority_claim'],
    [{ ...validPayload(), clientContext: { role: 'school_admin' } }, 'invalid_shape'],
    [{ ...validPayload(), generation: '4' }, 'invalid_shape'],
    [{ ...validPayload(), observedGeneration: '4' }, 'invalid_shape'],
    [{ ...validPayload(), legacyExtra: true }, 'invalid_shape'],
  ] as const)('rejects invalid claim payload %#', (payload, reason) => {
    expect(validateAccessJwtClaims(payload, {
      issuer: DEFAULT_ACCESS_JWT_ISSUER,
      audience: DEFAULT_ACCESS_JWT_AUDIENCE,
      nowEpochSeconds: nowSeconds,
    })).toEqual({ valid: false, reason });
  });

  it('supports a configured issuer/audience and the standard audience array form', () => {
    expect(validateAccessJwtClaims(validPayload({
      iss: 'deployment-issuer',
      aud: ['other-api', 'deployment-api'],
    }), {
      issuer: 'deployment-issuer',
      audience: 'deployment-api',
      nowEpochSeconds: nowSeconds,
    }).valid).toBe(true);
  });

  it('binds sub, sid, and cv to the persisted session and normalizes stale versions to 409', () => {
    const session = makeSession();
    expect(validateAccessJwtSession({
      claims: decodedClaims(),
      session,
      nowEpochSeconds: nowSeconds,
    })).toEqual({ allowed: true, context: null });

    expect(validateAccessJwtSession({
      claims: decodedClaims(validPayload({ sub: '13' })),
      session,
      nowEpochSeconds: nowSeconds,
    })).toEqual({ allowed: false, status: 401, code: 'ACCESS_SESSION_IDENTITY_MISMATCH' });

    expect(validateAccessJwtSession({
      claims: decodedClaims(validPayload({ sid: 'other-session' })),
      session,
      nowEpochSeconds: nowSeconds,
    })).toEqual({ allowed: false, status: 401, code: 'ACCESS_SESSION_IDENTITY_MISMATCH' });

    expect(validateAccessJwtSession({
      claims: decodedClaims(validPayload({ cv: 1 })),
      session,
      nowEpochSeconds: nowSeconds,
    })).toEqual({ allowed: false, status: 409, code: 'CONTEXT_VERSION_STALE' });
  });

  it('requires an exact active server-resolved local membership for a local context', () => {
    const session = makeSession('access-session-a', 0, makeLocalContext());
    const claims = decodedClaims();

    expect(validateAccessJwtSession({
      claims,
      session,
      nowEpochSeconds: nowSeconds,
      authorization: { kind: 'local', membership },
    })).toEqual({ allowed: true, context: makeLocalContext() });

    expect(validateAccessJwtSession({
      claims,
      session,
      nowEpochSeconds: nowSeconds,
      authorization: { kind: 'local', membership: { ...membership, status: 'revoked' } },
    })).toEqual({ allowed: false, status: 403, code: 'ACCESS_MEMBERSHIP_INACTIVE' });

    expect(validateAccessJwtSession({
      claims,
      session,
      nowEpochSeconds: nowSeconds,
      authorization: {
        kind: 'local',
        membership: { ...membership, membershipId: membership.membershipId + 1 },
      },
    })).toEqual({ allowed: false, status: 403, code: 'ACCESS_SESSION_INVALID' });
  });

  it('keeps global Super Admin distinct from local memberships', () => {
    const session = makeSession('access-session-a', 0, makeGlobalContext());
    const claims = decodedClaims();

    expect(validateAccessJwtSession({
      claims,
      session,
      nowEpochSeconds: nowSeconds,
      authorization: { kind: 'global', serverResolvedGlobalRole: 'super_admin' },
    })).toEqual({ allowed: true, context: makeGlobalContext() });

    expect(validateAccessJwtSession({
      claims,
      session,
      nowEpochSeconds: nowSeconds,
      authorization: { kind: 'local', membership },
    })).toEqual({ allowed: false, status: 403, code: 'ACCESS_SESSION_INVALID' });
    expect(validateAccessJwtSession({
      claims,
      session,
      nowEpochSeconds: nowSeconds,
      authorization: { kind: 'global', serverResolvedGlobalRole: 'school_admin' },
    })).toEqual({ allowed: false, status: 403, code: 'ACCESS_GLOBAL_ROLE_INVALID' });
  });

  it('allows a context-free session only when the route does not require a selected context', () => {
    const session = makeSession();
    expect(requireVerifiedAccessContext(session, false)).toEqual({ allowed: true, context: null });
    expect(requireVerifiedAccessContext(session, true)).toEqual({
      allowed: false,
      status: 403,
      code: 'ACCESS_CONTEXT_REQUIRED',
    });
  });

  it('normalizes missing, expired, revoked, stale, and invalid session failures', () => {
    expect(mapAccessSessionFailure('invalid_token')).toEqual({
      status: 401,
      code: 'ACCESS_TOKEN_INVALID',
    });
    expect(mapAccessSessionFailure('session_not_found')).toEqual({
      status: 401,
      code: 'ACCESS_SESSION_NOT_FOUND',
    });
    expect(mapAccessSessionFailure('expired_session')).toEqual({
      status: 401,
      code: 'ACCESS_SESSION_EXPIRED',
    });
    expect(mapAccessSessionFailure('revoked_session')).toEqual({
      status: 401,
      code: 'ACCESS_SESSION_REVOKED',
    });
    expect(mapAccessSessionFailure('stale_context')).toEqual({
      status: 409,
      code: 'CONTEXT_VERSION_STALE',
    });
    expect(mapAccessSessionFailure('version_conflict')).toEqual({
      status: 409,
      code: 'CONTEXT_VERSION_STALE',
    });
    expect(mapAccessSessionFailure('missing_membership')).toEqual({
      status: 403,
      code: 'ACCESS_MEMBERSHIP_NOT_FOUND',
    });
    expect(mapAccessSessionFailure('inactive_membership')).toEqual({
      status: 403,
      code: 'ACCESS_MEMBERSHIP_INACTIVE',
    });
  });

  it('invalidates an old context JWT after a transition without affecting another session', () => {
    const initial = makeSession();
    const deviceB = makeSession('access-session-b');
    const transitioned = transitionAccessSessionContext({
      identity,
      session: initial,
      claims: sessionClaims(initial.sessionId, initial.contextVersion),
      targetContext: makeLocalContext(),
      authorization: { kind: 'local', membership },
      nowEpochMs: nowMs,
    });
    expect(transitioned.ok).toBe(true);
    if (!transitioned.ok) return;

    expect(validateAccessJwtSession({
      claims: decodedClaims(),
      session: transitioned.session,
      nowEpochSeconds: nowSeconds,
      authorization: { kind: 'local', membership },
    })).toEqual({ allowed: false, status: 409, code: 'CONTEXT_VERSION_STALE' });

    expect(validateAccessJwtSession({
      claims: decodedClaims(validPayload({ sid: 'access-session-b' })),
      session: deviceB,
      nowEpochSeconds: nowSeconds,
    })).toEqual({ allowed: true, context: null });
  });
});
