import type express from 'express';
import { and, eq, sql, type SQL } from 'drizzle-orm';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { readFile } from 'node:fs/promises';
import { db } from '../db/index.ts';
import { requireOwnership, verifyToken } from '../middleware/auth.ts';
import { isBulletinOwnedByCurrentUser } from './bulletinAccess.ts';
import {
  academicYears,
  bulletinLines,
  bulletins,
  classes,
  schools,
  schoolTerms,
  students,
} from '../db/schema.ts';

export interface BulletinPdfActor {
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

const buildConditions = (actor: BulletinPdfActor): SQL[] => {
  const conditions: SQL[] = [];
  if (actor.role !== 'super_admin') {
    if (actor.schoolId == null) {
      conditions.push(sql`1 = 0`);
      return conditions;
    }
    conditions.push(eq(students.schoolId, actor.schoolId));
  }
  return conditions;
};

export const createDbBulletinPdfDataProvider = (): BulletinPdfDataProvider => ({
  async getById(actor, bulletinId) {
    const conditions = buildConditions(actor);
    conditions.push(eq(bulletins.id, bulletinId));
    const whereClause = and(...conditions);

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
        average: bulletins.average,
        totalPoints: bulletins.totalPoints,
        totalCoefficients: bulletins.totalCoefficients,
        rank: bulletins.rank,
        mention: bulletins.mention,
        appreciation: bulletins.appreciation,
        generatedAt: bulletins.generatedAt,
      })
      .from(bulletins)
      .innerJoin(students, eq(bulletins.studentId, students.id))
      .innerJoin(classes, eq(bulletins.classId, classes.id))
      .leftJoin(schools, eq(classes.schoolId, schools.id))
      .innerJoin(academicYears, eq(bulletins.schoolYearId, academicYears.id))
      .innerJoin(schoolTerms, eq(bulletins.termId, schoolTerms.id))
      .where(whereClause);

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

    return {
      id: header.id,
      studentId: header.studentId,
      studentName: `${header.studentFirstName} ${header.studentLastName}`.trim(),
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
      lines: lines.map((line) => ({
        id: line.id,
        bulletinId: line.bulletinId,
        subjectId: line.subjectId,
        subjectName: line.subjectName,
        coefficient: line.coefficient,
        average: parseNumber(line.average),
        teacherComment: line.teacherComment,
        rank: line.rank,
      })),
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
  page.drawText(text, {
    x,
    y,
    size,
    color,
    font,
  });
};

const safeText = (value: string | null | undefined): string => {
  return value ?? '';
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
  const page = pdf.addPage([595.28, 841.89]);
  const width = page.getWidth();
  const height = page.getHeight();
  const margin = 40;

  const fontRegular = await pdf.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);

  page.drawRectangle({ x: 0, y: height - 90, width, height: 90, color: primary });
  drawText(page, template.labels.title, margin, height - 52, 20, rgb(1, 1, 1), fontBold);
  drawText(page, safeText(data.schoolName), margin, height - 76, 12, rgb(1, 1, 1), fontRegular);

  if (template.logoFilePath) {
    try {
      const logoBytes = await readFile(template.logoFilePath);
      const logo = template.logoFilePath.toLowerCase().endsWith('.png')
        ? await pdf.embedPng(logoBytes)
        : await pdf.embedJpg(logoBytes);
      const scaled = logo.scale(0.2);
      page.drawImage(logo, {
        x: width - margin - scaled.width,
        y: height - 80,
        width: scaled.width,
        height: scaled.height,
      });
    } catch {
      // Ignore logo loading errors to keep PDF generation robust.
    }
  }

  let cursorY = height - 120;
  const lineGap = 18;

  page.drawRectangle({ x: margin, y: cursorY - 62, width: width - margin * 2, height: 62, color: secondary });
  drawText(page, `${template.labels.schoolYear}: ${safeText(data.schoolYearName)}`, margin + 10, cursorY - 20, 11, text, fontRegular);
  drawText(page, `${template.labels.term}: ${safeText(data.termName)}`, margin + 10, cursorY - 38, 11, text, fontRegular);
  drawText(page, `${template.labels.student}: ${safeText(data.studentName)}`, margin + 250, cursorY - 20, 11, text, fontRegular);
  drawText(page, `${template.labels.class}: ${safeText(data.className)}`, margin + 250, cursorY - 38, 11, text, fontRegular);

  cursorY -= 90;

  const tableX = margin;
  const colSubject = 220;
  const colCoef = 70;
  const colAvg = 80;
  const colComment = width - margin * 2 - colSubject - colCoef - colAvg;
  const tableWidth = width - margin * 2;

  page.drawRectangle({ x: tableX, y: cursorY, width: tableWidth, height: 22, color: primary });
  drawText(page, template.labels.subject, tableX + 8, cursorY + 6, 10, rgb(1, 1, 1), fontBold);
  drawText(page, template.labels.coefficient, tableX + colSubject + 8, cursorY + 6, 10, rgb(1, 1, 1), fontBold);
  drawText(page, template.labels.subjectAverage, tableX + colSubject + colCoef + 8, cursorY + 6, 10, rgb(1, 1, 1), fontBold);
  drawText(page, template.labels.teacherComment, tableX + colSubject + colCoef + colAvg + 8, cursorY + 6, 10, rgb(1, 1, 1), fontBold);

  cursorY -= 24;
  for (const line of data.lines) {
    page.drawRectangle({ x: tableX, y: cursorY, width: tableWidth, height: 22, borderColor: secondary, borderWidth: 0.6 });
    drawText(page, safeText(line.subjectName), tableX + 8, cursorY + 6, 9, text, fontRegular);
    drawText(page, String(line.coefficient ?? 0), tableX + colSubject + 8, cursorY + 6, 9, text, fontRegular);
    drawText(page, line.average == null ? '-' : line.average.toFixed(2), tableX + colSubject + colCoef + 8, cursorY + 6, 9, text, fontRegular);
    drawText(page, line.teacherComment ? safeText(line.teacherComment) : '-', tableX + colSubject + colCoef + colAvg + 8, cursorY + 6, 9, text, fontRegular);
    cursorY -= 22;
    if (cursorY < 160) break;
  }

  cursorY -= 16;
  drawText(page, `${template.labels.average}: ${data.average == null ? '-' : data.average.toFixed(2)}`, margin, cursorY, 11, text, fontBold);
  cursorY -= lineGap;
  drawText(page, `${template.labels.rank}: ${data.rank ?? '-'}`, margin, cursorY, 11, text, fontRegular);
  cursorY -= lineGap;
  drawText(page, `${template.labels.mention}: ${data.mention ?? '-'}`, margin, cursorY, 11, text, fontRegular);
  cursorY -= lineGap;
  drawText(page, `${template.labels.appreciation}: ${data.appreciation ?? '-'}`, margin, cursorY, 11, text, fontRegular);
  cursorY -= lineGap;
  drawText(page, `${template.labels.generationDate}: ${toDateLabel(data.generatedAt)}`, margin, cursorY, 10, text, fontRegular);

  page.drawLine({
    start: { x: margin, y: 100 },
    end: { x: margin + 190, y: 100 },
    color: secondary,
    thickness: 1,
  });
  page.drawLine({
    start: { x: width - margin - 190, y: 100 },
    end: { x: width - margin, y: 100 },
    color: secondary,
    thickness: 1,
  });
  drawText(page, template.labels.signatureSchool, margin, 84, 10, text, fontRegular);
  drawText(page, template.labels.signatureParent, width - margin - 190, 84, 10, text, fontRegular);

  return pdf.save({ useObjectStreams: false });
};

interface RegisterBulletinPdfRouteOptions {
  resolveActor: (req: any) => Promise<BulletinPdfActor | null>;
  dataProvider?: BulletinPdfDataProvider;
  pdfGenerator?: (data: BulletinPdfData) => Promise<Uint8Array>;
  template?: Partial<BulletinPdfTemplate>;
  verifyMiddleware?: express.RequestHandler;
  detailAccessMiddleware?: express.RequestHandler;
}

export const registerBulletinPdfRoute = (app: express.Express, options: RegisterBulletinPdfRouteOptions) => {
  const {
    resolveActor,
    dataProvider = createDbBulletinPdfDataProvider(),
    pdfGenerator,
    template,
    verifyMiddleware = verifyToken as any,
    detailAccessMiddleware = requireOwnership(isBulletinOwnedByCurrentUser, { bypassRoles: ['admin', 'teacher'] }) as any,
  } = options;

  const buildPdf = pdfGenerator ?? ((data: BulletinPdfData) => createBulletinPdfDocument(data, template));

  app.get('/api/bulletins/:id/pdf', verifyMiddleware, detailAccessMiddleware, async (req: any, res) => {
    const requestId = `PDF_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    console.log(`📥 [${requestId}] GET /api/bulletins/:id/pdf - params:`, req.params, 'auth:', req.user ? { uid: req.user.uid, role: req.user.role } : 'none', 'headers:', { authorization: req.headers.authorization ? '***' : 'missing', 'x-simulated-role': req.headers['x-simulated-role'] });
    try {
      const actor = await resolveActor(req);
      console.log(`🔐 [${requestId}] Actor resolved:`, actor ? { role: actor.role, schoolId: actor.schoolId } : null);
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
      res.status(500).json({ error: 'Failed to generate bulletin PDF' });
    }
  });
};
