import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Pool, type PoolClient } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const migrationSql = readFileSync(
  path.resolve(process.cwd(), 'drizzle/0011_users_phone_required_unique.sql'),
  'utf8',
);

describe('users phone constraints migration (PostgreSQL)', () => {
  let pool: Pool;
  let client: PoolClient;

  beforeAll(async () => {
    if (process.env.SQL_DB_NAME !== 'ecoletrack_test') {
      throw new Error('Phone migration integration tests require ecoletrack_test.');
    }
    if (!process.env.SQL_HOST || !process.env.SQL_USER || !process.env.SQL_PASSWORD) {
      throw new Error('Phone migration integration tests require PostgreSQL test credentials.');
    }

    pool = new Pool({
      host: process.env.SQL_HOST,
      port: process.env.SQL_PORT ? Number(process.env.SQL_PORT) : 5432,
      user: process.env.SQL_USER,
      password: process.env.SQL_PASSWORD,
      database: process.env.SQL_DB_NAME,
      ssl: process.env.SQL_USE_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
      connectionTimeoutMillis: 10000,
      max: 1,
    });
    client = await pool.connect();
    await client.query('BEGIN');
  });

  beforeEach(async () => {
    await client.query('DROP TABLE IF EXISTS pg_temp.users');
    await client.query('CREATE TEMP TABLE users (id integer PRIMARY KEY, phone text)');
  });

  afterAll(async () => {
    if (client) {
      await client.query('ROLLBACK');
      client.release();
    }
    await pool?.end();
  });

  const runMigrationExpectingFailure = async () => {
    await client.query('SAVEPOINT migration_attempt');
    let migrationError: Error | undefined;
    try {
      await client.query(migrationSql);
    } catch (error) {
      migrationError = error as Error;
    }
    await client.query('ROLLBACK TO SAVEPOINT migration_attempt');
    await client.query('RELEASE SAVEPOINT migration_attempt');
    return migrationError;
  };

  const expectRejectedWrite = async (statement: string) => {
    await client.query('SAVEPOINT rejected_write');
    let writeError: (Error & { code?: string }) | undefined;
    try {
      await client.query(statement);
    } catch (error) {
      writeError = error as Error & { code?: string };
    }
    await client.query('ROLLBACK TO SAVEPOINT rejected_write');
    await client.query('RELEASE SAVEPOINT rejected_write');
    expect(writeError?.code).toBe('23505');
  };

  it('refuses NULL phones without changing existing rows or applying constraints', async () => {
    await client.query(
      `INSERT INTO users (id, phone) VALUES (1, NULL), (2, '+22890000000')`,
    );

    const error = await runMigrationExpectingFailure();

    expect(error?.message).toContain('1 NULL');
    const rows = await client.query('SELECT id, phone FROM users ORDER BY id');
    expect(rows.rows).toEqual([
      { id: 1, phone: null },
      { id: 2, phone: '+22890000000' },
    ]);
    const constraints = await client.query(
      `SELECT COUNT(*)::int AS count
       FROM pg_constraint
       WHERE conrelid = 'pg_temp.users'::regclass
         AND conname IN ('users_phone_canonical_check', 'users_phone_unique')`,
    );
    expect(constraints.rows[0].count).toBe(0);
  });

  it('refuses duplicate phones without deleting or changing either account', async () => {
    await client.query(
      `INSERT INTO users (id, phone) VALUES (1, '+22890000000'), (2, '+22890000000')`,
    );

    const error = await runMigrationExpectingFailure();

    expect(error?.message).toContain('1 duplicate canonical groups');
    const rows = await client.query('SELECT id, phone FROM users ORDER BY id');
    expect(rows.rows).toEqual([
      { id: 1, phone: '+22890000000' },
      { id: 2, phone: '+22890000000' },
    ]);
  });

  it('detects different accepted representations of the same canonical number', async () => {
    await client.query(
      `INSERT INTO users (id, phone) VALUES (1, '+228 90 00 00 00'), (2, '+22890000000')`,
    );

    const error = await runMigrationExpectingFailure();

    expect(error?.message).toContain('1 non-canonical');
    expect(error?.message).toContain('1 duplicate canonical groups');
    const rows = await client.query('SELECT id, phone FROM users ORDER BY id');
    expect(rows.rowCount).toBe(2);
    expect(rows.rows[0].phone).toBe('+228 90 00 00 00');
    expect(rows.rows[1].phone).toBe('+22890000000');
  });

  it('applies constraints to valid data and rejects duplicate inserts and updates', async () => {
    await client.query(
      `INSERT INTO users (id, phone) VALUES (1, '+22890000000'), (2, '+14155552671')`,
    );

    await client.query(migrationSql);

    const rows = await client.query('SELECT id, phone FROM users ORDER BY id');
    expect(rows.rows).toEqual([
      { id: 1, phone: '+22890000000' },
      { id: 2, phone: '+14155552671' },
    ]);
    const notNull = await client.query(
      `SELECT attnotnull FROM pg_attribute WHERE attrelid = 'pg_temp.users'::regclass AND attname = 'phone'`,
    );
    expect(notNull.rows[0].attnotnull).toBe(true);

    await expectRejectedWrite(
      `INSERT INTO users (id, phone) VALUES (3, '+22890000000')`,
    );
    await expectRejectedWrite(
      `UPDATE users SET phone = '+22890000000' WHERE id = 2`,
    );

    const preserved = await client.query('SELECT id, phone FROM users ORDER BY id');
    expect(preserved.rows).toEqual([
      { id: 1, phone: '+22890000000' },
      { id: 2, phone: '+14155552671' },
    ]);
  });

  it('refuses blank and malformed phone values without changing them', async () => {
    await client.query(
      `INSERT INTO users (id, phone) VALUES (1, ''), (2, '90 00 00 00')`,
    );

    const error = await runMigrationExpectingFailure();

    expect(error?.message).toContain('1 blank');
    expect(error?.message).toContain('1 non-canonical');
    const rows = await client.query('SELECT id, phone FROM users ORDER BY id');
    expect(rows.rows).toEqual([
      { id: 1, phone: '' },
      { id: 2, phone: '90 00 00 00' },
    ]);
  });
});
