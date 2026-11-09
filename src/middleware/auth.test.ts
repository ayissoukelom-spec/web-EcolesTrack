import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextFunction } from 'express';

var mockVerifyAccessJwt: ReturnType<typeof vi.fn>;
var mockLoadWithGeneration: ReturnType<typeof vi.fn>;
var mockWhere: ReturnType<typeof vi.fn>;
var mockDb: { select: ReturnType<typeof vi.fn> };

vi.mock('../db/index.ts', () => {
  mockWhere = vi.fn();
  mockDb = {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: (...args: unknown[]) => {
          const query: Promise<unknown> = Promise.resolve(mockWhere(...args));
          return {
            limit: () => query,
            then: query.then.bind(query),
          };
        },
      })),
    })),
  };
  return { db: mockDb };
});

vi.mock('../server/accessSessionRuntime.ts', () => {
  mockVerifyAccessJwt = vi.fn();
  mockLoadWithGeneration = vi.fn();
  return {
    accessJwtSigner: { verify: (...args: unknown[]) => mockVerifyAccessJwt(...args) },
    generationAwareAccessSessionStore: {
      loadWithGeneration: (...args: unknown[]) => mockLoadWithGeneration(...args),
    },
  };
});

import {
  assertSimulatedAuthConfiguration,
  mapToAppRole,
  requireOwnership,
  requireRole,
  type AuthRequest,
  verifyToken,
} from './auth.ts';
import {
  DEFAULT_ACCESS_JWT_AUDIENCE,
  DEFAULT_ACCESS_JWT_ISSUER,
} from '../server/accessJwtContract.ts';
import {
  TEACHER_CONTROL_DOCUMENT_AUTH_COOKIE,
  TEACHER_CONTROL_TEACHER_DOCUMENT_PATH,
} from '../lib/teacherControl/security.ts';

const user = {
  id: 99,
  uid: 'user_99',
  email: 'user99@example.com',
  name: 'User NinetyNine',
  role: 'teacher',
  schoolId: 12,
  isDeleted: false,
};

function validClaims(overrides: Record<string, unknown> = {}) {
  const iat = Math.floor(Date.now() / 1000) - 5;
  return {
    sub: String(user.id),
    sid: 'web-session-99',
    cv: 0,
    jti: 'web-token-99',
    iat,
    exp: iat + 3600,
    iss: DEFAULT_ACCESS_JWT_ISSUER,
    aud: DEFAULT_ACCESS_JWT_AUDIENCE,
    ...overrides,
  };
}

function validSnapshot(claims = validClaims(), overrides: Record<string, unknown> = {}) {
  const userId = Number(claims.sub);
  return {
    session: {
      sessionId: claims.sid,
      userId,
      observedGeneration: '2',
      status: 'active',
      contextVersion: claims.cv,
      context: null,
      expiresAtEpochMs: Date.now() + 3_600_000,
      ...overrides,
    },
    currentGeneration: '2',
  };
}

function validLocalContext(role: 'parent' | 'teacher' | 'school_admin' | 'surveillant' = 'teacher') {
  return {
    kind: 'local',
    identity: { userId: user.id },
    active: { schoolId: 12, role },
    membershipId: 44,
  };
}

const createMockRes = () => {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  res.append = vi.fn().mockReturnValue(res);
  return res;
};

describe('Web access-session middleware', () => {
  beforeEach(() => {
    process.env.NODE_ENV = 'production';
    delete process.env.ALLOW_SIMULATED_AUTH;
    mockDb.select.mockClear();
    mockWhere.mockReset();
    mockVerifyAccessJwt.mockReset();
    mockLoadWithGeneration.mockReset();
  });

  it('rejects simulated auth headers in production', async () => {
    process.env.ALLOW_SIMULATED_AUTH = 'true';
    const req = { headers: { 'x-simulated-role': 'super_admin' } } as any as AuthRequest;
    const res = createMockRes();
    const next = vi.fn();

    await verifyToken(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(req.user).toBeUndefined();
  });

  it('rejects simulated-auth configuration in production', () => {
    process.env.ALLOW_SIMULATED_AUTH = 'true';
    expect(assertSimulatedAuthConfiguration).toThrow(
      'ALLOW_SIMULATED_AUTH=true is not allowed when NODE_ENV=production.',
    );
  });

  it('rejects a context-free session on protected routes after validating the session generation', async () => {
    const claims = validClaims();
    mockVerifyAccessJwt.mockReturnValueOnce({ valid: true, claims });
    mockLoadWithGeneration.mockResolvedValueOnce(validSnapshot(claims));
    mockWhere.mockResolvedValueOnce([user]).mockResolvedValueOnce([]);

    const req = { headers: { authorization: 'Bearer strict-web-token' } } as any as AuthRequest;
    const res = createMockRes();
    const next = vi.fn();

    await verifyToken(req, res, next);

    expect(mockLoadWithGeneration).toHaveBeenCalledWith(claims.sid);
    expect(next).not.toHaveBeenCalled();
    expect(req.user).toBeUndefined();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'ACCESS_CONTEXT_REQUIRED' }));
  });

  it('populates req.user from the exact active membership, not the historical account role', async () => {
    const claims = validClaims();
    const context = validLocalContext('surveillant');
    mockVerifyAccessJwt.mockReturnValueOnce({ valid: true, claims });
    mockLoadWithGeneration.mockResolvedValueOnce(validSnapshot(claims, { context }));
    mockWhere
      .mockResolvedValueOnce([user])
      .mockResolvedValueOnce([{ membershipId: 44, userId: user.id, schoolId: 12, role: 'surveillant' }])
      .mockResolvedValueOnce([{ id: 12, isSuspended: false }])
      .mockResolvedValueOnce([]);

    const req = {
      method: 'GET',
      path: '/api/protected',
      headers: { authorization: 'Bearer valid-access-token' },
    } as any as AuthRequest;
    const res = createMockRes();
    const next = vi.fn();

    await verifyToken(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.user).toMatchObject({
      role: 'surveillant',
      appRole: 'surveillant',
      schoolId: 12,
      accessContext: context,
    });
  });

  it('rejects a local context after its exact membership is removed', async () => {
    const claims = validClaims();
    mockVerifyAccessJwt.mockReturnValueOnce({ valid: true, claims });
    mockLoadWithGeneration.mockResolvedValueOnce(validSnapshot(claims, {
      context: validLocalContext('teacher'),
    }));
    mockWhere.mockResolvedValueOnce([user]).mockResolvedValueOnce([]);

    const req = {
      method: 'GET',
      path: '/api/protected',
      headers: { authorization: 'Bearer valid-access-token' },
    } as any as AuthRequest;
    const res = createMockRes();
    const next = vi.fn();

    await verifyToken(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'ACCESS_MEMBERSHIP_NOT_FOUND' }));
  });

  it('does not restore an administrator role from the historical account role when its membership is missing', async () => {
    const claims = validClaims();
    mockVerifyAccessJwt.mockReturnValueOnce({ valid: true, claims });
    mockLoadWithGeneration.mockResolvedValueOnce(validSnapshot(claims, {
      context: validLocalContext('school_admin'),
    }));
    mockWhere.mockResolvedValueOnce([{ ...user, role: 'school_admin' }]).mockResolvedValueOnce([]);

    const req = {
      method: 'GET',
      path: '/api/protected',
      headers: { authorization: 'Bearer test-token' },
    } as any as AuthRequest;
    const res = createMockRes();
    const next = vi.fn();

    await verifyToken(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'ACCESS_MEMBERSHIP_NOT_FOUND' }));
  });

  it('keeps an inactive administrator membership inactive', async () => {
    const claims = validClaims();
    mockVerifyAccessJwt.mockReturnValueOnce({ valid: true, claims });
    mockLoadWithGeneration.mockResolvedValueOnce(validSnapshot(claims, {
      context: validLocalContext('school_admin'),
    }));
    mockWhere
      .mockResolvedValueOnce([{ ...user, role: 'school_admin' }])
      .mockResolvedValueOnce([{
        membershipId: 44,
        userId: user.id,
        schoolId: 12,
        role: 'school_admin',
        isActive: false,
      }])
      .mockResolvedValueOnce([{ id: 12, isSuspended: false }]);

    const req = {
      method: 'GET',
      path: '/api/protected',
      headers: { authorization: 'Bearer test-token' },
    } as any as AuthRequest;
    const res = createMockRes();
    const next = vi.fn();

    await verifyToken(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'ACCESS_MEMBERSHIP_INACTIVE' }));
  });

  it('continues to authorize an active administrator membership', async () => {
    const claims = validClaims();
    const context = validLocalContext('school_admin');
    mockVerifyAccessJwt.mockReturnValueOnce({ valid: true, claims });
    mockLoadWithGeneration.mockResolvedValueOnce(validSnapshot(claims, { context }));
    mockWhere
      .mockResolvedValueOnce([{ ...user, role: 'teacher' }])
      .mockResolvedValueOnce([{
        membershipId: 44,
        userId: user.id,
        schoolId: 12,
        role: 'school_admin',
        isActive: true,
      }])
      .mockResolvedValueOnce([{ id: 12, isSuspended: false }])
      .mockResolvedValueOnce([]);

    const req = {
      method: 'GET',
      path: '/api/protected',
      headers: { authorization: 'Bearer test-token' },
    } as any as AuthRequest;
    const res = createMockRes();
    const next = vi.fn();

    await verifyToken(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.user).toMatchObject({
      role: 'school_admin',
      appRole: 'school_admin',
      schoolId: 12,
      accessContext: context,
    });
  });

  it('rejects a local context when the exact membership has become inactive', async () => {
    const claims = validClaims();
    mockVerifyAccessJwt.mockReturnValueOnce({ valid: true, claims });
    mockLoadWithGeneration.mockResolvedValueOnce(validSnapshot(claims, {
      context: validLocalContext('teacher'),
    }));
    mockWhere
      .mockResolvedValueOnce([user])
      .mockResolvedValueOnce([{
        membershipId: 44,
        userId: user.id,
        schoolId: 12,
        role: 'teacher',
        isActive: false,
      }])
      .mockResolvedValueOnce([{ id: 12, isSuspended: false }]);

    const req = {
      method: 'GET',
      path: '/api/protected',
      headers: { authorization: 'Bearer inactive-context-token' },
    } as any as AuthRequest;
    req.headers.authorization = 'Bearer inactive-context-token';
    const res = createMockRes();
    const next = vi.fn();

    await verifyToken(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'ACCESS_MEMBERSHIP_INACTIVE' }));
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('does not accept a school administrator account in the global super-admin context', async () => {
    const claims = validClaims();
    mockVerifyAccessJwt.mockReturnValueOnce({ valid: true, claims });
    mockLoadWithGeneration.mockResolvedValueOnce(validSnapshot(claims, {
      context: {
        kind: 'global',
        identity: { userId: user.id },
        globalRole: 'super_admin',
      },
    }));
    mockWhere.mockResolvedValueOnce([{ ...user, role: 'school_admin' }]);

    const req = {
      method: 'GET',
      path: '/api/protected',
      headers: { authorization: 'Bearer valid-access-token' },
    } as any as AuthRequest;
    const res = createMockRes();
    const next = vi.fn();

    await verifyToken(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'ACCESS_GLOBAL_ROLE_INVALID' }));
  });

  it('continues to accept the global super-admin context for a super-admin account', async () => {
    const claims = validClaims();
    const context = {
      kind: 'global',
      identity: { userId: user.id },
      globalRole: 'super_admin',
    } as const;
    mockVerifyAccessJwt.mockReturnValueOnce({ valid: true, claims });
    mockLoadWithGeneration.mockResolvedValueOnce(validSnapshot(claims, { context }));
    mockWhere
      .mockResolvedValueOnce([{ ...user, role: 'super_admin' }])
      .mockResolvedValueOnce([]);

    const req = {
      method: 'GET',
      path: '/api/protected',
      headers: { authorization: 'Bearer test-token' },
    } as any as AuthRequest;
    const res = createMockRes();
    const next = vi.fn();

    await verifyToken(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.user).toMatchObject({
      role: 'super_admin',
      appRole: 'super_admin',
      schoolId: null,
      accessContext: context,
    });
  });

  it('rejects legacy Web JWT claims without trying a permissive fallback', async () => {
    mockVerifyAccessJwt.mockReturnValueOnce({
      valid: false,
      reason: 'invalid_shape',
    });
    const req = {
      headers: {
        authorization: 'Bearer legacy-token',
        'x-simulated-role': 'teacher',
      },
    } as any as AuthRequest;
    const res = createMockRes();
    const next = vi.fn();

    await verifyToken(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Unauthorized: Invalid token' });
    expect(mockLoadWithGeneration).not.toHaveBeenCalled();
  });

  it('rejects malformed or unverifiable tokens', async () => {
    mockVerifyAccessJwt.mockReturnValueOnce({ valid: false, reason: 'verification_failed' });
    const req = { headers: { authorization: 'Bearer malformed' } } as any as AuthRequest;
    const res = createMockRes();
    const next = vi.fn();

    await verifyToken(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(mockLoadWithGeneration).not.toHaveBeenCalled();
  });

  it('surfaces missing Web JWT configuration as unavailable instead of treating it as bad credentials', async () => {
    mockVerifyAccessJwt.mockReturnValueOnce({ valid: false, reason: 'invalid_configuration' });
    const req = { headers: { authorization: 'Bearer token' } } as any as AuthRequest;
    const res = createMockRes();

    const nextMock = vi.fn();
    const next: NextFunction = (error?: unknown) => {
      nextMock(error);
    };
    await verifyToken(req, res, next);

    expect(nextMock).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Web access-token verification is not configured.',
      code: 'ACCESS_TOKEN_VERIFICATION_UNAVAILABLE',
    });
  });

  it('rejects a missing session', async () => {
    const claims = validClaims();
    mockVerifyAccessJwt.mockReturnValueOnce({ valid: true, claims });
    mockLoadWithGeneration.mockResolvedValueOnce(null);
    mockWhere.mockResolvedValueOnce([user]);

    const req = { headers: { authorization: 'Bearer token' } } as any as AuthRequest;
    const res = createMockRes();
    const next = vi.fn();

    await verifyToken(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Unauthorized: Access session not found' });
  });

  it('rejects revoked or expired sessions', async () => {
    for (const status of ['revoked', 'expired']) {
      const claims = validClaims({ sid: `session-${status}` });
      mockVerifyAccessJwt.mockReturnValueOnce({ valid: true, claims });
      mockLoadWithGeneration.mockResolvedValueOnce(validSnapshot(claims, { status }));
      mockWhere.mockResolvedValueOnce([user]);

      const req = { headers: { authorization: 'Bearer token' } } as any as AuthRequest;
      const res = createMockRes();
      const next = vi.fn();

      await verifyToken(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(401);
    }
  });

  it('rejects a stale context version and an identity mismatch', async () => {
    const staleClaims = validClaims({ cv: 1 });
    mockVerifyAccessJwt.mockReturnValueOnce({ valid: true, claims: staleClaims });
    mockLoadWithGeneration.mockResolvedValueOnce(validSnapshot(staleClaims, { contextVersion: 0 }));
    mockWhere.mockResolvedValueOnce([user]);
    const staleRes = createMockRes();
    const staleNext = vi.fn();
    await verifyToken(
      { headers: { authorization: 'Bearer stale-context' } } as any as AuthRequest,
      staleRes,
      staleNext,
    );
    expect(staleNext).not.toHaveBeenCalled();
    expect(staleRes.status).toHaveBeenCalledWith(409);

    const claims = validClaims();
    mockVerifyAccessJwt.mockReturnValueOnce({ valid: true, claims });
    mockLoadWithGeneration.mockResolvedValueOnce(validSnapshot(claims, { userId: 100 }));
    mockWhere.mockResolvedValueOnce([user]);
    const identityRes = createMockRes();
    const identityNext = vi.fn();
    await verifyToken(
      { headers: { authorization: 'Bearer wrong-user' } } as any as AuthRequest,
      identityRes,
      identityNext,
    );
    expect(identityNext).not.toHaveBeenCalled();
    expect(identityRes.status).toHaveBeenCalledWith(401);
  });

  it('rejects sessions created before a global generation change', async () => {
    const claims = validClaims();
    const snapshot = validSnapshot(claims);
    snapshot.currentGeneration = '3';
    mockVerifyAccessJwt.mockReturnValueOnce({ valid: true, claims });
    mockLoadWithGeneration.mockResolvedValueOnce(snapshot);
    mockWhere.mockResolvedValueOnce([user]);

    const req = { headers: { authorization: 'Bearer stale-generation' } } as any as AuthRequest;
    const res = createMockRes();
    const next = vi.fn();

    await verifyToken(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Unauthorized: Token revoked' });
  });

  it('rejects disabled accounts and still enforces the temporary-password restriction', async () => {
    const claims = validClaims();
    mockVerifyAccessJwt.mockReturnValueOnce({ valid: true, claims });
    mockLoadWithGeneration.mockResolvedValueOnce(validSnapshot(claims));
    mockWhere.mockResolvedValueOnce([{ ...user, isDeleted: true }]);
    const disabledRes = createMockRes();
    const disabledNext = vi.fn();
    await verifyToken(
      { headers: { authorization: 'Bearer disabled' } } as any as AuthRequest,
      disabledRes,
      disabledNext,
    );
    expect(disabledNext).not.toHaveBeenCalled();
    expect(disabledRes.json).toHaveBeenCalledWith({
      error: 'Unauthorized: Invalid token',
    });

    mockVerifyAccessJwt.mockReturnValueOnce({ valid: true, claims });
    mockLoadWithGeneration.mockResolvedValueOnce(validSnapshot(claims, { context: validLocalContext() }));
    mockWhere
      .mockResolvedValueOnce([user])
      .mockResolvedValueOnce([{ membershipId: 44, userId: user.id, schoolId: 12, role: 'teacher' }])
      .mockResolvedValueOnce([{ id: 12, isSuspended: false }])
      .mockResolvedValueOnce([{ mustReset: true }]);
    const resetRes = createMockRes();
    const resetNext = vi.fn();
    await verifyToken(
      {
        method: 'GET',
        path: '/api/protected',
        headers: { authorization: 'Bearer must-reset' },
      } as any as AuthRequest,
      resetRes,
      resetNext,
    );
    expect(resetNext).not.toHaveBeenCalled();
    expect(resetRes.status).toHaveBeenCalledWith(403);
    expect(resetRes.json).toHaveBeenCalledWith({
      error: 'Veuillez changer votre mot de passe avant de continuer.',
      code: 'PASSWORD_RESET_REQUIRED',
    });
  });

  it('allows the short-lived document cookie only on the teacher document route', async () => {
    const claims = validClaims();
    mockVerifyAccessJwt.mockReturnValueOnce({ valid: true, claims });
    mockLoadWithGeneration.mockResolvedValueOnce(validSnapshot(claims, { context: validLocalContext() }));
    mockWhere
      .mockResolvedValueOnce([user])
      .mockResolvedValueOnce([{ membershipId: 44, userId: user.id, schoolId: 12, role: 'teacher' }])
      .mockResolvedValueOnce([{ id: 12, isSuspended: false }])
      .mockResolvedValueOnce([]);
    const req = {
      method: 'GET',
      path: TEACHER_CONTROL_TEACHER_DOCUMENT_PATH,
      headers: { cookie: `${TEACHER_CONTROL_DOCUMENT_AUTH_COOKIE}=cookie-token` },
    } as any as AuthRequest;
    const res = createMockRes();
    const next = vi.fn();

    await verifyToken(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.append).toHaveBeenCalledWith('Set-Cookie', expect.stringContaining('Max-Age=0'));
  });

  it('supports simulated auth in tests only', async () => {
    process.env.NODE_ENV = 'test';
    mockWhere.mockResolvedValueOnce([]);
    const req = {
      headers: { 'x-simulated-role': 'teacher' },
    } as any as AuthRequest;
    const res = createMockRes();
    const next = vi.fn();

    await verifyToken(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.user?.simulated).toBe(true);
  });

  it('maps roles and preserves role/ownership guards', async () => {
    expect(mapToAppRole('surveillant')).toBe('surveillant');
    expect(mapToAppRole('school_admin')).toBe('school_admin');
    expect(mapToAppRole('super_admin')).toBe('super_admin');
    expect(mapToAppRole('admin')).toBeUndefined();

    const req = { user: { role: 'school_admin', appRole: 'school_admin' } } as any as AuthRequest;
    const next = vi.fn();
    const res = createMockRes();
    requireRole(['school_admin'])(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);

    const teacherOnlyNext = vi.fn();
    requireRole(['teacher'])(
      { user: { role: 'surveillant', appRole: 'surveillant' } } as any as AuthRequest,
      res,
      teacherOnlyNext,
    );
    expect(teacherOnlyNext).not.toHaveBeenCalled();

    const ownerAllowed = vi.fn(async () => true);
    const ownerDenied = vi.fn(async () => false);
    const allowedNext = vi.fn();
    const deniedNext = vi.fn();
    await requireOwnership(ownerAllowed)(req, res, allowedNext);
    await requireOwnership(ownerDenied)(req, res, deniedNext);
    expect(allowedNext).toHaveBeenCalledTimes(1);
    expect(deniedNext).not.toHaveBeenCalled();
  });
});
