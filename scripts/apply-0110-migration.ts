import { Pool } from 'pg';
import * as fs from 'fs';
import * as path from 'path';

interface MigrationContext {
  dryRun: boolean;
  verbose: boolean;
}

async function checkPrerequisites(pool: Pool): Promise<void> {
  console.log('\n=== PRE-FLIGHT CHECKS ===\n');

  // Check 1: subject_types table exists
  const subjectTypesCheck = await pool.query(`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'subject_types'
    ) AS exists
  `);
  if (!subjectTypesCheck.rows[0].exists) {
    throw new Error('FATAL: subject_types table does not exist');
  }
  console.log('✓ subject_types table exists');

  // Check 2: school_subjects table exists
  const schoolSubjectsCheck = await pool.query(`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'school_subjects'
    ) AS exists
  `);
  if (!schoolSubjectsCheck.rows[0].exists) {
    throw new Error('FATAL: school_subjects table does not exist');
  }
  console.log('✓ school_subjects table exists');

  // Check 3: Column does NOT already exist
  const columnCheck = await pool.query(`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' 
        AND table_name = 'school_subjects'
        AND column_name = 'subject_type_id'
    ) AS exists
  `);
  if (columnCheck.rows[0].exists) {
    console.log('⚠ Column subject_type_id already exists - migration is idempotent, skipping');
    return;
  }
  console.log('✓ Column subject_type_id does NOT yet exist (ready to add)');

  // Check 4: Baseline approved associations
  const approvedCount = await pool.query(`
    SELECT COUNT(*)::int AS count FROM school_subjects WHERE status = 'approved'
  `);
  const count = approvedCount.rows[0].count;
  console.log(`✓ Baseline: ${count} associations with status='approved'`);
  if (count !== 49) {
    console.warn(`⚠ WARNING: Expected 49 approved associations, found ${count}. Proceeding anyway.`);
  }

  // Check 5: FK from school_subjects to subject_types will not conflict
  const fkCheck = await pool.query(`
    SELECT conname AS constraint_name FROM pg_constraint
    WHERE conrelid = (SELECT oid FROM pg_class WHERE relname = 'school_subjects')
      AND conname LIKE '%subject_type_id%'
  `);
  if (fkCheck.rows.length > 0) {
    throw new Error(`FATAL: FK constraint already exists: ${fkCheck.rows[0].constraint_name}`);
  }
  console.log('✓ No conflicting subject_type_id FK constraint exists');

  console.log('\n✅ All pre-flight checks passed\n');
}

async function applyMigration(pool: Pool, ctx: MigrationContext): Promise<void> {
  console.log('\n=== MIGRATION EXECUTION ===\n');

  const migrationFile = path.join(process.cwd(), 'drizzle', '0110_add_school_subject_type_id.sql');
  if (!fs.existsSync(migrationFile)) {
    throw new Error(`FATAL: Migration file not found: ${migrationFile}`);
  }

  const migrationSQL = fs.readFileSync(migrationFile, 'utf-8');
  console.log(`Migration file: ${migrationFile}`);
  console.log(`Mode: ${ctx.dryRun ? 'DRY RUN' : 'LIVE'}\n`);

  if (ctx.verbose) {
    console.log('--- Migration SQL ---');
    console.log(migrationSQL);
    console.log('--- End Migration SQL ---\n');
  }

  const client = await pool.connect();
  try {
    // Start transaction
    await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
    console.log('📍 Transaction started (ISOLATION LEVEL SERIALIZABLE)');

    // Lock school_subjects table to prevent concurrent changes
    await client.query('LOCK TABLE school_subjects IN ACCESS EXCLUSIVE MODE');
    console.log('🔒 Locked school_subjects table');

    // Pre-migration state
    const preState = await client.query(
      'SELECT COUNT(*)::int AS count FROM school_subjects WHERE status = \'approved\''
    );
    const preCount = preState.rows[0].count;
    console.log(`📊 Before migration: ${preCount} approved associations`);

    // Execute migration
    console.log('🔧 Executing migration SQL...');
    await client.query(migrationSQL);
    console.log('✓ Migration SQL executed');

    // Post-migration verification (still in transaction)
    const columnExists = await client.query(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'school_subjects'
          AND column_name = 'subject_type_id'
      ) AS exists
    `);
    if (!columnExists.rows[0].exists) {
      throw new Error('FATAL: Column subject_type_id was not created');
    }
    console.log('✓ Column subject_type_id verified as created');

    // Verify all existing rows have NULL for the new column
    const nullCheck = await client.query(
      'SELECT COUNT(*)::int AS count FROM school_subjects WHERE subject_type_id IS NOT NULL'
    );
    if (nullCheck.rows[0].count !== 0) {
      throw new Error(`FATAL: ${nullCheck.rows[0].count} rows have non-NULL subject_type_id (expected 0)`);
    }
    console.log('✓ All rows have subject_type_id = NULL (as expected)');

    // Verify approved count unchanged
    const postState = await client.query(
      'SELECT COUNT(*)::int AS count FROM school_subjects WHERE status = \'approved\''
    );
    const postCount = postState.rows[0].count;
    console.log(`📊 After migration: ${postCount} approved associations`);
    if (preCount !== postCount) {
      throw new Error(`FATAL: Approved count changed from ${preCount} to ${postCount}`);
    }
    console.log('✓ Approved associations count unchanged');

    // Verify FK constraint
    const fkCheck = await client.query(`
      SELECT conname AS constraint_name FROM pg_constraint
      WHERE conrelid = (SELECT oid FROM pg_class WHERE relname = 'school_subjects')
        AND conname = 'school_subjects_subject_type_id_subject_types_id_fk'
    `);
    if (fkCheck.rows.length === 0) {
      throw new Error('FATAL: FK constraint was not created');
    }
    console.log('✓ FK constraint verified as created');

    if (ctx.dryRun) {
      await client.query('ROLLBACK');
      console.log('\n🎯 DRY RUN: Transaction rolled back (no changes committed)');
    } else {
      await client.query('COMMIT');
      console.log('\n✅ Transaction committed successfully');
    }
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const verbose = args.includes('--verbose');

  if (args.includes('--help')) {
    console.log(`
Usage: npx tsx scripts/apply-0110-migration.ts [OPTIONS]

Options:
  --dry-run    Preview changes without committing (default)
  --commit     Apply changes permanently
  --verbose    Print full migration SQL
  --help       Show this help message
    `);
    process.exit(0);
  }

  if (!dryRun && !args.includes('--commit')) {
    console.log('ℹ️  Running in DRY RUN mode (no changes will be committed)');
    console.log('   Use --commit flag to apply changes permanently\n');
  }

  const pool = new Pool({
    host: process.env.SQL_HOST || '127.0.0.1',
    port: parseInt(process.env.SQL_PORT || '5432'),
    database: process.env.SQL_DB_NAME || 'ecoletrack',
    user: process.env.SQL_USER || 'ecole_admin',
    password: process.env.SQL_PASSWORD || '',
    ssl: process.env.SQL_USE_SSL === 'true' ? { rejectUnauthorized: false } : false,
  });

  try {
    await checkPrerequisites(pool);
    await applyMigration(pool, { dryRun, verbose });

    if (!dryRun && args.includes('--commit')) {
      console.log('\n✨ Migration 0110 applied successfully!\n');
    }
  } catch (error: any) {
    console.error('\n❌ MIGRATION FAILED:');
    console.error(error.message);
    console.error('\nNo changes were committed.');
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
