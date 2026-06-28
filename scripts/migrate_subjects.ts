import { db } from '../src/db/index.ts';
import { sql } from 'drizzle-orm';

async function migrate() {
  try {
    console.log('Creating subjects table...');
    await db.execute(sql.raw(`
      CREATE TABLE IF NOT EXISTS subjects (
        id SERIAL PRIMARY KEY,
        school_id INTEGER NOT NULL REFERENCES schools(id),
        name TEXT NOT NULL,
        code TEXT,
        created_at TIMESTAMP DEFAULT now(),
        updated_at TIMESTAMP DEFAULT now()
      );
    `));
    console.log('✓ Subjects table created successfully');
  } catch (err: any) {
    console.error('✗ Error creating subjects table:', err.message);
    process.exit(1);
  }
}

migrate();
