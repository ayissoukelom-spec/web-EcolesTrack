const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const client = new Client({
  host: '127.0.0.1',
  port: 5432,
  database: 'ecoletrack',
  user: 'ecole_admin',
  password: 'Admin123!',
});

async function runMigration() {
  try {
    await client.connect();
    console.log('Connected to PostgreSQL');
    
    // Read migration file
    const migrationPath = path.join(__dirname, 'drizzle', '0002_add_enrolled_at_column.sql');
    const sql = fs.readFileSync(migrationPath, 'utf8');
    
    console.log('Executing migration...');
    await client.query(sql);
    console.log('✅ Migration executed successfully');
    
  } catch (err) {
    console.error('❌ Migration failed:', err.message);
  } finally {
    await client.end();
  }
}

runMigration();
