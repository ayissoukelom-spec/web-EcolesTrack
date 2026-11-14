import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { buildClassSituationExcel } from './classSituationExcel.ts';

describe('class situation Excel export', () => {
  it('creates three filtered-data sheets with the original columns, numeric totals, details, and safe text', async () => {
    const bytes = await buildClassSituationExcel({
      schoolName: '=HYPERLINK("https://example.invalid")',
      academicYearName: '2026-2027',
      className: '6e',
      students: [
        {
          firstName: 'Afi',
          lastName: 'Doe',
          className: '6e',
          obligationClassNames: ['6e'],
          studentDue: 100,
          studentPaid: 100,
          studentRemaining: 0,
          studentStatus: 'paid',
          overdueInstallmentCount: 0,
          overdueInstallmentAmount: 0,
          nextInstallment: null,
          punctualityStatus: 'paid_on_time',
        },
        {
          firstName: 'Ama',
          lastName: '=2+2',
          className: '+1+1',
          obligationClassNames: ['6e'],
          studentDue: 250,
          studentPaid: 50,
          studentRemaining: 200,
          studentStatus: 'partial',
          overdueInstallmentCount: 1,
          overdueInstallmentAmount: 200,
          nextInstallment: { label: 'Tranche future', dueDate: '2026-12-01', remaining: 200 },
          punctualityStatus: 'undetermined',
        },
      ],
      installments: [
        {
          firstName: 'Afi',
          lastName: 'Doe',
          obligationId: 81,
          className: '6e',
          categoryLabel: 'Scolarité',
          label: 'Tranche 1',
          dueDate: '2026-10-01',
          amount: 100,
          paid: 100,
          remaining: 0,
          currentStatus: 'paid',
          punctualityStatus: 'paid_on_time',
          settledAt: '2026-09-20',
        },
        {
          firstName: 'Ama',
          lastName: '=2+2',
          obligationId: 82,
          className: '+1+1',
          categoryLabel: '=CMD()',
          label: null,
          dueDate: null,
          amount: null,
          paid: null,
          remaining: null,
          currentStatus: 'overdue',
          punctualityStatus: 'undetermined',
          settledAt: null,
        },
        {
          firstName: 'Ama',
          lastName: '=2+2',
          obligationId: 83,
          className: '+1+1',
          categoryLabel: 'Frais personnalisés',
          label: null,
          dueDate: null,
          amount: null,
          paid: null,
          remaining: null,
          currentStatus: 'not_applicable',
          punctualityStatus: 'not_applicable',
          settledAt: null,
        },
      ],
    });

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.from(bytes));

    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
      'Situation des élèves',
      'Détail des échéances',
      'Synthèse',
    ]);

    const situation = workbook.getWorksheet('Situation des élèves')!;
    expect(Array.from({ length: 8 }, (_, index) => situation.getCell(1, index + 1).value)).toEqual([
      'N°',
      'Élève',
      'Classe courante',
      'Classe de l’obligation',
      'Montant dû',
      'Montant payé',
      'Reste à payer',
      'Statut',
    ]);
    expect(situation.rowCount).toBe(3);
    expect(situation.getCell('B3').value).toBe("'=2+2 Ama");
    expect(situation.getCell('C3').value).toBe("'+1+1");
    expect(situation.getCell('E3').value).toBe(250);
    expect(situation.getCell('K3').value).toBe('Tranche future');
    expect(situation.getCell('L3').value).toBeInstanceOf(Date);
    expect(situation.getCell('M3').value).toBe(200);
    expect(situation.autoFilter).toBeDefined();

    const detail = workbook.getWorksheet('Détail des échéances')!;
    expect(detail.rowCount).toBe(4);
    expect(detail.getCell('G2').value).toBe(100);
    expect(detail.getCell('F2').value).toBeInstanceOf(Date);
    expect(detail.getCell('L2').value).toBeInstanceOf(Date);
    expect(detail.getCell('K3').value).toBe('Non déterminé');
    expect(detail.getCell('F3').value).toBeNull();
    expect(detail.getCell('L3').value).toBeNull();
    expect(detail.getCell('D3').value).toBe("'=CMD()");
    expect(detail.getCell('J4').value).toBe('Sans échéancier');

    const summary = workbook.getWorksheet('Synthèse')!;
    expect(summary.getCell('B2').value).toBe('\'=HYPERLINK("https://example.invalid")');
    expect(summary.getCell('B6').value).toBe(350);
    expect(summary.getCell('B7').value).toBe(150);
    expect(summary.getCell('B8').value).toBe(200);
    expect(summary.getCell('B11').value).toBe(200);
    expect(summary.getCell('B9').value).toBe(2);
    expect(summary.getCell('B16').value).toBe(1);
    expect(summary.autoFilter).toBeDefined();
  });
});
