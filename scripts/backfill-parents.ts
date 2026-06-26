import { db } from '../src/db/index.ts';
import { sql } from 'drizzle-orm';

async function run() {
  try {
    console.log('Starting parents backfill migration...');

    // Count before
    const beforeTotal = await db.execute(sql`SELECT count(*)::int AS cnt FROM parents;`);
    const beforeWithClass = await db.execute(sql`SELECT count(*)::int AS cnt FROM parents WHERE class_id IS NOT NULL;`);
    const beforeWithSchool = await db.execute(sql`SELECT count(*)::int AS cnt FROM parents WHERE school_id IS NOT NULL;`);
    console.log('Before: total parents=', beforeTotal?.rows?.[0]?.cnt ?? 'unknown', 'with class=', beforeWithClass?.rows?.[0]?.cnt ?? 'unknown', 'with school=', beforeWithSchool?.rows?.[0]?.cnt ?? 'unknown');

    // 1) Backfill from parents.student_id -> students
    const q1 = await db.execute(sql`
      UPDATE parents p
      SET class_id = s.class_id,
          school_id = s.school_id
      FROM students s
      WHERE p.student_id IS NOT NULL
        AND p.student_id = s.id
        AND (p.class_id IS NULL OR p.school_id IS NULL);
    `);
    console.log('Backfilled from parents.student_id -> students; result:', q1?.rowCount ?? q1);

    // 2) Backfill from students.parent_id -> parents
    const q2 = await db.execute(sql`
      UPDATE parents p
      SET class_id = s.class_id,
          school_id = s.school_id
      FROM students s
      WHERE s.parent_id = p.id
        AND (p.class_id IS NULL OR p.school_id IS NULL);
    `);
    console.log('Backfilled from students.parent_id -> parents; result:', q2?.rowCount ?? q2);

    // 3) Backfill school_id from users.school_id when missing
    const q3 = await db.execute(sql`
      UPDATE parents p
      SET school_id = u.school_id
      FROM users u
      WHERE p.user_id = u.id
        AND p.school_id IS NULL
        AND u.school_id IS NOT NULL;
    `);
    console.log('Backfilled school_id from users; result:', q3?.rowCount ?? q3);

    // Counts after
    const afterWithClass = await db.execute(sql`SELECT count(*)::int AS cnt FROM parents WHERE class_id IS NOT NULL;`);
    const afterWithSchool = await db.execute(sql`SELECT count(*)::int AS cnt FROM parents WHERE school_id IS NOT NULL;`);
    console.log('After: parents with class=', afterWithClass?.rows?.[0]?.cnt ?? 'unknown', 'with school=', afterWithSchool?.rows?.[0]?.cnt ?? 'unknown');

    console.log('Migration completed. Review results and run again if needed.');
    process.exit(0);
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  }
}

run();
