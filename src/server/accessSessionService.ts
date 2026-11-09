import type {
  AccessContextSelection,
  AccessSessionAtomicCreateResult,
  GenerationAwareContextTransitionResult,
  GenerationAwareAccessSessionStore,
} from './accessSessionRepository.ts';
import { isAccessSessionGeneration } from './accessContextValidation.ts';
import type { AccessSessionGeneration } from './accessContextValidation.ts';
import {
  DEFAULT_ACCESS_JWT_AUDIENCE,
  DEFAULT_ACCESS_JWT_ISSUER,
  validateAccessJwtClaims,
} from './accessJwtContract.ts';
import type { AccessJwtClaims } from './accessJwtContract.ts';

export interface AccessSessionServiceDependencies {
  readonly repository: Pick<
    GenerationAwareAccessSessionStore,
    'createIfGenerationCurrent' | 'revokeById' | 'transitionContext'
  >;
  readonly now: () => number;
  readonly identifiers: {
    readonly createSessionId: () => string;
    readonly createTokenId: () => string;
  };
  readonly tokenIssuer: {
    readonly issue: (claims: AccessJwtClaims) => Promise<string>;
  };
  readonly issuer?: string;
  readonly audience?: string;
  readonly sessionLifetimeSeconds: number;
  readonly tokenLifetimeSeconds: number;
}

type AccessSessionCompensation =
  | { readonly revoked: true }
  | {
      readonly revoked: false;
      readonly cause: 'repository_error';
    };

export type AccessSessionServiceFailure =
  | { readonly reason: 'invalid_identity' | 'invalid_configuration' | 'invalid_time' | 'invalid_identifier' }
  | { readonly reason: 'identifier_collision' }
  | {
      readonly reason: 'context_transition_failed';
      readonly cause: Exclude<
        GenerationAwareContextTransitionResult,
        { readonly status: 'transitioned' | 'unchanged' }
      >['reason'] | 'repository_error';
    }
  | {
      readonly reason: 'session_creation_failed';
      readonly cause: Exclude<AccessSessionAtomicCreateResult['status'], 'created'> | 'repository_error';
    }
  | {
      readonly reason: 'jwt_issuance_failed';
      readonly compensation: AccessSessionCompensation;
    };

export type AccessSessionServiceResult =
  | {
      readonly ok: true;
      readonly accessToken: string;
      readonly sessionId: string;
      readonly expiresAtEpochSeconds: number;
    }
  | { readonly ok: false; readonly error: AccessSessionServiceFailure };

export type AccessSessionContextTransitionResult =
  | {
      readonly ok: true;
      readonly changed: boolean;
      readonly accessToken: string;
      readonly contextVersion: number;
      readonly expiresAtEpochSeconds: number;
    }
  | { readonly ok: false; readonly error: AccessSessionServiceFailure };

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

export class AccessSessionService {
  constructor(private readonly dependencies: AccessSessionServiceDependencies) {}

  async transitionContext(input: {
    readonly claims: AccessJwtClaims;
    readonly target: AccessContextSelection;
  }): Promise<AccessSessionContextTransitionResult> {
    const userId = Number(input?.claims?.sub);
    if (
      !Number.isSafeInteger(userId)
      || userId <= 0
      || String(userId) !== input?.claims?.sub
      || typeof input.claims.sid !== 'string'
      || input.claims.sid.length === 0
      || !Number.isSafeInteger(input.claims.cv)
      || input.claims.cv < 0
    ) {
      return { ok: false, error: { reason: 'invalid_identity' } };
    }

    const tokenLifetimeSeconds = this.dependencies.tokenLifetimeSeconds;
    const issuer = this.dependencies.issuer ?? DEFAULT_ACCESS_JWT_ISSUER;
    const audience = this.dependencies.audience ?? DEFAULT_ACCESS_JWT_AUDIENCE;
    if (
      !isPositiveSafeInteger(tokenLifetimeSeconds)
      || typeof issuer !== 'string'
      || issuer.length === 0
      || typeof audience !== 'string'
      || audience.length === 0
    ) {
      return { ok: false, error: { reason: 'invalid_configuration' } };
    }

    let nowEpochMs: number;
    try {
      nowEpochMs = this.dependencies.now();
    } catch {
      return { ok: false, error: { reason: 'invalid_time' } };
    }
    if (!isPositiveSafeInteger(nowEpochMs)) {
      return { ok: false, error: { reason: 'invalid_time' } };
    }
    let jti: string;
    try {
      jti = this.dependencies.identifiers.createTokenId();
    } catch {
      return { ok: false, error: { reason: 'invalid_identifier' } };
    }
    if (typeof jti !== 'string' || jti.length === 0 || jti === input.claims.sid) {
      return { ok: false, error: { reason: 'invalid_identifier' } };
    }

    let transition: GenerationAwareContextTransitionResult;
    try {
      transition = await this.dependencies.repository.transitionContext({
        userId,
        sessionId: input.claims.sid,
        expectedContextVersion: input.claims.cv,
        target: input.target,
        nowEpochMs,
      });
    } catch {
      return {
        ok: false,
        error: { reason: 'context_transition_failed', cause: 'repository_error' },
      };
    }
    if (transition.status === 'rejected') {
      return {
        ok: false,
        error: {
          reason: 'context_transition_failed',
          cause: transition.reason,
        },
      };
    }

    const iat = Math.floor(nowEpochMs / 1000);
    const exp = Math.min(
      iat + tokenLifetimeSeconds,
      Math.floor(transition.session.expiresAtEpochMs / 1000),
    );
    if (!isPositiveSafeInteger(iat) || !isPositiveSafeInteger(exp) || exp <= iat) {
      if (transition.status === 'transitioned') {
        await this.revokeSession(userId, input.claims.sid, nowEpochMs);
      }
      return { ok: false, error: { reason: 'invalid_time' } };
    }

    const validatedClaims = validateAccessJwtClaims({
      sub: String(userId),
      sid: input.claims.sid,
      cv: transition.session.contextVersion,
      jti,
      iat,
      exp,
      iss: issuer,
      aud: audience,
    }, {
      issuer,
      audience,
      nowEpochSeconds: iat,
    });
    if (validatedClaims.valid === false) {
      if (transition.status === 'transitioned') {
        await this.revokeSession(userId, input.claims.sid, nowEpochMs);
      }
      return { ok: false, error: { reason: 'invalid_time' } };
    }

    try {
      const accessToken = await this.dependencies.tokenIssuer.issue(validatedClaims.claims);
      if (typeof accessToken !== 'string' || accessToken.length === 0) {
        throw new Error('JWT issuer returned an empty token.');
      }
      return {
        ok: true,
        changed: transition.status === 'transitioned',
        accessToken,
        contextVersion: transition.session.contextVersion,
        expiresAtEpochSeconds: exp,
      };
    } catch {
      const compensation = await this.revokeSession(userId, input.claims.sid, nowEpochMs);
      return {
        ok: false,
        error: { reason: 'jwt_issuance_failed', compensation },
      };
    }
  }

  async createForAuthenticatedUser(input: {
    readonly userId: number;
    readonly expectedGeneration: AccessSessionGeneration;
  }): Promise<AccessSessionServiceResult> {
    if (!isPositiveSafeInteger(input?.userId) || !isAccessSessionGeneration(input?.expectedGeneration)) {
      return { ok: false, error: { reason: 'invalid_identity' } };
    }

    const {
      sessionLifetimeSeconds,
      tokenLifetimeSeconds,
    } = this.dependencies;
    if (
      !isPositiveSafeInteger(sessionLifetimeSeconds)
      || !isPositiveSafeInteger(tokenLifetimeSeconds)
      || tokenLifetimeSeconds > sessionLifetimeSeconds
    ) {
      return { ok: false, error: { reason: 'invalid_configuration' } };
    }

    const issuer = this.dependencies.issuer ?? DEFAULT_ACCESS_JWT_ISSUER;
    const audience = this.dependencies.audience ?? DEFAULT_ACCESS_JWT_AUDIENCE;
    if (typeof issuer !== 'string' || issuer.length === 0 || typeof audience !== 'string' || audience.length === 0) {
      return { ok: false, error: { reason: 'invalid_configuration' } };
    }

    let nowEpochMs: number;
    try {
      nowEpochMs = this.dependencies.now();
    } catch {
      return { ok: false, error: { reason: 'invalid_time' } };
    }
    if (!isPositiveSafeInteger(nowEpochMs)) {
      return { ok: false, error: { reason: 'invalid_time' } };
    }

    let sessionId: string;
    let jti: string;
    try {
      sessionId = this.dependencies.identifiers.createSessionId();
      jti = this.dependencies.identifiers.createTokenId();
    } catch {
      return { ok: false, error: { reason: 'invalid_identifier' } };
    }
    if (
      typeof sessionId !== 'string'
      || sessionId.length === 0
      || typeof jti !== 'string'
      || jti.length === 0
    ) {
      return { ok: false, error: { reason: 'invalid_identifier' } };
    }
    if (sessionId === jti) return { ok: false, error: { reason: 'identifier_collision' } };

    const iat = Math.floor(nowEpochMs / 1000);
    const exp = iat + tokenLifetimeSeconds;
    const expiresAtEpochMs = nowEpochMs + sessionLifetimeSeconds * 1000;
    if (
      !isPositiveSafeInteger(iat)
      || !isPositiveSafeInteger(exp)
      || !Number.isSafeInteger(expiresAtEpochMs)
      || new Date(expiresAtEpochMs).getTime() !== expiresAtEpochMs
      || exp * 1000 > expiresAtEpochMs
    ) {
      return { ok: false, error: { reason: 'invalid_time' } };
    }

    const claims: AccessJwtClaims = {
      sub: String(input.userId),
      sid: sessionId,
      cv: 0,
      jti,
      iat,
      exp,
      iss: issuer,
      aud: audience,
    };
    const validatedClaims = validateAccessJwtClaims(claims, {
      issuer,
      audience,
      nowEpochSeconds: iat,
    });
    if (validatedClaims.valid === false) {
      if (
        validatedClaims.reason === 'invalid_session_id'
        || validatedClaims.reason === 'invalid_token_id'
      ) {
        return { ok: false, error: { reason: 'invalid_identifier' } };
      }
      if (
        validatedClaims.reason === 'invalid_timestamps'
        || validatedClaims.reason === 'expired_token'
      ) {
        return { ok: false, error: { reason: 'invalid_time' } };
      }
      return { ok: false, error: { reason: 'invalid_configuration' } };
    }

    let created: AccessSessionAtomicCreateResult;
    try {
      created = await this.dependencies.repository.createIfGenerationCurrent({
        sessionId,
        userId: input.userId,
        expectedGeneration: input.expectedGeneration,
        expiresAtEpochMs,
        nowEpochMs,
      });
    } catch {
      // A rejected create may have committed, or may have collided; ownership is unknown.
      return {
        ok: false,
        error: {
          reason: 'session_creation_failed',
          cause: 'repository_error',
        },
      };
    }
    if (created.status !== 'created') {
      return created.status === 'session_exists'
        ? { ok: false, error: { reason: 'identifier_collision' } }
        : { ok: false, error: { reason: 'session_creation_failed', cause: created.status } };
    }
    if (
      created.session.sessionId !== sessionId
      || created.session.userId !== input.userId
      || created.session.observedGeneration !== input.expectedGeneration
      || created.session.status !== 'active'
      || created.session.contextVersion !== 0
      || created.session.expiresAtEpochMs !== expiresAtEpochMs
      || created.session.context !== null
    ) {
      await this.revokeSession(input.userId, sessionId, nowEpochMs);
      return {
        ok: false,
        error: { reason: 'session_creation_failed', cause: 'invalid_session' },
      };
    }

    try {
      const accessToken = await this.dependencies.tokenIssuer.issue(validatedClaims.claims);
      if (typeof accessToken !== 'string' || accessToken.length === 0) {
        throw new Error('JWT issuer returned an empty token.');
      }
      return {
        ok: true,
        accessToken,
        sessionId,
        expiresAtEpochSeconds: exp,
      };
    } catch {
      const compensation = await this.revokeSession(input.userId, sessionId, nowEpochMs);
      return {
        ok: false,
        error: { reason: 'jwt_issuance_failed', compensation },
      };
    }
  }

  private async revokeSession(
    userId: number,
    sessionId: string,
    nowEpochMs: number,
  ): Promise<AccessSessionCompensation> {
    try {
      const revoked = await this.dependencies.repository.revokeById({
        userId,
        sessionId,
        nowEpochMs,
      });
      return revoked.status === 'revoked' || revoked.status === 'already_revoked'
        ? { revoked: true }
        : { revoked: false, cause: 'repository_error' };
    } catch {
      return { revoked: false, cause: 'repository_error' };
    }
  }
}
