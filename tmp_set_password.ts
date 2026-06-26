import { db } from './src/db/index.ts';
import { localAuths } from './src/db/schema.ts';
import crypto from 'node:crypto';
import { eq } from 'drizzle-orm';

(async () => {
  try {
    const userId = 58; // super admin id just created
    const password = 'SuperSecret123!';
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.pbkdf2Sync(password, salt, 310000, 64, 'sha512').toString('hex');

    const exists = await db.select().from(localAuths).where(eq(localAuths.userId, userId));
    if (exists.length > 0) {
      await db.update(localAuths).set({ passwordHash: hash, salt }).where(eq(localAuths.userId, userId));
      console.log('Password updated for user', userId);
    } else {
      await db.insert(localAuths).values({ userId, passwordHash: hash, salt }).returning();
      console.log('Password set for user', userId);
    }
    console.log('username (email): admin.gestion@ecoletrack.test, password:', password);
    process.exit(0);
  } catch (e) {
    console.error('Failed to set password', e);
    process.exit(1);
  }
})();
