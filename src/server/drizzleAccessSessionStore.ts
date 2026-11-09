import { and, eq, gt } from 'drizzle-orm';
import type { db } from '../db/index.ts';
import { accessSessions } from '../db/schema.ts';
import type { AccessSessionStore, AccessSessionVersionCondition } from './accessSessionRepository.ts';
import type { AccessLifecycleSession } from './accessSessionLifecycle.ts';

type AccessSessionDrizzleClient = Pick<typeof db, 'insert' | 'select' | 'update'>;

function toDatabaseDate(epochMs: number): Date {
  const date = new Date(epochMs);
  if (!Number.isFinite(date.getTime())) {
    throw new RangeError('Access session timestamp is outside the supported date range.');
  }
  return date;
}

function toEpochMs(value: Date | string): number {
  const date = value instanceof Date ? value : new Date(value);
  return date.getTime();
}

function toLifecycleSession(row: {
  readonly id: string;
  readonly userId: number;
  readonly status: string;
  readonly contextVersion: number;
  readonly context: unknown;
  readonly expiresAt: Date | string;
}): unknown {
  return {
    sessionId: row.id,
    userId: row.userId,
    status: row.status,
    contextVersion: row.contextVersion,
    expiresAtEpochMs: toEpochMs(row.expiresAt),
    context: row.context,
  };
}

function expectedSessionCondition(expected: AccessSessionVersionCondition) {
  return and(
    eq(accessSessions.id, expected.sessionId),
    eq(accessSessions.userId, expected.userId),
    eq(accessSessions.status, expected.status),
    eq(accessSessions.contextVersion, expected.contextVersion),
    gt(accessSessions.expiresAt, toDatabaseDate(expected.validAtEpochMs)),
  );
}

export class DrizzleAccessSessionStore implements AccessSessionStore {
  constructor(private readonly client: AccessSessionDrizzleClient) {}

  async create(_session: AccessLifecycleSession): Promise<boolean> {
    throw new Error(
      'Generation-unaware access session creation is disabled; use DrizzleGenerationAwareAccessSessionStore.',
    );
  }

  async load(sessionId: string): Promise<unknown | null> {
    const [row] = await this.client
      .select({
        id: accessSessions.id,
        userId: accessSessions.userId,
        status: accessSessions.status,
        contextVersion: accessSessions.contextVersion,
        context: accessSessions.context,
        expiresAt: accessSessions.expiresAt,
      })
      .from(accessSessions)
      .where(eq(accessSessions.id, sessionId))
      .limit(1);
    return row ? toLifecycleSession(row) : null;
  }

  async compareAndSwap(input: {
    readonly expected: AccessSessionVersionCondition;
    readonly next: AccessLifecycleSession;
  }): Promise<boolean> {
    const { expected, next } = input;
    if (
      next.sessionId !== expected.sessionId
      || next.userId !== expected.userId
      || next.status === 'expired'
      || (next.status === 'active' && next.contextVersion !== expected.contextVersion + 1)
      || (next.status === 'revoked' && next.contextVersion !== expected.contextVersion)
    ) {
      return false;
    }

    const updated = await this.client
      .update(accessSessions)
      .set({
        status: next.status,
        contextVersion: next.contextVersion,
        context: next.context,
        expiresAt: toDatabaseDate(next.expiresAtEpochMs),
        updatedAt: toDatabaseDate(expected.validAtEpochMs),
        revokedAt: next.status === 'revoked'
          ? toDatabaseDate(expected.validAtEpochMs)
          : null,
      })
      .where(expectedSessionCondition(expected))
      .returning({ id: accessSessions.id });

    return updated.length === 1;
  }
}
