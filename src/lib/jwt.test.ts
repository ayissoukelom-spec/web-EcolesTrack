import jwt from 'jsonwebtoken';
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

  it('includes issuer, audience, subject, and jwtid claims when provided', () => {
    const claims = { uid: 'user_5' };
    const token = signJwt(claims, secret, { expiresIn: '1h', issuer: 'test-issuer', audience: 'test-audience', subject: '42', jwtid: 'test-jti' });
    const verified = verifyJwt(token, secret);

    expect(verified.uid).toBe(claims.uid);
    expect(verified.iss).toBe('test-issuer');
    expect(verified.aud).toBe('test-audience');
    expect(verified.sub).toBe('42');
    expect(verified.jti).toBe('test-jti');
  });

  it('rejects a token with an unexpected audience', () => {
    const token = signJwt({ uid: 'user_6' }, secret, { expiresIn: '1h', issuer: 'test-issuer', audience: 'expected-audience', subject: '6', jwtid: 'test-jti' });
    expect(() => verifyJwt(token, secret, { audience: 'other-audience' })).toThrow(/jwt audience invalid|invalid audience/i);
  });

  it('rejects a token with an unexpected issuer', () => {
    const token = signJwt({ uid: 'user_7' }, secret, { expiresIn: '1h', issuer: 'expected-issuer', audience: 'test-audience', subject: '7', jwtid: 'test-jti' });
    expect(() => verifyJwt(token, secret, { issuer: 'other-issuer' })).toThrow(/jwt issuer invalid|invalid issuer/i);
  });

  it('accepts a token without issuer or audience when no expected values are configured', () => {
    const token = signJwt({ uid: 'user_8' }, secret, { expiresIn: '1h', subject: '8', jwtid: 'test-jti' });
    const verified = verifyJwt(token, secret);
    expect(verified.uid).toBe('user_8');
  });

  it('rejects a token before its not-before time', () => {
    const token = jwt.sign({ uid: 'user_9' }, secret, { algorithm: 'HS256', notBefore: '10s', expiresIn: '1h' });
    expect(() => verifyJwt(token, secret)).toThrow(/jwt not active|not before/i);
  });

  it('rejects signing when secret is absent', () => {
    expect(() => signJwt({ uid: 'user_4' } as any, '', { expiresIn: '1h' })).toThrow(/JWT secret is required/i);
  });

  it('rejects a malformed token', () => {
    expect(() => verifyJwt('not-a-valid-token', secret)).toThrow(/jwt malformed/i);
  });
});
