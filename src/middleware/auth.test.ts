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
    verifyJwt: mockVerifyJwt,
  };
});

import { requireOwnership, requireRole, type AuthRequest, verifyToken } from './auth';

const createMockRes = () => {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
};

describe('auth middleware access control', () => {
  beforeEach(() => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 'test-jwt-secret';
    mockDb.select.mockClear();
    mockWhere.mockClear();
    mockVerifyJwt.mockClear();
  });

  it('rejects simulated auth headers in production', async () => {
    const req = { headers: { 'x-simulated-role': 'super_admin' } } as any as AuthRequest;
    const res = createMockRes();
    const next = vi.fn();

    await verifyToken(req, res as any, next as any);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
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
    mockWhere.mockResolvedValueOnce([]);

    const req = { headers: { authorization: `Bearer ${token}` } } as any as AuthRequest;
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
    process.env.NODE_ENV = 'test';
    delete process.env.JWT_SECRET;

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
