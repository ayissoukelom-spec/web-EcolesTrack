import type express from 'express';
import { and, eq, or, sql, type SQL } from 'drizzle-orm';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { readFile } from 'node:fs/promises';
import { db } from '../db/index.ts';
import { requireOwnership, requireRole, verifyToken } from '../middleware/auth.ts';
import { isBulletinOwnedByCurrentUser } from './bulletinAccess.ts';
import {
  academicYears,
  bulletinLines,
  bulletins,
  classes,
  evaluations,
  grades,
  parents,
  schoolClasses,
  schools,
  schoolTerms,
  students,
} from '../db/schema.ts';
import studentAccess from './studentAccess';

export interface BulletinPdfActor {
  id?: number | null;
  role: string;
  schoolId?: number | null;
}

export interface BulletinPdfLine {
  id: number;
  bulletinId: number;
  subjectId: number | null;
  subjectName: string;
  coefficient: number;
  average: number | null;
  teacherComment: string | null;
  rank: number | null;
}

export interface BulletinPdfData {
  id: number;
  studentId: number;
  studentName: string;
  classId: number;
  className: string;
  schoolName: string;
  schoolYearId: number;
  schoolYearName: string;
  termId: number;
  termName: string;
  average: number | null;
  totalPoints: number;
  totalCoefficients: number;
  rank: number | null;
  mention: string | null;
  appreciation: string | null;
  generatedAt: string | null;
  lines: BulletinPdfLine[];
}

export interface BulletinPdfDataProvider {
  getById(actor: BulletinPdfActor, bulletinId: number): Promise<BulletinPdfData | null>;
}

export interface BulletinPdfTemplate {
  primaryColor: string;
  secondaryColor: string;
  textColor: string;
  labels: {
    title: string;
    schoolYear: string;
    term: string;
    student: string;
    class: string;
    average: string;
    rank: string;
    mention: string;
    appreciation: string;
    generationDate: string;
    subject: string;
    coefficient: string;
    subjectAverage: string;
    teacherComment: string;
    signatureSchool: string;
    signatureParent: string;
  };
  logoFilePath?: string;
}

const DEFAULT_TEMPLATE: BulletinPdfTemplate = {
  primaryColor: '#1f3a8a',
  secondaryColor: '#e2e8f0',
  textColor: '#0f172a',
  labels: {
    title: 'Bulletin scolaire',
    schoolYear: 'Année scolaire',
    term: 'Trimestre',
    student: 'Élève',
    class: 'Classe',
    average: 'Moyenne générale',
    rank: 'Rang',
    mention: 'Mention',
    appreciation: 'Appréciation générale',
    generationDate: 'Date de génération',
    subject: 'Matière',
    coefficient: 'Coef',
    subjectAverage: 'Moyenne',
    teacherComment: 'Appréciation',
    signatureSchool: 'Signature de l établissement',
    signatureParent: 'Signature du parent',
  },
};

const parseNumber = (value: unknown): number | null => {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const parseNumericScore = (score: string): number | null => {
  const normalized = String(score || '').trim().replace(',', '.');
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
};

const buildFallbackLinesFromGrades = (
  rows: Array<{ subject: string; coefficient: number; maxScore: number; score: string }>,
): BulletinPdfLine[] => {
  const bySubject = new Map<string, { coefficient: number; weighted: number; weightedCoefficient: number }>();

  for (const row of rows) {
    const coefficient = Number(row.coefficient || 0);
    const maxScore = Number(row.maxScore || 0);
    const rawScore = parseNumericScore(row.score);
    if (!(coefficient > 0) || !(maxScore > 0) || rawScore == null) continue;

    const normalizedScore = (rawScore / maxScore) * 20;
    const current = bySubject.get(row.subject) ?? { coefficient: 0, weighted: 0, weightedCoefficient: 0 };
    current.coefficient += coefficient;
    current.weighted += normalizedScore * coefficient;
    current.weightedCoefficient += coefficient;
    bySubject.set(row.subject, current);
  }

  let runningId = 1;
  return Array.from(bySubject.entries()).map(([subjectName, agg]) => ({
    id: runningId++,
    bulletinId: 0,
    subjectId: null,
    subjectName,
    coefficient: agg.coefficient,
    average: agg.weightedCoefficient > 0 ? agg.weighted / agg.weightedCoefficient : null,
    teacherComment: null,
    rank: null,
  }));
};

const hexToRgb = (hexColor: string) => {
  const normalized = hexColor.replace('#', '').trim();
  const value = normalized.length === 3
    ? normalized.split('').map((c) => `${c}${c}`).join('')
    : normalized;

  const intValue = Number.parseInt(value, 16);
  const r = ((intValue >> 16) & 255) / 255;
  const g = ((intValue >> 8) & 255) / 255;
  const b = (intValue & 255) / 255;
  return rgb(r, g, b);
};

const toDateLabel = (iso: string | null): string => {
  if (!iso) return new Date().toLocaleDateString('fr-FR');
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return new Date().toLocaleDateString('fr-FR');
  return date.toLocaleDateString('fr-FR');
};

const sanitizePdfText = (value: string): string => {
  const raw = String(value ?? '');
  // Keep PDF generation stable with StandardFonts by removing unsupported glyphs.
  return raw
    .normalize('NFKD')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[^\x20-\x7E]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

const loadAuthorizedBulletinHeader = async (actor: BulletinPdfActor, bulletinId: number) => {
  const [header] = await db
    .select({
      id: bulletins.id,
      studentId: bulletins.studentId,
      studentFirstName: students.firstName,
      studentLastName: students.lastName,
      classId: bulletins.classId,
      className: classes.name,
      schoolName: schools.name,
      schoolYearId: bulletins.schoolYearId,
      schoolYearName: academicYears.name,
      termId: bulletins.termId,
      termName: schoolTerms.name,
      termStartDate: schoolTerms.startDate,
      termEndDate: schoolTerms.endDate,
      average: bulletins.average,
      totalPoints: bulletins.totalPoints,
      totalCoefficients: bulletins.totalCoefficients,
      rank: bulletins.rank,
      mention: bulletins.mention,
      appreciation: bulletins.appreciation,
      generatedAt: bulletins.generatedAt,
      studentSchoolId: students.schoolId,
      parentUserId: parents.userId,
    })
    .from(bulletins)
    .innerJoin(students, eq(bulletins.studentId, students.id))
    .leftJoin(parents, eq(students.parentId, parents.id))
    .innerJoin(classes, eq(bulletins.classId, classes.id))
    .leftJoin(
      schoolClasses,
      and(
        eq(schoolClasses.classId, bulletins.classId),
        eq(schoolClasses.schoolId, students.schoolId),
        eq(schoolClasses.status, 'approved'),
      ),
    )
    .leftJoin(
      schools,
      or(
        eq(classes.schoolId, schools.id),
        eq(schoolClasses.schoolId, schools.id),
      ),
    )
    .innerJoin(academicYears, eq(bulletins.schoolYearId, academicYears.id))
    .innerJoin(schoolTerms, eq(bulletins.termId, schoolTerms.id))
    .where(eq(bulletins.id, bulletinId));

  if (!header) return null;
  if (actor.role === 'super_admin') return header;

  if (actor.role === 'teacher') {
    const authorizedStudentIds = await studentAccess.getAuthorizedStudentIds(actor as any);
    if (authorizedStudentIds.length === 0 || !authorizedStudentIds.includes(header.studentId)) return null;
    return header;
  }

  if (actor.role === 'school_admin') {
    if (actor.schoolId == null || header.studentSchoolId !== actor.schoolId) return null;
    return header;
  }

  if (actor.role === 'parent') {
    if (!actor.id || header.parentUserId !== actor.id) return null;
    return header;
  }

  return null;
};

export const createDbBulletinPdfDataProvider = (): BulletinPdfDataProvider => ({
  async getById(actor, bulletinId) {
    const header = await loadAuthorizedBulletinHeader(actor, bulletinId);
    if (!header) return null;

    const lines = await db
      .select({
        id: bulletinLines.id,
        bulletinId: bulletinLines.bulletinId,
        subjectId: bulletinLines.subjectId,
        subjectName: bulletinLines.subjectName,
        coefficient: bulletinLines.coefficient,
        average: bulletinLines.average,
        teacherComment: bulletinLines.teacherComment,
        rank: bulletinLines.rank,
      })
      .from(bulletinLines)
      .where(eq(bulletinLines.bulletinId, bulletinId))
      .orderBy(bulletinLines.id);

    let resolvedLines = lines.map((line) => ({
      id: line.id,
      bulletinId: line.bulletinId,
      subjectId: line.subjectId,
      subjectName: line.subjectName,
      coefficient: line.coefficient,
      average: parseNumber(line.average),
      teacherComment: line.teacherComment,
      rank: line.rank,
    }));

    if (resolvedLines.length === 0) {
      const termScopeCondition: SQL = (header.termStartDate && header.termEndDate)
        ? sql`(
            ${evaluations.termId} = ${header.termId}
            or (
              ${evaluations.termId} is null
              and ${evaluations.date} >= ${header.termStartDate}
              and ${evaluations.date} <= ${header.termEndDate}
            )
          )`
        : sql`${evaluations.termId} = ${header.termId}`;

      const gradeRows = await db
        .select({
          subject: evaluations.subject,
          coefficient: evaluations.coefficient,
          maxScore: evaluations.maxScore,
          score: grades.score,
        })
        .from(grades)
        .innerJoin(evaluations, eq(grades.evaluationId, evaluations.id))
        .where(and(
          eq(grades.studentId, header.studentId),
          eq(evaluations.classId, header.classId),
          eq(evaluations.countInBulletin, true),
          termScopeCondition,
        ));

      resolvedLines = buildFallbackLinesFromGrades(gradeRows).map((line) => ({
        ...line,
        bulletinId: bulletinId,
      }));
    }

    return {
      id: header.id,
      studentId: header.studentId,
      studentName: `${header.studentLastName} ${header.studentFirstName}`.trim(),
      classId: header.classId,
      className: header.className,
      schoolName: header.schoolName,
      schoolYearId: header.schoolYearId,
      schoolYearName: header.schoolYearName,
      termId: header.termId,
      termName: header.termName,
      average: parseNumber(header.average),
      totalPoints: parseNumber(header.totalPoints) ?? 0,
      totalCoefficients: parseNumber(header.totalCoefficients) ?? 0,
      rank: header.rank,
      mention: header.mention,
      appreciation: header.appreciation,
      generatedAt: header.generatedAt ? header.generatedAt.toISOString() : null,
      lines: resolvedLines,
    };
  },
});

const drawText = (
  page: any,
  text: string,
  x: number,
  y: number,
  size: number,
  color: any,
  font: any,
) => {
  const safeText = sanitizePdfText(text);
  page.drawText(safeText, {
    x,
    y,
    size,
    color,
    font,
  });
};

export const createBulletinPdfDocument = async (
  data: BulletinPdfData,
  templateOverrides?: Partial<BulletinPdfTemplate>,
): Promise<Uint8Array> => {
  const template: BulletinPdfTemplate = {
    ...DEFAULT_TEMPLATE,
    ...templateOverrides,
    labels: {
      ...DEFAULT_TEMPLATE.labels,
      ...(templateOverrides?.labels || {}),
    },
  };

  const primary = hexToRgb(template.primaryColor);
  const secondary = hexToRgb(template.secondaryColor);
  const text = hexToRgb(template.textColor);

  const pdf = await PDFDocument.create();
  const pageSize: [number, number] = [595.28, 841.89];
  const margin = 40;

  const fontRegular = await pdf.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let logo: any = null;
  if (template.logoFilePath) {
    try {
      const logoBytes = await readFile(template.logoFilePath);
      logo = template.logoFilePath.toLowerCase().endsWith('.png')
        ? await pdf.embedPng(logoBytes)
        : await pdf.embedJpg(logoBytes);
    } catch {
      // Ignore logo loading errors to keep PDF generation robust.
    }
  }

  const pages: any[] = [];
  const white = rgb(1, 1, 1);
  const muted = hexToRgb('#475569');
  const lightBorder = hexToRgb('#cbd5e1');
  const softBackground = hexToRgb('#f8fafc');
  const tableX = margin;
  const tableWidth = pageSize[0] - margin * 2;
  const columns = [
    { label: template.labels.subject, width: 205 },
    { label: template.labels.coefficient, width: 52 },
    { label: template.labels.subjectAverage, width: 78 },
    { label: template.labels.rank, width: 48 },
    { label: template.labels.teacherComment, width: tableWidth - 205 - 52 - 78 - 48 },
  ];

  const wrapText = (value: string, maxWidth: number, font: any, size: number): string[] => {
    const words = sanitizePdfText(value || '-').split(' ');
    const lines: string[] = [];
    let current = '';
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth || !current) {
        current = candidate;
      } else {
        lines.push(current);
        current = word;
      }
    }
    if (current) lines.push(current);
    return lines.length > 0 ? lines : ['-'];
  };

  const drawWrappedText = (page: any, value: string, x: number, y: number, maxWidth: number, size: number, color: any, font: any, maxLines = 2) => {
    const lines = wrapText(value, maxWidth, font, size).slice(0, maxLines);
    lines.forEach((line, index) => drawText(page, line, x, y - index * (size + 2), size, color, font));
  };

  const drawHeader = (page: any, includeStudentBlock: boolean) => {
    const width = page.getWidth();
    const height = page.getHeight();
    page.drawRectangle({ x: 0, y: height - 112, width, height: 112, color: primary });
    if (logo) {
      const scaled = logo.scale(0.16);
      page.drawImage(logo, {
        x: width - margin - scaled.width,
        y: height - 92,
        width: scaled.width,
        height: scaled.height,
      });
    }
    drawText(page, data.schoolName, margin, height - 42, 16, white, fontBold);
    drawText(page, `${template.labels.schoolYear}: ${data.schoolYearName}`, margin, height - 65, 10, white, fontRegular);
    drawText(page, `${template.labels.term}: ${data.termName}`, margin, height - 82, 10, white, fontRegular);
    drawText(page, 'BULLETIN DE NOTES', width / 2 - 76, height - 104, 13, white, fontBold);

    if (includeStudentBlock) {
      const infoY = height - 142;
      page.drawRectangle({ x: margin, y: infoY - 62, width: tableWidth, height: 62, color: softBackground, borderColor: lightBorder, borderWidth: 0.7 });
      drawText(page, template.labels.student, margin + 12, infoY - 20, 8, muted, fontBold);
      drawText(page, data.studentName, margin + 12, infoY - 37, 11, text, fontBold);
      drawText(page, template.labels.class, margin + 275, infoY - 20, 8, muted, fontBold);
      drawText(page, data.className, margin + 275, infoY - 37, 11, text, fontBold);
      return infoY - 82;
    }
    return height - 132;
  };

  const drawTableHeader = (page: any, y: number) => {
    page.drawRectangle({ x: tableX, y: y - 20, width: tableWidth, height: 20, color: primary });
    let x = tableX;
    columns.forEach((column) => {
      drawText(page, column.label, x + 7, y - 14, 8.5, white, fontBold);
      x += column.width;
    });
    return y - 24;
  };

  const createPage = (includeStudentBlock: boolean) => {
    const page = pdf.addPage(pageSize);
    pages.push(page);
    return { page, cursorY: drawHeader(page, includeStudentBlock) };
  };

  let { page, cursorY } = createPage(true);
  const summaryY = cursorY;
  page.drawRectangle({ x: tableX, y: summaryY - 78, width: tableWidth, height: 70, color: secondary, borderColor: lightBorder, borderWidth: 0.7 });
  drawText(page, template.labels.average, tableX + 14, summaryY - 22, 9, muted, fontBold);
  drawText(page, data.average == null ? '-' : data.average.toFixed(2), tableX + 14, summaryY - 53, 24, primary, fontBold);
  drawText(page, 'Total points', tableX + 180, summaryY - 22, 8, muted, fontBold);
  drawText(page, data.totalPoints.toFixed(2), tableX + 180, summaryY - 43, 12, text, fontBold);
  drawText(page, 'Total coefficients', tableX + 180, summaryY - 59, 8, muted, fontBold);
  drawText(page, data.totalCoefficients.toFixed(2), tableX + 180, summaryY - 75, 10, text, fontBold);
  drawText(page, template.labels.rank, tableX + 330, summaryY - 22, 8, muted, fontBold);
  drawText(page, data.rank == null ? '-' : String(data.rank), tableX + 330, summaryY - 43, 12, text, fontBold);
  drawText(page, template.labels.mention, tableX + 410, summaryY - 22, 8, muted, fontBold);
  drawWrappedText(page, data.mention || '-', tableX + 410, summaryY - 43, 88, 10, text, fontBold, 2);

  cursorY = drawTableHeader(page, summaryY - 94);
  for (const line of data.lines) {
    const subjectLines = wrapText(line.subjectName, columns[0].width - 14, fontRegular, 8.5).slice(0, 2);
    const commentLines = wrapText(line.teacherComment || '-', columns[4].width - 14, fontRegular, 8.5).slice(0, 2);
    const rowHeight = Math.max(26, Math.max(subjectLines.length, commentLines.length) * 11 + 8);
    if (cursorY - rowHeight < 82) {
      ({ page, cursorY } = createPage(false));
      cursorY = drawTableHeader(page, cursorY);
    }
    page.drawRectangle({ x: tableX, y: cursorY - rowHeight, width: tableWidth, height: rowHeight, color: data.lines.indexOf(line) % 2 === 0 ? white : softBackground, borderColor: lightBorder, borderWidth: 0.5 });
    let x = tableX;
    drawWrappedText(page, line.subjectName, x + 7, cursorY - 13, columns[0].width - 14, 8.5, text, fontRegular, 2);
    x += columns[0].width;
    drawText(page, String(line.coefficient), x + 7, cursorY - 13, 8.5, text, fontRegular);
    x += columns[1].width;
    drawText(page, line.average == null ? '-' : line.average.toFixed(2), x + 7, cursorY - 13, 8.5, text, fontRegular);
    x += columns[2].width;
    drawText(page, line.rank == null ? '-' : String(line.rank), x + 7, cursorY - 13, 8.5, text, fontRegular);
    x += columns[3].width;
    drawWrappedText(page, line.teacherComment || '-', x + 7, cursorY - 13, columns[4].width - 14, 8.5, text, fontRegular, 2);
    cursorY -= rowHeight;
  }

  const appreciationText = data.appreciation || '-';
  const appreciationLines = wrapText(appreciationText, tableWidth - 24, fontRegular, 9);
  const appreciationHeight = 34 + Math.min(appreciationLines.length, 5) * 12;
  if (cursorY - appreciationHeight < 82) {
    ({ page, cursorY } = createPage(false));
  }
  page.drawRectangle({ x: tableX, y: cursorY - appreciationHeight, width: tableWidth, height: appreciationHeight, color: softBackground, borderColor: lightBorder, borderWidth: 0.7 });
  drawText(page, template.labels.appreciation, tableX + 12, cursorY - 17, 9, primary, fontBold);
  drawWrappedText(page, appreciationText, tableX + 12, cursorY - 34, tableWidth - 24, 9, text, fontRegular, 5);
  cursorY -= appreciationHeight + 58;
  if (cursorY < 82) {
    ({ page, cursorY } = createPage(false));
  }
  page.drawLine({ start: { x: margin, y: cursorY }, end: { x: margin + 190, y: cursorY }, color: lightBorder, thickness: 0.8 });
  page.drawLine({ start: { x: page.getWidth() - margin - 190, y: cursorY }, end: { x: page.getWidth() - margin, y: cursorY }, color: lightBorder, thickness: 0.8 });
  drawText(page, template.labels.signatureSchool, margin, cursorY - 16, 8.5, muted, fontRegular);
  drawText(page, template.labels.signatureParent, page.getWidth() - margin - 190, cursorY - 16, 8.5, muted, fontRegular);

  for (const currentPage of pages) {
    const width = currentPage.getWidth();
    currentPage.drawLine({ start: { x: margin, y: 54 }, end: { x: width - margin, y: 54 }, color: lightBorder, thickness: 0.7 });
    drawText(currentPage, `${data.schoolName} · ${template.labels.generationDate}: ${toDateLabel(data.generatedAt)}`, margin, 38, 7.5, muted, fontRegular);
    drawText(currentPage, `Page ${pages.indexOf(currentPage) + 1}/${pages.length}`, width - margin - 55, 38, 7.5, muted, fontRegular);
  }

  return pdf.save({ useObjectStreams: false });
};

interface RegisterBulletinPdfRouteOptions {
  resolveActor: (req: any) => Promise<BulletinPdfActor | null>;
  dataProvider?: BulletinPdfDataProvider;
  pdfGenerator?: (data: BulletinPdfData) => Promise<Uint8Array>;
  template?: Partial<BulletinPdfTemplate>;
  verifyMiddleware?: express.RequestHandler;
  detailAccessMiddleware?: express.RequestHandler;
  batchAccessMiddleware?: express.RequestHandler;
}

const requireBulletinSuperAdmin: express.RequestHandler = (req: any, res, next) => {
  if (req.user?.role !== 'super_admin') {
    return res.status(403).json({ error: 'Forbidden' });
  }
  return next();
};

export const registerBulletinPdfRoute = (app: express.Express, options: RegisterBulletinPdfRouteOptions) => {
  const {
    resolveActor,
    dataProvider = createDbBulletinPdfDataProvider(),
    pdfGenerator,
    template,
    verifyMiddleware = verifyToken as any,
    detailAccessMiddleware = requireBulletinSuperAdmin as any,
    batchAccessMiddleware = detailAccessMiddleware,
  } = options;

  const buildPdf = pdfGenerator ?? ((data: BulletinPdfData) => createBulletinPdfDocument(data, template));

  app.get('/api/bulletins/pdf/batch', verifyMiddleware, batchAccessMiddleware, async (req: any, res) => {
    try {
      const actor = await resolveActor(req);
      if (!actor) return res.status(404).json({ error: 'User not found' });

      const rawIds = String(req.query.ids || '')
        .split(',')
        .map((value: string) => Number(value.trim()))
        .filter((value: number) => Number.isInteger(value) && value > 0);

      const bulletinIds = Array.from(new Set(rawIds));
      if (bulletinIds.length === 0) {
        return res.status(400).json({ error: 'At least one valid bulletin id is required' });
      }

      const mergedPdf = await PDFDocument.create();
      let mergedCount = 0;

      for (const bulletinId of bulletinIds) {
        const bulletin = await dataProvider.getById(actor, bulletinId);
        if (!bulletin) continue;

        const pdfBytes = await buildPdf(bulletin);
        const sourcePdf = await PDFDocument.load(pdfBytes);
        const copiedPages = await mergedPdf.copyPages(sourcePdf, sourcePdf.getPageIndices());
        copiedPages.forEach((page) => mergedPdf.addPage(page));
        mergedCount += 1;
      }

      if (mergedCount === 0) {
        return res.status(404).json({ error: 'No accessible bulletins found for provided ids' });
      }

      const mergedBytes = await mergedPdf.save({ useObjectStreams: false });
      const fileName = `bulletins-batch-${Date.now()}.pdf`;

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="${fileName}"`);
      return res.status(200).send(Buffer.from(mergedBytes));
    } catch (err) {
      console.error('Failed to generate batch bulletin PDF:', err);
      const message = err instanceof Error && err.message
        ? `Failed to generate batch bulletin PDF: ${err.message}`
        : 'Failed to generate batch bulletin PDF';
      return res.status(500).json({ error: message });
    }
  });

  app.get('/api/bulletins/:id/pdf', verifyMiddleware, detailAccessMiddleware, async (req: any, res) => {
    try {
      const actor = await resolveActor(req);
      if (!actor) return res.status(404).json({ error: 'User not found' });

      const bulletinId = Number(req.params.id);
      if (!Number.isInteger(bulletinId) || bulletinId <= 0) {
        return res.status(400).json({ error: 'Invalid bulletin id' });
      }

      const bulletin = await dataProvider.getById(actor, bulletinId);
      if (!bulletin) {
        return res.status(404).json({ error: 'Bulletin not found' });
      }

      const pdfBytes = await buildPdf(bulletin);
      const fileName = `bulletin-${bulletin.id}.pdf`;

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="${fileName}"`);
      res.status(200).send(Buffer.from(pdfBytes));
    } catch (err) {
      console.error('Failed to generate bulletin PDF:', err);
      const message = err instanceof Error && err.message
        ? `Failed to generate bulletin PDF: ${err.message}`
        : 'Failed to generate bulletin PDF';
      res.status(500).json({ error: message });
    }
  });
};
