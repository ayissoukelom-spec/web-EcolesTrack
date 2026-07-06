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
  const client = await pool.connect();
  try {
    const r = await client.query('SELECT id, name, school_id, is_active FROM academic_years ORDER BY id DESC LIMIT 20');
    console.log(JSON.stringify(r.rows, null, 2));
  } finally {
    client.release();
    await pool.end();
  }
})();
