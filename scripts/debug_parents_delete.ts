import { db } from '../src/db/index.ts';
import { students, parents } from '../src/db/schema.ts';
import { sql } from 'drizzle-orm';

async function main() {
  try {
    const res = await db.select({ count: sql<number>`count(*)::integer` }).from(students).where(sql`parent_id IS NOT NULL`);
    const count = Number(res[0]?.count ?? 0);
    console.log('Students with parent_id set:', count);

    const sample = await db.select({ id: students.id, parentId: students.parentId }).from(students).where(sql`parent_id IS NOT NULL`).limit(20);
    console.log('Sample students with parent_id:', sample);

    // Check orphaned parent ids
    const parentIdsRows = await db.select({ pid: students.parentId }).from(students).where(sql`parent_id IS NOT NULL`);
    const parentIds = Array.from(new Set(parentIdsRows.map((r:any) => r.pid).filter(Boolean)));
    if (parentIds.length === 0) {
      console.log('No parent ids found in students rows.');
      return;
    }
    const existingParents = await db.select({ id: parents.id }).from(parents).where(sql`${parents.id} IN ${parentIds}`);
    const existingIds = existingParents.map((p:any)=>p.id);
    const missing = parentIds.filter((id:any)=>!existingIds.includes(id));
    console.log('Referenced parent ids count:', parentIds.length);
    console.log('Existing parent ids count:', existingIds.length);
    console.log('Missing referenced parent ids (orphan refs):', missing.slice(0,50));
  } catch (err:any) {
    console.error('Diagnostic error:', err?.message || err);
  } finally {
    process.exit(0);
  }
}

main();
