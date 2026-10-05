import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { readFirstExcelSheetRecords } from './excelImport';

describe('readFirstExcelSheetRecords', () => {
  it('reads the first worksheet and preserves headers without prototype setters', async () => {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Import');
    worksheet.addRow(['firstName', '__proto__', 'constructor', 'firstName', 'birthDate']);
    worksheet.addRow(['Awa', 'unexpected', 'also-unexpected', 'Kossi', new Date('2008-04-12T00:00:00.000Z')]);
    worksheet.getCell(2, 5).numFmt = 'yyyy-mm-dd';

    const buffer = await workbook.xlsx.writeBuffer();
    const records = await readFirstExcelSheetRecords(buffer);

    expect(records).toHaveLength(1);
    expect(Object.keys(records[0])).toEqual(['firstName', '__proto__', 'constructor', 'firstName_1', 'birthDate']);
    expect(records[0].firstName).toBe('Awa');
    expect(records[0]['__proto__']).toBe('unexpected');
    expect(records[0].constructor).toBe('also-unexpected');
    expect(records[0].firstName_1).toBe('Kossi');
    expect(records[0].birthDate).toBe('2008-04-12');
    expect(Object.getPrototypeOf(records[0])).toBeNull();
    expect(({} as { unexpected?: string }).unexpected).toBeUndefined();
  });

  it('returns an empty list when the workbook has no worksheets', async () => {
    const workbook = new ExcelJS.Workbook();
    const buffer = await workbook.xlsx.writeBuffer();

    const records = await readFirstExcelSheetRecords(buffer);

    expect(records).toEqual([]);
  });
});
