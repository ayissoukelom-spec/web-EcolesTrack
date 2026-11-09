import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it, vi } from 'vitest';
import type { AccessLifecycleSession } from './accessSessionLifecycle.ts';
import { DrizzleAccessSessionStore } from './drizzleAccessSessionStore.ts';

const now = 1_800_000_000_000;

function makeSession(overrides: Partial<AccessLifecycleSession> = {}): AccessLifecycleSession {
  return {
    sessionId: 'session-a',
    userId: 12,
    status: 'active',
    contextVersion: 0,
    expiresAtEpochMs: now + 60_000,
    context: null,
    ...overrides,
  };
}

function createMockClient(options: {
  readonly insertRows?: Array<{ id: string }>;
  readonly selectedRows?: Array<Record<string, unknown>>;
  readonly updatedRows?: Array<{ id: string }>;
} = {}) {
  const values = vi.fn();
  const insertReturning = vi.fn().mockResolvedValue(options.insertRows ?? [{ id: 'session-a' }]);
  const onConflictDoNothing = vi.fn();
  const insertBuilder = {
    values,
    onConflictDoNothing,
    returning: insertReturning,
  };
  values.mockReturnValue(insertBuilder);
  onConflictDoNothing.mockReturnValue(insertBuilder);
  const insert = vi.fn().mockReturnValue(insertBuilder);

  const limit = vi.fn().mockResolvedValue(options.selectedRows ?? []);
  const whereSelect = vi.fn().mockReturnValue({ limit });
  const from = vi.fn().mockReturnValue({ where: whereSelect });
  const select = vi.fn().mockReturnValue({ from });

  const updateReturning = vi.fn().mockResolvedValue(options.updatedRows ?? [{ id: 'session-a' }]);
  const whereUpdate = vi.fn().mockReturnValue({ returning: updateReturning });
  const set = vi.fn().mockReturnValue({ where: whereUpdate });
  const update = vi.fn().mockReturnValue({ set });

  return {
    client: { insert, select, update } as unknown as ConstructorParameters<typeof DrizzleAccessSessionStore>[0],
    insert,
    values,
    onConflictDoNothing,
    insertReturning,
    select,
    from,
    whereSelect,
    limit,
    update,
    set,
    whereUpdate,
    updateReturning,
  };
}

describe('DrizzleAccessSessionStore', () => {
  it('rejects generation-unaware session creation without writing to the database', async () => {
    const mock = createMockClient();
    const store = new DrizzleAccessSessionStore(mock.client);

    await expect(store.create(makeSession())).rejects.toThrow(/Generation-unaware access session creation is disabled/);
    expect(mock.insert).not.toHaveBeenCalled();
  });

  it('loads one session by identifier and maps the database timestamp to epoch milliseconds', async () => {
    const mock = createMockClient({
      selectedRows: [{
        id: 'session-a',
        userId: 12,
        status: 'active',
        contextVersion: 3,
        context: null,
        expiresAt: new Date(now + 60_000),
      }],
    });
    const store = new DrizzleAccessSessionStore(mock.client);

    await expect(store.load('session-a')).resolves.toEqual({
      sessionId: 'session-a',
      userId: 12,
      status: 'active',
      contextVersion: 3,
      expiresAtEpochMs: now + 60_000,
      context: null,
    });
    expect(mock.limit).toHaveBeenCalledWith(1);
  });

  it('performs an atomic version- and expiry-conditional update and reports the affected row count', async () => {
    const mock = createMockClient({ updatedRows: [{ id: 'session-a' }] });
    const store = new DrizzleAccessSessionStore(mock.client);
    const next = makeSession({
      contextVersion: 1,
      context: {
        kind: 'local',
        identity: { userId: 12 },
        active: { schoolId: 7, role: 'teacher' },
        membershipId: 31,
      } as AccessLifecycleSession['context'],
    });

    await expect(store.compareAndSwap({
      expected: {
        sessionId: 'session-a',
        userId: 12,
        contextVersion: 0,
        status: 'active',
        validAtEpochMs: now,
      },
      next,
    })).resolves.toBe(true);
    expect(mock.set).toHaveBeenCalledWith(expect.objectContaining({
      contextVersion: 1,
      status: 'active',
      context: next.context,
    }));

    const where = mock.whereUpdate.mock.calls[0]?.[0];
    expect(where).toBeDefined();
    const query = new PgDialect().sqlToQuery(where);
    expect(query.sql).toContain('"access_sessions"."id" = $1');
    expect(query.sql).toContain('"access_sessions"."user_id" = $2');
    expect(query.sql).toContain('"access_sessions"."status" = $3');
    expect(query.sql).toContain('"access_sessions"."context_version" = $4');
    expect(query.sql).toContain('"access_sessions"."expires_at" > $5');
    expect(query.params).toEqual([
      'session-a',
      12,
      'active',
      0,
      new Date(now).toISOString(),
    ]);

    const conflict = createMockClient({ updatedRows: [] });
    await expect(new DrizzleAccessSessionStore(conflict.client).compareAndSwap({
      expected: {
        sessionId: 'session-a',
        userId: 12,
        contextVersion: 0,
        status: 'active',
        validAtEpochMs: now,
      },
      next,
    })).resolves.toBe(false);
  });

  it('revokes only the target session without incrementing its context version', async () => {
    const mock = createMockClient({ updatedRows: [{ id: 'device-a' }] });
    const store = new DrizzleAccessSessionStore(mock.client);
    const next = makeSession({
      sessionId: 'device-a',
      status: 'revoked',
    });

    await expect(store.compareAndSwap({
      expected: {
        sessionId: 'device-a',
        userId: 12,
        contextVersion: 0,
        status: 'active',
        validAtEpochMs: now,
      },
      next,
    })).resolves.toBe(true);
    expect(mock.set).toHaveBeenCalledWith(expect.objectContaining({
      status: 'revoked',
      revokedAt: new Date(now),
    }));

    const wrongIdentity = createMockClient();
    await expect(new DrizzleAccessSessionStore(wrongIdentity.client).compareAndSwap({
      expected: {
        sessionId: 'device-a',
        userId: 12,
        contextVersion: 0,
        status: 'active',
        validAtEpochMs: now,
      },
      next: makeSession({ sessionId: 'device-b', status: 'revoked' }),
    })).resolves.toBe(false);
    expect(wrongIdentity.update).not.toHaveBeenCalled();
  });

  it('does not allow transaction-scoped legacy creation to bypass generation checks', async () => {
    const mock = createMockClient();
    const transaction = vi.fn(async (operation: (tx: typeof mock.client) => Promise<unknown>) => (
      operation(mock.client)
    ));

    await expect(transaction(async (tx) => new DrizzleAccessSessionStore(tx).create(makeSession())))
      .rejects.toThrow(/Generation-unaware access session creation is disabled/);
    expect(transaction).toHaveBeenCalledTimes(1);
  });
});
