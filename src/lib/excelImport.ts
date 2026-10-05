import ExcelJS from 'exceljs';

const toCellValue = (value: ExcelJS.CellValue): unknown => {
  if (value == null) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value !== 'object') return value;
  if ('result' in value) return toCellValue(value.result ?? '');
  if ('richText' in value) return value.richText.map((part) => part.text).join('');
  if ('text' in value) return value.text;
  return '';
};

export async function readFirstExcelSheetRecords(data: ArrayBuffer): Promise<Record<string, unknown>[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(data);
  const worksheet = workbook.worksheets[0];
  if (!worksheet) return [];

  const headerKeys = new Map<number, string>();
  const headerOccurrences = new Map<string, number>();
  for (let columnIndex = 1; columnIndex <= worksheet.columnCount; columnIndex += 1) {
    const header = String(worksheet.getCell(1, columnIndex).text || '').trim();
    if (!header) continue;
    const occurrence = headerOccurrences.get(header) ?? 0;
    headerOccurrences.set(header, occurrence + 1);
    headerKeys.set(columnIndex, occurrence === 0 ? header : `${header}_${occurrence}`);
  }

  const records: Record<string, unknown>[] = [];
  for (let rowIndex = 2; rowIndex <= worksheet.rowCount; rowIndex += 1) {
    const record = Object.create(null) as Record<string, unknown>;
    let hasValue = false;
    for (const [columnIndex, header] of headerKeys) {
      const value = toCellValue(worksheet.getCell(rowIndex, columnIndex).value);
      record[header] = value;
      if (value !== '') hasValue = true;
    }
    if (hasValue) records.push(record);
  }

  return records;
}
