import { describe, expect, it, vi } from 'vitest';
import type { AccessSessionAtomicCreateResult } from './accessSessionRepository.ts';
import type { AccessJwtClaims } from './accessJwtContract.ts';
import { createAccessSession } from './accessSessionLifecycle.ts';
import type { AccessSessionServiceDependencies } from './accessSessionService.ts';
import { AccessSessionService } from './accessSessionService.ts';

const now = 1_800_000_000_000;
const userId = 12;
const generation = '7';

function createdSession(sessionId: string, observedGeneration = generation) {
  const result = createAccessSession({
    sessionId,
    userId,
    expiresAtEpochMs: now + 86_400_000,
    nowEpochMs: now,
  });
  if (!result.ok) throw new Error('Expected valid session fixture');
  return { ...result.session, observedGeneration };
}

function webClaims(contextVersion = 0): AccessJwtClaims {
  return {
    sub: String(userId),
    sid: 'session-a',
    cv: contextVersion,
    jti: 'old-token',
    iat: now / 1000 - 10,
    exp: now / 1000 + 300,
    iss: 'ecoletrack-web',
    aud: 'ecoletrack-web-api',
  };
}

function setup(overrides: Partial<AccessSessionServiceDependencies> = {}) {
  const createIfGenerationCurrent = vi.fn(async (input: {
    readonly sessionId: string;
    readonly userId: number;
    readonly expectedGeneration: string;
    readonly expiresAtEpochMs: number;
    readonly nowEpochMs: number;
  }): Promise<AccessSessionAtomicCreateResult> => {
    const created = createAccessSession({
      sessionId: input.sessionId,
      userId: input.userId,
      expiresAtEpochMs: input.expiresAtEpochMs,
      nowEpochMs: input.nowEpochMs,
    });
    if (!created.ok) return { status: 'invalid_session' };
    return {
      status: 'created',
      session: { ...created.session, observedGeneration: input.expectedGeneration },
    };
  });
  const revokeById = vi.fn(async () => ({ status: 'revoked' as const }));
  const transitionContext = vi.fn(async () => ({
    status: 'rejected' as const,
    reason: 'invalid_selection' as const,
  }));
  const issue = vi.fn(async (_claims: AccessJwtClaims) => 'signed.jwt.token');
  const dependencies: AccessSessionServiceDependencies = {
    repository: { createIfGenerationCurrent, revokeById, transitionContext },
    now: () => now,
    identifiers: {
      createSessionId: () => 'session-a',
      createTokenId: () => 'token-a',
    },
    tokenIssuer: { issue },
    sessionLifetimeSeconds: 86_400,
    tokenLifetimeSeconds: 900,
    ...overrides,
  };
  return {
    service: new AccessSessionService(dependencies),
    createIfGenerationCurrent,
    revokeById,
    transitionContext,
    issue,
  };
}

describe('AccessSessionService', () => {
  it('creates a context-free session atomically against the expected generation before issuing the JWT', async () => {
    const { service, createIfGenerationCurrent, issue } = setup();

    await expect(service.createForAuthenticatedUser({
      userId,
      expectedGeneration: generation,
    })).resolves.toMatchObject({
      ok: true,
      accessToken: 'signed.jwt.token',
      sessionId: 'session-a',
      expiresAtEpochSeconds: now / 1000 + 900,
    });

    expect(createIfGenerationCurrent).toHaveBeenCalledWith({
      sessionId: 'session-a',
      userId,
      expectedGeneration: generation,
      expiresAtEpochMs: now + 86_400_000,
      nowEpochMs: now,
    });
    expect(issue).toHaveBeenCalledTimes(1);
    expect(issue.mock.calls[0]?.[0]).toEqual({
      sub: String(userId),
      sid: 'session-a',
      cv: 0,
      jti: 'token-a',
      iat: now / 1000,
      exp: now / 1000 + 900,
      iss: 'ecoletrack-web',
      aud: 'ecoletrack-web-api',
    });
  });

  it('reissues a JWT with the committed context version after a successful transition', async () => {
    const transitionedSession = {
      ...createdSession('session-a'),
      contextVersion: 1,
      context: null,
    };
    const transitionContext = vi.fn(async () => ({
      status: 'transitioned' as const,
      session: transitionedSession,
    }));
    const { service, issue } = setup({
      repository: {
        createIfGenerationCurrent: async () => ({ status: 'invalid_session' }),
        revokeById: async () => ({ status: 'revoked' }),
        transitionContext,
      },
    });

    await expect(service.transitionContext({
      claims: webClaims(),
      target: { kind: 'local', schoolId: 7, role: 'teacher', membershipId: 31 },
    })).resolves.toEqual({
      ok: true,
      changed: true,
      accessToken: 'signed.jwt.token',
      contextVersion: 1,
      expiresAtEpochSeconds: now / 1000 + 900,
    });
    expect(transitionContext).toHaveBeenCalledWith({
      userId,
      sessionId: 'session-a',
      expectedContextVersion: 0,
      target: { kind: 'local', schoolId: 7, role: 'teacher', membershipId: 31 },
      nowEpochMs: now,
    });
    expect(issue).toHaveBeenCalledWith(expect.objectContaining({
      sub: String(userId),
      sid: 'session-a',
      cv: 1,
      jti: 'token-a',
      iss: 'ecoletrack-web',
      aud: 'ecoletrack-web-api',
    }));
  });

  it('does not issue a token when the transaction rejects a stale or unauthorized transition', async () => {
    const issue = vi.fn(async () => 'unreachable');
    const { service } = setup({
      repository: {
        createIfGenerationCurrent: async () => ({ status: 'invalid_session' }),
        revokeById: async () => ({ status: 'revoked' }),
        transitionContext: async () => ({
          status: 'rejected',
          reason: 'version_conflict',
        }),
      },
      tokenIssuer: { issue },
    });

    await expect(service.transitionContext({
      claims: webClaims(),
      target: { kind: 'global' },
    })).resolves.toEqual({
      ok: false,
      error: {
        reason: 'context_transition_failed',
        cause: 'version_conflict',
      },
    });
    expect(issue).not.toHaveBeenCalled();
  });

  it('revokes the transitioned session if new JWT signing fails', async () => {
    const transitionedSession = { ...createdSession('session-a'), contextVersion: 1 };
    const revokeById = vi.fn(async () => ({ status: 'revoked' as const }));
    const issue = vi.fn(async () => {
      throw new Error('signing failed');
    });
    const { service } = setup({
      repository: {
        createIfGenerationCurrent: async () => ({ status: 'invalid_session' }),
        revokeById,
        transitionContext: async () => ({
          status: 'transitioned',
          session: transitionedSession,
        }),
      },
      tokenIssuer: { issue },
    });

    await expect(service.transitionContext({
      claims: webClaims(),
      target: { kind: 'global' },
    })).resolves.toMatchObject({
      ok: false,
      error: { reason: 'jwt_issuance_failed', compensation: { revoked: true } },
    });
    expect(revokeById).toHaveBeenCalledWith({
      sessionId: 'session-a',
      userId,
      nowEpochMs: now,
    });
  });

  it('does not issue a JWT when the generation changed before session creation', async () => {
    const issue = vi.fn(async () => 'unreachable');
    const { service } = setup({
      repository: {
        createIfGenerationCurrent: async () => ({
          status: 'generation_changed',
          currentGeneration: '8',
        }),
        revokeById: async () => ({ status: 'not_found' }),
        transitionContext: async () => ({
          status: 'rejected',
          reason: 'invalid_selection',
        }),
      },
      tokenIssuer: { issue },
    });

    await expect(service.createForAuthenticatedUser({
      userId,
      expectedGeneration: generation,
    })).resolves.toEqual({
      ok: false,
      error: {
        reason: 'session_creation_failed',
        cause: 'generation_changed',
      },
    });
    expect(issue).not.toHaveBeenCalled();
  });

  it('does not issue a JWT for a non-admissible account', async () => {
    const issue = vi.fn(async () => 'unreachable');
    const { service } = setup({
      repository: {
        createIfGenerationCurrent: async () => ({ status: 'account_not_admissible' }),
        revokeById: async () => ({ status: 'not_found' }),
        transitionContext: async () => ({
          status: 'rejected',
          reason: 'invalid_selection',
        }),
      },
      tokenIssuer: { issue },
    });

    await expect(service.createForAuthenticatedUser({
      userId,
      expectedGeneration: generation,
    })).resolves.toMatchObject({
      ok: false,
      error: { reason: 'session_creation_failed', cause: 'account_not_admissible' },
    });
    expect(issue).not.toHaveBeenCalled();
  });

  it('revokes the committed session and returns no token when signing fails', async () => {
    const issue = vi.fn(async () => {
      throw new Error('signing failed');
    });
    const { service, revokeById } = setup({ tokenIssuer: { issue } });

    await expect(service.createForAuthenticatedUser({
      userId,
      expectedGeneration: generation,
    })).resolves.toMatchObject({
      ok: false,
      error: { reason: 'jwt_issuance_failed', compensation: { revoked: true } },
    });
    expect(revokeById).toHaveBeenCalledWith({
      sessionId: 'session-a',
      userId,
      nowEpochMs: now,
    });
  });

  it('revokes a malformed committed session and never returns its token', async () => {
    const revokeById = vi.fn(async () => ({ status: 'revoked' as const }));
    const issue = vi.fn(async () => 'unreachable');
    const { service } = setup({
      repository: {
        createIfGenerationCurrent: async () => ({
          status: 'created',
          session: createdSession('unexpected-session'),
        }),
        revokeById,
        transitionContext: async () => ({
          status: 'rejected',
          reason: 'invalid_selection',
        }),
      },
      tokenIssuer: { issue },
    });

    await expect(service.createForAuthenticatedUser({
      userId,
      expectedGeneration: generation,
    })).resolves.toMatchObject({
      ok: false,
      error: { reason: 'session_creation_failed', cause: 'invalid_session' },
    });
    expect(revokeById).toHaveBeenCalledWith({
      sessionId: 'session-a',
      userId,
      nowEpochMs: now,
    });
    expect(issue).not.toHaveBeenCalled();
  });
});
