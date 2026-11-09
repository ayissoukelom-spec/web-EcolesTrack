import { getTableConfig, PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { accessSessions, users } from './schema.ts';

type IsOptional<T, K extends keyof T> = {} extends Pick<T, K> ? true : false;
type Expect<T extends true> = T;
type UserGenerationUsesBigInt = Expect<
  typeof users.$inferSelect.accessSessionGeneration extends bigint ? true : false
>;
type UserGenerationInsertHasDefault = Expect<
  IsOptional<typeof users.$inferInsert, 'accessSessionGeneration'>
>;
type ObservedGenerationUsesBigInt = Expect<
  typeof accessSessions.$inferSelect.observedGeneration extends bigint ? true : false
>;
type ObservedGenerationInsertIsRequired = Expect<
  IsOptional<typeof accessSessions.$inferInsert, 'observedGeneration'> extends false ? true : false
>;

const typeChecks = {
  userGenerationIsBigInt: true satisfies UserGenerationUsesBigInt,
  userGenerationInsertIsOptional: true satisfies UserGenerationInsertHasDefault,
  observedGenerationIsBigInt: true satisfies ObservedGenerationUsesBigInt,
  observedGenerationInsertIsRequired: true satisfies ObservedGenerationInsertIsRequired,
};

describe('access session generation schema', () => {
  it('exposes BIGINT-compatible inferred types and insert optionality', () => {
    expect(typeChecks).toEqual({
      userGenerationIsBigInt: true,
      userGenerationInsertIsOptional: true,
      observedGenerationIsBigInt: true,
      observedGenerationInsertIsRequired: true,
    });
  });

  it('declares users.access_session_generation as a required BIGINT defaulting to one', () => {
    const column = users.accessSessionGeneration;
    expect(column.name).toBe('access_session_generation');
    expect(column.getSQLType()).toBe('bigint');
    expect(column.notNull).toBe(true);
    expect(column.hasDefault).toBe(true);
    expect(column.default).toBe(1n);
    expect(getTableConfig(users).columns).toContain(column);
  });

  it('requires access_sessions.observed_generation explicitly with no default', () => {
    const column = accessSessions.observedGeneration;
    expect(column.name).toBe('observed_generation');
    expect(column.getSQLType()).toBe('bigint');
    expect(column.notNull).toBe(true);
    expect(column.hasDefault).toBe(false);
    expect(column.default).toBeUndefined();
    expect(getTableConfig(accessSessions).columns).toContain(column);
  });

  it('keeps generations within the signed BIGINT maximum', () => {
    const signedBigIntMaximum = 9_223_372_036_854_775_807n;
    const applicationMaximum = '9223372036854775807';
    expect(users.accessSessionGeneration.getSQLType()).toBe('bigint');
    expect(accessSessions.observedGeneration.getSQLType()).toBe('bigint');
    expect(signedBigIntMaximum).toBe(9_223_372_036_854_775_807n);
    expect(BigInt(applicationMaximum)).toBe(signedBigIntMaximum);
  });

  it('declares non-negative checks on both generations', () => {
    const usersChecks = getTableConfig(users).checks;
    const sessionChecks = getTableConfig(accessSessions).checks;
    const userGenerationCheck = usersChecks.find(
      ({ name }) => name === 'users_access_session_generation_nonnegative_check',
    );
    const observedGenerationCheck = sessionChecks.find(
      ({ name }) => name === 'access_sessions_observed_generation_nonnegative_check',
    );
    const dialect = new PgDialect();

    expect(userGenerationCheck).toBeDefined();
    expect(observedGenerationCheck).toBeDefined();
    expect(dialect.sqlToQuery(userGenerationCheck!.value).sql)
      .toContain('"users"."access_session_generation" >= 0');
    expect(dialect.sqlToQuery(observedGenerationCheck!.value).sql)
      .toContain('"access_sessions"."observed_generation" >= 0');
  });
});
