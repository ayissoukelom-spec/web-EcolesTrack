import path from 'path';
import * as dotenv from 'dotenv';
import { drizzle } from 'drizzle-orm/node-postgres';
import Pool from 'pg';
import * as schema from './schema.ts';

const envPath = path.resolve(process.cwd(), '.env');
dotenv.config({ path: envPath });

const requiredEnvVars = ['SQL_HOST', 'SQL_USER', 'SQL_PASSWORD', 'SQL_DB_NAME'];
for (const key of requiredEnvVars) {
  if (!process.env[key]) {
    throw new Error(`Missing required database environment variable: ${key}. Ensure ${envPath} exists and contains ${key}.`);
  }
}

// Create a new connection pool using the object method
export const createPool = () => {
  console.log('Connecting to Postgres using:', {
    host: process.env.SQL_HOST,
    port: process.env.SQL_PORT ?? 5432,
    database: process.env.SQL_DB_NAME,
    user: process.env.SQL_USER,
  });

  return new Pool.Pool({
    host: process.env.SQL_HOST,
    port: process.env.SQL_PORT ? Number(process.env.SQL_PORT) : 5432,
    user: process.env.SQL_USER,
    password: process.env.SQL_PASSWORD,
    database: process.env.SQL_DB_NAME,
    connectionTimeoutMillis: 15000,
  });
};

const pool = createPool();

// Prevent unhandled pool-level errors from crashing the application
pool.on('error', (err) => {
  console.error('Unexpected error on idle SQL pool client:', err);
});

// Initialize Drizzle with the pool and schema
export const db = drizzle(pool, { schema });
