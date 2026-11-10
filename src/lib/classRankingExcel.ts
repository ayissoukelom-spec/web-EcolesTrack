import ExcelJS from 'exceljs';

export interface ClassRankingExcelStudent {
  rank: string;
  matricule: string;
  fullName: string;
  subjectAverages: Array<number | null>;
  average: number | null;
}

export interface ClassRankingExcelOptions {
  schoolName: string;
  className: string;
  periodName: string;
  rankingType: 'official' | 'custom';
  generatedAt: Date;
  subjectNames: string[];
  evaluations?: Array<{ subject: string; title: string }>;
  students: ClassRankingExcelStudent[];
}

const border = {
  top: { style: 'thin' as const, color: { argb: 'FFBFBFBF' } },
  bottom: { style: 'thin' as const, color: { argb: 'FFBFBFBF' } },
  left: { style: 'thin' as const, color: { argb: 'FFBFBFBF' } },
  right: { style: 'thin' as const, color: { argb: 'FFBFBFBF' } },
};

export const buildClassRankingExcel = async (
  options: ClassRankingExcelOptions,
): Promise<Uint8Array> => {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'EcoleTrack';
  workbook.created = options.generatedAt;
  const worksheet = workbook.addWorksheet('Résultats', {
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  worksheet.columns = [
    { width: 12 },
    { width: 18 },
    { width: 30 },
    ...options.subjectNames.map((subject) => ({ width: Math.max(16, Math.min(28, subject.length + 4)) })),
    { width: 24 },
  ];
  const isCustom = options.rankingType === 'custom';
  const title = isCustom ? 'Classement personnalisé — non officiel' : 'Classement officiel';
  const metadataRows: Array<Array<string | Date>> = [
    [title],
    ['Établissement', options.schoolName],
    ['Classe', options.className],
    ['Période scolaire', options.periodName],
    ['Type de classement', isCustom ? 'Personnalisé' : 'Officiel'],
    ['Date de génération', options.generatedAt],
  ];
  worksheet.addRows(metadataRows);
  worksheet.getCell('B6').numFmt = 'dd/mm/yyyy hh:mm';
  let tableHeaderRow = 8;

  if (isCustom) {
    worksheet.getCell('A7').value = 'Évaluations sélectionnées';
    worksheet.getCell('A7').font = { bold: true };
    for (const evaluation of options.evaluations ?? []) {
      worksheet.addRow([evaluation.subject, evaluation.title]);
      tableHeaderRow += 1;
    }
    tableHeaderRow += 1;
  }

  const headers = [
    'Rang',
    'Matricule',
    'Nom et prénom',
    ...options.subjectNames,
    'Moyenne générale sur 20',
  ];
  worksheet.addRow([]);
  worksheet.addRow(headers);
  const table = worksheet.getRow(tableHeaderRow);
  table.font = { bold: true };
  table.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCE6F1' } };
  table.alignment = { vertical: 'middle', wrapText: true };
  table.eachCell((cell) => {
    cell.border = border;
  });

  for (const student of options.students) {
    const row = worksheet.addRow([
      student.rank,
      student.matricule,
      student.fullName,
      ...student.subjectAverages,
      student.average,
    ]);
    row.eachCell((cell, columnNumber) => {
      cell.border = border;
      cell.alignment = { vertical: 'middle', horizontal: columnNumber > 2 ? 'right' : 'left' };
      if (columnNumber > 3) cell.numFmt = '0.00';
    });
  }

  worksheet.autoFilter = {
    from: { row: tableHeaderRow, column: 1 },
    to: { row: tableHeaderRow + options.students.length, column: headers.length },
  };
  worksheet.getCell('A1').font = { bold: true, size: 16 };
  worksheet.getCell('A1').alignment = { vertical: 'middle' };
  worksheet.getRow(1).height = 24;
  worksheet.pageSetup.printTitlesRow = `${tableHeaderRow}:${tableHeaderRow}`;
  worksheet.pageSetup.paperSize = 9;
  worksheet.pageSetup.margins = {
    left: 0.25,
    right: 0.25,
    top: 0.5,
    bottom: 0.5,
    header: 0.2,
    footer: 0.2,
  };

  const buffer = await workbook.xlsx.writeBuffer();
  return new Uint8Array(buffer);
};

export const classRankingExcelFilename = (
  rankingType: 'official' | 'custom',
  className: string,
  periodName: string,
): string => {
  const safePart = (value: string) => value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('fr')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'inconnu';
  const typeName = rankingType === 'custom' ? 'personnalise' : 'officiel';
  return `classement-${typeName}_${safePart(className)}_${safePart(periodName)}.xlsx`;
};
