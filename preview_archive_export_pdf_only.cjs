const fs = require('fs');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

const makePdf = async () => {
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
  const cursorY = pageHeight - margin;

  const drawText = (text, x, y, options = {}) => {
    page.drawText(text, { x, y, font: options.bold ? helveticaBold : helvetica, size: options.size ?? 11, color: rgb(0, 0, 0) });
  };

  const headerY = cursorY - 50;
  const headerHeight = lineHeight + 8;
  const headerTextY = headerY - lineHeight + 4;
  let currentX = tableX;
  const headers = ['N°', 'Élève', 'Note', 'Remarques'];

  headers.forEach((header, index) => {
    page.drawRectangle({
      x: currentX,
      y: headerY - headerHeight - 4,
      width: colWidths[index],
      height: headerHeight,
      color: rgb(0.95, 0.95, 0.95),
      borderColor: rgb(0.6, 0.6, 0.6),
      borderWidth: 1,
    });
    drawText(header, currentX + cellPadding, headerTextY, { bold: true, size: 11 });
    currentX += colWidths[index];
  });

  const pdfBytes = await pdfDoc.save();
  fs.writeFileSync('preview-archive-export-pdf-only.pdf', pdfBytes);
};

makePdf().then(() => console.log('Generated preview-archive-export-pdf-only.pdf')).catch((err) => { console.error(err); process.exit(1); });
