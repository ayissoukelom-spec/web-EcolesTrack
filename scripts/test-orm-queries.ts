import { db } from '../src/db/index.ts';
import { eq } from 'drizzle-orm';
import { schoolSubjects, subjectTypes } from '../src/db/schema.ts';

async function testOrmQueries() {
  try {
    console.log('\n=== BUSINESS FLOW TEST: ORM QUERIES ===\n');

    // Test 1: Read a sample approved subject
    console.log('Test 1: Reading approved subject with new column...');
    const sample = await db.query.schoolSubjects.findFirst({
      where: eq(schoolSubjects.status, 'approved'),
    });
    
    if (!sample) {
      throw new Error('No approved subjects found');
    }
    
    console.log(`  ✓ Found approved subject (id=${sample.id})`);
    console.log(`    - schoolId: ${sample.schoolId}`);
    console.log(`    - subjectId: ${sample.subjectId}`);
    console.log(`    - status: ${sample.status}`);
    console.log(`    - subjectTypeId: ${sample.subjectTypeId}`);
    console.log(`    - createdAt: ${sample.createdAt}\n`);

    // Test 2: Try to update subjectTypeId to a valid value
    // First, get a valid subject type from the first school
    const firstSubjectType = await db.query.subjectTypes.findFirst({
      where: (t) => eq(t.schoolId, sample.schoolId),
    });

    if (firstSubjectType) {
      console.log('Test 2: Updating subjectTypeId with ORM...');
      const result = await db.update(schoolSubjects)
        .set({ subjectTypeId: firstSubjectType.id })
        .where(eq(schoolSubjects.id, sample.id))
        .returning();
      
      console.log(`  ✓ Updated subject (id=${result[0].id})`);
      console.log(`    - New subjectTypeId: ${result[0].subjectTypeId}`);
      console.log(`    - Updated timestamp: ${result[0].updatedAt}\n`);

      // Test 3: Verify the update persisted
      console.log('Test 3: Verifying update persisted...');
      const verified = await db.query.schoolSubjects.findFirst({
        where: eq(schoolSubjects.id, sample.id),
      });
      
      if (verified?.subjectTypeId !== firstSubjectType.id) {
        throw new Error('Update did not persist correctly');
      }
      console.log(`  ✓ Update verified: subjectTypeId = ${verified.subjectTypeId}\n`);

      // Test 4: Reset back to NULL
      console.log('Test 4: Resetting subjectTypeId to NULL...');
      const resetResult = await db.update(schoolSubjects)
        .set({ subjectTypeId: null })
        .where(eq(schoolSubjects.id, sample.id))
        .returning();
      
      console.log(`  ✓ Reset successful: subjectTypeId = ${resetResult[0].subjectTypeId}\n`);
    } else {
      console.log('⚠ No subject types found for this school, skipping update tests\n');
    }

    // Test 5: Count records with NULL and non-NULL subjectTypeId
    console.log('Test 5: Checking distribution of subjectTypeId values...');
    const allSubjects = await db.select().from(schoolSubjects).where(
      eq(schoolSubjects.status, 'approved')
    );
    
    const nullCount = allSubjects.filter(s => s.subjectTypeId === null).length;
    const assignedCount = allSubjects.filter(s => s.subjectTypeId !== null).length;
    
    console.log(`  Total approved subjects: ${allSubjects.length}`);
    console.log(`  - With subjectTypeId = NULL: ${nullCount}`);
    console.log(`  - With subjectTypeId assigned: ${assignedCount}\n`);

    console.log('✅ All ORM tests passed!\n');
  } catch (error: any) {
    console.error('❌ Test failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    process.exit(0);
  }
}

testOrmQueries();
