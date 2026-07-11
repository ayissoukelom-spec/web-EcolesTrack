import { describe, expect, it } from 'vitest';
import { signJwt, verifyJwt } from './jwt';

const secret = 'test-jwt-secret';
const invalidSecret = 'invalid-secret';

describe('JWT utilities', () => {
  it('signs and verifies a valid token', () => {
    const payload = { uid: 'user_1', email: 'user@example.com', role: 'teacher' };
    const token = signJwt(payload, secret, { expiresIn: '1h' });
    const verified = verifyJwt(token, secret);

    expect(verified.uid).toBe(payload.uid);
    expect(verified.email).toBe(payload.email);
    expect(verified.role).toBe(payload.role);
    expect(typeof verified.iat).toBe('number');
    expect(typeof verified.exp).toBe('number');
  });

  it('rejects an expired token', () => {
    const token = signJwt({ uid: 'user_2' }, secret, { expiresIn: '-1s' });
    expect(() => verifyJwt(token, secret)).toThrow(/expired|jwt expired/i);
  });

  it('rejects a token with an invalid signature', () => {
    const token = signJwt({ uid: 'user_3' }, secret, { expiresIn: '1h' });
    expect(() => verifyJwt(token, invalidSecret)).toThrow(/invalid signature/i);
  });

  it('signs and verifies an empty payload when provided explicitly', () => {
    const token = signJwt({} as any, secret, { expiresIn: '1h' });
    const verified = verifyJwt(token, secret);
    expect(verified).toBeDefined();
  });

  it('includes issuer, subject, and jwtid claims when provided', () => {
    const claims = { uid: 'user_5' };
    const token = signJwt(claims, secret, { expiresIn: '1h', issuer: 'test-issuer', subject: '42', jwtid: 'test-jti' });
    const verified = verifyJwt(token, secret);

    expect(verified.uid).toBe(claims.uid);
    expect(verified.iss).toBe('test-issuer');
    expect(verified.sub).toBe('42');
    expect(verified.jti).toBe('test-jti');
  });

  it('rejects signing when secret is absent', () => {
    expect(() => signJwt({ uid: 'user_4' } as any, '', { expiresIn: '1h' })).toThrow(/JWT secret is required/i);
  });

  it('rejects a malformed token', () => {
    expect(() => verifyJwt('not-a-valid-token', secret)).toThrow(/jwt malformed/i);
  });
});
