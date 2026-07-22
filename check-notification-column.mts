import { db } from "./src/db";

const result = await db.execute(`
  SELECT column_name
  FROM information_schema.columns
  WHERE table_name = 'notifications'
`);

console.log(result.rows);

process.exit(0);