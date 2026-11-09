import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import { accessSessions, localAuths, userSchools, users } from '../db/schema.ts';
import { DrizzleGenerationAwareAccessSessionStore } from './drizzleGenerationAwareAccessSessionStore.ts';
import { updateLocalAuthCredentials } from './localAuthCredentialTransaction.ts';

const now = 1_800_000_000_000;

function createMockClient(options: {
  readonly selectRows?: Array<Array<Record<string, unknown>>>;
  readonly insertRows?: Array<Array<{ id: string }>>;
  readonly updateRows?: Array<Array<{ id: number | string }>>;
  readonly serializeTransactions?: boolean;
} = {}) {
  type SelectBuilder = {
    where: (condition: SQL<unknown>) => SelectBuilder;
    for: (lock: 'update') => SelectBuilder;
    innerJoin: (...args: unknown[]) => SelectBuilder;
    limit: () => Promise<Array<Record<string, unknown>>>;
    then: PromiseLike<Array<Record<string, unknown>>>['then'];
  };
  type InsertBuilder = {
    values: (values: Record<string, unknown>) => InsertBuilder;
    onConflictDoNothing: (...args: unknown[]) => InsertBuilder;
    returning: () => Promise<Array<{ id: string }>>;
  };

  const selectRows = [...(options.selectRows ?? [])];
  const insertRows = [...(options.insertRows ?? [])];
  const updateRows = [...(options.updateRows ?? [])];

  const selectLimit = vi.fn(async () => selectRows.shift() ?? []);
  let selectBuilder: SelectBuilder;
  const selectWhere = vi.fn((_condition: SQL<unknown>): SelectBuilder => selectBuilder);
  const selectFor = vi.fn((_lock: 'update'): SelectBuilder => selectBuilder);
  const selectInnerJoin = vi.fn((..._args: unknown[]): SelectBuilder => selectBuilder);
  const selectFrom = vi.fn((_table: unknown): SelectBuilder => selectBuilder);
  selectBuilder = {
    where: selectWhere,
    for: selectFor,
    innerJoin: selectInnerJoin,
    limit: selectLimit,
    then: (onfulfilled, onrejected) => Promise.resolve(selectRows.shift() ?? []).then(onfulfilled, onrejected),
  };
  const select = vi.fn((_fields?: Record<string, unknown>) => ({ from: selectFrom }));

  const insertReturning = vi.fn(async () => insertRows.shift() ?? [{ id: 'session-a' }]);
  let insertBuilder: InsertBuilder;
  const insertOnConflict = vi.fn((..._args: unknown[]): InsertBuilder => insertBuilder);
  const insertValues = vi.fn((_values: Record<string, unknown>): InsertBuilder => insertBuilder);
  insertBuilder = {
    values: insertValues,
    onConflictDoNothing: insertOnConflict,
    returning: insertReturning,
  };
  const insert = vi.fn(() => insertBuilder);

  const updateReturning = vi.fn(async () => updateRows.shift() ?? [{ id: 12 }]);
  const updateWhere = vi.fn((_condition: SQL<unknown>) => ({ returning: updateReturning }));
  const updateSet = vi.fn((_values: Record<string, unknown>) => ({ where: updateWhere }));
  const update = vi.fn(() => ({ set: updateSet }));
  const tx = { select, insert, update };
  const committedTransactions: object[] = [];
  const rolledBackTransactions: object[] = [];

  let transactionTail = Promise.resolve();
  const transaction = vi.fn(async <T>(operation: (transaction: typeof tx) => Promise<T>) => {
    let release: (() => void) | undefined;
    if (options.serializeTransactions) {
      const previous = transactionTail;
      transactionTail = new Promise<void>((resolve) => {
        release = resolve;
      });
      await previous;
    }

    try {
      const result = await operation(tx);
      committedTransactions.push(tx);
      return result;
    } catch (error) {
      rolledBackTransactions.push(tx);
      throw error;
    } finally {
      release?.();
    }
  });

  return {
    client: { select, transaction } as unknown as ConstructorParameters<
      typeof DrizzleGenerationAwareAccessSessionStore
    >[0],
    select,
    selectWhere,
    selectFor,
    selectInnerJoin,
    selectFrom,
    selectLimit,
    insert,
    insertValues,
    insertOnConflict,
    insertReturning,
    update,
    updateSet,
    updateWhere,
    updateReturning,
    transaction,
    tx,
    committedTransactions,
    rolledBackTransactions,
  };
}

function userRow(generation: bigint, isDeleted = false) {
  return {
    id: 12,
    role: 'parent',
    name: 'Parent',
    email: 'parent@example.test',
    accessSessionGeneration: generation,
    isDeleted,
    deactivationGenerationAware: null,
  };
}

function sessionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'session-a',
    userId: 12,
    observedGeneration: 7n,
    status: 'active',
    contextVersion: 0,
    context: null,
    expiresAt: new Date(now + 60_000),
    currentGeneration: 7n,
    ...overrides,
  };
}

describe('DrizzleGenerationAwareAccessSessionStore', () => {
  it('creates only under a locked user row and persists the explicitly observed generation', async () => {
    const mock = createMockClient({
      selectRows: [[userRow(7n)]],
      insertRows: [[{ id: 'session-a' }]],
    });
    const store = new DrizzleGenerationAwareAccessSessionStore(mock.client);

    await expect(store.createIfGenerationCurrent({
      sessionId: 'session-a',
      userId: 12,
      expectedGeneration: '7',
      expiresAtEpochMs: now + 60_000,
      nowEpochMs: now,
    })).resolves.toMatchObject({
      status: 'created',
      session: {
        sessionId: 'session-a',
        observedGeneration: '7',
        context: null,
      },
    });

    expect(mock.transaction).toHaveBeenCalledTimes(1);
    expect(mock.selectFor).toHaveBeenCalledWith('update');
    const lockCondition = mock.selectWhere.mock.calls[0]?.[0];
    expect(new PgDialect().sqlToQuery(lockCondition).sql).toContain('"users"."id" = $1');
    expect(mock.insertValues).toHaveBeenCalledWith(expect.objectContaining({
      id: 'session-a',
      userId: 12,
      observedGeneration: 7n,
    }));
    expect(mock.insertOnConflict).toHaveBeenCalledWith({ target: accessSessions.id });
  });

  it.each([
    {
      selectRows: [[userRow(8n)]],
      insertRows: [],
      expected: { status: 'generation_changed', currentGeneration: '8' },
    },
    {
      selectRows: [[]],
      insertRows: [],
      expected: { status: 'user_not_found' },
    },
    {
      selectRows: [[userRow(7n, true)]],
      insertRows: [],
      expected: { status: 'account_not_admissible' },
    },
    {
      selectRows: [[userRow(7n)]],
      insertRows: [[]],
      expected: { status: 'session_exists' },
    },
    {
      selectRows: [[userRow(-1n)]],
      insertRows: [],
      expected: { status: 'invalid_generation' },
    },
  ])('returns explicit conditional-create outcome %#', async ({ selectRows, insertRows, expected }) => {
    const mock = createMockClient({ selectRows, insertRows });
    const store = new DrizzleGenerationAwareAccessSessionStore(mock.client);

    await expect(store.createIfGenerationCurrent({
      sessionId: 'session-a',
      userId: 12,
      expectedGeneration: '7',
      expiresAtEpochMs: now + 60_000,
      nowEpochMs: now,
    })).resolves.toEqual(expected);
    if (expected.status !== 'session_exists') expect(mock.insert).not.toHaveBeenCalled();
  });

  it('loads the session and current user generation from a single joined snapshot', async () => {
    const mock = createMockClient({ selectRows: [[sessionRow()]] });
    const store = new DrizzleGenerationAwareAccessSessionStore(mock.client);

    await expect(store.loadWithGeneration('session-a')).resolves.toEqual({
      session: {
        sessionId: 'session-a',
        userId: 12,
        observedGeneration: '7',
        status: 'active',
        contextVersion: 0,
        context: null,
        expiresAtEpochMs: now + 60_000,
      },
      currentGeneration: '7',
    });
    expect(mock.selectInnerJoin).toHaveBeenCalledWith(users, expect.anything());
    expect(mock.selectLimit).toHaveBeenCalledWith(1);
  });

  it('transitions to an exact active persisted membership under user-then-session locks', async () => {
    const sourceSession = sessionRow();
    const sourceMembership = {
      membershipId: 31,
      userId: 12,
      schoolId: 7,
      role: 'teacher',
      isActive: true,
    };
    const target = { kind: 'local' as const, membershipId: 31, schoolId: 7, role: 'teacher' as const };
    const mock = createMockClient({
      selectRows: [[userRow(7n)], [sourceSession], [sourceMembership]],
      updateRows: [[{ id: 'session-a' }]],
    });
    const store = new DrizzleGenerationAwareAccessSessionStore(mock.client);

    await expect(store.transitionContext({
      userId: 12,
      sessionId: 'session-a',
      expectedContextVersion: 0,
      target,
      nowEpochMs: now,
    })).resolves.toMatchObject({
      status: 'transitioned',
      session: {
        userId: 12,
        observedGeneration: '7',
        contextVersion: 1,
        context: {
          kind: 'local',
          identity: { userId: 12 },
          active: { schoolId: 7, role: 'teacher' },
          membershipId: 31,
        },
      },
    });

    expect(mock.selectFrom.mock.calls).toEqual([
      [users],
      [accessSessions],
      [userSchools],
    ]);
    expect(mock.selectFor).toHaveBeenCalledTimes(3);
    expect(mock.selectFor.mock.calls).toEqual([['update'], ['update'], ['update']]);
    expect(mock.update).toHaveBeenCalledWith(accessSessions);
    expect(mock.update).not.toHaveBeenCalledWith(users);
    expect(mock.updateSet).toHaveBeenCalledWith(expect.objectContaining({
      contextVersion: 1,
      updatedAt: new Date(now),
    }));
    expect(mock.selectWhere.mock.calls[2]?.[0]).toBeDefined();
    expect(mock.select.mock.calls[2]?.[0]).toEqual(expect.objectContaining({
      isActive: userSchools.isActive,
    }));
    expect(target).toEqual({ kind: 'local', membershipId: 31, schoolId: 7, role: 'teacher' });
    expect(sourceSession.context).toBeNull();
    expect(sourceMembership.isActive).toBe(true);
  });

  it('rejects an inactive exact membership while holding the membership lock', async () => {
    const mock = createMockClient({
      selectRows: [
        [userRow(7n)],
        [sessionRow()],
        [{ membershipId: 31, userId: 12, schoolId: 7, role: 'teacher', isActive: false }],
      ],
    });
    const store = new DrizzleGenerationAwareAccessSessionStore(mock.client);

    await expect(store.transitionContext({
      userId: 12,
      sessionId: 'session-a',
      expectedContextVersion: 0,
      target: { kind: 'local', membershipId: 31, schoolId: 7, role: 'teacher' },
      nowEpochMs: now,
    })).resolves.toEqual({ status: 'rejected', reason: 'inactive_membership' });
    expect(mock.selectFor).toHaveBeenCalledTimes(3);
    expect(mock.update).not.toHaveBeenCalled();
    expect(mock.select.mock.calls[2]?.[0]).toEqual(expect.objectContaining({
      isActive: userSchools.isActive,
    }));
  });

  it('allows successive transitions between active functions with increasing context versions', async () => {
    const parentContext = {
      kind: 'local',
      identity: { userId: 12 },
      active: { schoolId: 7, role: 'parent' },
      membershipId: 31,
    };
    const mock = createMockClient({
      selectRows: [
        [userRow(7n)],
        [sessionRow()],
        [{ membershipId: 31, userId: 12, schoolId: 7, role: 'parent', isActive: true }],
        [userRow(7n)],
        [sessionRow({ contextVersion: 1, context: parentContext })],
        [{ membershipId: 32, userId: 12, schoolId: 7, role: 'teacher', isActive: true }],
      ],
      updateRows: [[{ id: 'session-a' }], [{ id: 'session-a' }]],
    });
    const store = new DrizzleGenerationAwareAccessSessionStore(mock.client);

    const first = await store.transitionContext({
      userId: 12,
      sessionId: 'session-a',
      expectedContextVersion: 0,
      target: { kind: 'local', membershipId: 31, schoolId: 7, role: 'parent' },
      nowEpochMs: now,
    });
    const second = await store.transitionContext({
      userId: 12,
      sessionId: 'session-a',
      expectedContextVersion: 1,
      target: { kind: 'local', membershipId: 32, schoolId: 7, role: 'teacher' },
      nowEpochMs: now + 1,
    });

    expect(first).toMatchObject({
      status: 'transitioned',
      session: { contextVersion: 1, context: parentContext },
    });
    expect(second).toMatchObject({
      status: 'transitioned',
      session: {
        contextVersion: 2,
        context: {
          kind: 'local',
          identity: { userId: 12 },
          active: { schoolId: 7, role: 'teacher' },
          membershipId: 32,
        },
      },
    });
    expect(mock.updateSet.mock.calls.map(([values]) => values.contextVersion)).toEqual([1, 2]);
  });

  it('does not increment context version for an identical verified context', async () => {
    const currentContext = {
      kind: 'local',
      identity: { userId: 12 },
      active: { schoolId: 7, role: 'teacher' },
      membershipId: 31,
    };
    const mock = createMockClient({
      selectRows: [
        [userRow(7n)],
        [sessionRow({ contextVersion: 4, context: currentContext })],
        [{ membershipId: 31, userId: 12, schoolId: 7, role: 'teacher', isActive: null }],
      ],
    });
    const store = new DrizzleGenerationAwareAccessSessionStore(mock.client);

    await expect(store.transitionContext({
      userId: 12,
      sessionId: 'session-a',
      expectedContextVersion: 4,
      target: { kind: 'local', membershipId: 31, schoolId: 7, role: 'teacher' },
      nowEpochMs: now,
    })).resolves.toMatchObject({
      status: 'unchanged',
      session: { contextVersion: 4, context: currentContext },
    });
    expect(mock.update).not.toHaveBeenCalled();
  });

  it.each([
    ['obsolete version', sessionRow({ contextVersion: 1 }), 'version_conflict'],
    ['revoked session', sessionRow({ status: 'revoked' }), 'revoked_session'],
    ['expired session', sessionRow({ expiresAt: new Date(now) }), 'expired_session'],
  ] as const)('rejects a transition with %s', async (_label, session, reason) => {
    const mock = createMockClient({ selectRows: [[userRow(7n)], [session]] });
    const store = new DrizzleGenerationAwareAccessSessionStore(mock.client);

    await expect(store.transitionContext({
      userId: 12,
      sessionId: 'session-a',
      expectedContextVersion: 0,
      target: { kind: 'global' },
      nowEpochMs: now,
    })).resolves.toEqual({ status: 'rejected', reason });
    expect(mock.selectFor).toHaveBeenCalledTimes(2);
    expect(mock.update).not.toHaveBeenCalled();
  });

  it('rejects sessions created under an obsolete account generation', async () => {
    const mock = createMockClient({
      selectRows: [[userRow(8n)], [sessionRow({ observedGeneration: 7n })]],
    });
    const store = new DrizzleGenerationAwareAccessSessionStore(mock.client);

    await expect(store.transitionContext({
      userId: 12,
      sessionId: 'session-a',
      expectedContextVersion: 0,
      target: { kind: 'global' },
      nowEpochMs: now,
    })).resolves.toEqual({ status: 'rejected', reason: 'generation_changed' });
    expect(mock.update).not.toHaveBeenCalled();
  });

  it('rejects a disabled user before reading or updating the session', async () => {
    const mock = createMockClient({ selectRows: [[userRow(7n, true)]] });
    const store = new DrizzleGenerationAwareAccessSessionStore(mock.client);

    await expect(store.transitionContext({
      userId: 12,
      sessionId: 'session-a',
      expectedContextVersion: 0,
      target: { kind: 'global' },
      nowEpochMs: now,
    })).resolves.toEqual({ status: 'rejected', reason: 'account_not_admissible' });
    expect(mock.selectFor).toHaveBeenCalledTimes(1);
    expect(mock.update).not.toHaveBeenCalled();
  });

  it('rejects missing and role-mismatched memberships without trusting the requested role', async () => {
    for (const [membership, reason] of [
      [undefined, 'missing_membership'],
      [{ membershipId: 31, userId: 12, schoolId: 7, role: 'surveillant' }, 'role_mismatch'],
    ] as const) {
      const mock = createMockClient({
        selectRows: [
          [userRow(7n)],
          [sessionRow()],
          membership ? [membership] : [],
        ],
      });
      const store = new DrizzleGenerationAwareAccessSessionStore(mock.client);

      await expect(store.transitionContext({
        userId: 12,
        sessionId: 'session-a',
        expectedContextVersion: 0,
        target: { kind: 'local', membershipId: 31, schoolId: 7, role: 'teacher' },
        nowEpochMs: now,
      })).resolves.toEqual({ status: 'rejected', reason });
      expect(mock.update).not.toHaveBeenCalled();
    }
  });

  it('serializes competing transitions and rejects the second stale context version', async () => {
    const mock = createMockClient({
      serializeTransactions: true,
      selectRows: [
        [userRow(7n)],
        [sessionRow()],
        [{ membershipId: 31, userId: 12, schoolId: 7, role: 'teacher' }],
        [userRow(7n)],
        [sessionRow({ contextVersion: 1 })],
      ],
      updateRows: [[{ id: 'session-a' }]],
    });
    const store = new DrizzleGenerationAwareAccessSessionStore(mock.client);
    const input = {
      userId: 12,
      sessionId: 'session-a',
      expectedContextVersion: 0,
      target: { kind: 'local' as const, membershipId: 31, schoolId: 7, role: 'teacher' as const },
      nowEpochMs: now,
    };

    const results = await Promise.all([
      store.transitionContext(input),
      store.transitionContext(input),
    ]);
    expect(results.map((result) => result.status)).toEqual(['transitioned', 'rejected']);
    expect(results[1]).toEqual({ status: 'rejected', reason: 'version_conflict' });
    expect(mock.update).toHaveBeenCalledTimes(1);
  });

  it('rejects a global context unless the locked user is a super administrator', async () => {
    const mock = createMockClient({ selectRows: [[userRow(7n)], [sessionRow()]] });
    const store = new DrizzleGenerationAwareAccessSessionStore(mock.client);

    await expect(store.transitionContext({
      userId: 12,
      sessionId: 'session-a',
      expectedContextVersion: 0,
      target: { kind: 'global' },
      nowEpochMs: now,
    })).resolves.toEqual({ status: 'rejected', reason: 'unauthorized_context' });
    expect(mock.update).not.toHaveBeenCalled();
  });

  it('rejects invalid BIGINT driver values instead of coercing through Number', async () => {
    const mock = createMockClient({
      selectRows: [[sessionRow({ currentGeneration: '7' })]],
    });
    const store = new DrizzleGenerationAwareAccessSessionStore(mock.client);

    await expect(store.loadWithGeneration('session-a'))
      .rejects.toThrow(/Stored access session generation/);
  });

  it('revokes an active owned session with a single conditional update', async () => {
    const mock = createMockClient({ updateRows: [[{ id: 'session-a' }]] });
    const store = new DrizzleGenerationAwareAccessSessionStore(mock.client);

    await expect(store.revokeById({
      sessionId: 'session-a',
      userId: 12,
      nowEpochMs: now,
    })).resolves.toEqual({ status: 'revoked' });
    expect(mock.transaction).toHaveBeenCalledTimes(1);
    expect(mock.updateSet).toHaveBeenCalledWith({
      status: 'revoked',
      revokedAt: new Date(now),
      updatedAt: new Date(now),
    });
    const condition = mock.updateWhere.mock.calls[0]?.[0];
    const query = new PgDialect().sqlToQuery(condition);
    expect(query.sql).toContain('"access_sessions"."id" = $1');
    expect(query.sql).toContain('"access_sessions"."user_id" = $2');
    expect(query.sql).toContain('"access_sessions"."status" = $3');
    expect(query.sql).toContain('"access_sessions"."expires_at" > $4');
  });

  it('deactivates one exact function and revokes only sessions carrying its current context', async () => {
    const mock = createMockClient({
      selectRows: [
        [userRow(7n)],
        [{ id: 7 }],
        [{ id: 31, isActive: true }],
      ],
      updateRows: [[{ id: 31 }], [{ id: 'parent-session' }]],
    });
    const store = new DrizzleGenerationAwareAccessSessionStore(mock.client);
    const mutation = vi.fn(async () => undefined);

    await expect(store.deactivateMembership({
      userId: 12,
      membershipId: 31,
      schoolId: 7,
      role: 'parent',
      nowEpochMs: now,
      mutation,
    })).resolves.toEqual({ status: 'deactivated', revokedSessionCount: 1 });

    expect(mock.selectFor).toHaveBeenCalledTimes(3);
    expect(mock.updateSet).toHaveBeenNthCalledWith(1, { isActive: false });
    expect(mock.updateSet).toHaveBeenNthCalledWith(2, {
      status: 'revoked',
      revokedAt: new Date(now),
      updatedAt: new Date(now),
    });
    const sessionUpdate = new PgDialect().sqlToQuery(mock.updateWhere.mock.calls[1]![0]);
    expect(sessionUpdate.sql).toContain('"access_sessions"."user_id"');
    expect(sessionUpdate.sql).toContain('"access_sessions"."context" @>');
    expect(sessionUpdate.params).toContain(JSON.stringify({
      kind: 'local',
      identity: { userId: 12 },
      active: { schoolId: 7, role: 'parent' },
      membershipId: 31,
    }));
    expect(mock.updateSet.mock.calls.some(([values]) => (
      Object.hasOwn(values, 'accessSessionGeneration')
    ))).toBe(false);
    expect(mutation).toHaveBeenCalledWith(mock.tx);
  });

  it('refuses to deactivate the last active school administrator', async () => {
    const mock = createMockClient({
      selectRows: [
        [userRow(7n)],
        [{ id: 7 }],
        [{ id: 31, isActive: null }],
        [],
      ],
    });
    const store = new DrizzleGenerationAwareAccessSessionStore(mock.client);

    await expect(store.deactivateMembership({
      userId: 12,
      membershipId: 31,
      schoolId: 7,
      role: 'school_admin',
      nowEpochMs: now,
    })).resolves.toEqual({ status: 'last_school_admin' });
    expect(mock.selectFor).toHaveBeenCalledTimes(3);
    expect(mock.update).not.toHaveBeenCalled();
  });

  it('serializes competing last-administrator removals on the school row', async () => {
    const mock = createMockClient({
      serializeTransactions: true,
      selectRows: [
        [userRow(7n)],
        [{ id: 7 }],
        [{ id: 31, isActive: true }],
        [{ userId: 13 }],
        [{ ...userRow(7n), id: 13 }],
        [{ id: 7 }],
        [{ id: 32, isActive: true }],
        [],
      ],
      updateRows: [[{ id: 31 }], []],
    });
    const store = new DrizzleGenerationAwareAccessSessionStore(mock.client);

    const outcomes = await Promise.all([
      store.deactivateMembership({
        userId: 12,
        membershipId: 31,
        schoolId: 7,
        role: 'school_admin',
        nowEpochMs: now,
      }),
      store.deactivateMembership({
        userId: 13,
        membershipId: 32,
        schoolId: 7,
        role: 'school_admin',
        nowEpochMs: now,
      }),
    ]);

    expect(outcomes.map((outcome) => outcome.status).sort()).toEqual(['deactivated', 'last_school_admin']);
    expect(mock.selectFor).toHaveBeenCalledWith('update');
    expect(mock.transaction).toHaveBeenCalledTimes(2);
  });

  it('protects the last local school administrator during global account deactivation', async () => {
    const mock = createMockClient({
      selectRows: [
        [userRow(7n)],
        [{ schoolId: 7 }],
        [{ id: 7 }],
        [],
      ],
    });
    const store = new DrizzleGenerationAwareAccessSessionStore(mock.client);

    await expect(store.transitionAccountLifecycle({
      userId: 12,
      operation: 'deactivate',
      allowedRoles: ['parent'],
      protectLastSchoolAdmin: true,
    })).resolves.toEqual({ status: 'last_school_admin' });
    expect(mock.update).not.toHaveBeenCalled();
  });

  it.each([
    [sessionRow({ status: 'revoked' }), 'already_revoked'],
    [sessionRow({ status: 'expired' }), 'already_expired'],
    [sessionRow({ expiresAt: new Date(now) }), 'already_expired'],
    [sessionRow({ userId: 13 }), 'identity_mismatch'],
    [undefined, 'not_found'],
    [sessionRow({ status: 'unknown' }), 'invalid_session'],
  ] as const)('reports repeated or inapplicable revocation as %s', async (session, status) => {
    const mock = createMockClient({
      updateRows: [[]],
      selectRows: [session ? [session] : []],
    });
    const store = new DrizzleGenerationAwareAccessSessionStore(mock.client);

    await expect(store.revokeById({
      sessionId: 'session-a',
      userId: 12,
      nowEpochMs: now,
    })).resolves.toEqual({ status });
  });

  it('passes the transaction-scoped Drizzle client to the callback', async () => {
    const mock = createMockClient({
      selectRows: [[userRow(7n)], [{ id: 12 }]],
      updateRows: [[{ id: 12 }], [{ id: 12 }]],
    });
    const store = new DrizzleGenerationAwareAccessSessionStore(mock.client);
    let receivedTransaction: unknown;

    await expect(store.revokeAllForUser({
      userId: 12,
      mutation: async (_generation, transaction) => {
        receivedTransaction = transaction;
        await updateLocalAuthCredentials(transaction, {
          userId: 12,
          values: {
            passwordHash: 'new-hash',
            salt: 'new-salt',
            mustReset: true,
          },
        });
      },
    })).resolves.toEqual({
      status: 'revoked_all',
      previousGeneration: '7',
      currentGeneration: '8',
    });
    expect(receivedTransaction).toBe(mock.tx);
    expect(receivedTransaction).not.toBe(mock.client);
    expect(mock.selectFor).toHaveBeenCalledWith('update');
    expect(mock.updateSet).toHaveBeenCalledWith({ accessSessionGeneration: 8n });
    expect(mock.update).toHaveBeenLastCalledWith(localAuths);
    expect(mock.updateSet).toHaveBeenLastCalledWith({
      passwordHash: 'new-hash',
      salt: 'new-salt',
      mustReset: true,
    });
    expect(mock.committedTransactions).toEqual([mock.tx]);
  });

  it.each([
    [[], { status: 'user_not_found' }],
    [[userRow(9_223_372_036_854_775_807n)], { status: 'generation_exhausted' }],
    [[userRow(-1n)], { status: 'invalid_generation' }],
    [[userRow(7n, true)], { status: 'account_not_admissible' }],
  ] as const)('does not wrap an absent or invalid global generation %#', async (selectRows, expected) => {
    const mock = createMockClient({ selectRows: [Array.from(selectRows)] });
    const store = new DrizzleGenerationAwareAccessSessionStore(mock.client);

    await expect(store.revokeAllForUser({ userId: 12 })).resolves.toEqual(expected);
    expect(mock.update).not.toHaveBeenCalled();
  });

  it('allows explicit administrative revocation for a disabled account without changing its disabled state', async () => {
    const mock = createMockClient({
      selectRows: [[userRow(7n, true)]],
      updateRows: [[{ id: 12 }]],
    });
    const store = new DrizzleGenerationAwareAccessSessionStore(mock.client);

    await expect(store.revokeAllForUser({
      userId: 12,
      allowDisabledForAdministrativePasswordReset: true,
    })).resolves.toEqual({
      status: 'revoked_all',
      previousGeneration: '7',
      currentGeneration: '8',
    });
    expect(mock.updateSet).toHaveBeenCalledWith({ accessSessionGeneration: 8n });
    expect(mock.updateSet).not.toHaveBeenCalledWith({ isDeleted: false });
    expect(mock.updateSet).not.toHaveBeenCalledWith(expect.objectContaining({
      deactivationGenerationAware: expect.anything(),
    }));
  });

  it.each([
    [null, 8n],
    [false, 8n],
    [true, 8n],
  ] as const)('deactivates an active account with marker %s and increments once', async (marker, expectedGeneration) => {
    const mock = createMockClient({
      selectRows: [[{ ...userRow(7n), deactivationGenerationAware: marker }]],
    });
    const store = new DrizzleGenerationAwareAccessSessionStore(mock.client);
    const mutation = vi.fn(async () => undefined);

    await expect(store.transitionAccountLifecycle({
      userId: 12,
      operation: 'deactivate',
      allowedRoles: ['parent', 'teacher', 'school_admin'],
      mutation,
    })).resolves.toEqual({
      status: 'deactivated',
      previousGeneration: '7',
      currentGeneration: expectedGeneration.toString(),
    });
    expect(mock.selectFor).toHaveBeenCalledWith('update');
    expect(mock.updateSet).toHaveBeenCalledWith({
      isDeleted: true,
      deactivationGenerationAware: true,
      accessSessionGeneration: expectedGeneration,
    });
    expect(mutation).toHaveBeenCalledWith(mock.tx, expect.objectContaining({ role: 'parent' }));
  });

  it.each([
    [null, 'already_deactivated'],
    [true, 'already_deactivated'],
    [false, 'invalid_state'],
  ] as const)('does not repeat a deactivation for a disabled %s account', async (marker, status) => {
    const mock = createMockClient({
      selectRows: [[{ ...userRow(7n, true), deactivationGenerationAware: marker }]],
    });
    const store = new DrizzleGenerationAwareAccessSessionStore(mock.client);
    const mutation = vi.fn(async () => undefined);

    await expect(store.transitionAccountLifecycle({
      userId: 12,
      operation: 'deactivate',
      allowedRoles: ['parent'],
      mutation,
    })).resolves.toEqual({ status });
    expect(mock.update).not.toHaveBeenCalled();
    expect(mutation).not.toHaveBeenCalled();
  });

  it('reactivates a TRUE account without advancing generation or restoring sessions', async () => {
    const mock = createMockClient({
      selectRows: [[{ ...userRow(8n, true), deactivationGenerationAware: true }]],
    });
    const store = new DrizzleGenerationAwareAccessSessionStore(mock.client);

    await expect(store.transitionAccountLifecycle({
      userId: 12,
      operation: 'reactivate',
      allowedRoles: ['parent'],
    })).resolves.toEqual({
      status: 'reactivated',
      previousGeneration: '8',
      currentGeneration: '8',
    });
    expect(mock.updateSet).toHaveBeenCalledWith({
      isDeleted: false,
      deactivationGenerationAware: true,
    });
  });

  it('reactivates a historical NULL account only after advancing generation', async () => {
    const mock = createMockClient({
      selectRows: [[{ ...userRow(8n, true), deactivationGenerationAware: null }]],
    });
    const store = new DrizzleGenerationAwareAccessSessionStore(mock.client);

    await expect(store.transitionAccountLifecycle({
      userId: 12,
      operation: 'reactivate',
      allowedRoles: ['parent'],
    })).resolves.toEqual({
      status: 'reactivated',
      previousGeneration: '8',
      currentGeneration: '9',
    });
    expect(mock.updateSet).toHaveBeenCalledWith({
      isDeleted: false,
      deactivationGenerationAware: true,
      accessSessionGeneration: 9n,
    });
  });

  it('refuses disabled FALSE states without any write', async () => {
    const mock = createMockClient({
      selectRows: [[{ ...userRow(8n, true), deactivationGenerationAware: false }]],
    });
    const store = new DrizzleGenerationAwareAccessSessionStore(mock.client);

    await expect(store.transitionAccountLifecycle({
      userId: 12,
      operation: 'reactivate',
      allowedRoles: ['parent'],
    })).resolves.toEqual({ status: 'invalid_state' });
    expect(mock.update).not.toHaveBeenCalled();
  });

  it('does not run lifecycle mutations when generation increment fails', async () => {
    const mock = createMockClient({
      selectRows: [[{ ...userRow(9_223_372_036_854_775_807n), deactivationGenerationAware: false }]],
    });
    const store = new DrizzleGenerationAwareAccessSessionStore(mock.client);
    const mutation = vi.fn(async () => undefined);

    await expect(store.transitionAccountLifecycle({
      userId: 12,
      operation: 'deactivate',
      allowedRoles: ['parent'],
      mutation,
    })).resolves.toEqual({ status: 'generation_exhausted' });
    expect(mock.update).not.toHaveBeenCalled();
    expect(mutation).not.toHaveBeenCalled();
  });

  it('refuses malformed lifecycle generations before writing any state', async () => {
    const mock = createMockClient({
      selectRows: [[{ ...userRow(-1n), deactivationGenerationAware: false }]],
    });
    const store = new DrizzleGenerationAwareAccessSessionStore(mock.client);
    const mutation = vi.fn(async () => undefined);

    await expect(store.transitionAccountLifecycle({
      userId: 12,
      operation: 'deactivate',
      allowedRoles: ['parent'],
      mutation,
    })).resolves.toEqual({ status: 'invalid_generation' });
    expect(mock.update).not.toHaveBeenCalled();
    expect(mutation).not.toHaveBeenCalled();
  });

  it('rolls back lifecycle updates when downstream Android or audit mutation fails', async () => {
    const mutationError = new Error('simulated lifecycle side-effect failure');
    const mock = createMockClient({
      selectRows: [[{ ...userRow(7n), deactivationGenerationAware: false }]],
    });
    const store = new DrizzleGenerationAwareAccessSessionStore(mock.client);

    await expect(store.transitionAccountLifecycle({
      userId: 12,
      operation: 'deactivate',
      allowedRoles: ['parent'],
      mutation: async () => { throw mutationError; },
    })).rejects.toBe(mutationError);
    expect(mock.updateSet).toHaveBeenCalledWith({
      isDeleted: true,
      deactivationGenerationAware: true,
      accessSessionGeneration: 8n,
    });
    expect(mock.rolledBackTransactions).toEqual([mock.tx]);
    expect(mock.committedTransactions).toEqual([]);
  });

  it('runs the supplied mutation inside the transaction and propagates failure for rollback', async () => {
    const mutationError = new Error('transaction mutation failed');
    const mock = createMockClient({
      selectRows: [[userRow(7n)], [{ id: 12 }]],
      updateRows: [[{ id: 12 }], [{ id: 12 }]],
    });
    const store = new DrizzleGenerationAwareAccessSessionStore(mock.client);

    await expect(store.revokeAllForUser({
      userId: 12,
      mutation: async (_generation, transaction) => {
        expect(transaction).toBe(mock.tx);
        await updateLocalAuthCredentials(transaction, {
          userId: 12,
          values: {
            passwordHash: 'new-hash',
            salt: 'new-salt',
            mustReset: false,
          },
        });
        throw mutationError;
      },
    })).rejects.toBe(mutationError);
    expect(mock.transaction).toHaveBeenCalledTimes(1);
    expect(mock.updateSet).toHaveBeenCalledWith({ accessSessionGeneration: 8n });
    expect(mock.updateSet).toHaveBeenCalledWith({
      passwordHash: 'new-hash',
      salt: 'new-salt',
      mustReset: false,
    });
    expect(mock.rolledBackTransactions).toEqual([mock.tx]);
    expect(mock.committedTransactions).toEqual([]);
  });

  it('serializes competing create and global-revoke transactions through the shared user lock', async () => {
    const createFirst = createMockClient({
      serializeTransactions: true,
      selectRows: [[userRow(4n)], [userRow(4n)]],
      insertRows: [[{ id: 'session-a' }]],
      updateRows: [[{ id: 12 }]],
    });
    const createFirstStore = new DrizzleGenerationAwareAccessSessionStore(createFirst.client);
    const [createdBeforeRevoke, revokedAfterCreate] = await Promise.all([
      createFirstStore.createIfGenerationCurrent({
        sessionId: 'session-a',
        userId: 12,
        expectedGeneration: '4',
        expiresAtEpochMs: now + 60_000,
        nowEpochMs: now,
      }),
      createFirstStore.revokeAllForUser({ userId: 12 }),
    ]);

    expect(createdBeforeRevoke.status).toBe('created');
    expect(revokedAfterCreate).toMatchObject({
      status: 'revoked_all',
      currentGeneration: '5',
    });
    expect(createFirst.selectFor).toHaveBeenCalledTimes(2);
    expect(createFirst.selectFor.mock.calls).toEqual([['update'], ['update']]);

    const revokeFirst = createMockClient({
      serializeTransactions: true,
      selectRows: [[userRow(4n)], [userRow(5n)]],
      updateRows: [[{ id: 12 }]],
    });
    const revokeFirstStore = new DrizzleGenerationAwareAccessSessionStore(revokeFirst.client);
    const [revokedBeforeCreate, rejectedCreate] = await Promise.all([
      revokeFirstStore.revokeAllForUser({ userId: 12 }),
      revokeFirstStore.createIfGenerationCurrent({
        sessionId: 'session-b',
        userId: 12,
        expectedGeneration: '4',
        expiresAtEpochMs: now + 60_000,
        nowEpochMs: now,
      }),
    ]);

    expect(revokedBeforeCreate).toMatchObject({
      status: 'revoked_all',
      currentGeneration: '5',
    });
    expect(rejectedCreate).toEqual({
      status: 'generation_changed',
      currentGeneration: '5',
    });
    expect(revokeFirst.insert).not.toHaveBeenCalled();
    expect(revokeFirst.selectFor).toHaveBeenCalledTimes(2);
  });
});
