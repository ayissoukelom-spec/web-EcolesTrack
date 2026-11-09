import { randomUUID } from 'node:crypto';
import { db } from '../db/index.ts';
import {
  DEFAULT_ACCESS_JWT_AUDIENCE,
  DEFAULT_ACCESS_JWT_ISSUER,
} from './accessJwtContract.ts';
import { AccessJwtSigner, accessJwtLifetimeSeconds } from './accessJwtSigner.ts';
import { AccessSessionService } from './accessSessionService.ts';
import { DrizzleGenerationAwareAccessSessionStore } from './drizzleGenerationAwareAccessSessionStore.ts';

export const generationAwareAccessSessionStore = new DrizzleGenerationAwareAccessSessionStore(db);
export const accessJwtSigner = new AccessJwtSigner();

export type AccessSessionTokenRevocationResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly reason: 'invalid_token' | 'identity_mismatch' | 'invalid_session';
    };

export async function revokeAccessSessionToken(token: string): Promise<AccessSessionTokenRevocationResult> {
  const verification = accessJwtSigner.verify(token);
  if (!verification.valid) return { ok: false, reason: 'invalid_token' };

  const result = await generationAwareAccessSessionStore.revokeById({
    sessionId: verification.claims.sid,
    userId: Number(verification.claims.sub),
    nowEpochMs: Date.now(),
  });
  if (result.status === 'identity_mismatch' || result.status === 'invalid_session') {
    return { ok: false, reason: result.status };
  }
  return { ok: true };
}

export function createAccessSessionService(): AccessSessionService {
  const tokenLifetimeSeconds = accessJwtLifetimeSeconds(
    process.env.WEB_JWT_EXPIRES_IN ?? process.env.JWT_EXPIRES_IN,
  );
  return new AccessSessionService({
    repository: generationAwareAccessSessionStore,
    now: Date.now,
    identifiers: {
      createSessionId: randomUUID,
      createTokenId: randomUUID,
    },
    tokenIssuer: accessJwtSigner,
    issuer: process.env.WEB_JWT_ISSUER ?? DEFAULT_ACCESS_JWT_ISSUER,
    audience: process.env.WEB_JWT_AUDIENCE ?? DEFAULT_ACCESS_JWT_AUDIENCE,
    sessionLifetimeSeconds: tokenLifetimeSeconds,
    tokenLifetimeSeconds,
  });
}
