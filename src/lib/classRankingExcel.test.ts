import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { buildClassRankingExcel, classRankingExcelFilename } from './classRankingExcel';

describe('class ranking Excel export', () => {
  it('creates a valid custom-ranking workbook with numeric averages, ties and blank missing values', async () => {
    const bytes = await buildClassRankingExcel({
      schoolName: 'École A',
      className: '3ème A',
      periodName: 'Trimestre 1',
      rankingType: 'custom',
      generatedAt: new Date('2026-11-10T12:00:00.000Z'),
      subjectNames: ['Mathématiques', 'Français'],
      evaluations: [
        { subject: 'Mathématiques', title: 'Composition 1' },
        { subject: 'Français', title: 'Devoir 1' },
      ],
      students: [
        { rank: '1er', matricule: 'E001', fullName: 'Alice Akakpo', subjectAverages: [18, 14], average: 16 },
        { rank: '1er', matricule: 'E002', fullName: 'Benoît Zinsou', subjectAverages: [16, null], average: 16 },
        { rank: '—', matricule: '', fullName: 'Sans Note', subjectAverages: [null, null], average: null },
      ],
    });

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.from(bytes));
    const worksheet = workbook.getWorksheet('Résultats');
    expect(worksheet).toBeTruthy();
    expect(worksheet?.getCell('A1').value).toBe('Classement personnalisé — non officiel');
    expect(worksheet?.getCell('B2').value).toBe('École A');
    expect(worksheet?.getCell('B3').value).toBe('3ème A');
    expect(worksheet?.getCell('B4').value).toBe('Trimestre 1');
    expect(worksheet?.getCell('A7').value).toBe('Évaluations sélectionnées');
    expect(worksheet?.getCell('A8').value).toBe('Mathématiques');
    expect(worksheet?.getCell('B8').value).toBe('Composition 1');
    expect(worksheet?.getRow(11).values).toEqual([
      undefined,
      'Rang',
      'Matricule',
      'Nom et prénom',
      'Mathématiques',
      'Français',
      'Moyenne générale sur 20',
    ]);
    expect(worksheet?.getCell('D12').value).toBe(18);
    expect(typeof worksheet?.getCell('D12').value).toBe('number');
    expect(worksheet?.getCell('F12').value).toBe(16);
    expect(worksheet?.getCell('A13').value).toBe('1er');
    expect(worksheet?.getCell('E13').value).toBeNull();
    expect(worksheet?.getCell('A14').value).toBe('—');
    expect(worksheet?.getCell('F14').value).toBeNull();
    expect(worksheet?.getCell('D12').numFmt).toBe('0.00');
    expect(worksheet?.views).toBeNull();
  });

  it('creates an official-ranking workbook and an explicit sanitized filename', async () => {
    const bytes = await buildClassRankingExcel({
      schoolName: 'École B',
      className: '6ème B',
      periodName: 'Semestre 2',
      rankingType: 'official',
      generatedAt: new Date('2026-11-10T12:00:00.000Z'),
      subjectNames: [],
      students: [
        { rank: '2e', matricule: 'E010', fullName: 'Élève Test', subjectAverages: [], average: 13.25 },
      ],
    });

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.from(bytes));
    const worksheet = workbook.getWorksheet('Résultats');
    expect(worksheet?.getCell('A1').value).toBe('Classement officiel');
    expect(worksheet?.getRow(8).values).toEqual([
      undefined,
      'Rang',
      'Matricule',
      'Nom et prénom',
      'Moyenne générale sur 20',
    ]);
    expect(worksheet?.getCell('D9').value).toBe(13.25);
    expect(worksheet?.views).toBeNull();
    expect(classRankingExcelFilename('official', '6ème B', 'Semestre 2'))
      .toBe('classement-officiel_6eme-b_semestre-2.xlsx');
  });
});
