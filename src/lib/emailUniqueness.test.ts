import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { sql, SQL } from 'drizzle-orm';
import { getTableConfig, PgDialect } from 'drizzle-orm/pg-core';
import { users } from '../db/schema';
import {
  emailTrimCharactersSql,
  isEmailRequiredForRole,
  isUsersEmailUniqueViolation,
  normalizeEmail,
  normalizedEmailConflictCondition,
  normalizedEmailSql,
} from './emailUniqueness';

const emailColumn = sql`"users"."email"`;
const userIdColumn = sql`"users"."id"`;
const dialect = new PgDialect();

describe('global email uniqueness', () => {
  it('normalizes case and peripheral whitespace using JavaScript trim semantics', () => {
    expect(normalizeEmail('  USER@Example.COM  ')).toBe('user@example.com');
    expect(normalizeEmail('\uFEFF\u00A0User@Example.com\u3000')).toBe('user@example.com');
    expect(normalizeEmail('\u2009\t\r\n')).toBeNull();
  });

  it('allows an omitted email only for parent accounts', () => {
    expect(isEmailRequiredForRole('parent')).toBe(false);
    for (const role of ['super_admin', 'school_admin', 'teacher', 'surveillant', 'student']) {
      expect(isEmailRequiredForRole(role)).toBe(true);
    }
  });

  it('recognizes only the normalized email index and legacy email constraint violations', () => {
    expect(isUsersEmailUniqueViolation({ code: '23505', constraint: 'users_email_normalized_unique_idx' })).toBe(true);
    expect(isUsersEmailUniqueViolation({ cause: { code: '23505', constraint: 'users_email_unique' } })).toBe(true);
    expect(isUsersEmailUniqueViolation({ code: 'ERR_DATABASE', cause: { code: '23505', constraint: 'users_email_unique' } })).toBe(true);
    expect(isUsersEmailUniqueViolation({ code: '23505', constraint: 'users_uid_unique' })).toBe(false);
    expect(isUsersEmailUniqueViolation({ code: '23505', constraint: 'other_email_unique' })).toBe(false);
    expect(isUsersEmailUniqueViolation({ code: '23503', constraint: 'users_email_unique' })).toBe(false);
    expect(isUsersEmailUniqueViolation({ code: '23505', detail: 'Key (email) already exists.' })).toBe(false);
  });

  it('does not create a conflict query for null or whitespace-only parent emails', () => {
    expect(normalizedEmailConflictCondition(emailColumn, null)).toBeUndefined();
    expect(normalizedEmailConflictCondition(emailColumn, ' \uFEFF\u00A0 ')).toBeUndefined();
  });

  it('builds a normalized conflict query without school or role scope', () => {
    const condition = normalizedEmailConflictCondition(emailColumn, ' User@Example.com ');
    expect(condition).toBeDefined();
    const query = dialect.sqlToQuery(condition!);

    expect(query.sql).toContain('LOWER(BTRIM("users"."email"');
    expect(query.sql).toContain('chr(9)');
    expect(query.sql).toContain('chr(65279)');
    expect(query.sql).not.toContain('school_id');
    expect(query.params).toEqual(['user@example.com']);
  });

  it('uses the same normalized expression for local matching and the unique index', () => {
    const query = dialect.sqlToQuery(normalizedEmailSql(emailColumn));
    const trimCharacters = dialect.sqlToQuery(emailTrimCharactersSql);

    expect(query.sql).toContain('LOWER(BTRIM("users"."email"');
    expect(query.sql).toContain(trimCharacters.sql);
    expect(query.params).toEqual([]);
  });

  it('declares a partial global unique expression index and parent-only email checks', () => {
    const config = getTableConfig(users);
    const index = config.indexes.find(({ config: indexConfig }) => indexConfig.name === 'users_email_normalized_unique_idx');
    expect(index?.config.unique).toBe(true);
    expect(index?.config.where).toBeDefined();
    expect(config.uniqueConstraints.map(({ name }) => name)).not.toContain('users_email_unique');
    expect(config.checks.map(({ name }) => name)).toEqual(expect.arrayContaining([
      'users_email_required_for_non_parent_check',
      'users_email_not_blank_check',
    ]));

    const expression = index?.config.columns[0];
    expect(expression).toBeInstanceOf(SQL);
    if (expression instanceof SQL) {
      expect(dialect.sqlToQuery(expression).sql).toContain('LOWER(BTRIM("users"."email"');
    }
  });

  it('keeps the offline baseline SQL and snapshot aligned with the email rules', () => {
    type SnapshotTable = {
      indexes: Record<string, { columns: Array<{ expression: string }>; isUnique: boolean; where?: string }>;
      uniqueConstraints: Record<string, unknown>;
      checkConstraints: Record<string, { value: string }>;
    };
    const baselineSql = readFileSync(resolve(process.cwd(), 'drizzle-local-baseline-candidate/0000_baseline.sql'), 'utf8');
    const snapshot = JSON.parse(readFileSync(
      resolve(process.cwd(), 'drizzle-local-baseline-candidate/meta/0000_snapshot.json'),
      'utf8',
    )) as { tables: Record<string, SnapshotTable> };
    const usersTable = snapshot.tables['public.users'];
    const emailIndex = usersTable.indexes.users_email_normalized_unique_idx;

    expect(emailIndex.isUnique).toBe(true);
    expect(emailIndex.columns[0].expression).toContain('LOWER(BTRIM("users"."email"');
    expect(emailIndex.where).toBe('"users"."email" IS NOT NULL');
    expect(usersTable.uniqueConstraints).not.toHaveProperty('users_email_unique');
    expect(usersTable.checkConstraints).toHaveProperty('users_email_required_for_non_parent_check');
    expect(usersTable.checkConstraints).toHaveProperty('users_email_not_blank_check');
    expect(baselineSql).toContain('CREATE UNIQUE INDEX "users_email_normalized_unique_idx"');
    expect(baselineSql).toContain('"users_email_required_for_non_parent_check"');
    expect(baselineSql).toContain('"users_email_not_blank_check"');
    expect(baselineSql).not.toContain('CONSTRAINT "users_email_unique"');
  });

  it('excludes the current account when checking its unchanged email', () => {
    const condition = normalizedEmailConflictCondition(emailColumn, 'USER@example.com', userIdColumn, 42);
    const query = dialect.sqlToQuery(condition!);

    expect(query.sql).toContain('"users"."id" <> $2');
    expect(query.params).toEqual(['user@example.com', 42]);
  });

  it('checks an email globally for users in other schools and roles', () => {
    const condition = normalizedEmailConflictCondition(emailColumn, 'shared@example.com');
    const query = dialect.sqlToQuery(condition!);

    expect(query.sql).not.toContain('"users"."school_id"');
    expect(query.sql).not.toContain('"users"."role"');
    expect(query.params).toEqual(['shared@example.com']);
  });
});
