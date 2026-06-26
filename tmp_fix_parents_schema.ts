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

async function main() {
  await client.connect();
  await client.query('ALTER TABLE parents ADD COLUMN IF NOT EXISTS student_id INTEGER');
  await client.query('ALTER TABLE parents ADD COLUMN IF NOT EXISTS profession TEXT');
  console.log('Parents table schema ensured.');
  await client.end();
}

main().catch((err) => {
  console.error(err);
  client.end().catch(() => null);
  process.exit(1);
});
