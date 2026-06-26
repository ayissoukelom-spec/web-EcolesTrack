import { createPool } from './src/db/index.ts';

(async () => {
  const pool = createPool();
  try {
    const client = await pool.connect();
    const sql = `CREATE TABLE IF NOT EXISTS local_auths (
      id serial PRIMARY KEY,
      user_id integer REFERENCES users(id),
      password_hash text NOT NULL,
      salt text NOT NULL,
      created_at timestamp DEFAULT now(),
      UNIQUE (user_id)
    );`;
    await client.query(sql);
    console.log('local_auths table ensured');
    client.release();
    process.exit(0);
  } catch (e) {
    console.error('Failed to create table', e);
    process.exit(1);
  }
})();
