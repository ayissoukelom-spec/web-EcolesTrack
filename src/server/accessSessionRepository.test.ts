import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import type { LocalSchoolMembership } from '../lib/localSchoolMembershipContracts.ts';
import { accessSessions } from '../db/schema.ts';
import {
  isAccessSessionGeneration,
  incrementAccessSessionGeneration,
  validateGenerationBoundAccessSession,
} from './accessContextValidation.ts';
import type { AccessSessionClaims } from './accessContextValidation.ts';
import type { AccessLifecycleSession } from './accessSessionLifecycle.ts';
import {
  createAccessSession,
  copyAccessLifecycleSession,
  copyGenerationBoundAccessLifecycleSession,
  isValidGenerationBoundAccessLifecycleSession,
  revokeAccessSessionIdempotently,
} from './accessSessionLifecycle.ts';
import {
  AccessSessionRepository,
} from './accessSessionRepository.ts';
import type {
  AccessSessionStore,
  AccessSessionVersionCondition,
  GenerationAwareAccessSessionStore,
} from './accessSessionRepository.ts';
import type { VerifiedLocalAccessContext } from './verifiedAccessContext.ts';

const now = 1_800_000_000_000;
const identity = { userId: 12 } as const;
const membership: LocalSchoolMembership = {
  membershipId: 31,
  userId: identity.userId,
  schoolId: 7,
  role: 'teacher',
  status: 'active',
};

class MemoryAccessSessionStore implements AccessSessionStore {
  private readonly sessions = new Map<string, AccessLifecycleSession>();
  failNextCompareAndSwap = false;

  async create(session: AccessLifecycleSession): Promise<boolean> {
    if (this.sessions.has(session.sessionId)) return false;
    this.sessions.set(session.sessionId, copyAccessLifecycleSession(session));
    return true;
  }

  async load(sessionId: string): Promise<unknown | null> {
    const session = this.sessions.get(sessionId);
    return session ? copyAccessLifecycleSession(session) : null;
  }

  async compareAndSwap(input: {
    readonly expected: AccessSessionVersionCondition;
    readonly next: AccessLifecycleSession;
  }): Promise<boolean> {
    if (this.failNextCompareAndSwap) {
      this.failNextCompareAndSwap = false;
      return false;
    }

    const current = this.sessions.get(input.expected.sessionId);
    if (
      !current
      || current.userId !== input.expected.userId
      || current.contextVersion !== input.expected.contextVersion
      || current.status !== input.expected.status
      || current.expiresAtEpochMs <= input.expected.validAtEpochMs
    ) {
      return false;
    }
    this.sessions.set(input.expected.sessionId, copyAccessLifecycleSession(input.next));
    return true;
  }
}

function makeContext(): VerifiedLocalAccessContext {
  return {
    kind: 'local',
    identity: { userId: identity.userId },
    active: { schoolId: membership.schoolId, role: membership.role },
    membershipId: membership.membershipId,
  } as VerifiedLocalAccessContext;
}

function claims(sessionId: string, contextVersion = 0): AccessSessionClaims {
  return { sessionId, userId: identity.userId, contextVersion };
}

function setup() {
  const store = new MemoryAccessSessionStore();
  return { store, repository: new AccessSessionRepository(store) };
}

class MemoryGenerationAwareStore implements GenerationAwareAccessSessionStore {
  readonly generations = new Map<number, string>();
  readonly sessions = new Map<string, AccessLifecycleSession & { observedGeneration: string }>();
  readonly accountStates = new Map<number, { isDeleted: boolean; marker: boolean | null; role: string }>();

  addUser(userId: number, generation = '0') {
    this.generations.set(userId, generation);
    this.accountStates.set(userId, { isDeleted: false, marker: false, role: 'parent' });
  }

  async createIfGenerationCurrent(input: {
    readonly sessionId: string;
    readonly userId: number;
    readonly expectedGeneration: string;
    readonly expiresAtEpochMs: number;
    readonly nowEpochMs: number;
  }) {
    const currentGeneration = this.generations.get(input.userId);
    if (currentGeneration === undefined) return { status: 'user_not_found' as const };
    if (!isAccessSessionGeneration(input.expectedGeneration)) {
      return { status: 'invalid_generation' as const };
    }
    if (currentGeneration !== input.expectedGeneration) {
      return { status: 'generation_changed' as const, currentGeneration };
    }
    if (this.sessions.has(input.sessionId)) return { status: 'session_exists' as const };

    const result = createAccessSession(input);
    if (!result.ok) return { status: 'invalid_session' as const };
    const session = {
      ...result.session,
      observedGeneration: currentGeneration,
    };
    this.sessions.set(input.sessionId, copyGenerationBoundAccessLifecycleSession(session));
    return {
      status: 'created' as const,
      session: copyGenerationBoundAccessLifecycleSession(session),
    };
  }

  async loadWithGeneration(sessionId: string) {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    const currentGeneration = this.generations.get(session.userId);
    if (currentGeneration === undefined) return null;
    return {
      session: copyGenerationBoundAccessLifecycleSession(session),
      currentGeneration,
    };
  }

  async transitionContext() {
    return { status: 'rejected' as const, reason: 'invalid_selection' as const };
  }

  async revokeById(input: {
    readonly sessionId: string;
    readonly userId: number;
    readonly nowEpochMs: number;
  }) {
    const session = this.sessions.get(input.sessionId);
    const result = revokeAccessSessionIdempotently({
      session,
      expectedSessionId: input.sessionId,
      expectedUserId: input.userId,
      nowEpochMs: input.nowEpochMs,
    });
    if (result.status === 'revoked') {
      const current = this.sessions.get(input.sessionId);
      if (current) {
        this.sessions.set(input.sessionId, {
          ...result.session,
          observedGeneration: current.observedGeneration,
        });
      }
    }
    return { status: result.status };
  }

  async revokeAllForUser(input: {
    readonly userId: number;
    readonly mutation?: (newGeneration: string, transaction: unknown) => Promise<void>;
  }) {
    const previousGeneration = this.generations.get(input.userId);
    if (previousGeneration === undefined) return { status: 'user_not_found' as const };
    const incremented = incrementAccessSessionGeneration(previousGeneration);
    if (!incremented.ok) return { status: 'generation_exhausted' as const };
    const nextGeneration = incremented.generation;
    if (input.mutation) await input.mutation(nextGeneration, undefined);
    this.generations.set(input.userId, nextGeneration);
    return {
      status: 'revoked_all' as const,
      previousGeneration,
      currentGeneration: nextGeneration,
    };
  }

  async transitionAccountLifecycle(input: {
    readonly userId: number;
    readonly operation: 'deactivate' | 'reactivate';
    readonly allowedRoles: readonly string[];
    readonly mutation?: (transaction: unknown, user: {
      readonly role: string;
      readonly name: string;
      readonly email: string | null;
    }) => Promise<void>;
  }) {
    const state = this.accountStates.get(input.userId);
    const previousGeneration = this.generations.get(input.userId);
    if (!state || previousGeneration === undefined) return { status: 'user_not_found' as const };
    if (!input.allowedRoles.includes(state.role)) return { status: 'account_not_eligible' as const };
    if (input.operation === 'deactivate' && state.isDeleted) {
      return state.marker === false
        ? { status: 'invalid_state' as const }
        : { status: 'already_deactivated' as const };
    }
    if (input.operation === 'reactivate' && !state.isDeleted) return { status: 'already_active' as const };
    if (input.operation === 'reactivate' && state.marker === false) return { status: 'invalid_state' as const };

    const shouldIncrement = input.operation === 'deactivate' || state.marker === null;
    let currentGeneration = previousGeneration;
    if (shouldIncrement) {
      const incremented = incrementAccessSessionGeneration(previousGeneration);
      if (!incremented.ok) return { status: 'generation_exhausted' as const };
      currentGeneration = incremented.generation;
    }
    if (input.mutation) {
      await input.mutation(undefined, { role: state.role, name: '', email: null });
    }
    this.generations.set(input.userId, currentGeneration);
    this.accountStates.set(input.userId, {
      ...state,
      isDeleted: input.operation === 'deactivate',
      marker: true,
    });
    return {
      status: input.operation === 'deactivate' ? 'deactivated' as const : 'reactivated' as const,
      previousGeneration,
      currentGeneration,
    };
  }

  async deactivateMembership() {
    return { status: 'membership_not_found' as const };
  }
}

describe('access session repository contract', () => {
  it('declares access_sessions in the application schema without a migration', () => {
    const config = getTableConfig(accessSessions);
    expect(config.name).toBe('access_sessions');
    expect(config.columns.map((column) => column.name)).toEqual(expect.arrayContaining([
      'id',
      'user_id',
      'status',
      'context_version',
      'context',
      'expires_at',
    ]));
  });

  describe('generation-aware access session store contract', () => {
    it('creates only against the expected generation and records that generation', async () => {
      const store = new MemoryGenerationAwareStore();
      store.addUser(identity.userId, '7');

      const created = await store.createIfGenerationCurrent({
        sessionId: 'generation-session-a',
        userId: identity.userId,
        expectedGeneration: '7',
        expiresAtEpochMs: now + 60_000,
        nowEpochMs: now,
      });
      expect(created.status).toBe('created');
      if (created.status !== 'created') return;
      expect(created.session.observedGeneration).toBe('7');
      expect(isValidGenerationBoundAccessLifecycleSession(created.session)).toBe(true);

      expect(await store.createIfGenerationCurrent({
        sessionId: 'generation-session-b',
        userId: identity.userId,
        expectedGeneration: '6',
        expiresAtEpochMs: now + 60_000,
        nowEpochMs: now,
      })).toEqual({ status: 'generation_changed', currentGeneration: '7' });
      expect(await store.createIfGenerationCurrent({
        sessionId: 'generation-session-a',
        userId: identity.userId,
        expectedGeneration: '7',
        expiresAtEpochMs: now + 60_000,
        nowEpochMs: now,
      })).toEqual({ status: 'session_exists' });
      expect(await store.createIfGenerationCurrent({
        sessionId: 'generation-session-invalid',
        userId: identity.userId,
        expectedGeneration: '07',
        expiresAtEpochMs: now + 60_000,
        nowEpochMs: now,
      })).toEqual({ status: 'invalid_generation' });
    });

    it('prevents a creation based on an older generation from escaping global revocation', async () => {
      const store = new MemoryGenerationAwareStore();
      store.addUser(identity.userId, '2');
      const first = await store.createIfGenerationCurrent({
        sessionId: 'before-global-revocation',
        userId: identity.userId,
        expectedGeneration: '2',
        expiresAtEpochMs: now + 60_000,
        nowEpochMs: now,
      });
      expect(first.status).toBe('created');

      expect(await store.revokeAllForUser({ userId: identity.userId })).toEqual({
        status: 'revoked_all',
        previousGeneration: '2',
        currentGeneration: '3',
      });
      const priorSession = await store.loadWithGeneration('before-global-revocation');
      expect(priorSession?.session.observedGeneration).toBe('2');
      expect(priorSession?.currentGeneration).toBe('3');
      expect(priorSession && validateGenerationBoundAccessSession({
        identity,
        session: priorSession.session,
        claims: claims(priorSession.session.sessionId),
        currentGeneration: priorSession.currentGeneration,
        nowEpochMs: now,
      })).toEqual({ valid: false, reason: 'stale_generation' });
      expect(await store.createIfGenerationCurrent({
        sessionId: 'after-global-revocation',
        userId: identity.userId,
        expectedGeneration: '2',
        expiresAtEpochMs: now + 60_000,
        nowEpochMs: now,
      })).toEqual({ status: 'generation_changed', currentGeneration: '3' });
    });

    it('covers either serialized ordering of concurrent creation and global revocation', async () => {
      const createBeforeRevocation = new MemoryGenerationAwareStore();
      createBeforeRevocation.addUser(identity.userId, '4');
      const createFirst = createBeforeRevocation.createIfGenerationCurrent({
        sessionId: 'race-create-first',
        userId: identity.userId,
        expectedGeneration: '4',
        expiresAtEpochMs: now + 60_000,
        nowEpochMs: now,
      });
      const revokeSecond = createBeforeRevocation.revokeAllForUser({ userId: identity.userId });
      const [createdBefore, revokedAfter] = await Promise.all([createFirst, revokeSecond]);
      expect(createdBefore.status).toBe('created');
      expect(revokedAfter).toMatchObject({ status: 'revoked_all', currentGeneration: '5' });

      const revokeBeforeCreation = new MemoryGenerationAwareStore();
      revokeBeforeCreation.addUser(identity.userId, '4');
      const revokeFirst = revokeBeforeCreation.revokeAllForUser({ userId: identity.userId });
      const createSecond = revokeBeforeCreation.createIfGenerationCurrent({
        sessionId: 'race-revoke-first',
        userId: identity.userId,
        expectedGeneration: '4',
        expiresAtEpochMs: now + 60_000,
        nowEpochMs: now,
      });
      const [revokedBefore, createdAfter] = await Promise.all([revokeFirst, createSecond]);
      expect(revokedBefore).toMatchObject({ status: 'revoked_all', currentGeneration: '5' });
      expect(createdAfter).toEqual({ status: 'generation_changed', currentGeneration: '5' });
      expect(await revokeBeforeCreation.loadWithGeneration('race-revoke-first')).toBeNull();
    });

    it('rolls back global generation advancement when its atomic mutation fails', async () => {
      const store = new MemoryGenerationAwareStore();
      store.addUser(identity.userId, '9');

      await expect(store.revokeAllForUser({
        userId: identity.userId,
        mutation: async () => {
          throw new Error('mutation failed');
        },
      })).rejects.toThrow('mutation failed');
      expect(store.generations.get(identity.userId)).toBe('9');
    });

    it('does not wrap or reset an exhausted global generation', async () => {
      const store = new MemoryGenerationAwareStore();
      store.addUser(identity.userId, '9223372036854775807');

      expect(await store.revokeAllForUser({ userId: identity.userId })).toEqual({
        status: 'generation_exhausted',
      });
      expect(store.generations.get(identity.userId)).toBe('9223372036854775807');
    });

    it('distinguishes targeted revocation, repeated logout, expiry, absence and owner mismatch', async () => {
      const store = new MemoryGenerationAwareStore();
      store.addUser(identity.userId);
      await store.createIfGenerationCurrent({
        sessionId: 'logout-session-a',
        userId: identity.userId,
        expectedGeneration: '0',
        expiresAtEpochMs: now + 60_000,
        nowEpochMs: now,
      });

      expect(await store.revokeById({
        sessionId: 'logout-session-a',
        userId: identity.userId,
        nowEpochMs: now,
      })).toEqual({ status: 'revoked' });
      expect(await store.revokeById({
        sessionId: 'logout-session-a',
        userId: identity.userId,
        nowEpochMs: now,
      })).toEqual({ status: 'already_revoked' });
      expect(await store.revokeById({
        sessionId: 'logout-session-a',
        userId: identity.userId + 1,
        nowEpochMs: now,
      })).toEqual({ status: 'identity_mismatch' });
      expect(await store.revokeById({
        sessionId: 'missing-session',
        userId: identity.userId,
        nowEpochMs: now,
      })).toEqual({ status: 'not_found' });
    });
  });

  it('creates independent sessions without a selected context and rejects duplicate ids', async () => {
    const { repository } = setup();
    const input = {
      sessionId: 'device-a',
      userId: identity.userId,
      expiresAtEpochMs: now + 60_000,
      nowEpochMs: now,
    };

    const created = await repository.create(input);
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.session.context).toBeNull();
    expect(created.session.contextVersion).toBe(0);

    expect(await repository.create(input)).toEqual({ ok: false, reason: 'session_exists' });
    expect((await repository.create({ ...input, sessionId: 'device-b' })).ok).toBe(true);
  });

  it('verifies identity, active state, expiry, and the exact context version', async () => {
    const { repository } = setup();
    await repository.create({
      sessionId: 'device-a',
      userId: identity.userId,
      expiresAtEpochMs: now + 60_000,
      nowEpochMs: now,
    });

    expect(await repository.verify({
      identity: { userId: 99 },
      claims: claims('device-a'),
      nowEpochMs: now,
    })).toEqual({ ok: false, reason: 'identity_mismatch' });

    expect(await repository.verifyContextVersion({
      identity,
      claims: claims('device-a'),
      expectedContextVersion: 1,
      nowEpochMs: now,
    })).toEqual({ ok: false, reason: 'version_conflict' });

    expect(await repository.verify({
      identity,
      claims: claims('device-a'),
      nowEpochMs: now + 60_000,
    })).toEqual({ ok: false, reason: 'expired_session' });
  });

  it('atomically transitions context and rejects a failed version compare-and-swap', async () => {
    const { store, repository } = setup();
    await repository.create({
      sessionId: 'device-a',
      userId: identity.userId,
      expiresAtEpochMs: now + 60_000,
      nowEpochMs: now,
    });
    const input = {
      identity,
      claims: claims('device-a'),
      targetContext: makeContext(),
      authorization: { kind: 'local' as const, membership },
      nowEpochMs: now,
    };

    store.failNextCompareAndSwap = true;
    expect(await repository.transitionContext(input)).toEqual({
      ok: false,
      reason: 'version_conflict',
    });
    expect((await repository.load('device-a'))?.context).toBeNull();

    const transitioned = await repository.transitionContext(input);
    expect(transitioned.ok).toBe(true);
    if (!transitioned.ok) return;
    expect(transitioned.changed).toBe(true);
    expect(transitioned.session.contextVersion).toBe(1);
    expect(await repository.verify({
      identity,
      claims: claims('device-a'),
      nowEpochMs: now,
    })).toEqual({ ok: false, reason: 'version_conflict' });
  });

  it('revokes only the identified session and rejects later verification', async () => {
    const { repository } = setup();
    const createInput = {
      userId: identity.userId,
      expiresAtEpochMs: now + 60_000,
      nowEpochMs: now,
    };
    await repository.create({ ...createInput, sessionId: 'device-a' });
    await repository.create({ ...createInput, sessionId: 'device-b' });

    const revoked = await repository.revoke({
      identity,
      claims: claims('device-a'),
      nowEpochMs: now,
    });
    expect(revoked.ok).toBe(true);
    expect(await repository.verify({
      identity,
      claims: claims('device-a'),
      nowEpochMs: now,
    })).toEqual({ ok: false, reason: 'revoked_session' });
    expect((await repository.verify({
      identity,
      claims: claims('device-b'),
      nowEpochMs: now,
    })).ok).toBe(true);
  });

  it('does not expose stored context objects through created, loaded, or transitioned results', async () => {
    const { repository } = setup();
    const created = await repository.create({
      sessionId: 'device-a',
      userId: identity.userId,
      expiresAtEpochMs: now + 60_000,
      nowEpochMs: now,
    });
    if (!created.ok) throw new Error('Expected session creation');

    const transitioned = await repository.transitionContext({
      identity,
      claims: claims('device-a'),
      targetContext: makeContext(),
      authorization: { kind: 'local', membership },
      nowEpochMs: now,
    });
    if (!transitioned.ok || transitioned.session.context?.kind !== 'local') {
      throw new Error('Expected local context transition');
    }
    Object.assign(transitioned.session.context.active, { schoolId: 99 });

    const loaded = await repository.load('device-a');
    expect(loaded?.context).toEqual(makeContext());
    if (loaded?.context?.kind !== 'local') return;
    Object.assign(loaded.context.active, { schoolId: 88 });
    expect((await repository.load('device-a'))?.context).toEqual(makeContext());
  });
});
