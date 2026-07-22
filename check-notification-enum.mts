import { db } from "./src/db";
import { sql } from "drizzle-orm";

const result = await db.execute(
  sql`SELECT typname FROM pg_type WHERE typname = 'notification_category_enum';`
);

console.log(result.rows);

process.exit(0);