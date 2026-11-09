import jwt from 'jsonwebtoken';
import { describe, expect, it, vi } from 'vitest';
import {
  signJwt,
  verifyJwt,
} from '../lib/jwt.ts';
import type {
  AccessJwtSignerConfiguration,
  AccessJwtSignerDependencies,
} from './accessJwtSigner.ts';
import { AccessJwtSigner, accessJwtLifetimeSeconds } from './accessJwtSigner.ts';
import {
  DEFAULT_ACCESS_JWT_AUDIENCE,
  DEFAULT_ACCESS_JWT_ISSUER,
} from './accessJwtContract.ts';
import type { AccessJwtClaims } from './accessJwtContract.ts';
import { AccessSessionService } from './accessSessionService.ts';
import { createAccessSession } from './accessSessionLifecycle.ts';

const secret = 'access-signer-test-secret';
const nowEpochSeconds = 1_800_000_000;

function claims(overrides: Partial<AccessJwtClaims> = {}): AccessJwtClaims {
  return {
    sub: '12',
    sid: 'access-session-1',
    cv: 0,
    jti: 'jwt-id-1',
    iat: nowEpochSeconds,
    exp: nowEpochSeconds + 3_600,
    iss: DEFAULT_ACCESS_JWT_ISSUER,
    aud: DEFAULT_ACCESS_JWT_AUDIENCE,
    ...overrides,
  };
}

function signer(
  configuration: AccessJwtSignerConfiguration = {},
  dependencies: Partial<AccessJwtSignerDependencies> = {},
) {
  return new AccessJwtSigner({
    getSecret: () => secret,
    readConfiguration: () => configuration,
    nowEpochSeconds: () => nowEpochSeconds,
    ...dependencies,
  });
}

describe('AccessJwtSigner', () => {
  it('uses a Web-specific signing key and audience and refuses the legacy shared key', async () => {
    const previous = {
      webSecret: process.env.WEB_JWT_SECRET,
      legacySecret: process.env.JWT_SECRET,
      issuer: process.env.WEB_JWT_ISSUER,
      audience: process.env.WEB_JWT_AUDIENCE,
      expiresIn: process.env.WEB_JWT_EXPIRES_IN,
    };
    process.env.WEB_JWT_SECRET = secret;
    process.env.JWT_SECRET = 'legacy-web-or-mobile-secret';
    delete process.env.WEB_JWT_ISSUER;
    delete process.env.WEB_JWT_AUDIENCE;
    process.env.WEB_JWT_EXPIRES_IN = '1h';
    try {
      const adapter = new AccessJwtSigner({ nowEpochSeconds: () => nowEpochSeconds });
      const token = await adapter.issue(claims());
      expect(adapter.verify(token)).toMatchObject({
        valid: true,
        claims: {
          iss: 'ecoletrack-web',
          aud: 'ecoletrack-web-api',
        },
      });

      delete process.env.WEB_JWT_SECRET;
      expect(new AccessJwtSigner({ nowEpochSeconds: () => nowEpochSeconds }).verify(token)).toEqual({
        valid: false,
        reason: 'invalid_configuration',
      });

      process.env.WEB_JWT_SECRET = secret;
      process.env.JWT_SECRET = secret;
      await expect(new AccessJwtSigner({ nowEpochSeconds: () => nowEpochSeconds }).issue(claims()))
        .rejects.toThrow(/JWT secret is not configured/);
    } finally {
      if (previous.webSecret === undefined) delete process.env.WEB_JWT_SECRET;
      else process.env.WEB_JWT_SECRET = previous.webSecret;
      if (previous.legacySecret === undefined) delete process.env.JWT_SECRET;
      else process.env.JWT_SECRET = previous.legacySecret;
      if (previous.issuer === undefined) delete process.env.WEB_JWT_ISSUER;
      else process.env.WEB_JWT_ISSUER = previous.issuer;
      if (previous.audience === undefined) delete process.env.WEB_JWT_AUDIENCE;
      else process.env.WEB_JWT_AUDIENCE = previous.audience;
      if (previous.expiresIn === undefined) delete process.env.WEB_JWT_EXPIRES_IN;
      else process.env.WEB_JWT_EXPIRES_IN = previous.expiresIn;
    }
  });

  it.each([
    [undefined, 3_600],
    ['900', 900],
    ['15m', 900],
    ['1.5s', 1],
  ])('resolves %j to an integral session lifetime of %i seconds', (expiresIn, expected) => {
    expect(accessJwtLifetimeSeconds(expiresIn)).toBe(expected);
  });

  it('signs and verifies exactly the eight strict contract claims without legacy or authority claims', async () => {
    const adapter = signer();
    const token = await adapter.issue(claims());
    const decoded = verifyJwt(token, secret);
    const verified = adapter.verify(token);

    expect(Object.keys(decoded).sort()).toEqual([
      'aud',
      'cv',
      'exp',
      'iat',
      'iss',
      'jti',
      'sid',
      'sub',
    ]);
    expect(decoded).toEqual(claims());
    expect(verified).toEqual({ valid: true, claims: claims() });
    expect(jwt.decode(token, { complete: true })).toMatchObject({
      header: { alg: 'HS256' },
    });
  });

  it('uses the existing one-hour expiry only when JWT_EXPIRES_IN is absent', async () => {
    const token = await signer({}).issue(claims());
    expect(verifyJwt(token, secret).exp).toBe(nowEpochSeconds + 3_600);
  });

  it('accepts numeric seconds and text durations when claims have matching expiration', async () => {
    const numericToken = await signer({ expiresIn: '900' }).issue(claims({
      exp: nowEpochSeconds + 900,
    }));
    const durationToken = await signer({ expiresIn: '1h' }).issue(claims());

    expect(verifyJwt(numericToken, secret).exp).toBe(nowEpochSeconds + 900);
    expect(verifyJwt(durationToken, secret).exp).toBe(nowEpochSeconds + 3_600);
  });

  it.each([
    '',
    '   ',
    'not-a-duration',
    '0',
    '0s',
    '-1',
    '-1s',
    '0.5s',
    '900.0',
  ])('rejects explicitly invalid JWT_EXPIRES_IN value %j without signing', async (expiresIn) => {
    const sign = vi.fn(signJwt);
    const adapter = signer({ expiresIn }, { sign });

    await expect(adapter.issue(claims())).rejects.toThrow(/JWT_EXPIRES_IN/);
    expect(sign).not.toHaveBeenCalled();
  });

  it('accepts a one-second duration as the shortest whole-second access token', async () => {
    const token = await signer({ expiresIn: '1s' }).issue(claims({
      exp: nowEpochSeconds + 1,
    }));

    expect(verifyJwt(token, secret).exp).toBe(nowEpochSeconds + 1);
    expect(signer({ expiresIn: '1s' }).verify(token)).toMatchObject({
      valid: true,
      claims: { iat: nowEpochSeconds, exp: nowEpochSeconds + 1 },
    });
  });

  it('uses the default when the variable is absent', async () => {
    const token = await signer({ expiresIn: undefined }).issue(claims());
    expect(verifyJwt(token, secret).exp).toBe(nowEpochSeconds + 3_600);
  });

  it('reports invalid expiry configuration when verifying', async () => {
    const token = await signer().issue(claims());

    expect(signer({ expiresIn: '  ' }).verify(token)).toEqual({
      valid: false,
      reason: 'invalid_configuration',
    });
  });

  it('rejects numeric values that exceed safe integer seconds', async () => {
    await expect(signer({ expiresIn: String(Number.MAX_SAFE_INTEGER + 1) }).issue(claims()))
      .rejects.toThrow(/positive safe integer/);
  });

  it('rejects positive sub-second durations because they cannot produce a valid integral exp claim', async () => {
    for (const expiresIn of ['1ms', '500ms', '0.9s']) {
      await expect(signer({ expiresIn }).issue(claims({
        exp: nowEpochSeconds + 1,
      }))).rejects.toThrow(/at least one second/);
    }
  });

  it('rejects zero or negative effective expiry and preserves the supplied contract exp', async () => {
    for (const expiresIn of ['0', '0s']) {
      await expect(signer({ expiresIn }).issue(claims({
        exp: nowEpochSeconds,
      }))).rejects.toThrow(/JWT_EXPIRES_IN|claims rejected/i);
    }

    const boundedClaims = claims({ exp: nowEpochSeconds + 120 });
    const boundedToken = await signer({ expiresIn: '900' }).issue(boundedClaims);
    expect(signer({ expiresIn: '900' }).verify(boundedToken)).toEqual({
      valid: true,
      claims: boundedClaims,
    });
  });

  it('rejects incoherent timestamps before invoking the signer', async () => {
    const sign = vi.fn(signJwt);
    const adapter = signer({}, { sign });

    await expect(adapter.issue(claims({ exp: nowEpochSeconds })))
      .rejects.toThrow(/claims rejected/i);
    await expect(adapter.issue(claims({ iat: nowEpochSeconds + 1 })))
      .rejects.toThrow(/claims rejected/i);
    expect(sign).not.toHaveBeenCalled();
  });

  it('rejects a token with an unexpected issuer or audience', async () => {
    const token = await signer().issue(claims());

    expect(signer({ issuer: 'other-issuer' }).verify(token).valid).toBe(false);
    expect(signer({ audience: 'other-audience' }).verify(token).valid).toBe(false);
  });

  it('rejects expired tokens', async () => {
    const token = signJwt({
      sid: 'access-session-1',
      cv: 0,
      iat: nowEpochSeconds - 3_600,
    }, secret, {
      expiresIn: 1,
      issuer: DEFAULT_ACCESS_JWT_ISSUER,
      audience: DEFAULT_ACCESS_JWT_AUDIENCE,
      subject: '12',
      jwtid: 'jwt-id-1',
    });
    const expiredVerifier = signer({}, {
      nowEpochSeconds: () => nowEpochSeconds,
    });

    expect(expiredVerifier.verify(token)).toEqual({
      valid: false,
      reason: 'expired_token',
    });
  });

  it('rejects a signed payload containing additional authority claims', () => {
    const token = signJwt({
      sid: 'access-session-1',
      cv: 0,
      iat: nowEpochSeconds,
      role: 'super_admin',
    }, secret, {
      expiresIn: 3_600,
      issuer: DEFAULT_ACCESS_JWT_ISSUER,
      audience: DEFAULT_ACCESS_JWT_AUDIENCE,
      subject: '12',
      jwtid: 'jwt-id-1',
    });

    expect(signer().verify(token)).toEqual({
      valid: false,
      reason: 'untrusted_authority_claim',
    });
  });

  it('does not duplicate algorithm or secret configuration when delegating cryptography', async () => {
    const sign = vi.fn(signJwt);
    const getSecret = vi.fn(() => secret);
    const adapter = signer({}, { sign, getSecret });

    await adapter.issue(claims());

    expect(getSecret).toHaveBeenCalledTimes(2);
    expect(sign).toHaveBeenCalledWith(
      { sid: 'access-session-1', cv: 0, iat: nowEpochSeconds, exp: nowEpochSeconds + 3_600 },
      secret,
      {
        issuer: DEFAULT_ACCESS_JWT_ISSUER,
        audience: DEFAULT_ACCESS_JWT_AUDIENCE,
        subject: '12',
        jwtid: 'jwt-id-1',
      },
    );
    expect(sign.mock.calls[0]?.[2]).not.toHaveProperty('algorithm');
  });

  it('can be injected into AccessSessionService with the generation-aware repository contract', async () => {
    const adapter = signer({ expiresIn: '900' });
    const service = new AccessSessionService({
      repository: {
        createIfGenerationCurrent: async (input) => {
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
        },
        revokeById: async () => ({ status: 'revoked' }),
        transitionContext: async () => ({
          status: 'rejected',
          reason: 'invalid_selection',
        }),
      },
      now: () => nowEpochSeconds * 1000,
      identifiers: {
        createSessionId: () => 'service-session-1',
        createTokenId: () => 'service-jwt-1',
      },
      tokenIssuer: adapter,
      sessionLifetimeSeconds: 3_600,
      tokenLifetimeSeconds: 900,
    });

    const result = await service.createForAuthenticatedUser({ userId: 12, expectedGeneration: '1' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(adapter.verify(result.accessToken)).toMatchObject({
      valid: true,
      claims: {
        sub: '12',
        sid: 'service-session-1',
        cv: 0,
        jti: 'service-jwt-1',
        exp: nowEpochSeconds + 900,
      },
    });
  });

  it('signs and verifies a transition token bounded by the existing session expiration', async () => {
    const adapter = signer({ expiresIn: '900' });
    const service = new AccessSessionService({
      repository: {
        createIfGenerationCurrent: async () => ({ status: 'user_not_found' }),
        revokeById: async () => ({ status: 'revoked' }),
        transitionContext: async () => ({
          status: 'transitioned',
          session: {
            sessionId: 'access-session-1',
            userId: 12,
            observedGeneration: '1',
            status: 'active',
            contextVersion: 1,
            expiresAtEpochMs: (nowEpochSeconds + 120) * 1000,
            context: null,
          },
        }),
      },
      now: () => nowEpochSeconds * 1000,
      identifiers: {
        createSessionId: () => 'unused-session',
        createTokenId: () => 'transition-jwt-1',
      },
      tokenIssuer: adapter,
      sessionLifetimeSeconds: 3_600,
      tokenLifetimeSeconds: 900,
    });

    const result = await service.transitionContext({
      claims: claims(),
      target: { kind: 'global' },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.expiresAtEpochSeconds).toBe(nowEpochSeconds + 120);
    expect(result.expiresAtEpochSeconds).toBeLessThan(nowEpochSeconds + 900);
    expect(adapter.verify(result.accessToken)).toMatchObject({
      valid: true,
      claims: {
        sid: 'access-session-1',
        cv: 1,
        jti: 'transition-jwt-1',
        iat: nowEpochSeconds,
        exp: nowEpochSeconds + 120,
      },
    });
  });

  it('uses injected signing and verification functions', async () => {
    const sign = vi.fn(signJwt);
    const verify = vi.fn(verifyJwt);
    const adapter = signer({}, { sign, verify });

    const token = await adapter.issue(claims());

    expect(sign).toHaveBeenCalledTimes(1);
    expect(verify).toHaveBeenCalled();
    expect(adapter.verify(token).valid).toBe(true);
    expect(verify).toHaveBeenCalledWith(
      token,
      secret,
      { issuer: DEFAULT_ACCESS_JWT_ISSUER, audience: DEFAULT_ACCESS_JWT_AUDIENCE },
    );
  });
});
