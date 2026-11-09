import type { VerifiedAccessContext } from './verifiedAccessContext.ts';
import type { LocalSchoolRole } from '../lib/localSchoolRoles.ts';
import type { db } from '../db/index.ts';
import type {
  AccessSessionClaims,
  AccessSessionGeneration,
  AuthenticatedIdentity,
} from './accessContextValidation.ts';
import {
  validateAccessSession,
} from './accessContextValidation.ts';
import {
  copyAccessLifecycleSession,
  createAccessSession,
  isValidAccessLifecycleSession,
  revokeAccessSession,
  transitionAccessSessionContext,
} from './accessSessionLifecycle.ts';
import type {
  AccessLifecycleSession,
  ContextTransitionResult,
  GenerationBoundAccessLifecycleSession,
  ServerResolvedContextAuthorization,
  SessionLifecycleFailureReason,
  SessionOperationResult,
} from './accessSessionLifecycle.ts';

export type AccessSessionTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface AccessSessionVersionCondition {
  readonly sessionId: string;
  readonly userId: number;
  readonly contextVersion: number;
  readonly status: 'active';
  readonly validAtEpochMs: number;
}

export interface AccessSessionStore {
  /** Returns true only for the operation that inserted this identifier; false means it already existed. */
  create(session: AccessLifecycleSession): Promise<boolean>;
  load(sessionId: string): Promise<unknown | null>;
  /** Must persist only if every expected field still matches in one atomic operation. */
  compareAndSwap(input: {
    readonly expected: AccessSessionVersionCondition;
    readonly next: AccessLifecycleSession;
  }): Promise<boolean>;
}

export interface CreateGenerationBoundAccessSessionInput {
  readonly sessionId: string;
  readonly userId: number;
  readonly expectedGeneration: AccessSessionGeneration;
  readonly expiresAtEpochMs: number;
  readonly nowEpochMs: number;
}

export type AccessContextSelection =
  | {
      readonly kind: 'local';
      readonly schoolId: number;
      readonly role: LocalSchoolRole;
      readonly membershipId: number;
    }
  | { readonly kind: 'global' };

export type GenerationAwareContextTransitionResult =
  | {
      readonly status: 'transitioned' | 'unchanged';
      readonly session: GenerationBoundAccessLifecycleSession;
    }
  | {
      readonly status: 'rejected';
      readonly reason:
        | SessionLifecycleFailureReason
        | 'session_not_found'
        | 'account_not_admissible'
        | 'generation_changed'
        | 'invalid_generation';
    };

export type AccessSessionAtomicCreateResult =
  | { readonly status: 'created'; readonly session: GenerationBoundAccessLifecycleSession }
  | {
      readonly status: 'generation_changed';
          readonly currentGeneration: AccessSessionGeneration;
    }
  | { readonly status: 'session_exists' }
  | { readonly status: 'user_not_found' }
  | { readonly status: 'account_not_admissible' }
  | { readonly status: 'invalid_generation' }
  | { readonly status: 'invalid_session' };

export type AccessSessionIndividualRevocationResult =
  | { readonly status: 'revoked' }
  | { readonly status: 'already_revoked' }
  | { readonly status: 'already_expired' }
  | { readonly status: 'not_found' }
  | { readonly status: 'identity_mismatch' }
  | { readonly status: 'invalid_session' };

export type AccessSessionGlobalRevocationResult =
  | {
      readonly status: 'revoked_all';
      readonly previousGeneration: AccessSessionGeneration;
      readonly currentGeneration: AccessSessionGeneration;
    }
  | { readonly status: 'user_not_found' }
  | { readonly status: 'account_not_admissible' }
  | { readonly status: 'invalid_generation' }
  | { readonly status: 'generation_exhausted' };

export type MembershipDeactivationResult =
  | { readonly status: 'deactivated' | 'already_inactive'; readonly revokedSessionCount: number }
  | { readonly status: 'user_not_found' | 'school_not_found' | 'membership_not_found' | 'account_not_admissible' | 'last_school_admin' };

export type AccountLifecycleOperation = 'deactivate' | 'reactivate';

export type AccountLifecycleTransitionResult =
  | {
      readonly status: 'deactivated' | 'reactivated';
      readonly previousGeneration: AccessSessionGeneration;
      readonly currentGeneration: AccessSessionGeneration;
    }
  | { readonly status: 'already_deactivated' | 'already_active' }
  | { readonly status: 'user_not_found' }
  | { readonly status: 'account_not_eligible' }
  | { readonly status: 'invalid_state' }
  | { readonly status: 'invalid_generation' }
  | { readonly status: 'generation_exhausted' }
  | { readonly status: 'last_school_admin' };

export interface GenerationBoundAccessSessionSnapshot {
  readonly session: GenerationBoundAccessLifecycleSession;
  readonly currentGeneration: AccessSessionGeneration;
}

/**
 * Atomic generation-aware persistence contract. Implementations must serialize
 * creation and global revocation against the same user row/lock.
 */
export interface GenerationAwareAccessSessionStore<Transaction = unknown> {
  /** A created record must observe expectedGeneration; otherwise nothing is inserted. */
  createIfGenerationCurrent(
    input: CreateGenerationBoundAccessSessionInput,
  ): Promise<AccessSessionAtomicCreateResult>;
  /** Loads both generations from one consistent server-side snapshot. */
  loadWithGeneration(sessionId: string): Promise<GenerationBoundAccessSessionSnapshot | null>;
  /** Locks user then session and resolves target authority from persisted server data. */
  transitionContext(input: {
    readonly userId: number;
    readonly sessionId: string;
    readonly expectedContextVersion: number;
    readonly target: AccessContextSelection;
    readonly nowEpochMs: number;
  }): Promise<GenerationAwareContextTransitionResult>;
  /** The verified token's sub/sid association must be checked before this operation. */
  /** Revocation is terminal and never changes a revoked row back to active. */
  revokeById(input: {
    readonly sessionId: string;
    readonly userId: number;
    readonly nowEpochMs: number;
  }): Promise<AccessSessionIndividualRevocationResult>;
  /**
   * Advances the user's generation atomically. If provided, mutation must run
   * in the same transaction and failure must roll back both changes.
   */
  /** Must increment exactly once under the same lock used by createIfGenerationCurrent. */
  revokeAllForUser(input: {
    readonly userId: number;
    /** Allows an authorized administrative password reset to revoke a disabled account. */
    readonly allowDisabledForAdministrativePasswordReset?: boolean;
    readonly mutation?: (
      newGeneration: AccessSessionGeneration,
      transaction: Transaction,
    ) => Promise<void>;
  }): Promise<AccessSessionGlobalRevocationResult>;
  /** Applies lifecycle state and revocation boundary under the same user-row lock. */
  transitionAccountLifecycle(input: {
    readonly userId: number;
    readonly operation: AccountLifecycleOperation;
    readonly allowedRoles: readonly string[];
    readonly protectLastSchoolAdmin?: boolean;
    readonly mutation?: (
      transaction: Transaction,
      user: { readonly role: string; readonly name: string; readonly email: string | null },
    ) => Promise<void>;
  }): Promise<AccountLifecycleTransitionResult>;
  deactivateMembership(input: {
    readonly userId: number;
    readonly membershipId: number;
    readonly schoolId: number;
    readonly role: LocalSchoolRole;
    readonly nowEpochMs: number;
    readonly mutation?: (transaction: Transaction) => Promise<void>;
  }): Promise<MembershipDeactivationResult>;
}

export interface GenerationAwareAccessSessionRepository<Transaction = unknown> {
  createIfGenerationCurrent(
    input: CreateGenerationBoundAccessSessionInput,
  ): Promise<AccessSessionAtomicCreateResult>;
  loadWithGeneration(sessionId: string): Promise<GenerationBoundAccessSessionSnapshot | null>;
  transitionContext(input: {
    readonly userId: number;
    readonly sessionId: string;
    readonly expectedContextVersion: number;
    readonly target: AccessContextSelection;
    readonly nowEpochMs: number;
  }): Promise<GenerationAwareContextTransitionResult>;
  revokeById(input: {
    readonly sessionId: string;
    readonly userId: number;
    readonly nowEpochMs: number;
  }): Promise<AccessSessionIndividualRevocationResult>;
  revokeAllForUser(input: {
    readonly userId: number;
    readonly allowDisabledForAdministrativePasswordReset?: boolean;
    readonly mutation?: (
      newGeneration: AccessSessionGeneration,
      transaction: Transaction,
    ) => Promise<void>;
  }): Promise<AccessSessionGlobalRevocationResult>;
  transitionAccountLifecycle(input: {
    readonly userId: number;
    readonly operation: AccountLifecycleOperation;
    readonly allowedRoles: readonly string[];
    readonly protectLastSchoolAdmin?: boolean;
    readonly mutation?: (
      transaction: Transaction,
      user: { readonly role: string; readonly name: string; readonly email: string | null },
    ) => Promise<void>;
  }): Promise<AccountLifecycleTransitionResult>;
  deactivateMembership(input: {
    readonly userId: number;
    readonly membershipId: number;
    readonly schoolId: number;
    readonly role: LocalSchoolRole;
    readonly nowEpochMs: number;
    readonly mutation?: (transaction: Transaction) => Promise<void>;
  }): Promise<MembershipDeactivationResult>;
}

export type AccessSessionRepositoryError =
  | SessionLifecycleFailureReason
  | 'session_exists'
  | 'session_not_found';

export type AccessSessionRepositoryResult =
  | { readonly ok: true; readonly session: AccessLifecycleSession }
  | { readonly ok: false; readonly reason: AccessSessionRepositoryError };

export type AccessSessionVerificationResult =
  | { readonly ok: true; readonly session: AccessLifecycleSession }
  | {
      readonly ok: false;
      readonly reason: SessionLifecycleFailureReason | 'session_not_found';
    };

export interface VerifyAccessSessionInput {
  readonly identity: AuthenticatedIdentity;
  readonly claims: AccessSessionClaims;
  readonly nowEpochMs: number;
}

export class AccessSessionRepository {
  constructor(private readonly store: AccessSessionStore) {}

  async create(input: {
    readonly sessionId: string;
    readonly userId: number;
    readonly expiresAtEpochMs: number;
    readonly nowEpochMs: number;
  }): Promise<AccessSessionRepositoryResult> {
    const creation = createAccessSession(input);
    if (!creation.ok) return creation;

    const session = copyAccessLifecycleSession(creation.session);
    if (!(await this.store.create(copyAccessLifecycleSession(session)))) {
      return { ok: false, reason: 'session_exists' };
    }
    return { ok: true, session: copyAccessLifecycleSession(session) };
  }

  async load(sessionId: string): Promise<AccessLifecycleSession | null> {
    const stored = await this.store.load(sessionId);
    if (!isValidAccessLifecycleSession(stored)) return null;
    return copyAccessLifecycleSession(stored);
  }

  async verify(input: VerifyAccessSessionInput): Promise<AccessSessionVerificationResult> {
    if (
      !input.claims
      || typeof input.claims.sessionId !== 'string'
      || input.claims.sessionId.trim().length === 0
    ) {
      return { ok: false, reason: 'invalid_session' };
    }
    const session = await this.load(input.claims.sessionId);
    if (!session) return { ok: false, reason: 'session_not_found' };
    if (session.status === 'revoked') return { ok: false, reason: 'revoked_session' };
    if (session.status === 'expired') return { ok: false, reason: 'expired_session' };

    const validation = validateAccessSession({
      identity: input.identity,
      session: {
        sessionId: session.sessionId,
        userId: session.userId,
        status: 'active',
        contextVersion: session.contextVersion,
        expiresAtEpochMs: session.expiresAtEpochMs,
      },
      claims: input.claims,
      nowEpochMs: input.nowEpochMs,
    });
    if (validation.valid === false) {
      return {
        ok: false,
        reason: validation.reason === 'stale_context'
          ? 'version_conflict'
          : validation.reason,
      };
    }
    return { ok: true, session };
  }

  async verifyContextVersion(input: VerifyAccessSessionInput & {
    readonly expectedContextVersion: number;
  }): Promise<AccessSessionVerificationResult> {
    if (input.claims.contextVersion !== input.expectedContextVersion) {
      return { ok: false, reason: 'version_conflict' };
    }
    return this.verify(input);
  }

  async revoke(input: VerifyAccessSessionInput): Promise<SessionOperationResult> {
    const verified = await this.verify(input);
    if (verified.ok === false) {
      return { ok: false, reason: verified.reason === 'session_not_found' ? 'invalid_session' : verified.reason };
    }

    const revoked = revokeAccessSession(verified.session, input.nowEpochMs);
    if (revoked.ok === false) return revoked;
    const persisted = await this.store.compareAndSwap({
      expected: {
        sessionId: verified.session.sessionId,
        userId: verified.session.userId,
        contextVersion: verified.session.contextVersion,
        status: 'active',
        validAtEpochMs: input.nowEpochMs,
      },
      next: copyAccessLifecycleSession(revoked.session),
    });
    if (!persisted) return { ok: false, reason: 'version_conflict' };
    return { ok: true, session: copyAccessLifecycleSession(revoked.session) };
  }

  async transitionContext(input: VerifyAccessSessionInput & {
    readonly targetContext: VerifiedAccessContext;
    readonly authorization: ServerResolvedContextAuthorization;
  }): Promise<ContextTransitionResult> {
    const verified = await this.verify(input);
    if (verified.ok === false) {
      return { ok: false, reason: verified.reason === 'session_not_found' ? 'invalid_session' : verified.reason };
    }

    const transition = transitionAccessSessionContext({
      identity: input.identity,
      session: verified.session,
      claims: input.claims,
      targetContext: input.targetContext,
      authorization: input.authorization,
      nowEpochMs: input.nowEpochMs,
    });
    if (transition.ok === false || !transition.changed) return transition;

    const persisted = await this.store.compareAndSwap({
      expected: {
        sessionId: verified.session.sessionId,
        userId: verified.session.userId,
        contextVersion: verified.session.contextVersion,
        status: 'active',
        validAtEpochMs: input.nowEpochMs,
      },
      next: copyAccessLifecycleSession(transition.session),
    });
    if (!persisted) return { ok: false, reason: 'version_conflict' };
    return {
      ok: true,
      changed: true,
      session: copyAccessLifecycleSession(transition.session),
    };
  }
}
