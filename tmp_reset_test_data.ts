import { Client } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config();

const client = new Client({
  host: process.env.SQL_HOST ?? '127.0.0.1',
  port: Number(process.env.SQL_PORT ?? 5432),
  user: process.env.SQL_USER ?? 'ecole_admin',
  password: process.env.SQL_PASSWORD ?? 'EcoleTrack2026!',
  database: process.env.SQL_DB_NAME ?? 'ecoletrack',
});

async function main() {
  await client.connect();

  try {
    await client.query('BEGIN');

    const deletedGrades = await client.query('DELETE FROM grades');
    console.log(`Deleted grades: ${deletedGrades.rowCount}`);

    const deletedAbsences = await client.query('DELETE FROM absences');
    console.log(`Deleted absences: ${deletedAbsences.rowCount}`);

    const deletedEvaluations = await client.query('DELETE FROM evaluations');
    console.log(`Deleted evaluations: ${deletedEvaluations.rowCount}`);

    const deletedStudents = await client.query('DELETE FROM students');
    console.log(`Deleted students: ${deletedStudents.rowCount}`);

    const deletedParents = await client.query(
      `DELETE FROM parents p
       WHERE NOT EXISTS (SELECT 1 FROM students s WHERE s.parent_id = p.id OR s.id = p.student_id)`,
    );
    console.log(`Deleted orphan parents: ${deletedParents.rowCount}`);

    const unusedClassIdsRes = await client.query(
      `SELECT c.id
       FROM classes c
       WHERE NOT EXISTS (SELECT 1 FROM students s WHERE s.class_id = c.id)
         AND NOT EXISTS (SELECT 1 FROM evaluations e WHERE e.class_id = c.id)
         AND NOT EXISTS (SELECT 1 FROM absences a WHERE a.class_id = c.id)`,
    );

    const unusedClassIds = unusedClassIdsRes.rows.map((row) => row.id);
    if (unusedClassIds.length > 0) {
      const deletedClassTeachers = await client.query(
        'DELETE FROM class_teachers WHERE class_id = ANY($1)',
        [unusedClassIds],
      );
      console.log(`Deleted class_teachers for unused classes: ${deletedClassTeachers.rowCount}`);

      const deletedClasses = await client.query(
        'DELETE FROM classes WHERE id = ANY($1)',
        [unusedClassIds],
      );
      console.log(`Deleted unused classes: ${deletedClasses.rowCount}`);
    } else {
      console.log('Deleted unused classes: 0');
      console.log('Deleted class_teachers for unused classes: 0');
    }

    await client.query('COMMIT');
    console.log('Test data reset complete. Configuration tables are preserved.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Failed to reset test data:', err);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('Unhandled error:', err);
  process.exit(1);
});
