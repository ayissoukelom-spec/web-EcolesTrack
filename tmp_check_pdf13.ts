import { createDbBulletinPdfDataProvider, createBulletinPdfDocument } from './src/lib/bulletinPdfApi.ts';

async function main() {
  const provider = createDbBulletinPdfDataProvider();
  const actor = { role: 'super_admin', schoolId: null };
  const bulletinId = Number(process.argv[2] || 13);

  const data = await provider.getById(actor, bulletinId);
  console.log('DATA_EXISTS', !!data);
  if (!data) {
    console.log('NO_DATA');
    return;
  }

  console.log('HEADER', {
    id: data.id,
    studentId: data.studentId,
    classId: data.classId,
    termId: data.termId,
    average: data.average,
    lines: data.lines.length,
  });

  const pdf = await createBulletinPdfDocument(data);
  console.log('PDF_BYTES', pdf.length);
}

main().catch((err) => {
  console.error('PDF_CHECK_ERROR', err);
  process.exitCode = 1;
});
