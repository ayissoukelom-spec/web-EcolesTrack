const { Client } = require('pg');
(async () => {
  const client = new Client({
    host: '127.0.0.1',
    port: 5432,
    database: 'ecoletrack',
    user: 'ecole_admin',
    password: 'EcoleTrack2026!',
  });
  try {
    await client.connect();
    console.log('CONNECTED');

    const tables = await client.query(
      "SELECT table_schema, table_name FROM information_schema.tables WHERE table_name IN ('drizzle_migrations','schema_migrations','migrations','_drizzle_migrations');"
    );
    console.log('MIGRATION TABLES:', JSON.stringify(tables.rows, null, 2));

    for (const row of tables.rows) {
      const res = await client.query(`SELECT * FROM ${row.table_schema}."${row.table_name}" ORDER BY 1 LIMIT 20;`);
      console.log(`TABLE ${row.table_schema}.${row.table_name}:`, JSON.stringify(res.rows, null, 2));
    }

    const colRes = await client.query(
      "SELECT column_name, is_nullable, data_type FROM information_schema.columns WHERE table_name='classes' ORDER BY ordinal_position;"
    );
    console.log('CLASS COLUMNS:', JSON.stringify(colRes.rows, null, 2));
  } catch (err) {
    console.error('ERROR', err);
  } finally {
    await client.end();
  }
})();
