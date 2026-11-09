import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';

const { execute } = vi.hoisted(() => ({
  execute: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./index.ts', () => ({
  db: { execute },
}));

import { ensureUserSchoolsTableExists } from './helpers.ts';

describe('ensureUserSchoolsTableExists', () => {
  beforeEach(() => {
    execute.mockClear();
  });

  it('creates only the role-scoped unique index and leaves existing indexes untouched', async () => {
    await ensureUserSchoolsTableExists();

    const statements = execute.mock.calls.map(([statement]) => new PgDialect().sqlToQuery(statement).sql);
    const createTableStatement = statements.find((statement) => /CREATE TABLE IF NOT EXISTS user_schools/i.test(statement));
    const indexStatements = statements.filter((statement) => /CREATE UNIQUE INDEX/i.test(statement));

    expect(createTableStatement).toBeDefined();
    expect(indexStatements).toHaveLength(1);
    expect(indexStatements[0]).toMatch(/user_schools_user_id_school_id_role_idx\s+ON\s+user_schools\s*\(user_id,\s*school_id,\s*role\)/i);
    expect(indexStatements[0]).not.toMatch(/user_schools_user_id_school_id_idx/i);
    expect(statements.some((statement) => /DROP\s+INDEX/i.test(statement))).toBe(false);
  });
});
