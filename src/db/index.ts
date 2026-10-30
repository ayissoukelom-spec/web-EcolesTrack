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

export const NOTIFICATION_RECIPIENT_LOCK_NAMESPACE = 1_163_284_052;

export async function withNotificationRecipientAccountLock<T>(
  userId: number,
  action: (lockedDb: Omit<typeof db, "$client">) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  let lockAcquired = false;
  let releaseError: Error | undefined;

  try {
    await client.query("SET lock_timeout = '15s'");
    try {
      await client.query("SELECT pg_advisory_lock($1, $2)", [
        NOTIFICATION_RECIPIENT_LOCK_NAMESPACE,
        userId,
      ]);
      lockAcquired = true;
    } finally {
      try {
        await client.query("RESET lock_timeout");
      } catch (resetError) {
        releaseError = resetError instanceof Error
          ? resetError
          : new Error("Failed to reset PostgreSQL lock timeout.");
        throw resetError;
      }
    }

    return await action(drizzle(client, { schema }));
  } finally {
    try {
      if (lockAcquired) {
        const { rows } = await client.query(
          "SELECT pg_advisory_unlock($1, $2) AS unlocked",
          [NOTIFICATION_RECIPIENT_LOCK_NAMESPACE, userId],
        );
        if (rows[0]?.unlocked !== true) {
          throw new Error("Notification recipient advisory lock was not held at release.");
        }
      }
    } catch (unlockError) {
      releaseError = unlockError instanceof Error
        ? unlockError
        : new Error("Failed to release notification recipient advisory lock.");
      throw unlockError;
    } finally {
      client.release(releaseError);
    }
  }
}
