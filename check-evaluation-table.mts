import { db } from "./src/db";
import { sql } from "drizzle-orm";

const result = await db.execute(
  sql`SELECT table_name FROM information_schema.tables WHERE table_name = 'evaluation_participations';`
);

console.log(result.rows);

process.exit(0);