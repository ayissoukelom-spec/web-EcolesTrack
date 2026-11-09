import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { userSchools } from './schema.ts';

type IsOptional<T, K extends keyof T> = {} extends Pick<T, K> ? true : false;
type Expect<T extends true> = T;
type SelectAllowsNull = Expect<null extends typeof userSchools.$inferSelect.isActive ? true : false>;
type InsertAllowsNull = Expect<null extends typeof userSchools.$inferInsert.isActive ? true : false>;
type InsertIsOptional = Expect<IsOptional<typeof userSchools.$inferInsert, 'isActive'>>;

function getIndexColumnName(column: unknown): string | undefined {
  if (
    typeof column !== 'object'
    || column === null
    || !('name' in column)
    || typeof column.name !== 'string'
  ) {
    return undefined;
  }
  return column.name;
}

describe('user schools compatibility schema', () => {
  it('keeps the membership id as primary key and scopes uniqueness to the local role', () => {
    const config = getTableConfig(userSchools);
    const membershipId = config.columns.find((column) => column.name === 'id');

    expect(membershipId?.primary).toBe(true);
    expect(config.indexes).toHaveLength(1);
    expect(config.indexes[0].config.name).toBe('user_schools_user_id_school_id_role_idx');
    expect(config.indexes[0].config.columns.map(getIndexColumnName)).toEqual([
      'user_id',
      'school_id',
      'role',
    ]);
  });

  it('keeps the legacy selection flag nullable and defaulted only for new inserts', () => {
    const column = userSchools.isActive;

    expect(column.name).toBe('is_active');
    expect(column.getSQLType()).toBe('boolean');
    expect(column.notNull).toBe(false);
    expect(column.hasDefault).toBe(true);
    expect(column.default).toBe(true);
    expect(getTableConfig(userSchools).columns).toContain(column);
    expect({
      selectAllowsNull: true satisfies SelectAllowsNull,
      insertAllowsNull: true satisfies InsertAllowsNull,
      insertIsOptional: true satisfies InsertIsOptional,
    }).toEqual({
      selectAllowsNull: true,
      insertAllowsNull: true,
      insertIsOptional: true,
    });
  });
});
