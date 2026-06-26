import { sql } from 'drizzle-orm';
import { db } from './src/db/index.ts';
import { students } from './src/db/schema.ts';

const rows = await db
  .select({
    gender: students.gender,
    count: sql<number>`count(*)::int`,
  })
  .from(students)
  .groupBy(students.gender);

console.log('Raw students.gender groups:');
console.log(JSON.stringify(rows, null, 2));

const sample = await db
  .select({ id: students.id, firstName: students.firstName, lastName: students.lastName, gender: students.gender, schoolId: students.schoolId })
  .from(students)
  .limit(20);

console.log('Sample students:');
console.log(JSON.stringify(sample, null, 2));
