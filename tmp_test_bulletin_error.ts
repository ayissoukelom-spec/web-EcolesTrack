import { db } from './src/db/index.ts';
import { generateBulletinSnapshot } from './src/lib/bulletinSnapshotService.ts';

const test = async () => {
  try {
    // Using term 16 (academicYearId 43) with student 76 (class 179, academicYearId 43)
    const result = await generateBulletinSnapshot(76, 16);
    console.log('SUCCESS:', result);
  } catch (err) {
    console.error('ERROR generateBulletinSnapshot:');
    console.error('message:', (err as any)?.message);
    console.error('stack:', (err as any)?.stack);
    if ((err as any)?.cause) {
      console.error('cause:', (err as any).cause);
    }
  }
};

test().then(() => process.exit(0)).catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
