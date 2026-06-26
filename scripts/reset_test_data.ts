import { Client } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config();

const client = new Client({
  host: process.env.SQL_HOST ?? '127.0.0.1',
  port: Number(process.env.SQL_PORT ?? 5432),
  user: process.env.SQL_USER ?? 'ecole_admin',
  password: process.env.SQL_PASSWORD ?? 'EcoleTrack2026!',
  database: process.env.SQL_DB_NAME ?? 'ecoletrack',
});

async function main() {
  await client.connect();

  try {
    await client.query('BEGIN');

    await client.query('DELETE FROM grades');
    await client.query('DELETE FROM absences');
    await client.query('DELETE FROM notifications');
    await client.query('DELETE FROM audit_events');
    await client.query('DELETE FROM class_teachers');
    await client.query('DELETE FROM evaluations');

    await client.query('DELETE FROM students');
    await client.query('DELETE FROM parents');
    await client.query('DELETE FROM classes');

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Failed to reset test data:', error);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error('Unhandled error:', error);
  process.exit(1);
});
