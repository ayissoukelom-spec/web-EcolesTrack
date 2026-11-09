import { describe, expect, it } from 'vitest';
import type { LocalSchoolMembership } from '../lib/localSchoolMembershipContracts.ts';
import type { VerifiedGlobalAccessContext, VerifiedLocalAccessContext } from './verifiedAccessContext.ts';
import {
  createAccessSession,
  expireAccessSession,
  logoutAccessSession,
  revokeAccessSession,
  revokeAccessSessionIdempotently,
  transitionAccessSessionContext,
  copyGenerationBoundAccessLifecycleSession,
  isValidGenerationBoundAccessLifecycleSession,
} from './accessSessionLifecycle.ts';
import type {
  AccessLifecycleSession,
  GenerationBoundAccessLifecycleSession,
} from './accessSessionLifecycle.ts';
import type { AccessSessionClaims } from './accessContextValidation.ts';

const now = 1_800_000_000_000;
const identity = { userId: 12 } as const;
const membership: LocalSchoolMembership = {
  membershipId: 31,
  userId: identity.userId,
  schoolId: 7,
  role: 'teacher',
  status: 'active',
};

function makeSession(sessionId = 'device-session-a'): AccessLifecycleSession {
  const result = createAccessSession({
    sessionId,
    userId: identity.userId,
    expiresAtEpochMs: now + 60_000,
    nowEpochMs: now,
  });
  if (!result.ok) throw new Error('Expected valid session fixture');
  return result.session;
}

function makeLocalContext(
  schoolId = membership.schoolId,
  role: 'parent' | 'teacher' | 'school_admin' | 'surveillant' = membership.role,
  membershipId = membership.membershipId,
  userId: number = identity.userId,
): VerifiedLocalAccessContext {
  return {
    kind: 'local',
    identity: { userId },
    active: { schoolId, role },
    membershipId,
  } as VerifiedLocalAccessContext;
}

function makeGlobalContext(userId = identity.userId): VerifiedGlobalAccessContext {
  return {
    kind: 'global',
    identity: { userId },
    globalRole: 'super_admin',
  } as VerifiedGlobalAccessContext;
}

function claimsFor(session: AccessLifecycleSession): AccessSessionClaims {
  return {
    sessionId: session.sessionId,
    userId: session.userId,
    contextVersion: session.contextVersion,
  };
}

function transition(
  session: AccessLifecycleSession,
  targetContext: VerifiedLocalAccessContext | VerifiedGlobalAccessContext,
  overrides: Partial<Parameters<typeof transitionAccessSessionContext>[0]> = {},
) {
  return transitionAccessSessionContext({
    identity,
    session,
    claims: claimsFor(session),
    targetContext,
    authorization: { kind: 'local', membership },
    nowEpochMs: now,
    ...overrides,
  });
}

describe('access session lifecycle', () => {
  it('creates an independent active session with no selected context', () => {
    const result = createAccessSession({
      sessionId: 'device-session-a',
      userId: identity.userId,
      expiresAtEpochMs: now + 60_000,
      nowEpochMs: now,
    });

    expect(result).toEqual({
      ok: true,
      session: {
        sessionId: 'device-session-a',
        userId: identity.userId,
        status: 'active',
        contextVersion: 0,
        expiresAtEpochMs: now + 60_000,
        context: null,
      },
    });
  });

  it.each([
    ['', identity.userId, now + 60_000, now],
    ['session', 0, now + 60_000, now],
    ['session', Number.MAX_SAFE_INTEGER + 1, now + 60_000, now],
    ['session', identity.userId, 1.5, now],
    ['session', identity.userId, now, now],
    ['session', identity.userId, now + 60_000, 1.5],
  ])('rejects malformed session creation input %#', (sessionId, userId, expiry, createdAt) => {
    expect(createAccessSession({
      sessionId,
      userId,
      expiresAtEpochMs: expiry,
      nowEpochMs: createdAt,
    } as Parameters<typeof createAccessSession>[0])).toEqual({
      ok: false,
      reason: 'invalid_session',
    });
  });

  it('selects an initial local context and increments the version once', () => {
    const initial = makeSession();
    const result = transition(initial, makeLocalContext());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.changed).toBe(true);
    expect(result.session.context).toEqual(makeLocalContext());
    expect(result.session.contextVersion).toBe(1);
    expect(initial.context).toBeNull();
    expect(initial.contextVersion).toBe(0);
  });

  it('copies context objects when transitioning and returning an unchanged session', () => {
    const initial = makeSession();
    const target = makeLocalContext();
    const selected = transition(initial, target);
    expect(selected.ok).toBe(true);
    if (!selected.ok || selected.session.context?.kind !== 'local') return;

    expect(selected.session.context).not.toBe(target);
    expect(selected.session.context.identity).not.toBe(target.identity);
    expect(selected.session.context.active).not.toBe(target.active);
    Object.assign(selected.session.context.active, { schoolId: 99 });
    expect(target.active.schoolId).toBe(7);
    expect(initial.context).toBeNull();

    const stableInput = transition(makeSession(), makeLocalContext());
    if (!stableInput.ok) throw new Error('Expected initial context');
    const repeated = transition(stableInput.session, makeLocalContext());
    expect(repeated.ok).toBe(true);
    if (!repeated.ok || repeated.session.context?.kind !== 'local') return;

    expect(repeated.session).not.toBe(stableInput.session);
    expect(repeated.session.context).not.toBe(stableInput.session.context);
    expect(repeated.session.context.active).not.toBe(stableInput.session.context?.kind === 'local'
      ? stableInput.session.context.active
      : null);
    Object.assign(repeated.session.context.active, { schoolId: 88 });
    expect(stableInput.session.context).toEqual(makeLocalContext());
  });

  it('returns revoked and expired sessions with copied nested context', () => {
    const selected = transition(makeSession(), makeLocalContext());
    if (!selected.ok) throw new Error('Expected selected context');

    const revoked = revokeAccessSession(selected.session, now);
    expect(revoked.ok).toBe(true);
    if (!revoked.ok) return;
    expect(revoked.session.context).not.toBe(selected.session.context);
    if (revoked.session.context?.kind === 'local') {
      expect(revoked.session.context.active).not.toBe(
        selected.session.context?.kind === 'local' ? selected.session.context.active : null,
      );
      Object.assign(revoked.session.context.active, { schoolId: 99 });
    }
    expect(selected.session.context).toEqual(makeLocalContext());

    const expired = expireAccessSession(selected.session, selected.session.expiresAtEpochMs);
    expect(expired.ok).toBe(true);
    if (!expired.ok) return;
    expect(expired.session.context).not.toBe(selected.session.context);
  });

  it('keeps generation-bound session copies independent and validates the generation', () => {
    const generationBound: GenerationBoundAccessLifecycleSession = {
      ...makeSession(),
      observedGeneration: '4',
    };
    const copied = copyGenerationBoundAccessLifecycleSession(generationBound);

    expect(isValidGenerationBoundAccessLifecycleSession(generationBound)).toBe(true);
    expect(copied).not.toBe(generationBound);
    expect(copied).toEqual(generationBound);
    expect(isValidGenerationBoundAccessLifecycleSession({
      ...generationBound,
      observedGeneration: '04',
    })).toBe(false);
  });

  it('models idempotent, identity-bound session revocation without reactivation', () => {
    const active = makeSession();
    const revoked = revokeAccessSessionIdempotently({
      session: active,
      expectedSessionId: active.sessionId,
      expectedUserId: active.userId,
      nowEpochMs: now,
    });

    expect(revoked.status).toBe('revoked');
    if (revoked.status !== 'revoked') return;
    expect(revokeAccessSessionIdempotently({
      session: revoked.session,
      expectedSessionId: active.sessionId,
      expectedUserId: active.userId,
      nowEpochMs: now,
    })).toEqual({ status: 'already_revoked' });
    expect(revokeAccessSessionIdempotently({
      session: active,
      expectedSessionId: active.sessionId,
      expectedUserId: active.userId + 1,
      nowEpochMs: now,
    })).toEqual({ status: 'identity_mismatch' });
    expect(revokeAccessSessionIdempotently({
      session: null,
      expectedSessionId: active.sessionId,
      expectedUserId: active.userId,
      nowEpochMs: now,
    })).toEqual({ status: 'not_found' });
  });

  it('does not turn a naturally expired session into an active or revoked session', () => {
    const active = makeSession();
    expect(revokeAccessSessionIdempotently({
      session: active,
      expectedSessionId: active.sessionId,
      expectedUserId: active.userId,
      nowEpochMs: active.expiresAtEpochMs,
    })).toEqual({ status: 'already_expired' });
    expect(active.status).toBe('active');
  });

  it('increments the version when school or function changes', () => {
    const selected = transition(makeSession(), makeLocalContext());
    if (!selected.ok) throw new Error('Expected initial context selection');

    const changedSchool = transition(
      selected.session,
      makeLocalContext(8, 'teacher', 32),
      { authorization: { kind: 'local', membership: { ...membership, schoolId: 8, membershipId: 32 } } },
    );
    expect(changedSchool.ok).toBe(true);
    if (!changedSchool.ok) return;
    expect(changedSchool.session.contextVersion).toBe(2);
    expect(changedSchool.session.context).toEqual(makeLocalContext(8, 'teacher', 32));

    const changedRole = transition(
      changedSchool.session,
      makeLocalContext(8, 'parent', 33),
      { authorization: { kind: 'local', membership: { ...membership, schoolId: 8, role: 'parent', membershipId: 33 } } },
    );
    expect(changedRole.ok).toBe(true);
    if (!changedRole.ok) return;
    expect(changedRole.session.contextVersion).toBe(3);
    expect(changedRole.session.context).toEqual(makeLocalContext(8, 'parent', 33));
  });

  it('does not increment the version for an identical authorized context', () => {
    const selected = transition(makeSession(), makeLocalContext());
    if (!selected.ok) throw new Error('Expected initial context selection');

    const repeated = transition(selected.session, makeLocalContext());

    expect(repeated).toEqual({
      ok: true,
      changed: false,
      session: selected.session,
    });
    if (repeated.ok) expect(repeated.session.contextVersion).toBe(1);
  });

  it('rejects a stale context version and concurrent update without overwriting newer state', () => {
    const session = makeSession();
    const oldClaims = claimsFor(session);
    const first = transition(session, makeLocalContext());
    if (!first.ok) throw new Error('Expected first context transition');

    const conflict = transition(first.session, makeLocalContext(8, 'teacher', 32), {
      claims: oldClaims,
      authorization: { kind: 'local', membership: { ...membership, schoolId: 8, membershipId: 32 } },
    });

    expect(conflict).toEqual({ ok: false, reason: 'version_conflict' });
    expect(first.session.contextVersion).toBe(1);
    expect(first.session.context).toEqual(makeLocalContext());
  });

  it('lets tabs share one session and rejects an old tab version after a context change', () => {
    const session = makeSession();
    const tabAClaims = claimsFor(session);
    const tabBClaims = { ...tabAClaims };

    const tabA = transition(session, makeLocalContext(), { claims: tabAClaims });
    expect(tabA.ok).toBe(true);
    if (!tabA.ok) return;
    expect(tabA.session.sessionId).toBe(tabBClaims.sessionId);

    const tabB = transition(tabA.session, makeLocalContext(8, 'teacher', 32), {
      claims: tabBClaims,
      authorization: { kind: 'local', membership: { ...membership, schoolId: 8, membershipId: 32 } },
    });
    expect(tabB).toEqual({ ok: false, reason: 'version_conflict' });
  });

  it('keeps sessions for the same identity independent', () => {
    const deviceA = makeSession('device-a');
    const deviceB = makeSession('device-b');
    const updatedA = transition(deviceA, makeLocalContext());

    expect(updatedA.ok).toBe(true);
    if (!updatedA.ok) return;
    expect(updatedA.session.contextVersion).toBe(1);
    expect(deviceB.contextVersion).toBe(0);
    expect(deviceB.context).toBeNull();
    expect(transition(deviceB, makeLocalContext()).ok).toBe(true);
  });

  it('switches explicitly from local to global and back to local', () => {
    const local = transition(makeSession(), makeLocalContext());
    if (!local.ok) throw new Error('Expected local context');

    const global = transition(local.session, makeGlobalContext(), {
      authorization: { kind: 'global', serverResolvedGlobalRole: 'super_admin' },
    });
    expect(global.ok).toBe(true);
    if (!global.ok) return;
    expect(global.session.context).toEqual(makeGlobalContext());
    expect(global.session.contextVersion).toBe(2);

    const localAgain = transition(global.session, makeLocalContext(), {
      authorization: { kind: 'local', membership },
    });
    expect(localAgain.ok).toBe(true);
    if (!localAgain.ok) return;
    expect(localAgain.session.context).toEqual(makeLocalContext());
    expect(localAgain.session.contextVersion).toBe(3);
  });

  it('does not allow local context to use global authorization or vice versa', () => {
    expect(transition(makeSession(), makeLocalContext(), {
      authorization: { kind: 'global', serverResolvedGlobalRole: 'super_admin' },
    })).toEqual({ ok: false, reason: 'unauthorized_context' });

    expect(transition(makeSession(), makeGlobalContext(), {
      authorization: { kind: 'local', membership },
    })).toEqual({ ok: false, reason: 'unauthorized_context' });

    expect(transition(makeSession(), makeGlobalContext(), {
      authorization: { kind: 'global', serverResolvedGlobalRole: 'teacher' },
    })).toEqual({ ok: false, reason: 'not_super_admin' });
  });

  it('refuses revoked memberships and preserves the exact membership id', () => {
    expect(transition(makeSession(), makeLocalContext(), {
      authorization: { kind: 'local', membership: { ...membership, status: 'revoked' } },
    })).toEqual({ ok: false, reason: 'inactive_membership' });

    const mismatch = transition(makeSession(), makeLocalContext(7, 'teacher', 32));
    expect(mismatch).toEqual({ ok: false, reason: 'membership_mismatch' });

    const accepted = transition(makeSession(), makeLocalContext());
    expect(accepted.ok).toBe(true);
    if (accepted.ok) {
      expect(accepted.session.context?.kind).toBe('local');
      if (accepted.session.context?.kind === 'local') {
        expect(accepted.session.context.membershipId).toBe(membership.membershipId);
      }
    }
  });

  it('rejects a context belonging to a different identity', () => {
    expect(transition(makeSession(), makeLocalContext(7, 'teacher', 31, 99))).toEqual({
      ok: false,
      reason: 'identity_mismatch',
    });
  });

  it('rejects revoked or expired sessions for context transitions', () => {
    const session = makeSession();
    const revoked = revokeAccessSession(session, now);
    expect(revoked.ok).toBe(true);
    if (!revoked.ok) return;
    expect(transition(revoked.session, makeLocalContext())).toEqual({
      ok: false,
      reason: 'revoked_session',
    });

    const elapsedSession = {
      ...session,
      expiresAtEpochMs: now,
    };
    expect(transition(elapsedSession, makeLocalContext())).toEqual({
      ok: false,
      reason: 'expired_session',
    });
  });

  it('rejects incoherent session ids, identities, and versions', () => {
    const session = makeSession();
    expect(transition(session, makeLocalContext(), {
      claims: { ...claimsFor(session), sessionId: 'another-session' },
    })).toEqual({ ok: false, reason: 'session_mismatch' });

    expect(transition(session, makeLocalContext(), {
      claims: { ...claimsFor(session), userId: 99 },
    })).toEqual({ ok: false, reason: 'identity_mismatch' });

    for (const contextVersion of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(transition(session, makeLocalContext(), {
        claims: { ...claimsFor(session), contextVersion },
      })).toEqual({ ok: false, reason: 'invalid_session' });
    }
    expect(transition(session, makeLocalContext(), {
      claims: {
        ...claimsFor(session),
        contextVersion: '0',
      } as unknown as AccessSessionClaims,
    })).toEqual({
      ok: false,
      reason: 'invalid_session',
    });

    const malformedSession = {
      ...session,
      contextVersion: 0.5,
    } as AccessLifecycleSession;
    expect(transition(malformedSession, makeLocalContext())).toEqual({
      ok: false,
      reason: 'invalid_session',
    });

    expect(transition({ ...session, sessionId: '   ' }, makeLocalContext())).toEqual({
      ok: false,
      reason: 'invalid_session',
    });
  });

  it('rejects a transition when incrementing would exceed safe integer precision', () => {
    const session = {
      ...makeSession(),
      contextVersion: Number.MAX_SAFE_INTEGER,
    } as AccessLifecycleSession;

    expect(transition(session, makeLocalContext(), {
      claims: { ...claimsFor(session), contextVersion: Number.MAX_SAFE_INTEGER },
    })).toEqual({ ok: false, reason: 'version_exhausted' });
  });

  it('revokes only the requested session', () => {
    const deviceA = makeSession('device-a');
    const deviceB = makeSession('device-b');
    const revoked = revokeAccessSession(deviceA, now);

    expect(revoked.ok).toBe(true);
    if (!revoked.ok) return;
    expect(revoked.session.status).toBe('revoked');
    expect(deviceA.status).toBe('active');
    expect(deviceB.status).toBe('active');
    expect(transition(deviceB, makeLocalContext()).ok).toBe(true);
  });

  it('logs out only the requested session', () => {
    const deviceA = makeSession('device-a');
    const deviceB = makeSession('device-b');
    const loggedOut = logoutAccessSession(deviceA, now);

    expect(loggedOut.ok).toBe(true);
    if (!loggedOut.ok) return;
    expect(loggedOut.session.status).toBe('revoked');
    expect(deviceA.status).toBe('active');
    expect(deviceB.status).toBe('active');
  });

  it('expires only after the deadline and refuses operations on terminated sessions', () => {
    const session = makeSession();
    expect(expireAccessSession(session, now)).toEqual({ ok: false, reason: 'not_expired' });

    const expired = expireAccessSession(session, session.expiresAtEpochMs);
    expect(expired.ok).toBe(true);
    if (!expired.ok) return;
    expect(expired.session.status).toBe('expired');
    expect(transition(expired.session, makeLocalContext(), {
      nowEpochMs: expired.session.expiresAtEpochMs,
    })).toEqual({ ok: false, reason: 'expired_session' });
    expect(expireAccessSession(expired.session, session.expiresAtEpochMs)).toEqual({
      ok: false,
      reason: 'expired_session',
    });

    const revoked = revokeAccessSession(session, now);
    expect(revoked.ok).toBe(true);
    if (!revoked.ok) return;
    expect(revokeAccessSession(revoked.session, now)).toEqual({
      ok: false,
      reason: 'revoked_session',
    });
    expect(expireAccessSession(revoked.session, session.expiresAtEpochMs)).toEqual({
      ok: false,
      reason: 'revoked_session',
    });
  });

  it('does not mutate the session, context, identity, or membership inputs', () => {
    const frozenIdentity = Object.freeze({ ...identity });
    const frozenMembership = Object.freeze({ ...membership });
    const frozenContext = Object.freeze({
      ...makeLocalContext(),
      identity: Object.freeze({ userId: identity.userId }),
      active: Object.freeze({ schoolId: membership.schoolId, role: membership.role }),
    }) as VerifiedLocalAccessContext;
    const frozenSession = Object.freeze({
      ...makeSession(),
      context: null,
    }) as AccessLifecycleSession;

    const result = transition(frozenSession, frozenContext, {
      identity: frozenIdentity,
      authorization: { kind: 'local', membership: frozenMembership },
    });

    expect(result.ok).toBe(true);
    expect(frozenSession.context).toBeNull();
    expect(frozenSession.contextVersion).toBe(0);
    expect(frozenContext.membershipId).toBe(membership.membershipId);
    expect(frozenMembership).toEqual(membership);
  });
});
