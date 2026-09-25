const { writeFile } = require('fs/promises');
const path = require('path');
const { createBulletinPdfDocument } = require('./src/lib/bulletinPdfApi.ts');
(async () => {
  const data = {
    id: 1,
    studentId: 10,
    studentName: 'Alice Dupont',
    studentMatricule: '00001N',
    studentGender: 'F',
    studentStatus: 'Doublant',
    classId: 3,
    className: '3ème A',
    classStudentCount: 42,
    schoolName: 'C.S LE SAVOIR',
    school: {
      name: 'C.S LE SAVOIR',
      officialName: 'COLLEGE LE SAVOIR',
      abbreviation: 'CLS',
      motto: 'Le travail et la reussite',
      address: 'Lome',
      postalBox: 'BP 12',
      phone: '+228 90000000',
      email: 'contact@lessavoir.test',
      city: 'Lome',
      region: 'Maritime',
      educationDirection: 'Direction regionale Maritime',
      ministryName: 'MINISTERE DE L EDUCATION DU TOGO',
    },
    schoolYearId: 100,
    schoolYearName: '2025-2026',
    termId: 7,
    termName: 'Trimestre 1',
    average: 14.5,
    totalPoints: 58,
    totalCoefficients: 4,
    rank: 2,
    mention: 'SNAPSHOT_MENTION',
    appreciation: 'SNAPSHOT_APPRECIATION',
    absences: 0,
    retards: 0,
    generatedAt: '2026-06-26T08:00:00.000Z',
    lines: [
      { id:1, bulletinId:1, subjectId:null, subjectName:'Mathématiques', subjectCode:'MATH', coefficient:2, average:15, teacherComment:'Bon niveau', rank:1, interrogation:12, devoir:14, composition:16, classAverage:13.5, teacherName:'Martin', teacherLastName:'Bello', teacherFirstNames:'Jean' },
      { id:2, bulletinId:1, subjectId:null, subjectName:'Français', subjectCode:'FR', coefficient:3, average:13.5, teacherComment:'Très bien', rank:2, interrogation:11, devoir:12, composition:14, classAverage:12.5, teacherName:'Martin', teacherLastName:'Bello', teacherFirstNames:'Jean' },
      { id:3, bulletinId:1, subjectId:null, subjectName:'Histoire', subjectCode:'HIST', coefficient:2, average:12, teacherComment:'Stable', rank:3, interrogation:10, devoir:11, composition:13, classAverage:11.5, teacherName:'Martin', teacherLastName:'Bello', teacherFirstNames:'Jean' }
    ]
  };
  const pdf = await createBulletinPdfDocument(data);
  const out = path.resolve('bulletin-debug.pdf');
  await writeFile(out, Buffer.from(pdf));
  console.log(out);
})();
