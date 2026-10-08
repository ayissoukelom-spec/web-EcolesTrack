import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import {
  aggregateClassSituationPdfRows,
  generateClassSituationPdf,
  type ClassSituationPdfCategoryRow,
} from './classSituationPdf.ts';

const categoryRow = (
  studentId: number,
  categoryId: number,
  categoryCode: string,
  categoryLabel: string,
  due: number,
  paid: number,
  studentDue: number,
  studentPaid: number,
  studentRemaining: number,
  studentStatus: ClassSituationPdfCategoryRow['studentStatus'],
): ClassSituationPdfCategoryRow => ({
  studentId,
  firstName: studentId === 1 ? 'Kossi' : 'Ama',
  lastName: studentId === 1 ? 'Afi' : 'Binta',
  className: '6ème A',
  categoryId,
  categoryCode,
  categoryLabel,
  due,
  paid,
  studentDue,
  studentPaid,
  studentRemaining,
  studentStatus,
});

const pdfOptions = (rows: ClassSituationPdfCategoryRow[]) => ({
  schoolName: 'Établissement de test',
  academicYearName: '2026-2027',
  className: '6ème A',
  issuedAt: new Date('2026-10-08T00:00:00.000Z'),
  rows,
});

describe('class financial situation PDF', () => {
  it('keeps a student with one category on a single aggregated row', () => {
    const students = aggregateClassSituationPdfRows([
      categoryRow(1, 1, 'tuition', 'Scolarité', 100000, 100000, 100000, 100000, 0, 'paid'),
    ]);

    expect(students).toHaveLength(1);
    expect(students[0].categories).toEqual([
      expect.objectContaining({ categoryLabel: 'Scolarité', due: 100000, paid: 100000, remaining: 0 }),
    ]);
    expect(students[0]).toMatchObject({ studentDue: 100000, studentPaid: 100000, studentRemaining: 0 });
  });

  it('groups each student once with all category details and totals counted once', () => {
    const rows = [
      categoryRow(1, 1, 'tuition', 'Scolarité', 100000, 100000, 130000, 110000, 20000, 'partial'),
      categoryRow(1, 2, 'enrollment', 'Inscription', 10000, 0, 130000, 110000, 20000, 'partial'),
      categoryRow(1, 3, 'canteen', 'Cantine', 20000, 10000, 130000, 110000, 20000, 'partial'),
      categoryRow(2, 1, 'tuition', 'Scolarité', 100000, 100000, 130000, 110000, 20000, 'partial'),
      categoryRow(2, 2, 'enrollment', 'Inscription', 10000, 0, 130000, 110000, 20000, 'partial'),
      categoryRow(2, 3, 'canteen', 'Cantine', 20000, 10000, 130000, 110000, 20000, 'partial'),
    ];
    const students = aggregateClassSituationPdfRows(rows);

    expect(students).toHaveLength(2);
    expect(students.map((student) => student.studentId)).toEqual([1, 2]);
    expect(students[0].categories.map((category) => category.categoryLabel))
      .toEqual(['Scolarité', 'Inscription', 'Cantine']);
    expect(students[0].categories).toEqual([
      expect.objectContaining({ categoryLabel: 'Scolarité', due: 100000, paid: 100000, remaining: 0 }),
      expect.objectContaining({ categoryLabel: 'Inscription', due: 10000, paid: 0, remaining: 10000 }),
      expect.objectContaining({ categoryLabel: 'Cantine', due: 20000, paid: 10000, remaining: 10000 }),
    ]);
    expect(students.reduce((total, student) => total + student.studentDue, 0)).toBe(260000);
    expect(students.reduce((total, student) => total + student.studentPaid, 0)).toBe(220000);
    expect(students.reduce((total, student) => total + student.studentRemaining, 0)).toBe(40000);
    expect(students[0].studentStatus).toBe('partial');
  });

  it('creates a landscape report with one row per aggregated student and paginated rows', async () => {
    const rows = Array.from({ length: 75 }, (_, index) => categoryRow(
      index + 1,
      1,
      'tuition',
      'Scolarité',
      100000,
      40000,
      100000,
      40000,
      60000,
      'partial',
    ));
    const bytes = await generateClassSituationPdf(pdfOptions(rows));
    const pdf = await PDFDocument.load(bytes);

    expect(aggregateClassSituationPdfRows(rows)).toHaveLength(75);
    expect(pdf.getPageCount()).toBeGreaterThan(1);
    expect(pdf.getPage(0).getSize()).toEqual({ width: 842, height: 595 });
    expect(pdf.getTitle()).toBe('Situation financière de la classe - 6ème A');
  });

  it('creates a valid printable report for a class without students', async () => {
    const bytes = await generateClassSituationPdf(pdfOptions([]));
    const pdf = await PDFDocument.load(bytes);

    expect(pdf.getPageCount()).toBe(1);
    expect(pdf.getPage(0).getSize()).toEqual({ width: 842, height: 595 });
  });
});
