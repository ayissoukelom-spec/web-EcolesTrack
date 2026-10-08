import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

export interface ClassSituationPdfCategoryRow {
  studentId: number;
  firstName: string;
  lastName: string;
  className: string;
  categoryId: number;
  categoryCode: string;
  categoryLabel: string;
  due: number;
  paid: number;
  studentDue: number;
  studentPaid: number;
  studentRemaining: number;
  studentStatus: 'paid' | 'partial' | 'unpaid' | 'unconfigured';
}

export interface ClassSituationPdfStudent {
  studentId: number;
  firstName: string;
  lastName: string;
  className: string;
  categories: Array<{
    categoryId: number;
    categoryCode: string;
    categoryLabel: string;
    due: number;
    paid: number;
    remaining: number;
  }>;
  studentDue: number;
  studentPaid: number;
  studentRemaining: number;
  studentStatus: ClassSituationPdfCategoryRow['studentStatus'];
}

interface ClassSituationPdfOptions {
  schoolName: string;
  academicYearName: string;
  className: string;
  issuedAt: Date;
  rows: ClassSituationPdfCategoryRow[];
}

const pageWidth = 842;
const pageHeight = 595;
const margin = 32;
const tableColumns = [
  { label: 'N°', width: 28, align: 'right' as const },
  { label: 'Élève', width: 112, align: 'left' as const },
  { label: 'Catégories (dû / payé / reste)', width: 320, align: 'left' as const },
  { label: 'Total dû', width: 76, align: 'right' as const },
  { label: 'Total payé', width: 76, align: 'right' as const },
  { label: 'Reste', width: 76, align: 'right' as const },
  { label: 'Statut', width: 82, align: 'left' as const },
];
const tableWidth = tableColumns.reduce((total, column) => total + column.width, 0);
const money = (amount: number) => Math.round(amount).toLocaleString('fr-FR').replace(/\u202f/g, ' ');
const statusLabel = (status: ClassSituationPdfCategoryRow['studentStatus']) => ({
  paid: 'Soldé',
  partial: 'Partiel',
  unpaid: 'Impayé',
  unconfigured: 'À configurer',
}[status]);

const fitText = (
  text: string,
  maxWidth: number,
  size: number,
  font: Awaited<ReturnType<PDFDocument['embedFont']>>,
) => {
  if (font.widthOfTextAtSize(text, size) <= maxWidth) return text;
  let shortened = text;
  while (shortened.length > 1 && font.widthOfTextAtSize(`${shortened}…`, size) > maxWidth) {
    shortened = shortened.slice(0, -1);
  }
  return `${shortened}…`;
};

export const aggregateClassSituationPdfRows = (
  rows: ClassSituationPdfCategoryRow[],
): ClassSituationPdfStudent[] => {
  const students = new Map<number, ClassSituationPdfStudent>();
  for (const row of rows) {
    let student = students.get(row.studentId);
    if (!student) {
      student = {
        studentId: row.studentId,
        firstName: row.firstName,
        lastName: row.lastName,
        className: row.className,
        categories: [],
        studentDue: Math.max(0, Number(row.studentDue) || 0),
        studentPaid: Math.max(0, Number(row.studentPaid) || 0),
        studentRemaining: Math.max(0, Number(row.studentRemaining) || 0),
        studentStatus: row.studentStatus,
      };
      students.set(row.studentId, student);
    }
    const due = Math.max(0, Number(row.due) || 0);
    const paid = Math.min(due, Math.max(0, Number(row.paid) || 0));
    const category = student.categories.find((item) => item.categoryId === row.categoryId);
    if (category) {
      category.due += due;
      category.paid += paid;
      category.remaining = Math.max(0, category.due - category.paid);
    } else {
      student.categories.push({
        categoryId: row.categoryId,
        categoryCode: row.categoryCode,
        categoryLabel: row.categoryLabel,
        due,
        paid,
        remaining: Math.max(0, due - paid),
      });
    }
  }
  return [...students.values()];
};

export const generateClassSituationPdf = async ({
  schoolName,
  academicYearName,
  className,
  issuedAt,
  rows,
}: ClassSituationPdfOptions) => {
  const students = aggregateClassSituationPdfRows(rows);
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Situation financière de la classe - ${className}`);
  pdf.setAuthor(schoolName);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const dark = rgb(0.12, 0.16, 0.23);
  const muted = rgb(0.35, 0.4, 0.48);
  const border = rgb(0.72, 0.76, 0.81);
  const headerFill = rgb(0.91, 0.94, 0.97);
  const lineHeight = 11;
  const bottomLimit = 72;
  let page = pdf.addPage([pageWidth, pageHeight]);
  let y = pageHeight - margin;

  const drawText = (text: string, x: number, baseline: number, size = 9, isBold = false, color = dark) => {
    page.drawText(text, { x, y: baseline, size, font: isBold ? bold : regular, color });
  };
  const drawTableHeader = () => {
    const rowHeight = 28;
    const top = y;
    const bottom = y - rowHeight;
    let x = (pageWidth - tableWidth) / 2;
    page.drawRectangle({
      x,
      y: bottom,
      width: tableWidth,
      height: rowHeight,
      color: headerFill,
      borderColor: border,
      borderWidth: 0.7,
    });
    for (const column of tableColumns) {
      page.drawLine({ start: { x, y: top }, end: { x, y: bottom }, color: border, thickness: 0.7 });
      const label = fitText(column.label, column.width - 10, 7.5, bold);
      drawText(label, x + 5, bottom + 10, 7.5, true);
      x += column.width;
    }
    page.drawLine({ start: { x, y: top }, end: { x, y: bottom }, color: border, thickness: 0.7 });
    y = bottom;
  };
  const addPage = (repeatTableHeader: boolean) => {
    page = pdf.addPage([pageWidth, pageHeight]);
    y = pageHeight - margin;
    if (repeatTableHeader) drawTableHeader();
  };

  drawText(schoolName, margin, y - 10, 15, true);
  y -= 26;
  drawText(`Année scolaire : ${academicYearName}`, margin, y, 10, false, muted);
  y -= 26;
  drawText('Situation financière de la classe', margin, y, 18, true);
  y -= 22;
  drawText(`Classe : ${className}`, margin, y, 11, true);
  const issued = issuedAt.toLocaleDateString('fr-FR');
  const issuedText = `Édité le ${issued}`;
  drawText(issuedText, pageWidth - margin - regular.widthOfTextAtSize(issuedText, 9), y, 9, false, muted);
  y -= 22;
  drawTableHeader();

  for (const [index, student] of students.entries()) {
    const categoryLines = student.categories.map((category) =>
      `${category.categoryLabel} : ${money(category.due)} / ${money(category.paid)} / ${money(category.remaining)}`,
    );
    const rowHeight = Math.max(27, categoryLines.length * lineHeight + 8);
    if (y - rowHeight < bottomLimit) addPage(true);
    const top = y;
    const bottom = y - rowHeight;
    let x = (pageWidth - tableWidth) / 2;
    const values = [
      String(index + 1),
      `${student.lastName} ${student.firstName}`.trim(),
      '',
      money(student.studentDue),
      money(student.studentPaid),
      money(student.studentRemaining),
      statusLabel(student.studentStatus),
    ];
    page.drawRectangle({
      x,
      y: bottom,
      width: tableWidth,
      height: rowHeight,
      borderColor: border,
      borderWidth: 0.6,
    });
    values.forEach((value, columnIndex) => {
      const column = tableColumns[columnIndex];
      page.drawLine({ start: { x, y: top }, end: { x, y: bottom }, color: border, thickness: 0.6 });
      const innerWidth = column.width - 10;
      const shown = fitText(value, innerWidth, 8, regular);
      const textWidth = regular.widthOfTextAtSize(shown, 8);
      const textX = column.align === 'right' ? x + column.width - 5 - textWidth : x + 5;
      const statusColor = student.studentStatus === 'paid'
        ? rgb(0.08, 0.42, 0.25)
        : student.studentStatus === 'partial'
          ? rgb(0.58, 0.34, 0.04)
          : student.studentStatus === 'unpaid'
            ? rgb(0.65, 0.14, 0.14)
            : muted;
      if (columnIndex !== 2) {
        drawText(shown, textX, bottom + (rowHeight - 8) / 2, 8, columnIndex === 6, columnIndex === 6 ? statusColor : dark);
      } else {
        categoryLines.forEach((line, lineIndex) => {
          drawText(
            fitText(line, innerWidth, 7, regular),
            x + 5,
            top - 11 - lineIndex * lineHeight,
            7,
          );
        });
      }
      x += column.width;
    });
    page.drawLine({ start: { x, y: top }, end: { x, y: bottom }, color: border, thickness: 0.6 });
    y = bottom;
  }
  if (students.length === 0) {
    drawText('Aucun élève ne correspond à cette classe et aux filtres sélectionnés.', margin, y - 18, 10, false, muted);
    y -= 36;
  }

  const totals = students.reduce((result, student) => ({
    due: result.due + student.studentDue,
    paid: result.paid + student.studentPaid,
    remaining: result.remaining + student.studentRemaining,
    paidCount: result.paidCount + Number(student.studentStatus === 'paid'),
    partialCount: result.partialCount + Number(student.studentStatus === 'partial'),
    unpaidCount: result.unpaidCount + Number(student.studentStatus === 'unpaid'),
  }), { due: 0, paid: 0, remaining: 0, paidCount: 0, partialCount: 0, unpaidCount: 0 });
  const summaryHeight = 66;
  if (y - summaryHeight < bottomLimit) addPage(true);
  y -= 12;
  const summaryX = (pageWidth - tableWidth) / 2;
  page.drawRectangle({
    x: summaryX,
    y: y - summaryHeight,
    width: tableWidth,
    height: summaryHeight,
    color: rgb(0.96, 0.97, 0.98),
    borderColor: border,
    borderWidth: 0.8,
  });
  drawText(`Total élèves : ${students.length}`, summaryX + 10, y - 17, 9, true);
  drawText(`Total dû : ${money(totals.due)} FCFA`, summaryX + 130, y - 17, 9, true);
  drawText(`Total encaissé : ${money(totals.paid)} FCFA`, summaryX + 330, y - 17, 9, true);
  drawText(`Total restant : ${money(totals.remaining)} FCFA`, summaryX + 570, y - 17, 9, true);
  drawText(`Soldés : ${totals.paidCount}    Partiels : ${totals.partialCount}    Impayés : ${totals.unpaidCount}`, summaryX + 10, y - 42, 9, false, muted);

  const pages = pdf.getPages();
  pages.forEach((pageItem, index) => {
    const pageLabel = `Page ${index + 1} / ${pages.length}`;
    pageItem.drawText(pageLabel, {
      x: pageWidth - margin - regular.widthOfTextAtSize(pageLabel, 8),
      y: 15,
      size: 8,
      font: regular,
      color: muted,
    });
  });
  return pdf.save();
};
