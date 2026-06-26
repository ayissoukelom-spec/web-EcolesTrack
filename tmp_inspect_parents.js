import pkg from 'pg';
const { Client } = pkg;
const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
const res = await client.query("select column_name,data_type from information_schema.columns where table_name='parents' order by ordinal_position");
console.log(res.rows);
await client.end();
