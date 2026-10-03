import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Request, Response } from 'express';
import { verifyJwt } from './jwt.ts';

const mockWhere = vi.fn();
const mockInnerJoin = vi.fn(() => ({ where: mockWhere }));
const mockFrom = vi.fn(() => ({ where: mockWhere, innerJoin: mockInnerJoin }));
const mockUpdateWhere = vi.fn();
const mockSet = vi.fn(() => ({ where: mockUpdateWhere }));
const mockInsertValues = vi.fn();
const mockDb = {
  select: vi.fn(() => ({ from: mockFrom })),
  update: vi.fn(() => ({ set: mockSet })),
  insert: vi.fn(() => ({ values: mockInsertValues })),
};

vi.mock('../db/index.ts', () => ({
  db: mockDb,
}));

vi.mock('../db/schema.ts', () => ({
  users: {},
  parents: {},
  localAuths: {},
  userLoginEvents: {},
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
  mockInsertValues.mockResolvedValue(undefined);
  process.env.NODE_ENV = 'test';
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
    const response = (res.json as any).mock.calls[0][0];

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
    expect(mockInsertValues).toHaveBeenCalledWith({
      userId: userRecord.id,
      role: userRecord.role,
      schoolId: userRecord.schoolId,
      clientType: 'web',
    });

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
    expect(mockInnerJoin).not.toHaveBeenCalled();
  });

  it('keeps parent email login working with the existing password and token flow', async () => {
    const password = 'ParentSecret123!';
    const salt = 'parent-salt';
    const crypto = await import('node:crypto');
    const passwordHash = crypto.pbkdf2Sync(password, salt, 310000, 64, 'sha512').toString('hex');
    const userRecord = { id: 457, uid: 'parent_457', email: 'parent@example.com', name: 'Parent Example', role: 'parent', schoolId: 99 };

    mockWhere.mockResolvedValueOnce([userRecord]);
    mockWhere.mockResolvedValueOnce([{ passwordHash, salt, mustReset: false }]);

    const { handleLocalLogin } = await import('./localLogin.ts');
    const res = createMockRes() as Response;
    await handleLocalLogin({ body: { email: userRecord.email, password } } as Request, res);

    expect(res.status).not.toHaveBeenCalled();
    expect((res.json as any).mock.calls[0][0]).toMatchObject({ id: userRecord.id, role: 'parent', tokenType: 'access' });
    expect(mockInnerJoin).not.toHaveBeenCalled();
  });

  it.each([
    { input: '+228 78 23 45 67', countryCode: '+229', expected: ['22878234567'] },
    { input: '78 23 45 67', countryCode: '+228', expected: ['22878234567'] },
    { input: '78-23-45-67', countryCode: '+229', expected: ['22978234567'] },
    { input: '00229 78.23.45.67', countryCode: undefined, expected: ['22978234567'] },
    { input: '228-78-23-45-67', countryCode: '+228', expected: ['22878234567'] },
    { input: '78 23 45 67', countryCode: undefined, expected: [] },
  ])('normalizes $input with its country code', async ({ input, countryCode, expected }) => {
    const { normalizeParentLoginPhone } = await import('./localLogin.ts');
    expect(normalizeParentLoginPhone(input, countryCode)).toEqual(expected);
  });

  it.each([
    { input: '+228 78 23 45 67', countryCode: undefined, expected: '+22878234567' },
    { input: '00228 78-23-45-67', countryCode: undefined, expected: '+22878234567' },
    { input: '228 78-23-45-67', countryCode: undefined, expected: '+22878234567' },
    { input: '78 23 45 67', countryCode: '+228', expected: '+22878234567' },
    { input: '228 78-23-45-67', countryCode: '+228', expected: '+22878234567' },
    { input: '78 23 45 67', countryCode: undefined, expected: null },
    { input: '123', countryCode: undefined, expected: null },
    { input: '+228 90 ABC 00 00', countryCode: undefined, expected: null },
    { input: '   ', countryCode: '+228', expected: null },
  ])('canonicalizes $input for users.phone', async ({ input, countryCode, expected }) => {
    const { canonicalizeUserPhone } = await import('./localLogin.ts');
    expect(canonicalizeUserPhone(input, countryCode)).toBe(expected);
  });

  it('treats a null phone as absent', async () => {
    const { canonicalizeUserPhone } = await import('./localLogin.ts');
    expect(canonicalizeUserPhone(null)).toBeNull();
  });

  it.each([
    { input: '+228 78 23 45 67', countryCode: '+229', email: 'parent@example.com' },
    { input: '78 23 45 67', countryCode: '+229', email: '' },
  ])('authenticates a parent by phone ($input), even without an email value on the returned record', async ({ input, email }) => {
    const password = 'ParentSecret123!';
    const salt = 'parent-salt';
    const crypto = await import('node:crypto');
    const passwordHash = crypto.pbkdf2Sync(password, salt, 310000, 64, 'sha512').toString('hex');
    const userRecord = { id: 458, uid: 'parent_458', email, name: 'Parent Example', role: 'parent', schoolId: 99 };

    mockWhere.mockResolvedValueOnce([{ user: userRecord }]);
    mockWhere.mockResolvedValueOnce([{ passwordHash, salt, mustReset: false }]);

    const { handleLocalLogin } = await import('./localLogin.ts');
    const res = createMockRes() as Response;
    await handleLocalLogin({ body: { identifier: input, phoneCountryCode: '+229', password } } as Request, res);

    expect(res.status).not.toHaveBeenCalled();
    expect((res.json as any).mock.calls[0][0]).toMatchObject({ id: userRecord.id, role: 'parent', tokenType: 'access' });
    expect(mockInnerJoin).toHaveBeenCalledTimes(1);
  });

  it.each([
    { identifier: 'missing@example.com', phoneCountryCode: undefined, error: 'Email ou mot de passe invalide' },
    { identifier: '78 23 45 67', phoneCountryCode: '+228', error: 'Email ou mot de passe invalide' },
  ])('uses a generic authentication failure for unknown identifiers: $identifier', async ({ identifier, phoneCountryCode, error }) => {
    mockWhere.mockResolvedValueOnce([]);

    const { handleLocalLogin } = await import('./localLogin.ts');
    const res = createMockRes() as Response;
    await handleLocalLogin({ body: { identifier, phoneCountryCode, password: 'wrong' } } as Request, res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error });
    expect(JSON.stringify((res.json as any).mock.calls[0][0])).not.toMatch(/exists|aucun compte|numéro/i);
  });

  it.each([
    { identifier: 'parent@example.com', phone: false },
    { identifier: '78 23 45 67', phone: true },
  ])('does not distinguish a parent account with a wrong password for $identifier', async ({ identifier, phone }) => {
    const crypto = await import('node:crypto');
    const salt = 'parent-salt';
    const passwordHash = crypto.pbkdf2Sync('correct-password', salt, 310000, 64, 'sha512').toString('hex');
    const userRecord = { id: 459, uid: 'parent_459', email: 'parent@example.com', name: 'Parent Example', role: 'parent', schoolId: 99 };

    mockWhere.mockResolvedValueOnce(phone ? [{ user: userRecord }] : [userRecord]);
    mockWhere.mockResolvedValueOnce([{ passwordHash, salt, mustReset: false }]);

    const { handleLocalLogin } = await import('./localLogin.ts');
    const res = createMockRes() as Response;
    await handleLocalLogin({ body: { identifier, phoneCountryCode: phone ? '+228' : undefined, password: 'wrong-password' } } as Request, res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Email ou mot de passe invalide' });
    expect(mockInsertValues).not.toHaveBeenCalled();
  });

  it('rejects an ambiguous parent phone without selecting an arbitrary account', async () => {
    mockWhere.mockResolvedValueOnce([
      { user: { id: 460, role: 'parent' } },
      { user: { id: 461, role: 'parent' } },
    ]);

    const { handleLocalLogin } = await import('./localLogin.ts');
    const res = createMockRes() as Response;
    await handleLocalLogin({ body: { identifier: '78 23 45 67', phoneCountryCode: '+228', password: 'correct-password' } } as Request, res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Email ou mot de passe invalide' });
    expect(mockWhere).toHaveBeenCalledTimes(1);
  });

  it('does not allow a non-parent role to authenticate by phone', async () => {
    mockWhere.mockResolvedValueOnce([]);

    const { handleLocalLogin } = await import('./localLogin.ts');
    const res = createMockRes() as Response;
    await handleLocalLogin({ body: { identifier: '78 23 45 67', phoneCountryCode: '+228', password: 'correct-password' } } as Request, res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(mockInnerJoin).toHaveBeenCalledTimes(1);
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

  it('records one event for each successful login', async () => {
    const password = 'SuperSecret123!';
    const salt = 'test-salt';
    const crypto = await import('node:crypto');
    const passwordHash = crypto.pbkdf2Sync(password, salt, 310000, 64, 'sha512').toString('hex');
    const userRecord = {
      id: 654,
      uid: 'user_654',
      email: 'repeat@example.com',
      name: 'Repeat User',
      role: 'teacher',
      schoolId: 12,
    };
    const authRow = { passwordHash, salt, mustReset: false };

    mockWhere.mockResolvedValueOnce([userRecord]);
    mockWhere.mockResolvedValueOnce([authRow]);
    mockWhere.mockResolvedValueOnce([userRecord]);
    mockWhere.mockResolvedValueOnce([authRow]);

    const { handleLocalLogin } = await import('./localLogin.ts');
    const req = { body: { email: userRecord.email, password } } as Request;

    await handleLocalLogin(req, createMockRes() as Response);
    await handleLocalLogin(req, createMockRes() as Response);

    expect(mockInsertValues).toHaveBeenCalledTimes(2);
  });

  it('keeps a successful login when event recording fails', async () => {
    const password = 'SuperSecret123!';
    const salt = 'test-salt';
    const crypto = await import('node:crypto');
    const passwordHash = crypto.pbkdf2Sync(password, salt, 310000, 64, 'sha512').toString('hex');
    const userRecord = {
      id: 987,
      uid: 'user_987',
      email: 'event-error@example.com',
      name: 'Event Error User',
      role: 'teacher',
      schoolId: 3,
    };
    const authRow = { passwordHash, salt, mustReset: false };

    mockWhere.mockResolvedValueOnce([userRecord]);
    mockWhere.mockResolvedValueOnce([authRow]);
    mockInsertValues.mockRejectedValueOnce(new Error('event storage unavailable'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const { handleLocalLogin } = await import('./localLogin.ts');
    const res = createMockRes() as Response;
    await handleLocalLogin({ body: { email: userRecord.email, password } } as Request, res);

    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledTimes(1);
    expect((res.json as any).mock.calls[0][0]).toMatchObject({ tokenType: 'access' });
    errorSpy.mockRestore();
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

  it('does not record an event when the password is invalid', async () => {
    const crypto = await import('node:crypto');
    const userRecord = {
      id: 321,
      uid: 'user_321',
      email: 'wrong-password@example.com',
      name: 'Wrong Password User',
      role: 'teacher',
      schoolId: 4,
    };
    const salt = 'test-salt';
    const passwordHash = crypto.pbkdf2Sync('correct-password', salt, 310000, 64, 'sha512').toString('hex');

    mockWhere.mockResolvedValueOnce([userRecord]);
    mockWhere.mockResolvedValueOnce([{ passwordHash, salt, mustReset: false }]);

    const { handleLocalLogin } = await import('./localLogin.ts');
    const res = createMockRes() as Response;
    await handleLocalLogin({ body: { email: userRecord.email, password: 'wrong-password' } } as Request, res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(mockInsertValues).not.toHaveBeenCalled();
  });

  it('returns 500 when JWT secret is missing in production', async () => {
    delete process.env.JWT_SECRET;
    process.env.NODE_ENV = 'production';

    const password = 'SuperSecret123!';
    const salt = 'test-salt';
    const crypto = await import('node:crypto');
    const passwordHash = crypto.pbkdf2Sync(password, salt, 310000, 64, 'sha512').toString('hex');

    const userRecord = {
      id: 789,
      uid: 'user_789',
      email: 'prod@example.com',
      name: 'Prod User',
      role: 'teacher',
      schoolId: 7,
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

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'Server configuration error' });
  });

  it('returns 400 when email or password is missing', async () => {
    const { handleLocalLogin } = await import('./localLogin.ts');
    const req = { body: { email: 'user@example.com' } } as Request;
    const res = createMockRes() as Response;

    await handleLocalLogin(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'Missing login identifier or password' });
  });
});
