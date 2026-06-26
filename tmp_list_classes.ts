import { db } from './src/db/index.ts';
import { classes } from './src/db/schema.ts';

async function listClasses() {
  try {
    const all = await db.select().from(classes).orderBy(classes.name.asc);
    console.log('Classes count:', all.length);
    for (const c of all) {
      console.log(c.id, c.name);
    }
  } catch (err) {
    console.error(err);
  } finally {
    process.exit(0);
  }
}

listClasses();
