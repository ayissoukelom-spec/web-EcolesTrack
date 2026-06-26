import { Client } from 'pg';
import * as dotenv from 'dotenv';
dotenv.config();

const client = new Client({
  host: process.env.SQL_HOST,
  port: process.env.SQL_PORT ? Number(process.env.SQL_PORT) : 5432,
  user: process.env.SQL_USER,
  password: process.env.SQL_PASSWORD,
  database: process.env.SQL_DB_NAME,
});

async function run() {
  await client.connect();
  const tables = ['parents', 'teachers', 'schools', 'users', 'classes', 'academic_years'];
  for (const table of tables) {
    const res = await client.query(`SELECT column_name, data_type FROM information_schema.columns WHERE table_name = $1 ORDER BY ordinal_position`, [table]);
    console.log(`\nTABLE ${table}`);
    console.table(res.rows);
  }
  await client.end();
}

run().catch((err) => {
  console.error(err);
  client.end().catch(() => null);
  process.exit(1);
});