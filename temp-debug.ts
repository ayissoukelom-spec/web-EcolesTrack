import { eq, sql } from "drizzle-orm";
import { users } from "./src/db/schema.ts";
const q = eq(sql`LOWER(${users.email})`, "x");
const top = q as any;
const nested = top.queryChunks?.[1];
console.log('TOP CHUNKS LENGTH', top.queryChunks.length);
for (let i=0;i<top.queryChunks.length;i++) {
  const c = top.queryChunks[i];
  console.log('TOP', i, c?.constructor?.name, c && typeof c === 'object' ? Object.keys(c) : c);
}
console.log('--- NESTED ---');
for (let i=0;i<nested.queryChunks.length;i++) {
  const c = nested.queryChunks[i];
  console.log('NESTED', i, c?.constructor?.name, c && typeof c === 'object' ? Object.keys(c) : c, c?.name, c?.text, c?.value);
}
