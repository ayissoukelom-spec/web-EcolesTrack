import { db } from './src/db/index.ts';
import { users } from './src/db/schema.ts';

(async () => {
  try {
    const uid = 'admin_gestion_manual_' + Date.now();
    const result = await db.insert(users).values({ uid, email: 'admin.gestion@ecoletrack.test', name: 'Admin Gestion', role: 'super_admin' }).returning();
    console.log('Created user:', result[0]);
    process.exit(0);
  } catch (e) {
    console.error('Insert failed:', e);
    process.exit(1);
  }
})();
