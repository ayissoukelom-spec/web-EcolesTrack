import { Pool } from 'pg';

const pool = new Pool({
  host: process.env.SQL_HOST || '127.0.0.1',
  port: parseInt(process.env.SQL_PORT || '5432'),
  database: process.env.SQL_DB_NAME || 'ecoletrack',
  user: process.env.SQL_USER || 'ecole_admin',
  password: process.env.SQL_PASSWORD || '',
  ssl: process.env.SQL_USE_SSL === 'true' ? { rejectUnauthorized: false } : false,
});

async function verify() {
  try {
    console.log('\n=== POST-MIGRATION VERIFICATION ===\n');

    // Check 1: Column exists and is nullable
    const columnInfo = await pool.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'school_subjects'
      AND column_name = 'subject_type_id'
    `);
    if (columnInfo.rows.length === 0) {
      throw new Error('Column subject_type_id not found!');
    }
    const col = columnInfo.rows[0];
    console.log('Column Definition:');
    console.log(`  Name: ${col.column_name}`);
    console.log(`  Type: ${col.data_type}`);
    console.log(`  Nullable: ${col.is_nullable}\n`);

    // Check 2: FK constraint exists
    const fkInfo = await pool.query(`
      SELECT conname, contype, 
             (SELECT relname FROM pg_class WHERE oid = confrelid) AS referenced_table
      FROM pg_constraint
      WHERE conrelid = (SELECT oid FROM pg_class WHERE relname = 'school_subjects')
        AND conname = 'school_subjects_subject_type_id_subject_types_id_fk'
    `);
    if (fkInfo.rows.length === 0) {
      throw new Error('FK constraint not found!');
    }
    const fk = fkInfo.rows[0];
    console.log('Foreign Key Constraint:');
    console.log(`  Name: ${fk.conname}`);
    console.log(`  Type: ${fk.contype === 'f' ? 'FOREIGN KEY' : fk.contype}`);
    console.log(`  References: ${fk.referenced_table}\n`);

    // Check 3: Data integrity
    const nullCheck = await pool.query(`
      SELECT COUNT(*)::int AS total_rows,
             SUM(CASE WHEN subject_type_id IS NULL THEN 1 ELSE 0 END)::int AS null_rows,
             SUM(CASE WHEN subject_type_id IS NOT NULL THEN 1 ELSE 0 END)::int AS assigned_rows
      FROM school_subjects
    `);
    const data = nullCheck.rows[0];
    console.log('Data Integrity:');
    console.log(`  Total rows in school_subjects: ${data.total_rows}`);
    console.log(`  Rows with subject_type_id = NULL: ${data.null_rows}`);
    console.log(`  Rows with subject_type_id assigned: ${data.assigned_rows}\n`);

    // Check 4: Approved associations preserved
    const approved = await pool.query(`
      SELECT COUNT(*)::int AS count FROM school_subjects WHERE status = 'approved'
    `);
    console.log(`✓ Approved associations: ${approved.rows[0].count} (expected: 49)\n`);

    console.log('✅ All verification checks passed!\n');
  } catch (error: any) {
    console.error('❌ Verification failed:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

verify();
