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
    const email = 'jes@gmail.com';
    const client = await pool.connect();
    try {
      const u = await client.query('SELECT id, uid, email, name, role, school_id FROM users WHERE LOWER(email)=LOWER($1)', [email]);
      console.log('USERS:', JSON.stringify(u.rows, null, 2));
      if (u.rows.length > 0) {
        const userId = u.rows[0].id;
        const p = await client.query('SELECT * FROM parents WHERE user_id=$1', [userId]);
        console.log('PARENTS:', JSON.stringify(p.rows, null, 2));
      }
    } finally {
      client.release();
    }
    await pool.end();
  } catch (e) {
    console.error('ERROR', e);
    process.exit(1);
  }
})();
