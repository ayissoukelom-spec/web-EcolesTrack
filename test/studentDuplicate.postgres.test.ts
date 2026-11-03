import { randomUUID } from 'node:crypto';
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildStudentDuplicateIdentity, getStudentParentIdentity, isDuplicateStudent } from '../src/lib/studentDuplicate.ts';

const requiredTestDatabase = 'ecoletrack_test';
const hasTestDatabaseConfiguration = process.env.SQL_DB_NAME === requiredTestDatabase
  && Boolean(process.env.SQL_HOST && process.env.SQL_USER && process.env.SQL_PASSWORD);
const postgresDescribe = hasTestDatabaseConfiguration ? describe.sequential : describe.skip;

let schemaName = '';
let pool: Pool;
let database: ReturnType<typeof drizzle>;

const connectionOptions = (options?: string) => ({
  host: process.env.SQL_HOST,
  port: process.env.SQL_PORT ? Number(process.env.SQL_PORT) : 5432,
  user: process.env.SQL_USER,
  password: process.env.SQL_PASSWORD,
  database: requiredTestDatabase,
  ssl: process.env.SQL_USE_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
  connectionTimeoutMillis: 10000,
  max: 4,
  ...(options ? { options } : {}),
});

const baseline = {
  schoolId: 10,
  firstName: 'Mila',
  lastName: 'Diallo',
  birthDate: '2015-04-12',
  gender: 'F',
  parentId: 7,
};

async function attemptStudentCreation(input: typeof baseline & { parentId: number }) {
  return database.transaction(async (tx) => {
    const parent = await getStudentParentIdentity(tx, input.parentId);
    const identity = buildStudentDuplicateIdentity(
      input.schoolId,
      input.firstName,
      input.lastName,
      input.gender,
      input.birthDate,
      parent?.name,
      parent?.gender,
    );
    if (identity && await isDuplicateStudent(tx, identity)) return false;

    await tx.execute(sql`
      INSERT INTO students (school_id, first_name, last_name, birth_date, gender, parent_id)
      VALUES (${input.schoolId}, ${input.firstName}, ${input.lastName}, ${input.birthDate}, ${input.gender}, ${input.parentId})
    `);
    return true;
  });
}

async function createParent(id: number, userId: number, name: string, gender: string) {
  await pool.query('INSERT INTO users (id, name, gender) VALUES ($1, $2, $3)', [userId, name, gender]);
  await pool.query('INSERT INTO parents (id, user_id) VALUES ($1, $2)', [id, userId]);
}

postgresDescribe('student duplicate detection PostgreSQL integration', () => {
  beforeAll(async () => {
    const adminPool = new Pool(connectionOptions());
    const actualDatabase = await adminPool.query('SELECT current_database() AS name');
    if (actualDatabase.rows[0]?.name !== requiredTestDatabase) {
      await adminPool.end();
      throw new Error('Refusing student duplicate tests outside the isolated PostgreSQL test database.');
    }

    schemaName = `student_duplicate_it_${randomUUID().replace(/-/g, '')}`;
    if (!/^student_duplicate_it_[a-f0-9]{32}$/.test(schemaName)) {
      await adminPool.end();
      throw new Error('Invalid temporary student duplicate test schema name.');
    }
    await adminPool.query(`CREATE SCHEMA "${schemaName}"`);
    await adminPool.end();

    pool = new Pool(connectionOptions(`-c search_path=${schemaName}`));
    await pool.query(`
      CREATE TABLE users (
        id integer PRIMARY KEY,
        name text NOT NULL,
        gender text
      );
      CREATE TABLE parents (
        id integer PRIMARY KEY,
        user_id integer NOT NULL REFERENCES users(id)
      );
      CREATE TABLE students (
        id serial PRIMARY KEY,
        school_id integer NOT NULL,
        first_name text NOT NULL,
        last_name text NOT NULL,
        birth_date text,
        gender text,
        parent_id integer REFERENCES parents(id)
      )
    `);
    database = drizzle(pool);
  }, 30000);

  beforeEach(async () => {
    await pool.query('TRUNCATE students, parents, users RESTART IDENTITY CASCADE');
    await createParent(7, 99, 'Ama Diallo', 'F');
    await pool.query(`
      INSERT INTO students (school_id, first_name, last_name, birth_date, gender, parent_id)
      VALUES (10, 'Mila', 'Diallo', '2015-04-12', 'F', 7)
    `);
  });

  afterAll(async () => {
    await pool?.end();
    if (!schemaName) return;

    const adminPool = new Pool(connectionOptions());
    const actualDatabase = await adminPool.query('SELECT current_database() AS name');
    if (actualDatabase.rows[0]?.name === requiredTestDatabase
      && /^student_duplicate_it_[a-f0-9]{32}$/.test(schemaName)) {
      await adminPool.query(`DROP SCHEMA "${schemaName}" CASCADE`);
    }
    await adminPool.end();
  }, 30000);

  it('rejects all five matching identity criteria in the same school', async () => {
    expect(await attemptStudentCreation(baseline)).toBe(false);
    const result = await pool.query('SELECT count(*)::int AS count FROM students');
    expect(result.rows[0].count).toBe(1);
  });

  it.each([
    ['first name', { firstName: 'Mila Grace' }],
    ['last name', { lastName: 'Kouassi' }],
    ['student gender', { gender: 'M' }],
    ['birth date', { birthDate: '2015-04-13' }],
  ])('allows creation when only the %s differs in PostgreSQL', async (_criterion, override) => {
    expect(await attemptStudentCreation({ ...baseline, ...override })).toBe(true);
  });

  it('allows creation when only the parent name differs in PostgreSQL', async () => {
    await createParent(8, 100, 'Afi Diallo', 'F');
    expect(await attemptStudentCreation({ ...baseline, parentId: 8 })).toBe(true);
  });

  it('allows creation when only the parent gender differs in PostgreSQL', async () => {
    await createParent(8, 100, 'Ama Diallo', 'M');
    expect(await attemptStudentCreation({ ...baseline, parentId: 8 })).toBe(true);
  });

  it('allows the identical student identity in another school', async () => {
    expect(await attemptStudentCreation({ ...baseline, schoolId: 20 })).toBe(true);
  });

  it('matches stored names with different casing and repeated whitespace', async () => {
    await pool.query(`
      UPDATE students SET first_name = '  mIlA   ', last_name = '  dIaLlO '
    `);
    await pool.query(`UPDATE users SET name = '  aMa    dIaLlO ' WHERE id = 99`);
    expect(await attemptStudentCreation(baseline)).toBe(false);
  });

  it('serializes two simultaneous identical creations with PostgreSQL transaction locks', async () => {
    await pool.query('TRUNCATE students RESTART IDENTITY CASCADE');

    const results = await Promise.all([
      attemptStudentCreation(baseline),
      attemptStudentCreation(baseline),
    ]);

    expect(results.sort()).toEqual([false, true]);
    const count = await pool.query('SELECT count(*)::int AS count FROM students');
    expect(count.rows[0].count).toBe(1);
  });
});
