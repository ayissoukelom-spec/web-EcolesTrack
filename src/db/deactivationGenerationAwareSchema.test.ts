import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { users } from './schema.ts';

type IsOptional<T, K extends keyof T> = {} extends Pick<T, K> ? true : false;
type Expect<T extends true> = T;
type SelectAllowsNull = Expect<
  null extends typeof users.$inferSelect.deactivationGenerationAware ? true : false
>;
type InsertAllowsNull = Expect<
  null extends typeof users.$inferInsert.deactivationGenerationAware ? true : false
>;
type InsertIsOptional = Expect<
  IsOptional<typeof users.$inferInsert, 'deactivationGenerationAware'>
>;

const typeChecks = {
  selectAllowsNull: true satisfies SelectAllowsNull,
  insertAllowsNull: true satisfies InsertAllowsNull,
  insertIsOptional: true satisfies InsertIsOptional,
};

describe('deactivation generation-aware schema', () => {
  it('declares a nullable BOOLEAN without a database default', () => {
    const column = users.deactivationGenerationAware;

    expect(column.name).toBe('deactivation_generation_aware');
    expect(column.getSQLType()).toBe('boolean');
    expect(column.notNull).toBe(false);
    expect(column.hasDefault).toBe(true);
    expect(column.default).toBeUndefined();
    expect(getTableConfig(users).columns).toContain(column);
    expect(typeChecks).toEqual({
      selectAllowsNull: true,
      insertAllowsNull: true,
      insertIsOptional: true,
    });
  });

  it('defaults newly inserted Drizzle records to FALSE without backfilling history', () => {
    const column = users.deactivationGenerationAware;

    expect(column.defaultFn).toBeTypeOf('function');
    expect(column.defaultFn?.()).toBe(false);
    expect(column.hasDefault).toBe(true);
  });
});
