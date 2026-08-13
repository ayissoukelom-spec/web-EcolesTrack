import jwt, { SignOptions, VerifyOptions } from 'jsonwebtoken';

export interface JwtPayload {
  uid: string;
  email?: string;
  name?: string;
  role?: string;
  schoolId?: number | null;
  [key: string]: unknown;
}

export type JwtExpiresIn = number | `${number}${'ms' | 's' | 'm' | 'h' | 'd' | 'w' | 'y'}`;
export type JwtSignAudience = string | string[];
export type JwtVerifyAudience = string | RegExp | [string | RegExp, ...(string | RegExp)[]];

export interface JwtSignOptions {
  expiresIn?: JwtExpiresIn;
  issuer?: string;
  audience?: JwtSignAudience;
  subject?: string;
  jwtid?: string;
}

export interface JwtVerifyOptions {
  issuer?: string;
  audience?: JwtVerifyAudience;
  subject?: string;
}

export interface JwtVerifiedPayload extends JwtPayload {
  iat?: number;
  exp?: number;
  iss?: string;
  aud?: string | string[];
  sub?: string;
  jti?: string;
}

const DEFAULT_JWT_ALGORITHM = 'HS256';

export function getJwtSecret(options: { isProduction?: boolean } = {}): string | undefined {
  const isProduction = options.isProduction ?? process.env.NODE_ENV === 'production';
  const secret = process.env.JWT_SECRET;
  if (typeof secret === 'string' && secret.trim()) {
    return secret;
  }
  return isProduction ? undefined : 'dev-jwt-secret';
}

export function signJwt(payload: JwtPayload, secret: string, options: JwtSignOptions = {}): string {
  if (!secret) {
    throw new Error('JWT secret is required to sign tokens');
  }

  const signOptions: SignOptions = {
    algorithm: DEFAULT_JWT_ALGORITHM,
  };

  if (options.expiresIn !== undefined) {
    signOptions.expiresIn = options.expiresIn;
  }
  if (options.issuer !== undefined) {
    signOptions.issuer = options.issuer;
  }
  if (options.audience !== undefined) {
    signOptions.audience = options.audience;
  }
  if (options.subject !== undefined) {
    signOptions.subject = options.subject;
  }
  if (options.jwtid !== undefined) {
    signOptions.jwtid = options.jwtid;
  }

  return jwt.sign(payload as string | Buffer | object, secret, signOptions);
}

export function verifyJwt(token: string, secret: string, options: JwtVerifyOptions = {}): JwtVerifiedPayload {
  if (!secret) {
    throw new Error('JWT secret is required to verify tokens');
  }

  const verifyOptions: VerifyOptions = {
    algorithms: [DEFAULT_JWT_ALGORITHM],
  };

  if (options.issuer !== undefined) {
    verifyOptions.issuer = options.issuer;
  }
  if (options.audience !== undefined) {
    verifyOptions.audience = options.audience;
  }
  if (options.subject !== undefined) {
    verifyOptions.subject = options.subject;
  }

  const decoded = jwt.verify(token, secret, verifyOptions);
  if (typeof decoded !== 'object' || decoded === null) {
    throw new Error('Invalid JWT payload');
  }

  return decoded as JwtVerifiedPayload;
}
