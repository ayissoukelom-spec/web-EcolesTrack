import dotenv from 'dotenv';
import { Pool } from 'pg';

dotenv.config();

const pool = new Pool({
  host: process.env.SQL_HOST || '127.0.0.1',
  port: process.env.SQL_PORT ? Number(process.env.SQL_PORT) : 5432,
  user: process.env.SQL_USER,
  password: process.env.SQL_PASSWORD,
  database: process.env.SQL_DB_NAME,
});

(async () => {
  try {
    const client = await pool.connect();
    try {
      const r = await client.query("SELECT id, uid, email, name, role, school_id FROM users WHERE role='super_admin' ORDER BY id");
      console.log(JSON.stringify(r.rows, null, 2));
    } finally {
      client.release();
    }
    await pool.end();
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
})();
