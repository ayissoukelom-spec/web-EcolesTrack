const fs = require('fs');
const XLSX = require('xlsx');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

const normalizeDateOnly = (value) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().split('T')[0];
};

const getExportRows = (ev, gradesList, studentsList, classesList, schoolsList) => {
  const evaluationClass = classesList.find((cls) => cls.id === ev.classId);
  const school = evaluationClass ? schoolsList.find((school) => school.id === evaluationClass.schoolId) : undefined;
  const gradesForEval = gradesList
    .filter((grade) => grade.evaluationId === ev.id)
    .map((grade, index) => {
      const student = studentsList.find((st) => st.id === grade.studentId);
      const studentName = grade.studentName || `${student?.firstName ?? ''} ${student?.lastName ?? ''}`.trim();
      return {
        index: index + 1,
        studentName: studentName || 'Élève',
        score: grade.score ?? '',
        remarks: grade.remarks ?? '',
      };
    });

  return {
    meta: [
      ['École', school?.name ?? 'École Demo'],
      ['Classe', evaluationClass?.name ?? '1A'],
      ['Matière', ev.subject],
      ['Enseignant', ev.teacherName ?? 'Mme Dupont'],
      ['Intitulé du devoir', ev.title],
      ['Date', normalizeDateOnly(ev.date || ev.createdAt) ?? ''],
    ],
    grades: gradesForEval,
  };
};

const exportEvaluationExcel = (ev, gradesList, studentsList, classesList, schoolsList) => {
  const { meta, grades } = getExportRows(ev, gradesList, studentsList, classesList, schoolsList);
  const rows = [
    ['Relevé des notes'],
    [],
    ...meta,
    [],
    ['N°', 'Élève', 'Note', 'Remarques'],
    ...grades.map((grade) => [grade.index, grade.studentName, grade.score, grade.remarks]),
  ];

  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  worksheet['!cols'] = [
    { wch: 5 },
    { wch: 30 },
    { wch: 15 },
    { wch: 40 },
  ];
  worksheet['!freeze'] = { xSplit: 0, ySplit: 7 };

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Relevé des notes');
  const data = XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer', cellStyles: true });
  fs.writeFileSync('preview-archive-export.xlsx', data);
};

const exportEvaluationPdf = async (ev, gradesList, studentsList, classesList, schoolsList) => {
  const { meta, grades } = getExportRows(ev, gradesList, studentsList, classesList, schoolsList);
  const pdfDoc = await PDFDocument.create();
  const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const pageWidth = 595.28;
  const pageHeight = 841.89;
  const margin = 40;
  const lineHeight = 18;
  const cellPadding = 6;
  const tableX = margin;
  const tableWidth = pageWidth - margin * 2;
  const colWidths = [40, 220, 100, tableWidth - 40 - 220 - 100];

  const createPage = () => pdfDoc.addPage([pageWidth, pageHeight]);
  let page = createPage();
  let cursorY = pageHeight - margin;

  const drawText = (text, x, y, options = {}) => {
    page.drawText(text, {
      x,
      y,
      font: options.bold ? helveticaBold : helvetica,
      size: options.size ?? 11,
      color: rgb(0, 0, 0),
    });
  };

  const addPageIfNeeded = (neededHeight) => {
    if (cursorY - neededHeight < margin) {
      page = createPage();
      cursorY = pageHeight - margin;
    }
  };

  drawText('Relevé des notes', tableX, cursorY, { bold: true, size: 18 });
  cursorY -= 28;

  meta.forEach(([label, value]) => {
    addPageIfNeeded(lineHeight);
    drawText(`${label}:`, tableX, cursorY, { bold: true, size: 11 });
    drawText(String(value), tableX + 110, cursorY, { size: 11 });
    cursorY -= lineHeight;
  });

  cursorY -= 8;
  addPageIfNeeded(lineHeight + (grades.length + 1) * (lineHeight + 8));

  const headerY = cursorY;
  let currentX = tableX;
  const headers = ['N°', 'Élève', 'Note', 'Remarques'];

  headers.forEach((header, index) => {
    page.drawRectangle({
      x: currentX,
      y: headerY - lineHeight - 4,
      width: colWidths[index],
      height: lineHeight + 8,
      color: rgb(0.95, 0.95, 0.95),
      borderColor: rgb(0.6, 0.6, 0.6),
      borderWidth: 1,
    });
    drawText(header, currentX + cellPadding, headerY - lineHeight + 2, { bold: true, size: 11 });
    currentX += colWidths[index];
  });

  let rowY = headerY - lineHeight - 12;
  grades.forEach((grade) => {
    addPageIfNeeded(lineHeight + 8);
    currentX = tableX;
    const rowHeight = lineHeight + 8;
    page.drawRectangle({
      x: currentX,
      y: rowY - 4,
      width: tableWidth,
      height: rowHeight,
      borderColor: rgb(0.8, 0.8, 0.8),
      borderWidth: 1,
    });
    drawText(String(grade.index), currentX + cellPadding, rowY, { size: 10 });
    currentX += colWidths[0];
    drawText(grade.studentName, currentX + cellPadding, rowY, { size: 10 });
    currentX += colWidths[1];
    drawText(String(grade.score), currentX + cellPadding, rowY, { size: 10 });
    currentX += colWidths[2];
    drawText(grade.remarks || '—', currentX + cellPadding, rowY, { size: 10 });
    rowY -= rowHeight;
  });

  const pdfBytes = await pdfDoc.save();
  fs.writeFileSync('preview-archive-export.pdf', pdfBytes);
};

(async () => {
  const sampleEval = {
    id: 1001,
    classId: 201,
    subject: 'Mathématiques',
    teacherName: 'Mme Dupont',
    title: 'Contrôle sur les fractions',
    date: '2026-06-15',
    createdAt: '2026-06-10',
  };

  const classesList = [{ id: 201, name: '6ème A', schoolId: 301 }];
  const schoolsList = [{ id: 301, name: 'Lycée Victor Hugo' }];
  const studentsList = [
    { id: 401, firstName: 'Alice', lastName: 'Martin' },
    { id: 402, firstName: 'Basile', lastName: 'Roy' },
    { id: 403, firstName: 'Camille', lastName: 'Nguyen' },
  ];
  const gradesList = [
    { evaluationId: 1001, studentId: 401, score: '16/20', remarks: 'Très bon travail' },
    { evaluationId: 1001, studentId: 402, score: '12/20', remarks: 'Progression visible' },
    { evaluationId: 1001, studentId: 403, score: '14/20', remarks: '' },
  ];

  exportEvaluationExcel(sampleEval, gradesList, studentsList, classesList, schoolsList);
  await exportEvaluationPdf(sampleEval, gradesList, studentsList, classesList, schoolsList);
  console.log('Generated preview-archive-export.xlsx and preview-archive-export.pdf');
})();
