import ExcelJS from 'exceljs';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

export interface TeacherHoursSession {
  id: number;
  schoolId: number;
  schoolNameSnapshot: string;
  teacherId: number;
  teacherNameSnapshot: string;
  classNameSnapshot: string;
  subjectNameSnapshot: string;
  status?: string;
  startedAt: string;
  validatedEndedAt: string | null;
}

export interface TeacherHoursDetailedSession extends TeacherHoursSession {
  durationMilliseconds: number;
  cumulativeDurationMilliseconds: number;
}

export interface TeacherHoursReportIdentity {
  schoolId: number;
  schoolName: string;
  teacherId: number;
  teacherName: string;
}

export interface TeacherHoursAggregate {
  label: string;
  sessionCount: number;
  durationMilliseconds: number;
}

export interface TeacherHoursClassSubjectAggregate {
  className: string;
  subjectName: string;
  sessionCount: number;
  durationMilliseconds: number;
}

export interface TeacherHoursTeacherReport extends TeacherHoursReportIdentity {
  sessions: TeacherHoursDetailedSession[];
  sessionCount: number;
  durationMilliseconds: number;
  byClass: TeacherHoursAggregate[];
  bySubject: TeacherHoursAggregate[];
  byClassSubject: TeacherHoursClassSubjectAggregate[];
}

export interface TeacherHoursReport {
  periodLabel: string;
  scopeLabel: string;
  includeGeneralSummary: boolean;
  teachers: TeacherHoursTeacherReport[];
  sessionCount: number;
  durationMilliseconds: number;
}

export interface TeacherHoursReportOptions {
  periodLabel: string;
  scopeLabel: string;
  emptyTeacher?: TeacherHoursReportIdentity;
  teachers?: TeacherHoursReportIdentity[];
  includeGeneralSummary?: boolean;
}

const timeZone = 'Africa/Lome';
const workbookDurationFormat = '[h]" h "mm" min"';

function sessionDuration(session: TeacherHoursSession): number {
  if (!session.validatedEndedAt) return 0;
  if (session.status != null && session.status !== 'completed') return 0;
  const start = Date.parse(session.startedAt);
  const end = Date.parse(session.validatedEndedAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
    throw new Error(`Intervalle de séance invalide (#${session.id}).`);
  }
  return Math.floor((end - start) / 60_000) * 60_000;
}

function aggregateBy(
  sessions: TeacherHoursSession[],
  getLabel: (session: TeacherHoursSession) => string,
): TeacherHoursAggregate[] {
  const totals = new Map<string, TeacherHoursAggregate>();
  for (const session of sessions) {
    const label = getLabel(session) || 'Non renseigné';
    const aggregate = totals.get(label) ?? { label, sessionCount: 0, durationMilliseconds: 0 };
    aggregate.sessionCount += 1;
    aggregate.durationMilliseconds += sessionDuration(session);
    totals.set(label, aggregate);
  }
  return [...totals.values()].sort((left, right) => left.label.localeCompare(right.label, 'fr'));
}

export function formatTeacherHoursDuration(milliseconds: number): string {
  const totalMinutes = Math.floor(milliseconds / 60_000);
  return `${Math.floor(totalMinutes / 60)} h ${String(totalMinutes % 60).padStart(2, '0')} min`;
}

export function formatTeacherHoursDate(value: string, includeTime = false): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '—';
  return new Intl.DateTimeFormat('fr-FR', {
    timeZone,
    dateStyle: 'medium',
    ...(includeTime ? { timeStyle: 'short' as const } : {}),
  }).format(date);
}

export function formatTeacherHoursTime(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '—';
  return new Intl.DateTimeFormat('fr-FR', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function aggregateByClassAndSubject(sessions: TeacherHoursDetailedSession[]): TeacherHoursClassSubjectAggregate[] {
  const totals = new Map<string, TeacherHoursClassSubjectAggregate>();
  for (const session of sessions) {
    const className = session.classNameSnapshot || 'Non renseignée';
    const subjectName = session.subjectNameSnapshot || 'Non renseignée';
    const key = `${className}\u0000${subjectName}`;
    const aggregate = totals.get(key) ?? { className, subjectName, sessionCount: 0, durationMilliseconds: 0 };
    aggregate.sessionCount += 1;
    aggregate.durationMilliseconds += session.durationMilliseconds;
    totals.set(key, aggregate);
  }
  return [...totals.values()].sort((left, right) => left.className.localeCompare(right.className, 'fr')
    || left.subjectName.localeCompare(right.subjectName, 'fr'));
}

function durationInExcelDays(milliseconds: number): number {
  return milliseconds / 86_400_000;
}

function excelDateInLome(value: string): Date {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(value));
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return new Date(Date.UTC(get('year'), get('month') - 1, get('day')));
}

function excelTimeInLome(value: string | null): number | null {
  if (!value) return null;
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(value));
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return (get('hour') * 3600 + get('minute') * 60 + get('second')) / 86_400;
}

export function buildTeacherHoursReport(
  sessions: TeacherHoursSession[],
  options: TeacherHoursReportOptions,
): TeacherHoursReport {
  const grouped = new Map<string, { identity: TeacherHoursReportIdentity; sessions: TeacherHoursSession[] }>();
  for (const identity of options.teachers ?? []) {
    grouped.set(`${identity.schoolId}:${identity.teacherId}`, { identity, sessions: [] });
  }
  for (const session of sessions) {
    if (!session.validatedEndedAt || (session.status != null && session.status !== 'completed')) continue;
    sessionDuration(session);
    const key = `${session.schoolId}:${session.teacherId}`;
    const entry = grouped.get(key) ?? {
      identity: {
        schoolId: session.schoolId,
        schoolName: session.schoolNameSnapshot,
        teacherId: session.teacherId,
        teacherName: session.teacherNameSnapshot,
      },
      sessions: [],
    };
    entry.sessions.push(session);
    if (!options.teachers?.some((teacher) => `${teacher.schoolId}:${teacher.teacherId}` === key)) {
      entry.identity = {
        schoolId: session.schoolId,
        schoolName: session.schoolNameSnapshot,
        teacherId: session.teacherId,
        teacherName: session.teacherNameSnapshot,
      };
    }
    grouped.set(key, entry);
  }

  if (grouped.size === 0 && options.emptyTeacher) {
    grouped.set(`${options.emptyTeacher.schoolId}:${options.emptyTeacher.teacherId}`, {
      identity: options.emptyTeacher,
      sessions: [],
    });
  }

  const teachers = [...grouped.values()]
    .map(({ identity, sessions: teacherSessions }): TeacherHoursTeacherReport => {
      let cumulativeDurationMilliseconds = 0;
      const sortedSessions = [...teacherSessions]
        .sort((left, right) => {
        const byDate = Date.parse(left.startedAt) - Date.parse(right.startedAt);
        return byDate || left.id - right.id;
        })
        .map((session): TeacherHoursDetailedSession => {
          const durationMilliseconds = sessionDuration(session);
          cumulativeDurationMilliseconds += durationMilliseconds;
          return { ...session, durationMilliseconds, cumulativeDurationMilliseconds };
        });
      return {
        ...identity,
        sessions: sortedSessions,
        sessionCount: sortedSessions.length,
        durationMilliseconds: sortedSessions.reduce((total, session) => total + sessionDuration(session), 0),
        byClass: aggregateBy(sortedSessions, (session) => session.classNameSnapshot),
        bySubject: aggregateBy(sortedSessions, (session) => session.subjectNameSnapshot),
        byClassSubject: aggregateByClassAndSubject(sortedSessions),
      };
    })
    .sort((left, right) => left.schoolName.localeCompare(right.schoolName, 'fr')
      || left.teacherName.localeCompare(right.teacherName, 'fr')
      || left.teacherId - right.teacherId);

  return {
    periodLabel: options.periodLabel,
    scopeLabel: options.scopeLabel,
    includeGeneralSummary: options.includeGeneralSummary ?? false,
    teachers,
    sessionCount: teachers.reduce((total, teacher) => total + teacher.sessionCount, 0),
    durationMilliseconds: teachers.reduce((total, teacher) => total + teacher.durationMilliseconds, 0),
  };
}

function styleHeader(row: ExcelJS.Row): void {
  row.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF243B6B' } };
  row.alignment = { vertical: 'middle', wrapText: true };
}

function styleSection(row: ExcelJS.Row): void {
  row.font = { bold: true, size: 12, color: { argb: 'FF1E293B' } };
  row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EEF8' } };
}

export async function createTeacherHoursExcel(report: TeacherHoursReport): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'EcoleTrack';
  workbook.subject = 'Relevé des heures effectuées';

  const summary = workbook.addWorksheet('Synthèse générale');
  summary.columns = [
    { width: 32 },
    { width: 32 },
    { width: 24 },
    { width: 30 },
    { width: 24 },
  ];
  summary.addRow(['Relevé des heures effectuées']);
  summary.getCell('A1').font = { bold: true, size: 18, color: { argb: 'FF243B6B' } };
  summary.addRow(['Établissement', report.scopeLabel]);
  summary.addRow(['Période', report.periodLabel]);
  summary.addRow([]);
  const overviewTitle = summary.addRow(['Synthèse générale']);
  styleSection(overviewTitle);
  summary.addRow(['Nombre total de séances', report.sessionCount]);
  const grandTotalRow = summary.addRow(['Total général des heures et minutes effectuées', durationInExcelDays(report.durationMilliseconds)]);
  grandTotalRow.getCell(2).numFmt = workbookDurationFormat;
  const teachersHeader = summary.addRow(['Établissement', 'Enseignant', 'Nombre de séances', 'Total effectué']);
  styleHeader(teachersHeader);
  for (const teacher of report.teachers) {
    summary.addRow([
      teacher.schoolName,
      teacher.teacherName,
      teacher.sessionCount,
      durationInExcelDays(teacher.durationMilliseconds),
    ]);
    summary.getCell(summary.rowCount, 4).numFmt = workbookDurationFormat;
  }

  for (const teacher of report.teachers) {
    summary.addRow([]);
    const individualTitle = summary.addRow([`Relevé individuel - ${teacher.teacherName} - ${teacher.schoolName}`]);
    styleSection(individualTitle);
    summary.addRow(['Nombre total de séances', teacher.sessionCount]);
    const totalRow = summary.addRow(['Total des heures et minutes effectuées', durationInExcelDays(teacher.durationMilliseconds)]);
    totalRow.getCell(2).numFmt = workbookDurationFormat;

    const classSubjectTitle = summary.addRow(['Synthèse par classe et matière', 'Classe', 'Matière', 'Nombre de séances', 'Total effectué']);
    styleHeader(classSubjectTitle);
    for (const aggregate of teacher.byClassSubject) {
      const row = summary.addRow([
        '',
        aggregate.className,
        aggregate.subjectName,
        aggregate.sessionCount,
        durationInExcelDays(aggregate.durationMilliseconds),
      ]);
      row.getCell(5).numFmt = workbookDurationFormat;
    }
  }

  summary.eachRow((row) => {
    row.eachCell((cell) => {
      cell.alignment = { ...cell.alignment, vertical: 'middle', wrapText: true };
    });
  });

  const details = workbook.addWorksheet('Détail des séances');
  details.columns = [
    { width: 28 },
    { width: 28 },
    { width: 16 },
    { width: 20 },
    { width: 24 },
    { width: 15 },
    { width: 15 },
    { width: 46 },
    { width: 18 },
    { width: 24 },
    { width: 18 },
  ];
  details.addRow(['Établissement', 'Enseignant', 'Date', 'Classe', 'Matière', 'Heure de début', 'Heure de fin', 'Intervalle', 'Durée', 'Cumul progressif', 'Statut']);
  styleHeader(details.getRow(1));
  for (const teacher of report.teachers) {
    details.addRow([]);
    const section = details.addRow([`Relevé de ${teacher.teacherName} - ${teacher.schoolName}`]);
    styleSection(section);
    for (const session of teacher.sessions) {
      const end = session.validatedEndedAt;
      const duration = sessionDuration(session);
      const row = details.addRow([
        teacher.schoolName,
        teacher.teacherName,
        excelDateInLome(session.startedAt),
        session.classNameSnapshot || 'Non renseignée',
        session.subjectNameSnapshot || 'Non renseignée',
        excelTimeInLome(session.startedAt),
        excelTimeInLome(end),
        end
          ? `${formatTeacherHoursDate(session.startedAt, true)} - ${formatTeacherHoursDate(end, true)}`
          : `${formatTeacherHoursDate(session.startedAt, true)} - En cours`,
        durationInExcelDays(duration),
        durationInExcelDays(session.cumulativeDurationMilliseconds),
        'Terminée et validée',
      ]);
      row.getCell(3).numFmt = 'dd/mm/yyyy';
      row.getCell(6).numFmt = 'hh:mm';
      row.getCell(7).numFmt = 'hh:mm';
      row.getCell(9).numFmt = workbookDurationFormat;
      row.getCell(10).numFmt = workbookDurationFormat;
    }
  }
  details.views = [{ state: 'frozen', ySplit: 1 }];
  details.autoFilter = { from: 'A1', to: 'K1' };
  details.eachRow((row) => row.eachCell((cell) => {
    cell.alignment = { ...cell.alignment, vertical: 'middle', wrapText: true };
  }));
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}

const pdfPageSize: [number, number] = [841.89, 595.28];
const pdfMargin = 30;
const pdfInk = rgb(0.12, 0.18, 0.31);
const pdfMuted = rgb(0.35, 0.39, 0.47);
const pdfRule = rgb(0.78, 0.81, 0.86);
const pdfHeader = rgb(0.90, 0.93, 0.97);

function fitPdfText(text: string, font: Awaited<ReturnType<PDFDocument['embedFont']>>, size: number, maxWidth: number): string {
  let value = text
    .replace(/[—–]/g, '-')
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[Œœ]/g, (character) => character === 'Œ' ? 'OE' : 'oe')
    .replace(/[^\x20-\xFF]/g, '?');
  while (value.length > 0 && font.widthOfTextAtSize(value, size) > maxWidth) {
    value = `${value.slice(0, -4)}...`;
  }
  return value;
}

export async function createTeacherHoursPdf(report: TeacherHoursReport): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle('Relevé des heures effectuées');
  pdf.setSubject(report.periodLabel);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const pages: ReturnType<typeof pdf.addPage>[] = [];
  let page: ReturnType<typeof pdf.addPage>;
  let y: number;

  const newPage = () => {
    page = pdf.addPage(pdfPageSize);
    pages.push(page);
    y = pdfPageSize[1] - pdfMargin;
  };
  const drawText = (text: string, x: number, baseline: number, size = 9, strong = false, color = pdfInk, maxWidth = 750) => {
    const font = strong ? bold : regular;
    page.drawText(fitPdfText(text, font, size, maxWidth), { x, y: baseline, size, font, color });
  };
  const drawTableHeader = (columns: Array<{ label: string; width: number }>, top: number) => {
    let x = pdfMargin;
    const rowHeight = 23;
    page.drawRectangle({ x: pdfMargin, y: top - rowHeight, width: pdfPageSize[0] - pdfMargin * 2, height: rowHeight, color: pdfHeader });
    for (const column of columns) {
      drawText(column.label, x + 4, top - 15, 8, true, pdfInk, column.width - 8);
      x += column.width;
    }
    return top - rowHeight;
  };
  const drawTeacherHeading = (teacher: TeacherHoursTeacherReport, continuation = false) => {
    drawText('Relevé des heures effectuées', pdfMargin, y, 18, true, pdfInk);
    y -= 25;
    drawText(`Établissement : ${teacher.schoolName}`, pdfMargin, y, 10, true);
    y -= 16;
    drawText(`Enseignant : ${teacher.teacherName}`, pdfMargin, y, 10, true);
    y -= 16;
    drawText(`Période : ${report.periodLabel}${continuation ? ' - suite' : ''}`, pdfMargin, y, 9, false, pdfMuted);
    y -= 15;
    drawText(`Séances : ${teacher.sessionCount}   Total effectué : ${formatTeacherHoursDuration(teacher.durationMilliseconds)}`, pdfMargin, y, 10, true, pdfInk);
    y -= 20;
  };
  const detailColumns = [
    { label: 'Date', width: 65 },
    { label: 'Classe', width: 80 },
    { label: 'Matière', width: 100 },
    { label: 'Début', width: 45 },
    { label: 'Fin', width: 45 },
    { label: 'Intervalle', width: 220 },
    { label: 'Durée', width: 65 },
    { label: 'Cumul', width: 75 },
  ];
  const detailWidth = detailColumns.reduce((total, column) => total + column.width, 0);
  const drawDetailsHeader = () => {
    y = drawTableHeader(detailColumns, y);
    y -= 3;
  };
  const drawSummaryTable = (
    teacher: TeacherHoursTeacherReport,
    title: string,
    entries: TeacherHoursClassSubjectAggregate[],
  ) => {
    const drawHeading = (continued: boolean) => {
      if (continued) drawTeacherHeading(teacher, true);
      drawText(`${title}${continued ? ' - suite' : ''}`, pdfMargin, y, 11, true);
      y -= 16;
    };
    if (y < pdfMargin + 52) {
      newPage();
      drawHeading(true);
    } else {
      drawHeading(false);
    }
    const columns = [
      { label: 'Classe', width: 200 },
      { label: 'Matière', width: 210 },
      { label: 'Séances', width: 90 },
      { label: 'Total effectué', width: detailWidth - 500 },
    ];
    y = drawTableHeader(columns, y);
    y -= 3;
    for (const entry of entries) {
      if (y < pdfMargin + 18) {
        newPage();
        drawTeacherHeading(teacher, true);
        drawText(`${title} - suite`, pdfMargin, y, 11, true);
        y -= 16;
        y = drawTableHeader(columns, y);
        y -= 3;
      }
      let x = pdfMargin;
      const values = [
        entry.className,
        entry.subjectName,
        String(entry.sessionCount),
        formatTeacherHoursDuration(entry.durationMilliseconds),
      ];
      values.forEach((value, index) => {
        drawText(value, x + 4, y - 12, 8, index === 3, pdfInk, columns[index].width - 8);
        x += columns[index].width;
      });
      page.drawLine({ start: { x: pdfMargin, y: y - 17 }, end: { x: pdfMargin + detailWidth, y: y - 17 }, thickness: 0.4, color: pdfRule });
      y -= 19;
    }
    y -= 9;
  };

  if (report.includeGeneralSummary) {
    newPage();
    drawText('Relevé des heures effectuées', pdfMargin, y, 18, true, pdfInk);
    y -= 28;
    drawText(`Établissement : ${report.scopeLabel}`, pdfMargin, y, 10, true);
    y -= 17;
    drawText(`Période : ${report.periodLabel}`, pdfMargin, y, 9, false, pdfMuted);
    y -= 22;
    drawText(`Total général : ${report.sessionCount} séance(s) - ${formatTeacherHoursDuration(report.durationMilliseconds)}`, pdfMargin, y, 12, true);
    y -= 25;
    const overviewColumns = [
      { label: 'Établissement', width: 200 },
      { label: 'Enseignant', width: 220 },
      { label: 'Séances', width: 100 },
      { label: 'Total effectué', width: 180 },
    ];
    y = drawTableHeader(overviewColumns, y);
    y -= 3;
    for (const teacher of report.teachers) {
      if (y < pdfMargin + 18) {
        newPage();
        drawText('Synthèse générale - suite', pdfMargin, y, 12, true);
        y -= 20;
        y = drawTableHeader(overviewColumns, y);
        y -= 3;
      }
      const values = [
        teacher.schoolName,
        teacher.teacherName,
        String(teacher.sessionCount),
        formatTeacherHoursDuration(teacher.durationMilliseconds),
      ];
      let x = pdfMargin;
      values.forEach((value, index) => {
        drawText(value, x + 4, y - 11, 8, index === 3, pdfInk, overviewColumns[index].width - 8);
        x += overviewColumns[index].width;
      });
      page.drawLine({ start: { x: pdfMargin, y: y - 17 }, end: { x: pdfMargin + 700, y: y - 17 }, thickness: 0.4, color: pdfRule });
      y -= 20;
    }
  }

  for (const teacher of report.teachers) {
    newPage();
    drawTeacherHeading(teacher);
    drawDetailsHeader();
    for (const session of teacher.sessions) {
      if (y < pdfMargin + 20) {
        newPage();
        drawTeacherHeading(teacher, true);
        drawDetailsHeader();
      }
      const end = session.validatedEndedAt;
      const duration = sessionDuration(session);
      const values = [
        formatTeacherHoursDate(session.startedAt),
        session.classNameSnapshot || 'Non renseignee',
        session.subjectNameSnapshot || 'Non renseignee',
        formatTeacherHoursTime(session.startedAt),
        formatTeacherHoursTime(end),
        end
          ? `${formatTeacherHoursDate(session.startedAt, true)} - ${formatTeacherHoursDate(end, true)}`
          : `${formatTeacherHoursDate(session.startedAt, true)} - En cours`,
        end ? formatTeacherHoursDuration(duration) : 'Non validee',
        formatTeacherHoursDuration(session.cumulativeDurationMilliseconds),
      ];
      let x = pdfMargin;
      values.forEach((value, index) => {
        drawText(value, x + 4, y - 11, 7.5, false, pdfInk, detailColumns[index].width - 8);
        x += detailColumns[index].width;
      });
      page.drawLine({ start: { x: pdfMargin, y: y - 17 }, end: { x: pdfMargin + detailWidth, y: y - 17 }, thickness: 0.4, color: pdfRule });
      y -= 20;
    }
    y -= 12;
    drawSummaryTable(teacher, 'Synthèse par classe et matière', teacher.byClassSubject);
    if (y < pdfMargin + 35) {
      newPage();
      drawTeacherHeading(teacher, true);
    }
    page.drawRectangle({
      x: pdfMargin,
      y: y - 24,
      width: detailWidth,
      height: 28,
      color: rgb(0.91, 0.95, 0.92),
      borderColor: rgb(0.60, 0.72, 0.64),
      borderWidth: 0.8,
    });
    drawText(`SOLDE FINAL : ${teacher.sessionCount} seance(s) - ${formatTeacherHoursDuration(teacher.durationMilliseconds)}`, pdfMargin + 9, y - 14, 11, true, pdfInk, detailWidth - 18);
  }

  if (pages.length === 0) {
    newPage();
    drawText('Relevé des heures effectuées', pdfMargin, y, 18, true);
    y -= 30;
    drawText(`Établissement : ${report.scopeLabel}`, pdfMargin, y, 10, true);
    y -= 18;
    drawText(`Période : ${report.periodLabel}`, pdfMargin, y, 10);
    y -= 24;
    drawText('Aucune séance pour cette période.', pdfMargin, y, 10, false, pdfMuted);
    y -= 22;
    drawText(`TOTAL GENERAL : 0 seance - ${formatTeacherHoursDuration(report.durationMilliseconds)}`, pdfMargin, y, 12, true);
  }

  pages.forEach((pdfPage, index) => {
    const pageLabel = `Page ${index + 1} / ${pages.length}`;
    pdfPage.drawText(pageLabel, {
      x: pdfPageSize[0] - pdfMargin - regular.widthOfTextAtSize(pageLabel, 8),
      y: 14,
      size: 8,
      font: regular,
      color: pdfMuted,
    });
  });
  return new Uint8Array(await pdf.save());
}
