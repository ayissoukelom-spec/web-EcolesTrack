import {
  signJwt,
  verifyJwt,
} from '../lib/jwt.ts';
import type {
  JwtExpiresIn,
  JwtSignOptions,
  JwtSignPayload,
  JwtVerifiedPayload,
  JwtVerifyOptions,
} from '../lib/jwt.ts';
import {
  DEFAULT_ACCESS_JWT_AUDIENCE,
  DEFAULT_ACCESS_JWT_ISSUER,
  validateAccessJwtClaims,
} from './accessJwtContract.ts';
import type {
  AccessJwtClaims,
  AccessJwtValidationResult,
} from './accessJwtContract.ts';

const DEFAULT_JWT_EXPIRES_IN = '1h';

export interface AccessJwtSignerConfiguration {
  readonly issuer?: string;
  readonly audience?: string;
  readonly expiresIn?: string;
}

export interface AccessJwtSignerDependencies {
  readonly getSecret: () => string | undefined;
  readonly sign: (
    payload: JwtSignPayload,
    secret: string,
    options: JwtSignOptions,
  ) => string;
  readonly verify: (
    token: string,
    secret: string,
    options: JwtVerifyOptions,
  ) => JwtVerifiedPayload;
  readonly readConfiguration: () => AccessJwtSignerConfiguration;
  readonly nowEpochSeconds: () => number;
}

export type AccessJwtSignerVerificationResult =
  | { readonly valid: true; readonly claims: AccessJwtClaims }
  | {
      readonly valid: false;
      readonly reason:
        | Extract<AccessJwtValidationResult, { readonly valid: false }>['reason']
        | 'invalid_configuration'
        | 'verification_failed';
    };

function defaultDependencies(): AccessJwtSignerDependencies {
  return {
    getSecret: () => {
      const webSecret = process.env.WEB_JWT_SECRET;
      if (!webSecret || webSecret === process.env.JWT_SECRET) return undefined;
      return webSecret;
    },
    sign: signJwt,
    verify: verifyJwt,
    readConfiguration: () => ({
      issuer: process.env.WEB_JWT_ISSUER,
      audience: process.env.WEB_JWT_AUDIENCE,
      expiresIn: process.env.WEB_JWT_EXPIRES_IN ?? process.env.JWT_EXPIRES_IN,
    }),
    nowEpochSeconds: () => Math.floor(Date.now() / 1000),
  };
}

function parseStrictExpiresIn(rawValue: string | undefined): JwtExpiresIn {
  if (rawValue === undefined) return DEFAULT_JWT_EXPIRES_IN;

  const value = rawValue.trim();
  if (!value) throw new Error('JWT_EXPIRES_IN must not be empty.');

  if (/^\d+$/.test(value)) {
    const seconds = Number(value);
    if (isPositiveSafeInteger(seconds)) return seconds;
    throw new Error('JWT_EXPIRES_IN must be a positive safe integer of seconds.');
  }

  const match = value.match(/^(\d+(?:\.\d+)?)(ms|s|m|h|d|w|y)$/);
  if (!match) throw new Error('JWT_EXPIRES_IN has an invalid format.');

  const amount = Number(match[1]);
  const unit = match[2];
  const secondsPerUnit: Record<string, number> = {
    ms: 0.001,
    s: 1,
    m: 60,
    h: 3_600,
    d: 86_400,
    w: 604_800,
    y: 31_557_600,
  };
  const durationSeconds = amount * (secondsPerUnit[unit] ?? Number.NaN);
  if (!Number.isFinite(durationSeconds) || durationSeconds < 1) {
    throw new Error('JWT_EXPIRES_IN must be at least one second for the access-token contract.');
  }
  if (!Number.isSafeInteger(Math.floor(durationSeconds))) {
    throw new Error('JWT_EXPIRES_IN exceeds the supported duration.');
  }

  return value as JwtExpiresIn;
}

export function accessJwtLifetimeSeconds(rawValue: string | undefined): number {
  const expiresIn = parseStrictExpiresIn(rawValue);
  if (typeof expiresIn === 'number') return expiresIn;

  const match = expiresIn.match(/^(\d+(?:\.\d+)?)(ms|s|m|h|d|w|y)$/);
  if (!match) throw new Error('JWT_EXPIRES_IN has an invalid format.');
  const secondsPerUnit: Record<string, number> = {
    ms: 0.001,
    s: 1,
    m: 60,
    h: 3_600,
    d: 86_400,
    w: 604_800,
    y: 31_557_600,
  };
  const durationSeconds = Number(match[1]) * secondsPerUnit[match[2]];
  const lifetimeSeconds = Math.floor(durationSeconds);
  if (!Number.isSafeInteger(lifetimeSeconds) || lifetimeSeconds < 1) {
    throw new Error('JWT_EXPIRES_IN must be at least one whole second.');
  }
  return lifetimeSeconds;
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function readStrictConfiguration(
  dependencies: AccessJwtSignerDependencies,
): {
  readonly issuer: string;
  readonly audience: string;
  readonly expiresIn: JwtExpiresIn;
} {
  const configuration = dependencies.readConfiguration();
  const issuer = configuration.issuer ?? DEFAULT_ACCESS_JWT_ISSUER;
  const audience = configuration.audience ?? DEFAULT_ACCESS_JWT_AUDIENCE;
  const expiresIn = parseStrictExpiresIn(configuration.expiresIn);

  if (!issuer.trim() || !audience.trim()) {
    throw new Error('JWT issuer and audience must not be empty.');
  }

  return { issuer, audience, expiresIn };
}

function claimsEqual(left: AccessJwtClaims, right: AccessJwtClaims): boolean {
  return left.sub === right.sub
    && left.sid === right.sid
    && left.cv === right.cv
    && left.jti === right.jti
    && left.iat === right.iat
    && left.exp === right.exp
    && left.iss === right.iss
    && JSON.stringify(left.aud) === JSON.stringify(right.aud);
}

export class AccessJwtSigner {
  private readonly dependencies: AccessJwtSignerDependencies;

  constructor(dependencies: Partial<AccessJwtSignerDependencies> = {}) {
    this.dependencies = { ...defaultDependencies(), ...dependencies };
  }

  async issue(claims: AccessJwtClaims): Promise<string> {
    const configuration = readStrictConfiguration(this.dependencies);
    const nowEpochSeconds = this.dependencies.nowEpochSeconds();
    const validation = validateAccessJwtClaims(claims, {
      issuer: configuration.issuer,
      audience: configuration.audience,
      nowEpochSeconds,
    });
    if (validation.valid === false) {
      throw new Error(`Access JWT claims rejected: ${validation.reason}.`);
    }

    const secret = this.dependencies.getSecret();
    if (!secret) throw new Error('JWT secret is not configured.');

    const payload: JwtSignPayload = {
      sid: validation.claims.sid,
      cv: validation.claims.cv,
      iat: validation.claims.iat,
      exp: validation.claims.exp,
    };
    const signOptions: JwtSignOptions = {
      issuer: configuration.issuer,
      audience: configuration.audience,
      subject: validation.claims.sub,
      jwtid: validation.claims.jti,
    };
    const token = this.dependencies.sign(payload, secret, signOptions);
    const signedClaims = this.verify(token);
    if (signedClaims.valid === false || !claimsEqual(signedClaims.claims, validation.claims)) {
      throw new Error('Signed JWT does not match the strict access-token contract.');
    }
    return token;
  }

  verify(token: string): AccessJwtSignerVerificationResult {
    let configuration: ReturnType<typeof readStrictConfiguration>;
    try {
      configuration = readStrictConfiguration(this.dependencies);
    } catch {
      return { valid: false, reason: 'invalid_configuration' };
    }

    try {
      const secret = this.dependencies.getSecret();
      if (!secret) return { valid: false, reason: 'invalid_configuration' };

      const decoded = this.dependencies.verify(token, secret, {
        issuer: configuration.issuer,
        audience: configuration.audience,
      });
      return validateAccessJwtClaims(decoded, {
        issuer: configuration.issuer,
        audience: configuration.audience,
        nowEpochSeconds: this.dependencies.nowEpochSeconds(),
      });
    } catch {
      return { valid: false, reason: 'verification_failed' };
    }
  }
}
