// Script de correction des anciens parents.
//
// Il remplit les champs manquants `class_id` et `school_id` dans la table `parents`
// à partir des informations déjà présentes sur les élèves (`students`) ou les
// utilisateurs (`users`).
//
// Exécution : npm run fix:parents
import { db } from '../src/db/index.ts';
import { sql } from 'drizzle-orm';

async function run() {
  try {
    console.log('=== Fix ancien parents: démarrage ===');

    const beforeTotal = await db.execute(sql`SELECT count(*)::int AS cnt FROM parents;`);
    const beforeWithClass = await db.execute(sql`SELECT count(*)::int AS cnt FROM parents WHERE class_id IS NOT NULL;`);
    const beforeWithSchool = await db.execute(sql`SELECT count(*)::int AS cnt FROM parents WHERE school_id IS NOT NULL;`);
    console.log('Avant correction:', {
      totalParents: Number(beforeTotal?.rows?.[0]?.cnt ?? 0),
      parentsWithClass: Number(beforeWithClass?.rows?.[0]?.cnt ?? 0),
      parentsWithSchool: Number(beforeWithSchool?.rows?.[0]?.cnt ?? 0),
    });

    const updateFromStudentId = await db.execute(sql`
      UPDATE parents p
      SET class_id = s.class_id,
          school_id = s.school_id
      FROM students s
      WHERE p.student_id IS NOT NULL
        AND p.student_id = s.id
        AND (p.class_id IS NULL OR p.school_id IS NULL);
    `);
    console.log('Correction depuis parents.student_id:', updateFromStudentId?.rowCount ?? updateFromStudentId);

    const updateFromStudentParent = await db.execute(sql`
      UPDATE parents p
      SET class_id = s.class_id,
          school_id = s.school_id
      FROM students s
      WHERE s.parent_id = p.id
        AND (p.class_id IS NULL OR p.school_id IS NULL);
    `);
    console.log('Correction depuis students.parent_id:', updateFromStudentParent?.rowCount ?? updateFromStudentParent);

    const updateSchoolFromUser = await db.execute(sql`
      UPDATE parents p
      SET school_id = u.school_id
      FROM users u
      WHERE p.user_id = u.id
        AND p.school_id IS NULL
        AND u.school_id IS NOT NULL;
    `);
    console.log('Correction school_id depuis users.school_id:', updateSchoolFromUser?.rowCount ?? updateSchoolFromUser);

    const afterWithClass = await db.execute(sql`SELECT count(*)::int AS cnt FROM parents WHERE class_id IS NOT NULL;`);
    const afterWithSchool = await db.execute(sql`SELECT count(*)::int AS cnt FROM parents WHERE school_id IS NOT NULL;`);
    const afterMissingClass = await db.execute(sql`SELECT count(*)::int AS cnt FROM parents WHERE class_id IS NULL;`);
    const afterMissingSchool = await db.execute(sql`SELECT count(*)::int AS cnt FROM parents WHERE school_id IS NULL;`);

    console.log('Après correction:', {
      parentsWithClass: Number(afterWithClass?.rows?.[0]?.cnt ?? 0),
      parentsWithSchool: Number(afterWithSchool?.rows?.[0]?.cnt ?? 0),
      missingClass: Number(afterMissingClass?.rows?.[0]?.cnt ?? 0),
      missingSchool: Number(afterMissingSchool?.rows?.[0]?.cnt ?? 0),
    });

    console.log('=== Fix ancien parents: terminé ===');
    process.exit(0);
  } catch (error) {
    console.error('Échec du script de correction des anciens parents:', error);
    process.exit(1);
  }
}

run();
