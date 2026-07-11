import jwt, { SignOptions } from 'jsonwebtoken';

export interface JwtPayload {
  uid: string;
  email?: string;
  name?: string;
  role?: string;
  schoolId?: number | null;
  [key: string]: unknown;
}

export interface JwtSignOptions {
  expiresIn?: string | number;
  issuer?: string;
  audience?: string;
  subject?: string;
  jwtid?: string;
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

export function verifyJwt(token: string, secret: string): JwtVerifiedPayload {
  if (!secret) {
    throw new Error('JWT secret is required to verify tokens');
  }

  const decoded = jwt.verify(token, secret, { algorithms: [DEFAULT_JWT_ALGORITHM] });
  if (typeof decoded !== 'object' || decoded === null) {
    throw new Error('Invalid JWT payload');
  }

  return decoded as JwtVerifiedPayload;
}
