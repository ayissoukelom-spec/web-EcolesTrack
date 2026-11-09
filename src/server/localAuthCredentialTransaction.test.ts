import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import { localAuths, users } from '../db/schema.ts';
import type { AccessSessionTransaction } from './accessSessionRepository.ts';
import { updateLocalAuthCredentials } from './localAuthCredentialTransaction.ts';

const oldValues = {
  passwordHash: 'old-hash',
  salt: 'old-salt',
  mustReset: true,
};
const newValues = {
  passwordHash: 'new-hash',
  salt: 'new-salt',
  mustReset: false,
};

function createTransaction(options: {
  readonly userRows?: Array<Array<{ id: number }>>;
  readonly authRows?: Array<Array<{ userId: number }>>;
  readonly updatedRows?: Array<Array<{ userId: number }>>;
  readonly updateError?: Error;
} = {}) {
  const userRows = [...(options.userRows ?? [[{ id: 12 }]])];
  const authRows = [...(options.authRows ?? [[{ userId: 12 }]])];
  const updatedRows = [...(options.updatedRows ?? [[{ userId: 12 }]])];

  const userSelectLimit = vi.fn(async () => userRows.shift() ?? []);
  const userSelectWhere = vi.fn(() => ({ for: userSelectFor }));
  const userSelectFor = vi.fn(() => ({ limit: userSelectLimit }));
  const authSelectLimit = vi.fn(async () => authRows.shift() ?? []);
  const authSelectWhere = vi.fn(() => ({ limit: authSelectLimit }));
  const from = vi.fn((table: unknown) => table === users
    ? { where: userSelectWhere }
    : { where: authSelectWhere });
  const select = vi.fn(() => ({ from }));

  const updateReturning = vi.fn(async () => {
    if (options.updateError) throw options.updateError;
    return updatedRows.shift() ?? [];
  });
  const updateWhere = vi.fn((_condition: SQL<unknown>) => ({ returning: updateReturning }));
  const updateSet = vi.fn(() => ({ where: updateWhere }));
  const update = vi.fn(() => ({ set: updateSet }));
  const transaction = { select, update } as unknown as AccessSessionTransaction;

  return {
    transaction,
    select,
    from,
    userSelectWhere,
    userSelectFor,
    userSelectLimit,
    authSelectWhere,
    authSelectLimit,
    update,
    updateSet,
    updateWhere,
    updateReturning,
  };
}

describe('updateLocalAuthCredentials', () => {
  it('updates the exact user row within the supplied transaction', async () => {
    const mock = createTransaction();

    await expect(updateLocalAuthCredentials(mock.transaction, {
      userId: 12,
      values: newValues,
      expected: oldValues,
    })).resolves.toBeUndefined();

    expect(mock.select).toHaveBeenCalledTimes(1);
    expect(mock.userSelectFor).toHaveBeenCalledWith('update');
    expect(mock.update).toHaveBeenCalledWith(localAuths);
    expect(mock.updateSet).toHaveBeenCalledWith(newValues);
    const condition = mock.updateWhere.mock.calls[0]?.[0];
    expect(condition).toBeDefined();
    expect(new PgDialect().sqlToQuery(condition).sql)
      .toContain('"local_auths"."user_id" = $1');
    expect(mock.updateReturning).toHaveBeenCalledWith({ userId: localAuths.userId });
    expect(mock.from).toHaveBeenCalledWith(users);
  });

  it('fails when the user row is absent', async () => {
    const mock = createTransaction({ userRows: [[]] });

    await expect(updateLocalAuthCredentials(mock.transaction, {
      userId: 12,
      values: newValues,
    })).rejects.toMatchObject({ code: 'user_not_found' });
    expect(mock.update).not.toHaveBeenCalled();
  });

  it('fails when the local authentication row is absent', async () => {
    const mock = createTransaction({ updatedRows: [[]], authRows: [[]] });

    await expect(updateLocalAuthCredentials(mock.transaction, {
      userId: 12,
      values: newValues,
    })).rejects.toMatchObject({ code: 'local_auth_not_found' });
  });

  it('reports changed old credentials as a concurrent modification', async () => {
    const mock = createTransaction({ updatedRows: [[]] });

    await expect(updateLocalAuthCredentials(mock.transaction, {
      userId: 12,
      values: newValues,
      expected: oldValues,
    })).rejects.toMatchObject({ code: 'concurrent_change' });

    const condition = mock.updateWhere.mock.calls[0]?.[0];
    const { sql } = new PgDialect().sqlToQuery(condition);
    expect(sql).toContain('"local_auths"."password_hash" = $2');
    expect(sql).toContain('"local_auths"."salt" = $3');
    expect(sql).toContain('"local_auths"."must_reset" = $4');
  });

  it('fails explicitly when the update returns no rows despite the auth row still existing', async () => {
    const mock = createTransaction({ updatedRows: [[]] });

    await expect(updateLocalAuthCredentials(mock.transaction, {
      userId: 12,
      values: newValues,
    })).rejects.toMatchObject({ code: 'unexpected_row_count' });
  });

  it('rejects unexpected multiple-row updates', async () => {
    const mock = createTransaction({ updatedRows: [[{ userId: 12 }, { userId: 12 }]] });

    await expect(updateLocalAuthCredentials(mock.transaction, {
      userId: 12,
      values: newValues,
    })).rejects.toMatchObject({ code: 'unexpected_row_count' });
  });

  it('propagates database failures without exposing credential values', async () => {
    const databaseError = new Error('transaction update failed');
    const mock = createTransaction({ updateError: databaseError });

    await expect(updateLocalAuthCredentials(mock.transaction, {
      userId: 12,
      values: newValues,
      expected: oldValues,
    })).rejects.toBe(databaseError);
    expect(databaseError.message).not.toContain(oldValues.passwordHash);
    expect(databaseError.message).not.toContain(oldValues.salt);
  });
});
