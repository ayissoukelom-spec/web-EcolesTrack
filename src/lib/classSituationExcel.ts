import ExcelJS from 'exceljs';

export type ClassSituationPunctualityStatus =
  | 'overdue'
  | 'paid_late'
  | 'paid_on_time'
  | 'upcoming'
  | 'undetermined'
  | 'not_applicable';

export interface ClassSituationExcelStudent {
  firstName: string;
  lastName: string;
  className: string;
  obligationClassNames?: string[];
  studentDue: number;
  studentPaid: number;
  studentRemaining: number;
  studentStatus: 'unpaid' | 'partial' | 'paid' | 'unconfigured';
  overdueInstallmentCount: number;
  overdueInstallmentAmount: number;
  nextInstallment: { label: string; dueDate: string; remaining: number } | null;
  punctualityStatus: ClassSituationPunctualityStatus;
}

export interface ClassSituationExcelInstallment {
  firstName: string;
  lastName: string;
  obligationId: number;
  className: string | null;
  categoryLabel: string | null;
  label: string | null;
  dueDate: string | null;
  amount: number | null;
  paid: number | null;
  remaining: number | null;
  currentStatus: 'paid' | 'partial' | 'overdue' | 'pending' | 'not_applicable';
  punctualityStatus: ClassSituationPunctualityStatus;
  settledAt: string | null;
}

export interface ClassSituationExcelOptions {
  schoolName: string;
  academicYearName: string;
  className: string;
  groupByClass?: boolean;
  students: ClassSituationExcelStudent[];
  installments: ClassSituationExcelInstallment[];
}

const punctualityLabels: Record<ClassSituationPunctualityStatus, string> = {
  overdue: 'En retard',
  paid_late: 'Payée en retard',
  paid_on_time: 'Payée à temps',
  upcoming: 'À venir',
  undetermined: 'Non déterminé',
  not_applicable: 'Sans objet',
};

const studentStatusLabels: Record<ClassSituationExcelStudent['studentStatus'], string> = {
  unpaid: 'Impayé',
  partial: 'Partiel',
  paid: 'Soldé',
  unconfigured: 'Aucune obligation',
};

const installmentStatusLabels: Record<ClassSituationExcelInstallment['currentStatus'], string> = {
  paid: 'Soldée',
  partial: 'Partiellement payée',
  overdue: 'En retard',
  pending: 'À venir',
  not_applicable: 'Sans échéancier',
};

const protectTextCell = (value: string): string => (
  /^[\s]*[=+\-@]/.test(value) ? `'${value}` : value
);

const excelDate = (value: string | null): Date | null => {
  if (value == null || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value
    ? null
    : parsed;
};

const styleHeader = (row: ExcelJS.Row) => {
  row.font = { bold: true, color: { argb: 'FF1F2937' } };
  row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCE6F1' } };
  row.alignment = { vertical: 'middle', wrapText: true };
};

const applyTextProtection = (row: ExcelJS.Row, columns: number[]) => {
  for (const column of columns) {
    const cell = row.getCell(column);
    if (typeof cell.value === 'string') cell.value = protectTextCell(cell.value);
  }
};

const moneyFormat = '#,##0 "FCFA"';

export const buildClassSituationExcel = async (
  options: ClassSituationExcelOptions,
): Promise<Uint8Array> => {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'EcoleTrack';

  const situation = workbook.addWorksheet('Situation des élèves', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });
  const situationHeaders = [
    'N°',
    'Élève',
    'Classe courante',
    'Classe de l’obligation',
    'Montant dû',
    'Montant payé',
    'Reste à payer',
    'Statut',
    'Nombre d’échéances échues',
    'Montant des échéances en retard',
    'Prochaine échéance',
    'Date de la prochaine échéance',
    'Montant de la prochaine échéance',
    'Respect des délais',
    'Action',
  ];
  situation.columns = [
    { width: 7 }, { width: 28 }, { width: 18 }, { width: 28 }, { width: 18 },
    { width: 18 }, { width: 18 }, { width: 20 }, { width: 20 }, { width: 24 },
    { width: 28 }, { width: 22 }, { width: 24 }, { width: 22 }, { width: 28 },
  ];
  situation.addRow(situationHeaders);
  styleHeader(situation.getRow(1));
  const studentGroups = options.groupByClass
    ? [...options.students.reduce((groups, student) => {
      const group = groups.get(student.className) ?? [];
      group.push(student);
      groups.set(student.className, group);
      return groups;
    }, new Map<string, ClassSituationExcelStudent[]>()).entries()]
      .sort(([left], [right]) => left.localeCompare(right, 'fr'))
      .map(([className, students]) => ({ className, students }))
    : [{ className: options.className, students: options.students }];
  let studentIndex = 0;
  for (const group of studentGroups) {
    if (options.groupByClass) {
      const heading = situation.addRow([null, `Classe : ${group.className}`]);
      heading.font = { bold: true, color: { argb: 'FF1F2937' } };
      heading.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEAF0F6' } };
      applyTextProtection(heading, [2]);
    }
    for (const student of group.students) {
      studentIndex += 1;
      const row = situation.addRow([
        studentIndex,
        `${student.lastName} ${student.firstName}`,
        student.className,
        student.obligationClassNames?.join(', ') || null,
        student.studentDue,
        student.studentPaid,
        student.studentRemaining,
        studentStatusLabels[student.studentStatus],
        student.overdueInstallmentCount,
        student.overdueInstallmentAmount,
        student.nextInstallment?.label ?? null,
        excelDate(student.nextInstallment?.dueDate ?? null),
        student.nextInstallment?.remaining ?? null,
        punctualityLabels[student.punctualityStatus],
        'Voir les échéances (feuille 2)',
      ]);
      applyTextProtection(row, [2, 3, 4, 8, 11, 14, 15]);
      for (const column of [5, 6, 7, 10, 13]) row.getCell(column).numFmt = moneyFormat;
      row.getCell(9).numFmt = '0';
      row.getCell(12).numFmt = 'dd/mm/yyyy';
    }
    if (options.groupByClass) {
      const totals = group.students.reduce((result, student) => ({
        due: result.due + student.studentDue,
        paid: result.paid + student.studentPaid,
        remaining: result.remaining + student.studentRemaining,
      }), { due: 0, paid: 0, remaining: 0 });
      const subtotal = situation.addRow([
        null,
        `Sous-total — ${group.className} (${group.students.length} élève(s))`,
        null,
        null,
        totals.due,
        totals.paid,
        totals.remaining,
      ]);
      subtotal.font = { bold: true };
      subtotal.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' } };
      applyTextProtection(subtotal, [2]);
      for (const column of [5, 6, 7]) subtotal.getCell(column).numFmt = moneyFormat;
    }
  }
  if (options.groupByClass) {
    const totals = options.students.reduce((result, student) => ({
      due: result.due + student.studentDue,
      paid: result.paid + student.studentPaid,
      remaining: result.remaining + student.studentRemaining,
    }), { due: 0, paid: 0, remaining: 0 });
    const grandTotal = situation.addRow([
      null,
      `Total général établissement (${options.students.length} élève(s))`,
      null,
      null,
      totals.due,
      totals.paid,
      totals.remaining,
    ]);
    grandTotal.font = { bold: true, color: { argb: 'FF1F2937' } };
    grandTotal.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCE6F1' } };
    applyTextProtection(grandTotal, [2]);
    for (const column of [5, 6, 7]) grandTotal.getCell(column).numFmt = moneyFormat;
  } else {
    situation.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: options.students.length + 1, column: situationHeaders.length },
    };
  }

  const detail = workbook.addWorksheet('Détail des échéances', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });
  const detailHeaders = [
    'Élève',
    'N° obligation',
    'Classe',
    'Catégorie de frais',
    'Libellé de l’échéance',
    'Date limite',
    'Montant de l’échéance',
    'Montant payé net',
    'Reste à payer',
    'Statut actuel',
    'Ponctualité',
    'Date de règlement intégral',
  ];
  detail.columns = [
    { width: 28 }, { width: 16 }, { width: 18 }, { width: 26 }, { width: 28 }, { width: 16 },
    { width: 22 }, { width: 20 }, { width: 18 }, { width: 22 }, { width: 22 }, { width: 26 },
  ];
  detail.addRow(detailHeaders);
  styleHeader(detail.getRow(1));
  for (const installment of options.installments) {
    const row = detail.addRow([
      `${installment.lastName} ${installment.firstName}`,
      installment.obligationId,
      installment.className,
      installment.categoryLabel,
      installment.label,
      excelDate(installment.dueDate),
      installment.amount,
      installment.paid,
      installment.remaining,
      installmentStatusLabels[installment.currentStatus],
      punctualityLabels[installment.punctualityStatus],
      excelDate(installment.settledAt),
    ]);
    applyTextProtection(row, [1, 3, 4, 5, 10, 11]);
    for (const column of [7, 8, 9]) row.getCell(column).numFmt = moneyFormat;
    for (const column of [6, 12]) row.getCell(column).numFmt = 'dd/mm/yyyy';
  }
  detail.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: options.installments.length + 1, column: detailHeaders.length },
  };

  const summary = workbook.addWorksheet('Synthèse');
  summary.columns = [{ width: 42 }, { width: 32 }];
  summary.addRow(['Indicateur', 'Valeur']);
  styleHeader(summary.getRow(1));
  const totalDue = options.students.reduce((total, student) => total + student.studentDue, 0);
  const totalPaid = options.students.reduce((total, student) => total + student.studentPaid, 0);
  const totalRemaining = options.students.reduce((total, student) => total + student.studentRemaining, 0);
  const rows: Array<[string, string | number]> = [
    ['Établissement', options.schoolName],
    ['Année scolaire', options.academicYearName],
    ['Classe ou périmètre sélectionné', options.className],
    ['Nombre d’élèves', options.students.length],
    ['Montant total dû', totalDue],
    ['Montant total payé net', totalPaid],
    ['Reste total à payer', totalRemaining],
    ['Nombre d’échéances détaillées', options.installments.filter((row) => row.currentStatus !== 'not_applicable').length],
    ['Échéances actuellement en retard', options.installments.filter((row) => row.currentStatus === 'overdue').length],
    ['Montant des échéances actuellement en retard', options.students.reduce((total, student) => total + student.overdueInstallmentAmount, 0)],
    ['Échéances payées à temps', options.installments.filter((row) => row.punctualityStatus === 'paid_on_time').length],
    ['Échéances payées en retard', options.installments.filter((row) => row.punctualityStatus === 'paid_late').length],
    ['Échéances à venir', options.installments.filter((row) => row.punctualityStatus === 'upcoming').length],
    ['Échéances non déterminées', options.installments.filter((row) => row.punctualityStatus === 'undetermined').length],
    ['Obligations sans échéancier', options.installments.filter((row) => row.punctualityStatus === 'not_applicable').length],
  ];
  for (const [label, value] of rows) {
    const row = summary.addRow([label, value]);
    applyTextProtection(row, [1, 2]);
    if (typeof value === 'string' && row.getCell(2).value === value) {
      row.getCell(2).value = protectTextCell(value);
    }
  }
  for (const rowNumber of [6, 7, 8, 11]) summary.getCell(`B${rowNumber}`).numFmt = moneyFormat;
  summary.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: rows.length + 1, column: 2 },
  };

  return new Uint8Array(await workbook.xlsx.writeBuffer());
};
