import { db } from './src/db/index.ts';
import { classes, schools, academicYears } from './src/db/schema.ts';

const needed = [
  '3ème', '2nde CD', '2nde CD 2', '2nde CD 3', '1ère A4', '1ère A4 3', 'Tle D2', 'Tle D3', 'Tle A4', 'Tle A4 2', 'Tle A4 3'
];

async function addMissing() {
  try {
    const allSchools = await db.select().from(schools);
    if (allSchools.length === 0) { console.log('No school'); process.exit(0); }
    const mainSchool = allSchools[0];
    const years = await db.select().from(academicYears);
    if (years.length === 0) { console.log('No year'); process.exit(0); }
    const year = years[0];

    const existing = await db.select().from(classes);
    const existingNames = new Set(existing.map(c => c.name));
    let created = 0;
    for (const name of needed) {
      if (!existingNames.has(name)) {
        await db.insert(classes).values({ schoolId: mainSchool.id, academicYearId: year.id, name });
        console.log('Created', name);
        created++;
      } else {
        console.log('Already exists', name);
      }
    }
    console.log('Done. created=', created);
  } catch (err) {
    console.error(err);
  } finally { process.exit(0); }
}

addMissing();
