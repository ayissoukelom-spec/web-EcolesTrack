import { db } from "./src/db";
import { sql } from "drizzle-orm";

const result = await db.execute(
  sql`SELECT * FROM drizzle.__drizzle_migrations ORDER BY created_at;`
);

console.log(result.rows);

process.exit(0);