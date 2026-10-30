import { beforeEach, describe, expect, it, vi } from 'vitest';

var mockVerifyJwt: ReturnType<typeof vi.fn>;
var mockWhere: ReturnType<typeof vi.fn>;
var mockDb: { select: ReturnType<typeof vi.fn> };

vi.mock('../db/index.ts', () => {
  mockWhere = vi.fn();
  mockDb = {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: (...args: any[]) => mockWhere(...args),
      })),
    })),
  };
  return {
    db: mockDb,
  };
});

vi.mock('../lib/jwt.ts', () => {
  mockVerifyJwt = vi.fn();
  return {
    getJwtSecret: vi.fn(() => 'test-jwt-secret'),
    verifyJwt: mockVerifyJwt,
  };
});

import {
  assertSimulatedAuthConfiguration,
  mapToAppRole,
  requireOwnership,
  requireRole,
  type AuthRequest,
  verifyToken,
} from './auth';

const createMockRes = () => {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
};

describe('auth middleware access control', () => {
  beforeEach(() => {
    process.env.NODE_ENV = 'production';
    delete process.env.ALLOW_SIMULATED_AUTH;
    process.env.JWT_SECRET = 'test-jwt-secret';
    mockDb.select.mockClear();
    mockWhere.mockReset();
    mockVerifyJwt.mockClear();
  });

  it('rejects simulated auth headers in production', async () => {
    process.env.ALLOW_SIMULATED_AUTH = 'true';
    const req = { headers: { 'x-simulated-role': 'super_admin' } } as any as AuthRequest;
    const res = createMockRes();
    const next = vi.fn();

    await verifyToken(req, res as any, next as any);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(req.user).toBeUndefined();
  });

  it('rejects simulated auth configuration in production', () => {
    process.env.ALLOW_SIMULATED_AUTH = 'true';

    expect(assertSimulatedAuthConfiguration).toThrow(
      'ALLOW_SIMULATED_AUTH=true is not allowed when NODE_ENV=production.',
    );
  });

  it('accepts disabled simulated auth configuration in production', () => {
    process.env.ALLOW_SIMULATED_AUTH = 'false';

    expect(assertSimulatedAuthConfiguration).not.toThrow();
  });

  it('authorizes a valid JWT access token and populates req.user', async () => {
    const token = 'valid-token';
    const userRecord = {
      id: 99,
      uid: 'user_99',
      email: 'user99@example.com',
      name: 'User NinetyNine',
      role: 'teacher',
      schoolId: 12,
    };

    mockVerifyJwt.mockReturnValueOnce({
      uid: userRecord.uid,
      type: 'access',
      jti: 'jti-99',
      sub: String(userRecord.id),
    });
    mockWhere.mockResolvedValueOnce([]);
    mockWhere.mockResolvedValueOnce([userRecord]);
    mockWhere.mockResolvedValueOnce([]);
    mockWhere.mockResolvedValueOnce([]);

    const req = { headers: { authorization: `Bearer ${token}` } } as any as AuthRequest;
    const res = createMockRes();
    const next = vi.fn();

    await verifyToken(req, res as any, next as any);

    expect(next).toHaveBeenCalled();
    expect(req.user).toMatchObject({
      id: userRecord.id,
      uid: userRecord.uid,
      email: userRecord.email,
      name: userRecord.name,
      role: userRecord.role,
      appRole: 'teacher',
      schoolId: userRecord.schoolId,
    });
    expect(res.status).not.toHaveBeenCalled();
  });

  it('rejects a blacklisted access token', async () => {
    const token = 'revoked-token';
    const userRecord = {
      id: 99,
      uid: 'user_99',
      email: 'user99@example.com',
      name: 'User NinetyNine',
      role: 'teacher',
      schoolId: 12,
    };

    mockVerifyJwt.mockReturnValueOnce({
      uid: userRecord.uid,
      type: 'access',
      jti: 'jti-99',
    });
    mockWhere.mockResolvedValueOnce([{ token }]);
    mockWhere.mockResolvedValueOnce([userRecord]);

    const req = { headers: { authorization: `Bearer ${token}` } } as any as AuthRequest;
    const res = createMockRes();
    const next = vi.fn();

    await verifyToken(req, res as any, next as any);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('rejects a token when its jti is blacklisted', async () => {
    const token = 'revoked-token';
    const jti = 'jti-blacklisted';
    const userRecord = {
      id: 100,
      uid: 'user_100',
      email: 'user100@example.com',
      name: 'User OneHundred',
      role: 'teacher',
      schoolId: 12,
    };

    mockVerifyJwt.mockReturnValueOnce({
      uid: userRecord.uid,
      type: 'access',
      jti,
    });
    mockWhere.mockResolvedValueOnce([{ tokenJti: jti }]);
    mockWhere.mockResolvedValueOnce([userRecord]);

    const req = { headers: { authorization: `Bearer ${token}` } } as any as AuthRequest;
    const res = createMockRes();
    const next = vi.fn();

    await verifyToken(req, res as any, next as any);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('rejects a token for a soft-deleted user', async () => {
    const token = 'deleted-token';

    mockVerifyJwt.mockReturnValueOnce({
      uid: 'user_100',
      type: 'access',
      jti: 'jti-100',
    });
    mockWhere.mockResolvedValueOnce([]);
    mockWhere.mockResolvedValueOnce([{
      id: 100,
      uid: 'user_100',
      role: 'parent',
      isDeleted: true,
    }]);

    const req = { headers: { authorization: 'Bearer deleted-token' } } as any as AuthRequest;
    const res = createMockRes();
    const next = vi.fn();

    await verifyToken(req, res as any, next as any);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Ce compte est désactivé. Contactez votre administrateur.',
      code: 'ACCOUNT_DISABLED',
    });
  });

    it('rejects an access token issued before the latest account deactivation', async () => {
      mockVerifyJwt.mockReturnValueOnce({
        uid: 'user_99',
        type: 'access',
        jti: 'jti-before-deactivation',
        sub: '99',
        authRevocationEventId: 0,
      });
      mockWhere.mockResolvedValueOnce([]);
      mockWhere.mockResolvedValueOnce([{
        id: 99,
        uid: 'user_99',
        email: 'user99@example.com',
        name: 'User NinetyNine',
        role: 'teacher',
        schoolId: 12,
      }]);
      mockWhere.mockResolvedValueOnce([{ id: 21 }]);

      const req = { headers: { authorization: 'Bearer old-token' } } as any as AuthRequest;
      const res = createMockRes();
      const next = vi.fn();

      await verifyToken(req, res as any, next as any);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: 'Unauthorized: Token revoked' });
    });

    it('rejects the same old token after reactivation has recorded a revocation boundary', async () => {
      mockVerifyJwt.mockReturnValueOnce({
        uid: 'user_99',
        type: 'access',
        jti: 'jti-before-deactivation',
        sub: '99',
        authRevocationEventId: 0,
      });
      mockWhere.mockResolvedValueOnce([]);
      mockWhere.mockResolvedValueOnce([{
        id: 99,
        uid: 'user_99',
        email: 'user99@example.com',
        name: 'User NinetyNine',
        role: 'teacher',
        schoolId: 12,
        isDeleted: false,
      }]);
      mockWhere.mockResolvedValueOnce([{ id: 21 }, { id: 22 }]);

      const req = { headers: { authorization: 'Bearer new-token' } } as any as AuthRequest;
      const res = createMockRes();
      const next = vi.fn();

      await verifyToken(req, res as any, next as any);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: 'Unauthorized: Token revoked' });
    });

    it('rejects a parent token issued before deactivation even after the parent is reactivated', async () => {
      mockVerifyJwt.mockReturnValueOnce({
        uid: 'parent-uid',
        type: 'access',
        jti: 'parent-token-before-deactivation',
        sub: '600',
        authRevocationEventId: 0,
      });
      mockWhere.mockResolvedValueOnce([]);
      mockWhere.mockResolvedValueOnce([{
        id: 600,
        uid: 'parent-uid',
        email: 'parent@example.com',
        name: 'Parent Account',
        role: 'parent',
        schoolId: 12,
        isDeleted: false,
      }]);
      mockWhere.mockResolvedValueOnce([{ id: 31 }, { id: 32 }]);

      const req = { headers: { authorization: 'Bearer parent-token-before-deactivation' } } as any as AuthRequest;
      const res = createMockRes();
      const next = vi.fn();

      await verifyToken(req, res as any, next as any);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: 'Unauthorized: Token revoked' });
    });

    it('accepts a new token issued after reactivation using the current revocation event id', async () => {
      mockVerifyJwt.mockReturnValueOnce({
        uid: 'user_99',
        type: 'access',
        jti: 'jti-after-reactivation',
        sub: '99',
        authRevocationEventId: 22,
      });
      mockWhere.mockResolvedValueOnce([]);
      mockWhere.mockResolvedValueOnce([{
        id: 99,
        uid: 'user_99',
        email: 'user99@example.com',
        name: 'User NinetyNine',
        role: 'teacher',
        schoolId: 12,
        isDeleted: false,
      }]);
      mockWhere.mockResolvedValueOnce([{ id: 21 }, { id: 22 }]);
      mockWhere.mockResolvedValueOnce([]);

      const req = { headers: { authorization: 'Bearer reactivated-current-token' } } as any as AuthRequest;
      const res = createMockRes();
      const next = vi.fn();

      await verifyToken(req, res as any, next as any);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('rejects a legacy token without a revocation claim after an account has been reactivated', async () => {
      mockVerifyJwt.mockReturnValueOnce({
        uid: 'user_99',
        type: 'access',
        jti: 'legacy-token',
        sub: '99',
      });
      mockWhere.mockResolvedValueOnce([]);
      mockWhere.mockResolvedValueOnce([{
        id: 99,
        uid: 'user_99',
        email: 'user99@example.com',
        name: 'User NinetyNine',
        role: 'teacher',
        schoolId: 12,
        isDeleted: false,
      }]);
      mockWhere.mockResolvedValueOnce([{ id: 22 }]);

      const req = { headers: { authorization: 'Bearer legacy-token-after-reactivation' } } as any as AuthRequest;
      const res = createMockRes();
      const next = vi.fn();

      await verifyToken(req, res as any, next as any);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: 'Unauthorized: Token revoked' });
    });

    it('rejects simulated authentication for a real deleted account', async () => {
      process.env.NODE_ENV = 'test';
      mockWhere.mockResolvedValueOnce([{ id: 700, isDeleted: true }]);

      const req = {
        headers: {
          'x-simulated-role': 'teacher',
          'x-simulated-uid': 'deleted-teacher',
        },
      } as any as AuthRequest;
      const res = createMockRes();
      const next = vi.fn();

      await verifyToken(req, res as any, next as any);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(401);
      expect(req.user).toBeUndefined();
    });

    it('rejects simulated auth when the supplied email belongs to a deleted account', async () => {
      process.env.NODE_ENV = 'test';
      mockWhere.mockResolvedValueOnce([{ id: 701, isDeleted: false }]);
      mockWhere.mockResolvedValueOnce([{ id: 700, isDeleted: true }]);

      const req = {
        headers: {
          'x-simulated-role': 'teacher',
          'x-simulated-uid': 'active-uid',
          'x-simulated-email': 'DELETED@example.test',
        },
      } as any as AuthRequest;
      const res = createMockRes();
      const next = vi.fn();

      await verifyToken(req, res as any, next as any);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(401);
    });

  it('rejects a token when sub does not match the DB user id', async () => {
    const token = 'mismatched-sub-token';
    const userRecord = {
      id: 99,
      uid: 'user_99',
      email: 'user99@example.com',
      name: 'User NinetyNine',
      role: 'teacher',
      schoolId: 12,
    };

    mockVerifyJwt.mockReturnValueOnce({
      uid: userRecord.uid,
      type: 'access',
      jti: 'jti-99',
      sub: '100',
    });
    mockWhere.mockResolvedValueOnce([]);
    mockWhere.mockResolvedValueOnce([userRecord]);

    const req = { headers: { authorization: `Bearer ${token}` } } as any as AuthRequest;
    const res = createMockRes();
    const next = vi.fn();

    await verifyToken(req, res as any, next as any);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('restricts temporary-password tokens to password change and logout', async () => {
    mockVerifyJwt.mockReturnValueOnce({
      uid: 'user_99',
      type: 'access',
      jti: 'jti-99',
      sub: '99',
    });
    mockWhere.mockResolvedValueOnce([]);
    mockWhere.mockResolvedValueOnce([{
      id: 99,
      uid: 'user_99',
      email: 'user99@example.com',
      name: 'User NinetyNine',
      role: 'teacher',
      schoolId: 12,
    }]);
    mockWhere.mockResolvedValueOnce([]);
    mockWhere.mockResolvedValueOnce([{ mustReset: true }]);

    const req = {
      headers: { authorization: 'Bearer temporary-token' },
      method: 'GET',
      path: '/api/grades',
    } as any as AuthRequest;
    const res = createMockRes();
    const next = vi.fn();

    await verifyToken(req, res as any, next as any);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'PASSWORD_RESET_REQUIRED' }));
  });

  it('allows a temporary-password token to reach the password-change endpoint', async () => {
    mockVerifyJwt.mockReturnValueOnce({
      uid: 'user_99',
      type: 'access',
      jti: 'jti-99',
      sub: '99',
    });
    mockWhere.mockResolvedValueOnce([]);
    mockWhere.mockResolvedValueOnce([{
      id: 99,
      uid: 'user_99',
      email: 'user99@example.com',
      name: 'User NinetyNine',
      role: 'teacher',
      schoolId: 12,
    }]);
    mockWhere.mockResolvedValueOnce([]);
    mockWhere.mockResolvedValueOnce([{ mustReset: true }]);

    const req = {
      headers: { authorization: 'Bearer temporary-token' },
      method: 'POST',
      path: '/api/auth/change-password',
    } as any as AuthRequest;
    const res = createMockRes();
    const next = vi.fn();

    await verifyToken(req, res as any, next as any);

    expect(next).toHaveBeenCalled();
    expect(req.user?.id).toBe(99);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('rejects an invalid JWT signature without falling back to simulated auth', async () => {
    const token = 'invalid-token';
    mockVerifyJwt.mockImplementationOnce(() => {
      throw new Error('invalid signature');
    });

    const req = { headers: { authorization: `Bearer ${token}`, 'x-simulated-role': 'teacher' } } as any as AuthRequest;
    const res = createMockRes();
    const next = vi.fn();

    await verifyToken(req, res as any, next as any);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('rejects a non-access token type', async () => {
    const token = 'wrong-type-token';
    mockVerifyJwt.mockReturnValueOnce({
      uid: 'user_99',
      type: 'refresh',
      jti: 'jti-99',
    });

    const req = { headers: { authorization: `Bearer ${token}` } } as any as AuthRequest;
    const res = createMockRes();
    const next = vi.fn();

    await verifyToken(req, res as any, next as any);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('rejects an expired JWT token', async () => {
    const token = 'expired-token';
    mockVerifyJwt.mockImplementationOnce(() => {
      throw new Error('jwt expired');
    });

    const req = { headers: { authorization: `Bearer ${token}` } } as any as AuthRequest;
    const res = createMockRes();
    const next = vi.fn();

    await verifyToken(req, res as any, next as any);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('authorizes simulated auth headers in test when no token is present', async () => {
    process.env.NODE_ENV = 'development';
    process.env.ALLOW_SIMULATED_AUTH = 'true';
    delete process.env.JWT_SECRET;
    mockWhere.mockResolvedValueOnce([]);
    mockWhere.mockResolvedValueOnce([]);
    expect(assertSimulatedAuthConfiguration).not.toThrow();

    const req = {
      headers: {
        'x-simulated-role': 'teacher',
        'x-simulated-uid': 'sim_teacher_1',
        'x-simulated-email': 'teacher@sim.local',
        'x-simulated-name': 'Sim Teacher',
        'x-simulated-school-id': '7',
      },
    } as any as AuthRequest;
    const res = createMockRes();
    const next = vi.fn();

    await verifyToken(req, res as any, next as any);

    expect(next).toHaveBeenCalled();
    expect(req.user).toMatchObject({
      uid: 'sim_teacher_1',
      email: 'teacher@sim.local',
      name: 'Sim Teacher',
      role: 'teacher',
      appRole: 'teacher',
      schoolId: 7,
      simulated: true,
    });
  });

  it('autorise un role admin sur requireRole', () => {
    const req = { user: { appRole: 'admin' } } as any as AuthRequest;
    const res = createMockRes();
    const next = vi.fn();

    requireRole(['admin'])(req, res as any, next as any);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('mappe le rôle surveillant comme accès de type enseignant', () => {
    expect(mapToAppRole('surveillant')).toBe('teacher');
  });

  it('refuse un role parent sur une route admin/teacher', () => {
    const req = { user: { appRole: 'parent' } } as any as AuthRequest;
    const res = createMockRes();
    const next = vi.fn();

    requireRole(['admin', 'teacher'])(req, res as any, next as any);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('autorise owner quand resolver retourne true', async () => {
    const req = { user: { appRole: 'parent' } } as any as AuthRequest;
    const res = createMockRes();
    const next = vi.fn();

    const middleware = requireOwnership(async () => true, { bypassRoles: ['admin', 'teacher'] });
    await middleware(req, res as any, next as any);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('refuse owner quand resolver retourne false (cross-user)', async () => {
    const req = { user: { appRole: 'parent' } } as any as AuthRequest;
    const res = createMockRes();
    const next = vi.fn();

    const middleware = requireOwnership(async () => false, { bypassRoles: ['admin', 'teacher'] });
    await middleware(req, res as any, next as any);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });
});
