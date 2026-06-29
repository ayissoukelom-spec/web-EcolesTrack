import { db } from './src/db/index.js';
import { teachers, classTeachers, users } from './src/db/schema.js';
import { eq, inArray } from 'drizzle-orm';

async function check() {
  console.log('\n========== CHECKING classIds DATA ==========\n');

  // Check 1: Count assignments
  const countResult = await db.select().from(classTeachers);
  console.log(`✅ Total class_teachers assignments: ${countResult.length}`);
  console.log(`Sample assignments:`, countResult.slice(0, 5));

  // Check 2: Get all teachers with their assignments
  const allTeachers = await db
    .select({
      id: teachers.id,
      userId: teachers.userId,
      name: users.name,
      email: users.email,
    })
    .from(teachers)
    .innerJoin(users, eq(teachers.userId, users.id));

  console.log(`\n✅ Total teachers: ${allTeachers.length}`);
  
  if (allTeachers.length > 0) {
    const teacherIds = allTeachers.map(t => t.id).filter(Boolean);
    
    // Check 3: Get assignments for these teachers
    if (teacherIds.length > 0) {
      const assignments = await db
        .select({ teacherId: classTeachers.teacherId, classId: classTeachers.classId })
        .from(classTeachers)
        .where(inArray(classTeachers.teacherId, teacherIds));

      console.log(`\n✅ Found ${assignments.length} class_teachers entries for these teachers`);
      console.log('Sample assignments:', assignments.slice(0, 5));

      // Group by teacher
      const assignmentMap = new Map<number, number[]>();
      assignments.forEach((item) => {
        const existing = assignmentMap.get(item.teacherId) || [];
        existing.push(item.classId);
        assignmentMap.set(item.teacherId, existing);
      });

      // Show teachers and their classIds
      console.log('\n✅ Teachers with their classIds:');
      allTeachers.slice(0, 5).forEach((teacher) => {
        const classIds = assignmentMap.get(teacher.id) || [];
        console.log(`  ${teacher.name} (ID: ${teacher.id}): classIds = [${classIds.join(', ')}]`);
      });
    }
  }

  console.log('\n========== END CHECK ==========\n');
  process.exit(0);
}

check().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
