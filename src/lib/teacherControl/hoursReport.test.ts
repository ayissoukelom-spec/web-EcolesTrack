import { PDFDocument } from 'pdf-lib';
import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import {
  buildTeacherHoursReport,
  createTeacherHoursExcel,
  createTeacherHoursPdf,
  formatTeacherHoursDuration,
  type TeacherHoursSession,
} from './hoursReport.ts';

const sessions: TeacherHoursSession[] = [
  {
    id: 2,
    schoolId: 8,
    schoolNameSnapshot: 'École A',
    teacherId: 20,
    teacherNameSnapshot: 'Afi Mensah',
    classNameSnapshot: '6e A',
    subjectNameSnapshot: 'Mathématiques',
    status: 'completed',
    startedAt: '2026-10-31T10:00:00.000Z',
    validatedEndedAt: '2026-10-31T11:15:00.000Z',
  },
  {
    id: 1,
    schoolId: 8,
    schoolNameSnapshot: 'École A',
    teacherId: 20,
    teacherNameSnapshot: 'Afi Mensah',
    classNameSnapshot: '6e A',
    subjectNameSnapshot: 'Mathématiques',
    status: 'completed',
    startedAt: '2026-10-30T08:00:00.000Z',
    validatedEndedAt: '2026-10-30T10:00:00.000Z',
  },
  {
    id: 3,
    schoolId: 8,
    schoolNameSnapshot: 'École A',
    teacherId: 21,
    teacherNameSnapshot: 'Kossi Agbo',
    classNameSnapshot: '5e B',
    subjectNameSnapshot: 'Histoire',
    status: 'completed',
    startedAt: '2026-10-31T08:00:00.000Z',
    validatedEndedAt: '2026-10-31T08:30:00.000Z',
  },
];

function excelDurationMilliseconds(value: unknown): number {
  if (value instanceof Date) {
    const datePart = Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()) - Date.UTC(1899, 11, 30);
    const timePart = ((value.getUTCHours() * 60 + value.getUTCMinutes()) * 60 + value.getUTCSeconds()) / 86_400;
    return (datePart / 86_400_000 + timePart) * 86_400_000;
  }
  return Number(value) * 86_400_000;
}

describe('teacher hours reports', () => {
  it('builds chronological individual reports and shared class, subject, and grand totals', () => {
    const report = buildTeacherHoursReport(sessions, {
      periodLabel: 'Du 2026-10-30 au 2026-10-31 (UTC)',
      scopeLabel: 'École A',
      teachers: [
        { schoolId: 8, schoolName: 'École A', teacherId: 20, teacherName: 'Afi Mensah' },
        { schoolId: 8, schoolName: 'École A', teacherId: 21, teacherName: 'Kossi Agbo' },
      ],
    });

    expect(report.sessionCount).toBe(3);
    expect(report.durationMilliseconds).toBe(225 * 60_000);
    expect(report.teachers.map(({ teacherName }) => teacherName)).toEqual(['Afi Mensah', 'Kossi Agbo']);
    expect(report.teachers[0].sessions.map(({ id }) => id)).toEqual([1, 2]);
    expect(report.teachers[0].sessions.map(({ durationMilliseconds, cumulativeDurationMilliseconds }) => [
      durationMilliseconds,
      cumulativeDurationMilliseconds,
    ])).toEqual([
      [120 * 60_000, 120 * 60_000],
      [75 * 60_000, 195 * 60_000],
    ]);
    expect(report.teachers[0].byClass).toEqual([
      { label: '6e A', sessionCount: 2, durationMilliseconds: 195 * 60_000 },
    ]);
    expect(report.teachers[0].bySubject).toEqual([
      { label: 'Mathématiques', sessionCount: 2, durationMilliseconds: 195 * 60_000 },
    ]);
    expect(report.teachers[0].byClassSubject).toEqual([
      { className: '6e A', subjectName: 'Mathématiques', sessionCount: 2, durationMilliseconds: 195 * 60_000 },
    ]);
    expect(report.teachers[1].durationMilliseconds).toBe(30 * 60_000);
    expect(report.teachers[1].sessions[0].cumulativeDurationMilliseconds).toBe(30 * 60_000);
    expect(formatTeacherHoursDuration(report.durationMilliseconds)).toBe('3 h 45 min');
  });

  it('creates a two-sheet Excel workbook with general and individual summaries', async () => {
    const report = buildTeacherHoursReport(sessions, {
      periodLabel: 'Du 2026-10-30 au 2026-10-31 (UTC)',
      scopeLabel: 'École A',
      teachers: [
        { schoolId: 8, schoolName: 'École A', teacherId: 20, teacherName: 'Afi Mensah' },
        { schoolId: 8, schoolName: 'École A', teacherId: 21, teacherName: 'Kossi Agbo' },
      ],
    });
    const bytes = await createTeacherHoursExcel(report);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.from(bytes));

    expect(workbook.worksheets.map(({ name }) => name)).toEqual(['Synthèse générale', 'Détail des séances']);
    const summary = workbook.getWorksheet('Synthèse générale');
    expect(summary?.getCell('A1').value).toBe('Relevé des heures effectuées');
    expect(summary?.getCell('A6').value).toBe('Nombre total de séances');
    expect(summary?.getCell('B6').value).toBe(3);
    expect(summary?.getCell('A7').value).toBe('Total général des heures et minutes effectuées');
    expect(excelDurationMilliseconds(summary?.getCell('B7').value)).toBeCloseTo(report.durationMilliseconds, 5);
    expect(summary?.getCell('B9').value).toBe('Afi Mensah');
    expect(excelDurationMilliseconds(summary?.getCell('E16').value)).toBeCloseTo(report.teachers[0].durationMilliseconds, 5);
    expect(excelDurationMilliseconds(summary?.getCell('E22').value)).toBeCloseTo(report.teachers[1].durationMilliseconds, 5);

    const detailRows = workbook.getWorksheet('Détail des séances');
    expect(detailRows?.getRow(1).values).toContain('Cumul progressif');
    expect(detailRows?.getCell('D4').value).toBe('6e A');
    expect(detailRows?.getCell('C4').value).toBeInstanceOf(Date);
    expect(detailRows?.getCell('C4').numFmt).toBe('dd/mm/yyyy');
    expect(detailRows?.getCell('F4').numFmt).toBe('hh:mm');
    expect(excelDurationMilliseconds(detailRows?.getCell('I4').value)).toBeCloseTo(120 * 60_000, 5);
    expect(excelDurationMilliseconds(detailRows?.getCell('J4').value)).toBeCloseTo(120 * 60_000, 5);
    expect(excelDurationMilliseconds(detailRows?.getCell('J5').value)).toBeCloseTo(195 * 60_000, 5);
    expect(excelDurationMilliseconds(detailRows?.getCell('J8').value)).toBeCloseTo(30 * 60_000, 5);
    expect(detailRows?.getRows(1, detailRows.rowCount)?.some((row) => (
      Array.isArray(row.values) && row.values.includes('Mathématiques')
    ))).toBe(true);
  });

  it('creates a paginated PDF for the same report model and total', async () => {
    const report = buildTeacherHoursReport(sessions, {
      periodLabel: 'Du 2026-10-30 au 2026-10-31 (UTC)',
      scopeLabel: 'École A',
      teachers: [
        { schoolId: 8, schoolName: 'École A', teacherId: 20, teacherName: 'Afi Mensah' },
        { schoolId: 8, schoolName: 'École A', teacherId: 21, teacherName: 'Kossi Agbo' },
      ],
      includeGeneralSummary: true,
    });
    const bytes = await createTeacherHoursPdf(report);
    const pdf = await PDFDocument.load(bytes);

    expect(pdf.getTitle()).toBe('Relevé des heures effectuées');
    expect(pdf.getPageCount()).toBe(3);
    expect(bytes.byteLength).toBeGreaterThan(1000);
    expect(report.durationMilliseconds).toBe(225 * 60_000);
  });

  it('exports the corrected validated interval instead of the original end time', async () => {
    const report = buildTeacherHoursReport([{
      ...sessions[0],
      validatedEndedAt: '2026-10-31T11:00:00.000Z',
    }], {
      periodLabel: 'Du 2026-10-31 au 2026-10-31 (UTC)',
      scopeLabel: 'École A',
    });
    expect(report.durationMilliseconds).toBe(60 * 60_000);

    const bytes = await createTeacherHoursExcel(report);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.from(bytes));
    expect(excelDurationMilliseconds(workbook.getWorksheet('Synthèse générale')?.getCell('B7').value))
      .toBeCloseTo(60 * 60_000, 5);
  });

  it('includes an explicit zero-session individual report and rejects invalid intervals', () => {
    const empty = buildTeacherHoursReport([], {
      periodLabel: 'Toute la période',
      scopeLabel: 'École A',
      emptyTeacher: { schoolId: 8, schoolName: 'École A', teacherId: 20, teacherName: 'Afi Mensah' },
    });
    expect(empty.teachers).toHaveLength(1);
    expect(empty.teachers[0].sessionCount).toBe(0);
    expect(empty.durationMilliseconds).toBe(0);

    expect(() => buildTeacherHoursReport([{
      ...sessions[0],
      validatedEndedAt: '2026-10-30T07:00:00.000Z',
    }], { periodLabel: 'Période', scopeLabel: 'École A' })).toThrow(/Intervalle de séance invalide/);
  });
});
