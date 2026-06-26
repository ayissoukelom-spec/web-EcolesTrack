import dotenv from "dotenv";
dotenv.config();
import { createPool } from "./src/db/index.ts";
const pool = createPool();
(async () => {
  const client = await pool.connect();
  try {
    const res = await client.query("SELECT current_database() AS db, current_schema() AS schema, session_user AS user; SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename;");
    console.log(JSON.stringify(res));
  } finally {
    client.release();
    await pool.end();
  }
})();
