import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Request, Response } from 'express';
import { verifyJwt } from './jwt.ts';

const mockWhere = vi.fn();
const mockUpdateWhere = vi.fn();
const mockSet = vi.fn(() => ({ where: mockUpdateWhere }));
const mockDb = {
  select: vi.fn(() => ({
    from: vi.fn(() => ({ where: mockWhere })),
  })),
  update: vi.fn(() => ({ set: mockSet })),
};

vi.mock('../db/index.ts', () => ({
  db: mockDb,
}));

vi.mock('../db/schema.ts', () => ({
  users: {},
  localAuths: {},
}));

const createMockRes = () => {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
};

beforeEach(() => {
  vi.clearAllMocks();
  mockUpdateWhere.mockResolvedValue(undefined);
  process.env.JWT_SECRET = 'test-jwt-secret';
  process.env.JWT_ISSUER = 'test-issuer';
  process.env.JWT_AUDIENCE = 'test-audience';
  process.env.JWT_EXPIRES_IN = '1h';
});

describe('handleLocalLogin', () => {
  it('returns a JWT token on successful login with expected claims', async () => {
    const password = 'SuperSecret123!';
    const salt = 'test-salt';
    const crypto = await import('node:crypto');
    const passwordHash = crypto.pbkdf2Sync(password, salt, 310000, 64, 'sha512').toString('hex');

    const userRecord = {
      id: 123,
      uid: 'user_123',
      email: 'user@example.com',
      name: 'User Example',
      role: 'teacher',
      schoolId: 42,
    };

    const authRow = {
      passwordHash,
      salt,
      mustReset: false,
    };

    mockWhere.mockResolvedValueOnce([userRecord]);
    mockWhere.mockResolvedValueOnce([authRow]);

    const { handleLocalLogin } = await import('./localLogin.ts');
    const req = { body: { email: userRecord.email, password } } as Request;
    const res = createMockRes() as Response;

    await handleLocalLogin(req, res);

    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledTimes(1);
    const response = res.json.mock.calls[0][0];

    expect(response).toMatchObject({
      id: userRecord.id,
      uid: userRecord.uid,
      email: userRecord.email,
      name: userRecord.name,
      role: userRecord.role,
      schoolId: userRecord.schoolId,
      mustReset: false,
      tokenType: 'access',
    });
    expect(typeof response.token).toBe('string');

    const decoded = verifyJwt(response.token, 'test-jwt-secret');
    expect(decoded.uid).toBe(userRecord.uid);
    expect(decoded.email).toBe(userRecord.email);
    expect(decoded.name).toBe(userRecord.name);
    expect(decoded.role).toBe(userRecord.role);
    expect(decoded.schoolId).toBe(userRecord.schoolId);
    expect(decoded.iss).toBe('test-issuer');
    expect(decoded.aud).toBe('test-audience');
    expect(decoded.sub).toBe(String(userRecord.id));
    expect(typeof decoded.iat).toBe('number');
    expect(typeof decoded.exp).toBe('number');
  });

  it('updates lastLoginAt for a successful parent login', async () => {
    const password = 'SuperSecret123!';
    const salt = 'test-salt';
    const crypto = await import('node:crypto');
    const passwordHash = crypto.pbkdf2Sync(password, salt, 310000, 64, 'sha512').toString('hex');

    const userRecord = {
      id: 456,
      uid: 'parent_456',
      email: 'parent@example.com',
      name: 'Parent Example',
      role: 'parent',
      schoolId: 99,
    };

    const authRow = {
      passwordHash,
      salt,
      mustReset: false,
    };

    mockWhere.mockResolvedValueOnce([userRecord]);
    mockWhere.mockResolvedValueOnce([authRow]);

    const { handleLocalLogin } = await import('./localLogin.ts');
    const req = { body: { email: userRecord.email, password } } as Request;
    const res = createMockRes() as Response;

    await handleLocalLogin(req, res);

    expect(mockDb.update).toHaveBeenCalledTimes(1);
    expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({ lastLoginAt: expect.any(Date) }));
    expect(mockUpdateWhere).toHaveBeenCalled();
  });

  it('returns 401 when login credentials are invalid', async () => {
    mockWhere.mockResolvedValueOnce([]);

    const { handleLocalLogin } = await import('./localLogin.ts');
    const req = { body: { email: 'missing@example.com', password: 'nope' } } as Request;
    const res = createMockRes() as Response;

    await handleLocalLogin(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Email ou mot de passe invalide' });
  });

  it('returns 400 when email or password is missing', async () => {
    const { handleLocalLogin } = await import('./localLogin.ts');
    const req = { body: { email: 'user@example.com' } } as Request;
    const res = createMockRes() as Response;

    await handleLocalLogin(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'Missing email or password' });
  });
});
