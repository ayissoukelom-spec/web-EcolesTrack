import { db } from './src/db/index.ts';
import { classes, schools, academicYears, users, students, teachers } from './src/db/schema.ts';
import { eq } from 'drizzle-orm';

async function createPredefineClasses() {
  try {
    // Get the first school
    const allSchools = await db.select().from(schools);
    if (allSchools.length === 0) {
      console.log('No schools found. Cannot create classes.');
      return;
    }
    const mainSchool = allSchools[0];
    console.log(`Creating classes for school: ${mainSchool.name}`);

    // Get the first academic year
    const allYears = await db.select().from(academicYears);
    if (allYears.length === 0) {
      console.log('No academic years found. Cannot create classes.');
      return;
    }
    const activeYear = allYears[0];
    console.log(`Using academic year: ${activeYear.name}`);

    // Get a teacher (from teachers table, not users)
    const allTeachers = await db.select().from(teachers);
    if (allTeachers.length === 0) {
      console.log('No teachers found. Cannot create classes.');
      return;
    }
    const teacher = allTeachers[0];

    // Class names ordered: 4ème, 3ème, 2nde A4 then 2nde CD, 1ère A4, 1ère D, 1ère, Tle A4, Tle D, Tle
    const classNames = [
      // 4ème
      '4ème A', '4ème B', '4ème C', '4ème D', '4ème E', '4ème F',

      // 3ème
      '3ème', '3ème A', '3ème B', '3ème C', '3ème D', '3ème E', '3ème F',

      // 2nde A4 first
      '2nde A4 1', '2nde A4 2', '2nde A4 3',
      // 2nde CD variants
      '2nde CD', '2nde CD 1', '2nde CD 2', '2nde CD 3',
      '2nde 1', '2nde 2', '2nde 3', '2nde 4', '2nde 5', '2nde 6',

      // 1ère A4 variants and 1ère D
      '1ère A4', '1ère A4 1', '1ère A4 2', '1ère A4 3',
      '1ère D', '1ère D 1',
      '1ère 1', '1ère 2', '1ère 3', '1ère 4', '1ère 5', '1ère 6',

      // Terminale
      'Tle A4', 'Tle A4 1', 'Tle A4 2', 'Tle A4 3',
      'Tle D', 'Tle D 1', 'Tle D2', 'Tle D3',
      'Tle 1', 'Tle 2', 'Tle 3', 'Tle 4', 'Tle 5', 'Tle 6',
    ];

    // Delete existing classes and students first
    // First delete all related data
    const { evaluations, grades, absences } = await import('./src/db/schema.ts');
    
    // Get all student IDs for this school
    const schoolStudents = await db.select().from(students).where(eq(students.schoolId, mainSchool.id));
    const studentIds = schoolStudents.map(s => s.id);
    
    if (studentIds.length > 0) {
      // Delete dependent records first
      console.log(`Deleting records for ${studentIds.length} students...`);
      for (const studentId of studentIds) {
        await db.delete(evaluations).where(eq(evaluations.studentId, studentId));
        await db.delete(grades).where(eq(grades.studentId, studentId));
        await db.delete(absences).where(eq(absences.studentId, studentId));
      }
    }
    
    console.log('Deleted evaluations, grades, and absences');
    
    await db.delete(students).where(eq(students.schoolId, mainSchool.id));
    console.log('Deleted existing students');
    
    // Don't delete classes, just insert new ones
    console.log('Ready to create new classes');

    let createdCount = 0;
    for (const className of classNames) {
      const created = await db.insert(classes).values({
        schoolId: mainSchool.id,
        academicYearId: activeYear.id,
        name: className,
      }).returning();
      
      if (created.length > 0) {
        createdCount++;
        console.log(`✓ Created class: ${className}`);
      }
    }

    console.log(`\n✅ Successfully created ${createdCount} classes!`);
  } catch (error) {
    console.error('Error creating classes:', error);
  } finally {
    process.exit(0);
  }
}

createPredefineClasses();
