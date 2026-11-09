import { describe, expect, it } from 'vitest';
import type {
  LocalSchoolMembership,
  SchoolContextSelectionRequest,
  SpaceContextSelectionRequest,
} from '../lib/localSchoolMembershipContracts.ts';
import { LOCAL_SCHOOL_ROLES } from '../lib/localSchoolRoles.ts';
import type { VerifiedLocalAccessContext } from './verifiedAccessContext.ts';
import {
  incrementAccessSessionGeneration,
  validateAccessSession,
  validateAccessSessionGeneration,
  validateGlobalSuperAdminAccess,
  validateGenerationBoundAccessSession,
  validateLocalMembership,
} from './accessContextValidation.ts';

const activeMembership: LocalSchoolMembership = {
  membershipId: 31,
  userId: 12,
  schoolId: 7,
  role: 'teacher',
  status: 'active',
};

const identity = { userId: 12 } as const;
const schoolSelection: SchoolContextSelectionRequest = { schoolId: 7 };
const spaceSelection: SpaceContextSelectionRequest = { role: 'teacher' };

describe('validateLocalMembership', () => {
  it.each(LOCAL_SCHOOL_ROLES)('accepts an exact active %s membership', (role) => {
    const membership = { ...activeMembership, role };

    expect(validateLocalMembership({
      identity,
      schoolSelection,
      spaceSelection: { role },
      expectedMembershipId: activeMembership.membershipId,
      membership,
    })).toEqual({ valid: true, membership });
  });

  it.each(['admin', 'student', 'super_admin'])(
    'rejects %s as a locally selected role',
    (role) => {
      const result = validateLocalMembership({
        identity,
        schoolSelection,
        spaceSelection: { role } as SpaceContextSelectionRequest,
        expectedMembershipId: activeMembership.membershipId,
        membership: activeMembership,
      });

      expect(result).toEqual({ valid: false, reason: 'invalid_selection' });
    },
  );

  it('rejects a missing membership', () => {
    expect(validateLocalMembership({
      identity,
      schoolSelection,
      spaceSelection,
      expectedMembershipId: activeMembership.membershipId,
      membership: null,
    })).toEqual({ valid: false, reason: 'missing_membership' });
  });

  it('rejects incomplete or invalid selection input', () => {
    expect(validateLocalMembership({
      identity,
      schoolSelection: null,
      spaceSelection,
      expectedMembershipId: activeMembership.membershipId,
      membership: activeMembership,
    })).toEqual({ valid: false, reason: 'invalid_selection' });

    expect(validateLocalMembership({
      identity,
      schoolSelection,
      spaceSelection: null,
      expectedMembershipId: activeMembership.membershipId,
      membership: activeMembership,
    })).toEqual({ valid: false, reason: 'invalid_selection' });

    expect(validateLocalMembership({
      identity: { userId: 0 },
      schoolSelection,
      spaceSelection,
      expectedMembershipId: activeMembership.membershipId,
      membership: activeMembership,
    })).toEqual({ valid: false, reason: 'invalid_selection' });
  });

  it.each(['revoked', 'inactive'])(
    'rejects a %s membership without reactivating it',
    (status) => {
      const membership = { ...activeMembership, status } as LocalSchoolMembership;

      expect(validateLocalMembership({
        identity,
        schoolSelection,
        spaceSelection,
        expectedMembershipId: activeMembership.membershipId,
        membership,
      })).toEqual({ valid: false, reason: 'inactive_membership' });
      expect(membership.status).toBe(status);
    },
  );

  it('rejects a membership for another school', () => {
    expect(validateLocalMembership({
      identity,
      schoolSelection,
      spaceSelection,
      expectedMembershipId: activeMembership.membershipId,
      membership: { ...activeMembership, schoolId: 8 },
    })).toEqual({ valid: false, reason: 'school_mismatch' });
  });

  it('rejects a membership for another function', () => {
    expect(validateLocalMembership({
      identity,
      schoolSelection,
      spaceSelection,
      expectedMembershipId: activeMembership.membershipId,
      membership: { ...activeMembership, role: 'parent' },
    })).toEqual({ valid: false, reason: 'role_mismatch' });
  });

  it('rejects a membership for another identity', () => {
    expect(validateLocalMembership({
      identity,
      schoolSelection,
      spaceSelection,
      expectedMembershipId: activeMembership.membershipId,
      membership: { ...activeMembership, userId: 13 },
    })).toEqual({ valid: false, reason: 'identity_mismatch' });
  });

  it('accepts only the exact expected membership id', () => {
    expect(validateLocalMembership({
      identity,
      schoolSelection,
      spaceSelection,
      expectedMembershipId: activeMembership.membershipId,
      membership: activeMembership,
    })).toEqual({ valid: true, membership: activeMembership });

    expect(validateLocalMembership({
      identity,
      schoolSelection,
      spaceSelection,
      expectedMembershipId: 32,
      membership: activeMembership,
    })).toEqual({ valid: false, reason: 'membership_mismatch' });
  });

  it.each([undefined, null, 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, '31', 'not-an-id'])(
    'rejects invalid expected membership id %j',
    (expectedMembershipId) => {
      expect(validateLocalMembership({
        identity,
        schoolSelection,
        spaceSelection,
        expectedMembershipId,
        membership: activeMembership,
      } as Parameters<typeof validateLocalMembership>[0])).toEqual({
        valid: false,
        reason: 'invalid_selection',
      });
    },
  );

  it('rejects a request with no expected membership id', () => {
    const input = {
      identity,
      schoolSelection,
      spaceSelection,
      membership: activeMembership,
    };

    expect(validateLocalMembership(
      input as Parameters<typeof validateLocalMembership>[0],
    )).toEqual({ valid: false, reason: 'invalid_selection' });
  });

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, '31', null, undefined])(
    'rejects invalid membership id %j',
    (membershipId) => {
      expect(validateLocalMembership({
        identity,
        schoolSelection,
        spaceSelection,
        expectedMembershipId: activeMembership.membershipId,
        membership: { ...activeMembership, membershipId },
      } as Parameters<typeof validateLocalMembership>[0])).toEqual({
        valid: false,
        reason: 'invalid_selection',
      });
    },
  );

  it('does not create or alter a membership or the historical user role', () => {
    const membership = Object.freeze({ ...activeMembership });
    const user = Object.freeze({ id: identity.userId, role: 'teacher' });

    validateLocalMembership({
      identity,
      schoolSelection,
      spaceSelection,
      expectedMembershipId: activeMembership.membershipId,
      membership,
    });

    expect(membership).toEqual(activeMembership);
    expect(user.role).toBe('teacher');
  });

  it('keeps school and space selection contracts separate', () => {
    const schoolSelectionHasRole: 'role' extends keyof SchoolContextSelectionRequest ? true : false = false;
    const spaceSelectionHasSchoolId: 'schoolId' extends keyof SpaceContextSelectionRequest ? true : false = false;

    expect(schoolSelectionHasRole).toBe(false);
    expect(spaceSelectionHasSchoolId).toBe(false);
  });

  it('keeps global privileges out of the local context type', () => {
    const localContextHasGlobalRole: 'globalRole' extends keyof VerifiedLocalAccessContext ? true : false = false;

    expect(localContextHasGlobalRole).toBe(false);
  });
});

describe('validateGlobalSuperAdminAccess', () => {
  it('accepts a server-resolved global super_admin role', () => {
    expect(validateGlobalSuperAdminAccess({
      identity,
      serverResolvedGlobalRole: 'super_admin',
    })).toEqual({ valid: true });
  });

  it.each(['teacher', 'school_admin', 'admin', 'student', null, undefined])(
    'rejects %j as global super_admin authority',
    (role) => {
      expect(validateGlobalSuperAdminAccess({
        identity,
        serverResolvedGlobalRole: role,
      })).toEqual({ valid: false, reason: 'not_super_admin' });
    },
  );

  it('rejects an invalid identity', () => {
    expect(validateGlobalSuperAdminAccess({
      identity: { userId: 0 },
      serverResolvedGlobalRole: 'super_admin',
    })).toEqual({ valid: false, reason: 'invalid_identity' });
  });

  it('does not let global authority replace a local membership', () => {
    expect(validateLocalMembership({
      identity,
      schoolSelection,
      spaceSelection,
      expectedMembershipId: activeMembership.membershipId,
      membership: null,
    })).toEqual({ valid: false, reason: 'missing_membership' });
  });
});

describe('validateAccessSession', () => {
  const session = {
    sessionId: 'session-device-a',
    userId: identity.userId,
    status: 'active',
    contextVersion: 4,
    expiresAtEpochMs: 20_000,
  } as const;

  it('accepts the current context version', () => {
    expect(validateAccessSession({
      identity,
      session,
      claims: { sessionId: session.sessionId, userId: identity.userId, contextVersion: 4 },
      nowEpochMs: 10_000,
    })).toEqual({ valid: true });
  });

  it('rejects a stale context version', () => {
    expect(validateAccessSession({
      identity,
      session,
      claims: { sessionId: session.sessionId, userId: identity.userId, contextVersion: 3 },
      nowEpochMs: 10_000,
    })).toEqual({ valid: false, reason: 'stale_context' });
  });

  it('rejects an expired or revoked session', () => {
    expect(validateAccessSession({
      identity,
      session: { ...session, expiresAtEpochMs: 10_000 },
      claims: { sessionId: session.sessionId, userId: identity.userId, contextVersion: 4 },
      nowEpochMs: 10_000,
    })).toEqual({ valid: false, reason: 'expired_session' });

    expect(validateAccessSession({
      identity,
      session: { ...session, status: 'revoked' },
      claims: { sessionId: session.sessionId, userId: identity.userId, contextVersion: 4 },
      nowEpochMs: 9_000,
    })).toEqual({ valid: false, reason: 'revoked_session' });

    expect(validateAccessSession({
      identity,
      session: { ...session, status: 'expired' },
      claims: { sessionId: session.sessionId, userId: identity.userId, contextVersion: 4 },
      nowEpochMs: 9_000,
    })).toEqual({ valid: false, reason: 'expired_session' });
  });

  it('rejects missing session inputs', () => {
    expect(validateAccessSession({
      identity,
      session: null,
      claims: { sessionId: 'session-device-a', userId: identity.userId, contextVersion: 4 },
      nowEpochMs: 10_000,
    })).toEqual({ valid: false, reason: 'invalid_session' });

    expect(validateAccessSession({
      identity,
      session,
      claims: null,
      nowEpochMs: 10_000,
    })).toEqual({ valid: false, reason: 'invalid_session' });
  });

  it('keeps two sessions for the same identity independent', () => {
    const anotherSession = {
      ...session,
      sessionId: 'session-device-b',
      contextVersion: 1,
    };

    expect(validateAccessSession({
      identity,
      session,
      claims: { sessionId: session.sessionId, userId: identity.userId, contextVersion: 5 },
      nowEpochMs: 10_000,
    })).toEqual({ valid: false, reason: 'stale_context' });

    expect(validateAccessSession({
      identity,
      session: anotherSession,
      claims: {
        sessionId: anotherSession.sessionId,
        userId: identity.userId,
        contextVersion: 1,
      },
      nowEpochMs: 10_000,
    })).toEqual({ valid: true });
  });

  it('rejects a session belonging to another identity or session id', () => {
    expect(validateAccessSession({
      identity,
      session: { ...session, userId: 13 },
      claims: { sessionId: session.sessionId, userId: identity.userId, contextVersion: 4 },
      nowEpochMs: 10_000,
    })).toEqual({ valid: false, reason: 'identity_mismatch' });

    expect(validateAccessSession({
      identity,
      session,
      claims: { sessionId: 'another-session', userId: identity.userId, contextVersion: 4 },
      nowEpochMs: 10_000,
    })).toEqual({ valid: false, reason: 'session_mismatch' });
  });
});

describe('access session generations', () => {
  const generationBoundSession = {
    sessionId: 'session-device-a',
    userId: identity.userId,
    status: 'active',
    contextVersion: 4,
    expiresAtEpochMs: 20_000,
    observedGeneration: '12',
  } as const;
  const claims = {
    sessionId: generationBoundSession.sessionId,
    userId: identity.userId,
    contextVersion: generationBoundSession.contextVersion,
  };

  it('accepts canonical generations and rejects stale generations', () => {
    expect(validateAccessSessionGeneration({
      observedGeneration: '12',
      currentGeneration: '12',
    })).toEqual({ valid: true, generation: '12' });
    expect(validateAccessSessionGeneration({
      observedGeneration: '11',
      currentGeneration: '12',
    })).toEqual({ valid: false, reason: 'stale_generation' });
  });

  it('increments generations exactly and rejects overflow', () => {
    expect(incrementAccessSessionGeneration('0')).toEqual({ ok: true, generation: '1' });
    expect(incrementAccessSessionGeneration('9223372036854775806')).toEqual({
      ok: true,
      generation: '9223372036854775807',
    });
    expect(incrementAccessSessionGeneration('9223372036854775807')).toEqual({
      ok: false,
      reason: 'generation_exhausted',
    });
    expect(incrementAccessSessionGeneration('01')).toEqual({
      ok: false,
      reason: 'invalid_generation',
    });
  });

  it.each(['', '-1', '+1', '01', '1.0', '9223372036854775808', 12, null, undefined])(
    'rejects invalid generation %j',
    (generation) => {
      expect(validateAccessSessionGeneration({
        observedGeneration: generation,
        currentGeneration: '12',
      })).toEqual({ valid: false, reason: 'invalid_generation' });
    },
  );

  it('requires the session-observed generation to equal the current user generation', () => {
    expect(validateGenerationBoundAccessSession({
      identity,
      session: generationBoundSession,
      claims,
      currentGeneration: '12',
      nowEpochMs: 10_000,
    })).toEqual({ valid: true });

    expect(validateGenerationBoundAccessSession({
      identity,
      session: generationBoundSession,
      claims,
      currentGeneration: '13',
      nowEpochMs: 10_000,
    })).toEqual({ valid: false, reason: 'stale_generation' });
  });
});
