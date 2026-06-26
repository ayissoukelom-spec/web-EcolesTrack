import { Pool } from 'pg';
import * as fs from 'fs';
import * as path from 'path';

const pool = new Pool({
  host: process.env.SQL_HOST || '127.0.0.1',
  port: parseInt(process.env.SQL_PORT || '5432'),
  database: process.env.SQL_DB_NAME || 'ecoletrack',
  user: process.env.SQL_USER || 'ecole_admin',
  password: process.env.SQL_PASSWORD || '',
});

async function runMigration() {
  try {
    console.log('Connecting to database...');
    const client = await pool.connect();
    
    console.log('Reading migration script...');
    const migrationSql = fs.readFileSync(path.join(process.cwd(), 'scripts', 'migrate_class_teachers.sql'), 'utf-8');
    
    console.log('Executing migration...');
    await client.query(migrationSql);
    
    console.log('✓ Migration completed successfully');
    
    // Verify the results
    const result = await client.query('SELECT COUNT(*) as count FROM class_teachers');
    console.log(`✓ Total rows in class_teachers: ${result.rows[0].count}`);
    
    client.release();
    process.exit(0);
  } catch (error: any) {
    console.error('✗ Migration failed:', error.message);
    process.exit(1);
  }
}

runMigration();
