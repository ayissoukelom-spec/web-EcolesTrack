const { Client } = require('pg');

const client = new Client({
  host: '127.0.0.1',
  port: 5432,
  database: 'ecoletrack',
  user: 'ecole_admin',
  password: 'Admin123!',
});

async function fixSchema() {
  try {
    await client.connect();
    console.log('✅ Connected to PostgreSQL');
    
    // Check if enrolled_at column exists
    const checkColumn = await client.query(
      `SELECT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name='students' AND column_name='enrolled_at'
      );`
    );
    
    if (checkColumn.rows[0].exists) {
      console.log('✅ Column enrolled_at already exists');
    } else {
      console.log('❌ Column enrolled_at does NOT exist, creating it...');
      await client.query(
        `ALTER TABLE "students" ADD COLUMN "enrolled_at" timestamp DEFAULT now() NOT NULL;`
      );
      console.log('✅ Column enrolled_at created successfully');
    }
    
    // Verify the column now exists
    const verifyColumn = await client.query(
      `SELECT column_name, data_type FROM information_schema.columns 
       WHERE table_name='students' AND column_name='enrolled_at';`
    );
    
    if (verifyColumn.rows.length > 0) {
      console.log(`✅ Verified: Column '${verifyColumn.rows[0].column_name}' (type: ${verifyColumn.rows[0].data_type}) exists in students table`);
    }
    
  } catch (err) {
    if (err.message.includes('already exists')) {
      console.log('✅ Column already exists (caught existing column error)');
    } else {
      console.error('❌ Error:', err.message);
    }
  } finally {
    await client.end();
  }
}

fixSchema();
