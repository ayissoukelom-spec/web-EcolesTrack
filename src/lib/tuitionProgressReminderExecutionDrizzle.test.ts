import { describe, expect, it, vi } from 'vitest';
import { tuitionProgressReminderControls } from '../db/schema.ts';
import {
  createTuitionProgressReminderExecutionDrizzleSource,
} from './tuitionProgressReminderExecutionDrizzle.ts';
import type {
  TuitionProgressReminderDrizzleDatabase,
} from './tuitionProgressReminderDrizzle.ts';

const now = new Date('2027-02-20T12:00:00.000Z');
const token = '00000000-0000-4000-8000-000000000001';

const claim = {
  id: 501,
  schoolId: 7,
  academicYearId: 23,
  cycleId: 4,
  studentId: 33,
  monthStart: '2027-02-01',
  stage: 'last' as const,
  scheduledAt: new Date('2027-02-20T08:00:00.000Z'),
  expiresAt: new Date('2027-02-20T23:59:59.999Z'),
  timeZone: 'Africa/Lome',
  status: 'checking' as const,
  attemptCount: 2,
  nextAttemptAt: new Date('2027-02-20T08:00:00.000Z'),
  leaseToken: token,
  leaseExpiresAt: new Date('2027-02-20T12:00:30.000Z'),
};

const createDatabase = ({
  selectedRows = [{ id: claim.id }],
  returnedRows = [claim],
}: {
  selectedRows?: Array<{ id: number }>;
  returnedRows?: Array<typeof claim>;
} = {}) => {
  const calls: {
    selectedTable?: unknown;
    lock?: unknown[];
    updateTable?: unknown;
    values?: Record<string, unknown>;
    where?: unknown;
  } = {};
  const database: Record<string, any> = {
    select: vi.fn(() => {
      const builder: any = {
        from(table: unknown) {
          calls.selectedTable = table;
          return builder;
        },
        where() {
          return builder;
        },
        orderBy() {
          return builder;
        },
        limit() {
          return builder;
        },
        for: vi.fn((...args: unknown[]) => {
          calls.lock = args;
          return builder;
        }),
        then(resolve: (rows: unknown[]) => unknown, reject: (error: unknown) => unknown) {
          return Promise.resolve(selectedRows).then(resolve, reject);
        },
      };
      return builder;
    }),
    update: vi.fn((table: unknown) => {
      calls.updateTable = table;
      return {
        set: vi.fn((values: Record<string, unknown>) => {
          calls.values = values;
          return {
            where: vi.fn((condition: unknown) => {
              calls.where = condition;
              return {
                returning: vi.fn(async () => returnedRows),
              };
            }),
          };
        }),
      };
    }),
    transaction: vi.fn(async (callback: (transaction: unknown) => Promise<unknown>) =>
      callback(database)),
  };
  return {
    database: database as unknown as TuitionProgressReminderDrizzleDatabase,
    calls,
  };
};

describe('tuition progress reminder Drizzle execution source', () => {
  it('claims a due row under a transaction-scoped skip-locked row lock', async () => {
    const mock = createDatabase();
    const source = createTuitionProgressReminderExecutionDrizzleSource(mock.database);

    await expect(source.claimDueControl({
      now,
      leaseToken: token,
      leaseExpiresAt: new Date(now.getTime() + 30_000),
      scope: { schoolId: 7, academicYearId: 23, cycleId: 4 },
    })).resolves.toMatchObject({
      id: 501,
      status: 'checking',
      leaseToken: token,
    });

    expect(mock.database.transaction).toHaveBeenCalledOnce();
    expect(mock.calls.selectedTable).toBe(tuitionProgressReminderControls);
    expect(mock.calls.lock).toEqual(['update', { skipLocked: true }]);
    expect(mock.calls.values).toMatchObject({
      status: 'checking',
      leaseToken: token,
      lastAttemptAt: now,
    });
  });

  it('returns no claim when another transaction has locked all due rows', async () => {
    const mock = createDatabase({ selectedRows: [] });
    const source = createTuitionProgressReminderExecutionDrizzleSource(mock.database);

    await expect(source.claimDueControl({
      now,
      leaseToken: token,
      leaseExpiresAt: new Date(now.getTime() + 30_000),
    })).resolves.toBeNull();
    expect(mock.database.update).not.toHaveBeenCalled();
  });

  it('expires due rows and clears any stale lease', async () => {
    const mock = createDatabase();
    const source = createTuitionProgressReminderExecutionDrizzleSource(mock.database);

    await expect(source.expireElapsedControls({
      now,
      scope: { schoolId: 7, academicYearId: 23, cycleId: 4, studentId: 33 },
    })).resolves.toBe(1);

    expect(mock.calls.values).toMatchObject({
      status: 'expired',
      leaseToken: null,
      leaseExpiresAt: null,
      lastError: 'control_expired',
    });
  });

  it('finalizes only through the supplied lease token and clears the lease', async () => {
    const mock = createDatabase();
    const source = createTuitionProgressReminderExecutionDrizzleSource(mock.database);

    await expect(source.completeControl({
      controlId: 501,
      leaseToken: token,
      nextAttemptAt: claim.nextAttemptAt,
      lastCalculatedAt: now,
      decision: {
        status: 'checked_below_target',
        targetAmount: 500,
        netPaidAmount: 300,
        shortfallAmount: 200,
        lastError: null,
      },
    })).resolves.toBe(true);

    expect(mock.calls.values).toMatchObject({
      status: 'checked_below_target',
      targetAmount: 500,
      netPaidAmount: 300,
      shortfallAmount: 200,
      leaseToken: null,
      leaseExpiresAt: null,
    });
    expect(mock.calls.where).toBeDefined();
  });

  it('moves a failed calculation to retry_pending without retaining the lease', async () => {
    const mock = createDatabase();
    const source = createTuitionProgressReminderExecutionDrizzleSource(mock.database);

    await expect(source.retryControl({
      controlId: 501,
      leaseToken: token,
      now,
      nextAttemptAt: new Date(now.getTime() + 1_000),
      lastError: 'accounting_calculation_failed',
    })).resolves.toBe(true);

    expect(mock.calls.values).toMatchObject({
      status: 'retry_pending',
      leaseToken: null,
      leaseExpiresAt: null,
      lastError: 'accounting_calculation_failed',
    });
  });
});
