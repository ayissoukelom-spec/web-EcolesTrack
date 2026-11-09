import { and, eq, gt, sql } from 'drizzle-orm';
import type { db } from '../db/index.ts';
import { accessSessions, schools, userSchools, users } from '../db/schema.ts';
import { isLocalSchoolRole } from '../lib/localSchoolRoles.ts';
import type { LocalSchoolRole } from '../lib/localSchoolRoles.ts';
import type { LocalSchoolMembership } from '../lib/localSchoolMembershipContracts.ts';
import {
  incrementAccessSessionGeneration,
  isAccessSessionGeneration,
  validateAccessSession,
} from './accessContextValidation.ts';
import type { AccessSessionGeneration } from './accessContextValidation.ts';
import {
  copyAccessContext,
  copyGenerationBoundAccessLifecycleSession,
  createAccessSession,
  isValidGenerationBoundAccessLifecycleSession,
  transitionAccessSessionContext,
} from './accessSessionLifecycle.ts';
import type {
  GenerationBoundAccessLifecycleSession,
  ServerResolvedContextAuthorization,
} from './accessSessionLifecycle.ts';
import type { VerifiedAccessContext } from './verifiedAccessContext.ts';
import type {
  AccessSessionTransaction,
  AccessSessionAtomicCreateResult,
  AccessContextSelection,
  AccountLifecycleOperation,
  AccountLifecycleTransitionResult,
  AccessSessionGlobalRevocationResult,
  AccessSessionIndividualRevocationResult,
  MembershipDeactivationResult,
  CreateGenerationBoundAccessSessionInput,
  GenerationAwareContextTransitionResult,
  GenerationAwareAccessSessionStore,
  GenerationBoundAccessSessionSnapshot,
} from './accessSessionRepository.ts';

type GenerationAwareAccessSessionDrizzleClient = Pick<typeof db, 'transaction' | 'select'>;

async function lockUserForGenerationTransition(transaction: AccessSessionTransaction, userId: number) {
  const [user] = await transaction.select({
    id: users.id,
    role: users.role,
    name: users.name,
    email: users.email,
    accessSessionGeneration: users.accessSessionGeneration,
    isDeleted: users.isDeleted,
    deactivationGenerationAware: users.deactivationGenerationAware,
  })
    .from(users)
    .where(eq(users.id, userId))
    .for('update')
    .limit(1);
  return user;
}

function toDatabaseDate(epochMs: number): Date {
  const date = new Date(epochMs);
  if (!Number.isFinite(date.getTime())) {
    throw new RangeError('Access session timestamp is outside the supported date range.');
  }
  return date;
}

function generationFromDatabase(value: unknown): AccessSessionGeneration {
  if (typeof value !== 'bigint' || value < 0n) {
    throw new Error('Stored access session generation is not a non-negative BIGINT.');
  }
  const generation = value.toString();
  if (!isAccessSessionGeneration(generation)) {
    throw new Error('Stored access session generation exceeds the supported BIGINT range.');
  }
  return generation;
}

function generationToDatabase(value: unknown): bigint {
  if (!isAccessSessionGeneration(value)) {
    throw new Error('Access session generation is not a canonical signed BIGINT value.');
  }
  return BigInt(value);
}

function storedSession(session: GenerationBoundAccessLifecycleSession) {
  return {
    id: session.sessionId,
    userId: session.userId,
    observedGeneration: generationToDatabase(session.observedGeneration),
    status: session.status,
    contextVersion: session.contextVersion,
    context: copyAccessContext(session.context),
    expiresAt: toDatabaseDate(session.expiresAtEpochMs),
    createdAt: new Date(),
    updatedAt: new Date(),
    revokedAt: session.status === 'revoked' ? new Date() : null,
  };
}

function mapGenerationBoundSession(row: {
  readonly id: string;
  readonly userId: number;
  readonly observedGeneration: unknown;
  readonly status: string;
  readonly contextVersion: number;
  readonly context: unknown;
  readonly expiresAt: Date | string;
}): GenerationBoundAccessLifecycleSession {
  const expiresAt = row.expiresAt instanceof Date ? row.expiresAt : new Date(row.expiresAt);
  const session: unknown = {
    sessionId: row.id,
    userId: row.userId,
    observedGeneration: generationFromDatabase(row.observedGeneration),
    status: row.status,
    contextVersion: row.contextVersion,
    context: row.context,
    expiresAtEpochMs: expiresAt.getTime(),
  };
  if (!isValidGenerationBoundAccessLifecycleSession(session)) {
    throw new Error('Stored access session is invalid.');
  }
  return copyGenerationBoundAccessLifecycleSession(session);
}

export class DrizzleGenerationAwareAccessSessionStore
implements GenerationAwareAccessSessionStore<AccessSessionTransaction> {
  constructor(private readonly client: GenerationAwareAccessSessionDrizzleClient) {}

  private async lockSchools(
    transaction: AccessSessionTransaction,
    schoolIds: readonly number[],
  ): Promise<boolean> {
    for (const schoolId of [...new Set(schoolIds)].sort((left, right) => left - right)) {
      const [school] = await transaction.select({ id: schools.id })
        .from(schools)
        .where(eq(schools.id, schoolId))
        .for('update')
        .limit(1);
      if (!school) return false;
    }
    return true;
  }

  private async hasOtherActiveSchoolAdmin(
    transaction: AccessSessionTransaction,
    schoolId: number,
    excludedUserId: number,
  ): Promise<boolean> {
    const [otherAdmin] = await transaction.select({ userId: userSchools.userId })
      .from(userSchools)
      .innerJoin(users, eq(users.id, userSchools.userId))
      .where(and(
        eq(userSchools.schoolId, schoolId),
        eq(userSchools.role, 'school_admin'),
        eq(users.isDeleted, false),
        sql`${userSchools.userId} <> ${excludedUserId}`,
        sql`${userSchools.isActive} IS DISTINCT FROM FALSE`,
      ))
      .limit(1);
    return Boolean(otherAdmin);
  }

  private async wouldRemoveLastSchoolAdmin(
    transaction: AccessSessionTransaction,
    userId: number,
  ): Promise<boolean> {
    const memberships = await transaction.select({ schoolId: userSchools.schoolId })
      .from(userSchools)
      .where(and(
        eq(userSchools.userId, userId),
        eq(userSchools.role, 'school_admin'),
        sql`${userSchools.isActive} IS DISTINCT FROM FALSE`,
      ));
    const schoolIds = [...new Set(memberships.map(({ schoolId }) => schoolId))];
    if (schoolIds.length === 0) return false;
    if (!(await this.lockSchools(transaction, schoolIds))) return true;

    for (const schoolId of schoolIds) {
      if (!(await this.hasOtherActiveSchoolAdmin(transaction, schoolId, userId))) return true;
    }
    return false;
  }

  private async revokeMembershipSessions(
    transaction: AccessSessionTransaction,
    input: {
      readonly userId: number;
      readonly membershipId: number;
      readonly schoolId: number;
      readonly role: string;
      readonly nowEpochMs: number;
    },
  ): Promise<number> {
    const now = toDatabaseDate(input.nowEpochMs);
    const exactContext = {
      kind: 'local',
      identity: { userId: input.userId },
      active: { schoolId: input.schoolId, role: input.role },
      membershipId: input.membershipId,
    };
    const revoked = await transaction.update(accessSessions)
      .set({ status: 'revoked', revokedAt: now, updatedAt: now })
      .where(and(
        eq(accessSessions.userId, input.userId),
        eq(accessSessions.status, 'active'),
        sql`${accessSessions.context} @> ${JSON.stringify(exactContext)}::jsonb`,
      ))
      .returning({ id: accessSessions.id });
    return revoked.length;
  }

  async createIfGenerationCurrent(
    input: CreateGenerationBoundAccessSessionInput,
  ): Promise<AccessSessionAtomicCreateResult> {
    if (!isAccessSessionGeneration(input.expectedGeneration)) {
      return { status: 'invalid_generation' };
    }

    const creation = createAccessSession({
      sessionId: input.sessionId,
      userId: input.userId,
      expiresAtEpochMs: input.expiresAtEpochMs,
      nowEpochMs: input.nowEpochMs,
    });
    if (!creation.ok) return { status: 'invalid_session' };

    return this.client.transaction(async (tx) => {
      const user = await lockUserForGenerationTransition(tx, input.userId);

      if (!user) return { status: 'user_not_found' };
      if (user.isDeleted) return { status: 'account_not_admissible' };

      let currentGeneration: AccessSessionGeneration;
      try {
        currentGeneration = generationFromDatabase(user.accessSessionGeneration);
      } catch {
        return { status: 'invalid_generation' };
      }
      if (currentGeneration !== input.expectedGeneration) {
        return { status: 'generation_changed', currentGeneration };
      }

      const session = copyGenerationBoundAccessLifecycleSession({
        ...creation.session,
        observedGeneration: currentGeneration,
      });
      const [inserted] = await tx.insert(accessSessions)
        .values(storedSession(session))
        .onConflictDoNothing({ target: accessSessions.id })
        .returning({ id: accessSessions.id });

      return inserted
        ? { status: 'created', session }
        : { status: 'session_exists' };
    });
  }

  async loadWithGeneration(
    sessionId: string,
  ): Promise<GenerationBoundAccessSessionSnapshot | null> {
    const [row] = await this.client.select({
      id: accessSessions.id,
      userId: accessSessions.userId,
      observedGeneration: accessSessions.observedGeneration,
      status: accessSessions.status,
      contextVersion: accessSessions.contextVersion,
      context: accessSessions.context,
      expiresAt: accessSessions.expiresAt,
      currentGeneration: users.accessSessionGeneration,
    })
      .from(accessSessions)
      .innerJoin(users, eq(users.id, accessSessions.userId))
      .where(eq(accessSessions.id, sessionId))
      .limit(1);

    if (!row) return null;
    return {
      session: mapGenerationBoundSession(row),
      currentGeneration: generationFromDatabase(row.currentGeneration),
    };
  }

  async transitionContext(input: {
    readonly userId: number;
    readonly sessionId: string;
    readonly expectedContextVersion: number;
    readonly target: AccessContextSelection;
    readonly nowEpochMs: number;
  }): Promise<GenerationAwareContextTransitionResult> {
    if (
      !Number.isSafeInteger(input.userId)
      || input.userId <= 0
      || typeof input.sessionId !== 'string'
      || input.sessionId.trim().length === 0
      || !Number.isSafeInteger(input.expectedContextVersion)
      || input.expectedContextVersion < 0
      || !Number.isSafeInteger(input.nowEpochMs)
      || !input.target
      || typeof input.target !== 'object'
      || (input.target.kind !== 'global' && input.target.kind !== 'local')
    ) {
      return { status: 'rejected', reason: 'invalid_selection' };
    }
    if (input.target.kind === 'local' && (
      !Number.isSafeInteger(input.target.schoolId)
      || input.target.schoolId <= 0
      || !Number.isSafeInteger(input.target.membershipId)
      || input.target.membershipId <= 0
      || !isLocalSchoolRole(input.target.role)
    )) {
      return { status: 'rejected', reason: 'invalid_selection' };
    }

    return this.client.transaction(async (tx) => {
      const user = await lockUserForGenerationTransition(tx, input.userId);
      if (!user) return { status: 'rejected', reason: 'identity_mismatch' };
      if (user.isDeleted) return { status: 'rejected', reason: 'account_not_admissible' };

      let currentGeneration: AccessSessionGeneration;
      try {
        currentGeneration = generationFromDatabase(user.accessSessionGeneration);
      } catch {
        return { status: 'rejected', reason: 'invalid_generation' };
      }

      const [row] = await tx.select({
        id: accessSessions.id,
        userId: accessSessions.userId,
        observedGeneration: accessSessions.observedGeneration,
        status: accessSessions.status,
        contextVersion: accessSessions.contextVersion,
        context: accessSessions.context,
        expiresAt: accessSessions.expiresAt,
      })
        .from(accessSessions)
        .where(and(
          eq(accessSessions.id, input.sessionId),
          eq(accessSessions.userId, input.userId),
        ))
        .for('update')
        .limit(1);
      if (!row) return { status: 'rejected', reason: 'session_not_found' };

      let session: GenerationBoundAccessLifecycleSession;
      try {
        session = mapGenerationBoundSession(row);
      } catch {
        return { status: 'rejected', reason: 'invalid_session' };
      }
      if (session.observedGeneration !== currentGeneration) {
        return { status: 'rejected', reason: 'generation_changed' };
      }

      const claims = {
        userId: input.userId,
        sessionId: input.sessionId,
        contextVersion: input.expectedContextVersion,
      };
      const validation = validateAccessSession({
        identity: { userId: input.userId },
        session: {
          sessionId: session.sessionId,
          userId: session.userId,
          status: session.status,
          contextVersion: session.contextVersion,
          expiresAtEpochMs: session.expiresAtEpochMs,
        },
        claims,
        nowEpochMs: input.nowEpochMs,
      });
      if (validation.valid === false) {
        return {
          status: 'rejected',
          reason: validation.reason === 'stale_context'
            ? 'version_conflict'
            : validation.reason,
        };
      }

      let targetContext: VerifiedAccessContext;
      let authorization: ServerResolvedContextAuthorization;
      if (input.target.kind === 'local') {
        const [membershipRow] = await tx.select({
          membershipId: userSchools.id,
          userId: userSchools.userId,
          schoolId: userSchools.schoolId,
          role: userSchools.role,
          isActive: userSchools.isActive,
        })
          .from(userSchools)
          .where(and(
            eq(userSchools.id, input.target.membershipId),
            eq(userSchools.userId, input.userId),
            eq(userSchools.schoolId, input.target.schoolId),
          ))
          .for('update')
          .limit(1);
        if (!membershipRow) return { status: 'rejected', reason: 'missing_membership' };
        if (
          membershipRow.membershipId !== input.target.membershipId
          || membershipRow.userId !== input.userId
          || membershipRow.schoolId !== input.target.schoolId
        ) {
          return { status: 'rejected', reason: 'membership_mismatch' };
        }
        if (!isLocalSchoolRole(membershipRow.role)) {
          return { status: 'rejected', reason: 'invalid_membership' };
        }
        if (membershipRow.role !== input.target.role) {
          return { status: 'rejected', reason: 'role_mismatch' };
        }

        const membership: LocalSchoolMembership = {
          membershipId: membershipRow.membershipId,
          userId: membershipRow.userId,
          schoolId: membershipRow.schoolId,
          role: membershipRow.role,
          status: membershipRow.isActive === false ? 'revoked' : 'active',
        };
        authorization = { kind: 'local', membership };
        targetContext = {
          kind: 'local',
          identity: { userId: membershipRow.userId },
          active: { schoolId: membershipRow.schoolId, role: membershipRow.role },
          membershipId: membershipRow.membershipId,
        } as VerifiedAccessContext;
      } else if (input.target.kind === 'global') {
        if (user.role !== 'super_admin') {
          return { status: 'rejected', reason: 'unauthorized_context' };
        }
        authorization = {
          kind: 'global',
          serverResolvedGlobalRole: user.role,
        };
        targetContext = {
          kind: 'global',
          identity: { userId: user.id },
          globalRole: 'super_admin',
        } as VerifiedAccessContext;
      } else {
        return { status: 'rejected', reason: 'invalid_selection' };
      }

      const transition = transitionAccessSessionContext({
        identity: { userId: input.userId },
        session,
        claims,
        targetContext,
        authorization,
        nowEpochMs: input.nowEpochMs,
      });
      if (transition.ok === false) {
        return { status: 'rejected', reason: transition.reason };
      }
      if (!transition.changed) {
        return { status: 'unchanged', session };
      }

      const now = toDatabaseDate(input.nowEpochMs);
      const [updated] = await tx.update(accessSessions)
        .set({
          context: copyAccessContext(transition.session.context),
          contextVersion: transition.session.contextVersion,
          updatedAt: now,
        })
        .where(and(
          eq(accessSessions.id, input.sessionId),
          eq(accessSessions.userId, input.userId),
          eq(accessSessions.status, 'active'),
          eq(accessSessions.contextVersion, input.expectedContextVersion),
          eq(accessSessions.observedGeneration, generationToDatabase(currentGeneration)),
          gt(accessSessions.expiresAt, now),
        ))
        .returning({ id: accessSessions.id });
      if (!updated) return { status: 'rejected', reason: 'version_conflict' };

      return {
        status: 'transitioned',
        session: copyGenerationBoundAccessLifecycleSession({
          ...transition.session,
          observedGeneration: currentGeneration,
        }),
      };
    });
  }

  async revokeById(input: {
    readonly sessionId: string;
    readonly userId: number;
    readonly nowEpochMs: number;
  }): Promise<AccessSessionIndividualRevocationResult> {
    const now = toDatabaseDate(input.nowEpochMs);
    const [revoked] = await this.client.transaction(async (tx) => {
      const rows = await tx.update(accessSessions)
        .set({
          status: 'revoked',
          revokedAt: now,
          updatedAt: now,
        })
        .where(and(
          eq(accessSessions.id, input.sessionId),
          eq(accessSessions.userId, input.userId),
          eq(accessSessions.status, 'active'),
          gt(accessSessions.expiresAt, now),
        ))
        .returning({ id: accessSessions.id });

      if (rows.length > 0) return [{ status: 'revoked' as const }];

      const [session] = await tx.select({
        userId: accessSessions.userId,
        status: accessSessions.status,
        expiresAt: accessSessions.expiresAt,
      })
        .from(accessSessions)
        .where(eq(accessSessions.id, input.sessionId))
        .limit(1);
      if (!session) return [{ status: 'not_found' as const }];
      if (session.userId !== input.userId) return [{ status: 'identity_mismatch' as const }];
      if (session.status === 'revoked') return [{ status: 'already_revoked' as const }];

      const expiresAt = session.expiresAt instanceof Date
        ? session.expiresAt
        : new Date(session.expiresAt);
      if (session.status === 'expired' || expiresAt.getTime() <= input.nowEpochMs) {
        return [{ status: 'already_expired' as const }];
      }
      return [{ status: 'invalid_session' as const }];
    });
    return revoked;
  }

  async deactivateMembership(input: {
    readonly userId: number;
    readonly membershipId: number;
    readonly schoolId: number;
    readonly role: LocalSchoolRole;
    readonly nowEpochMs: number;
    readonly mutation?: (transaction: AccessSessionTransaction) => Promise<void>;
  }): Promise<MembershipDeactivationResult> {
    if (
      !Number.isSafeInteger(input.userId) || input.userId <= 0
      || !Number.isSafeInteger(input.membershipId) || input.membershipId <= 0
      || !Number.isSafeInteger(input.schoolId) || input.schoolId <= 0
      || !isLocalSchoolRole(input.role)
      || !Number.isSafeInteger(input.nowEpochMs)
    ) {
      return { status: 'membership_not_found' };
    }

    return this.client.transaction(async (tx) => {
      const user = await lockUserForGenerationTransition(tx, input.userId);
      if (!user) return { status: 'user_not_found' };
      if (user.isDeleted) return { status: 'account_not_admissible' };

      const schoolExists = await this.lockSchools(tx, [input.schoolId]);
      if (!schoolExists) return { status: 'school_not_found' };

      const [membership] = await tx.select({
        id: userSchools.id,
        isActive: userSchools.isActive,
      })
        .from(userSchools)
        .where(and(
          eq(userSchools.id, input.membershipId),
          eq(userSchools.userId, input.userId),
          eq(userSchools.schoolId, input.schoolId),
          eq(userSchools.role, input.role),
        ))
        .for('update')
        .limit(1);
      if (!membership) return { status: 'membership_not_found' };

      if (
        input.role === 'school_admin'
        && membership.isActive !== false
        && !(await this.hasOtherActiveSchoolAdmin(tx, input.schoolId, input.userId))
      ) {
        return { status: 'last_school_admin' };
      }

      if (membership.isActive !== false) {
        await tx.update(userSchools)
          .set({ isActive: false })
          .where(and(
            eq(userSchools.id, input.membershipId),
            eq(userSchools.userId, input.userId),
            eq(userSchools.schoolId, input.schoolId),
            eq(userSchools.role, input.role),
            sql`${userSchools.isActive} IS DISTINCT FROM FALSE`,
          ))
          .returning({ id: userSchools.id });
      }

      const revokedSessionCount = await this.revokeMembershipSessions(tx, input);
      if (membership.isActive !== false && input.mutation) await input.mutation(tx);
      return {
        status: membership.isActive === false ? 'already_inactive' : 'deactivated',
        revokedSessionCount,
      };
    });
  }

  async revokeAllForUser(input: {
    readonly userId: number;
    readonly allowDisabledForAdministrativePasswordReset?: boolean;
    readonly mutation?: (
      newGeneration: AccessSessionGeneration,
      transaction: AccessSessionTransaction,
    ) => Promise<void>;
  }): Promise<AccessSessionGlobalRevocationResult> {
    return this.client.transaction(async (tx) => {
      const user = await lockUserForGenerationTransition(tx, input.userId);

      if (!user) return { status: 'user_not_found' };
      if (user.isDeleted && input.allowDisabledForAdministrativePasswordReset !== true) {
        return { status: 'account_not_admissible' };
      }

      let previousGeneration: AccessSessionGeneration;
      try {
        previousGeneration = generationFromDatabase(user.accessSessionGeneration);
      } catch {
        return { status: 'invalid_generation' };
      }
      const incremented = incrementAccessSessionGeneration(previousGeneration);
      if (incremented.ok === false) {
        return incremented.reason === 'generation_exhausted'
          ? { status: 'generation_exhausted' }
          : { status: 'invalid_generation' };
      }

      const nextGeneration = generationToDatabase(incremented.generation);
      const [updated] = await tx.update(users)
        .set({ accessSessionGeneration: nextGeneration })
        .where(eq(users.id, input.userId))
        .returning({ id: users.id });
      if (!updated) return { status: 'user_not_found' };

      if (input.mutation) await input.mutation(incremented.generation, tx);

      return {
        status: 'revoked_all',
        previousGeneration,
        currentGeneration: incremented.generation,
      };
    });
  }

  async transitionAccountLifecycle(input: {
    readonly userId: number;
    readonly operation: AccountLifecycleOperation;
    readonly allowedRoles: readonly string[];
    readonly protectLastSchoolAdmin?: boolean;
    readonly mutation?: (
      transaction: AccessSessionTransaction,
      user: { readonly role: string; readonly name: string; readonly email: string | null },
    ) => Promise<void>;
  }): Promise<AccountLifecycleTransitionResult> {
    return this.client.transaction(async (tx) => {
      const user = await lockUserForGenerationTransition(tx, input.userId);
      if (!user) return { status: 'user_not_found' };
      if (!input.allowedRoles.includes(user.role)) return { status: 'account_not_eligible' };
      if (user.deactivationGenerationAware !== null
        && typeof user.deactivationGenerationAware !== 'boolean') {
        return { status: 'invalid_state' };
      }

      if (input.operation === 'deactivate' && user.isDeleted) {
        return user.deactivationGenerationAware === false
          ? { status: 'invalid_state' }
          : { status: 'already_deactivated' };
      }
      if (input.operation === 'reactivate' && !user.isDeleted) {
        return { status: 'already_active' };
      }
      if (input.operation === 'reactivate' && user.deactivationGenerationAware === false) {
        return { status: 'invalid_state' };
      }
      if (
        input.operation === 'deactivate'
        && input.protectLastSchoolAdmin
        && await this.wouldRemoveLastSchoolAdmin(tx, input.userId)
      ) {
        return { status: 'last_school_admin' };
      }

      let previousGeneration: AccessSessionGeneration;
      try {
        previousGeneration = generationFromDatabase(user.accessSessionGeneration);
      } catch {
        return { status: 'invalid_generation' };
      }

      const shouldIncrement = input.operation === 'deactivate'
        || user.deactivationGenerationAware === null;
      let currentGeneration = previousGeneration;
      if (shouldIncrement) {
        const incremented = incrementAccessSessionGeneration(previousGeneration);
        if (incremented.ok === false) {
          return incremented.reason === 'generation_exhausted'
            ? { status: 'generation_exhausted' }
            : { status: 'invalid_generation' };
        }
        currentGeneration = incremented.generation;
      }

      const values = {
        isDeleted: input.operation === 'deactivate',
        deactivationGenerationAware: true,
        ...(shouldIncrement ? { accessSessionGeneration: generationToDatabase(currentGeneration) } : {}),
      };
      const [updated] = await tx.update(users)
        .set(values)
        .where(eq(users.id, input.userId))
        .returning({ id: users.id });
      if (!updated) return { status: 'user_not_found' };

      if (input.mutation) {
        await input.mutation(tx, {
          role: user.role,
          name: user.name,
          email: user.email,
        });
      }

      return {
        status: input.operation === 'deactivate' ? 'deactivated' : 'reactivated',
        previousGeneration,
        currentGeneration,
      };
    });
  }
}
