import type express from 'express';
import { and, desc, eq, sql, type SQL } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { requireOwnership, requireRole, verifyToken } from '../middleware/auth.ts';
import { isBulletinOwnedByCurrentUser } from './bulletinAccess.ts';
import {
  academicYears,
  bulletinLines,
  bulletins,
  classes,
  schoolTerms,
  students,
} from '../db/schema.ts';

export interface BulletinReadActor {
  role: string;
  schoolId?: number | null;
}

export interface BulletinListFilters {
  schoolYearId?: number;
  termId?: number;
  classId?: number;
  studentId?: number;
  page: number;
  pageSize: number;
}

export interface BulletinListItem {
  id: number;
  studentId: number;
  studentName: string;
  classId: number;
  className: string;
  schoolYearId: number;
  schoolYearName: string;
  termId: number;
  termName: string;
  average: number | null;
  rank: number | null;
  mention: string | null;
  appreciation: string | null;
  generatedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface BulletinListResponse {
  page: number;
  pageSize: number;
  total: number;
  items: BulletinListItem[];
}

export interface BulletinLineResponse {
  id: number;
  bulletinId: number;
  subjectId: number | null;
  subjectName: string;
  coefficient: number;
  average: number | null;
  teacherComment: string | null;
  rank: number | null;
  createdAt: string | null;
}

export interface BulletinDetailResponse {
  id: number;
  studentId: number;
  studentName: string;
  classId: number;
  className: string;
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
  createdAt: string | null;
  updatedAt: string | null;
  lines: BulletinLineResponse[];
}

export interface BulletinReadService {
  list(actor: BulletinReadActor, filters: BulletinListFilters): Promise<BulletinListResponse>;
  getById(actor: BulletinReadActor, id: number): Promise<BulletinDetailResponse | null>;
}

const parseNumber = (value: unknown): number | null => {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const toIso = (value: Date | null): string | null => {
  if (!value) return null;
  return value.toISOString();
};

const buildConditions = (actor: BulletinReadActor, filters?: Partial<BulletinListFilters>): SQL[] => {
  const conditions: SQL[] = [];

  if (actor.role !== 'super_admin') {
    if (actor.schoolId == null) {
      conditions.push(sql`1 = 0`);
      return conditions;
    }
    conditions.push(eq(students.schoolId, actor.schoolId));
  }

  if (filters?.schoolYearId != null) conditions.push(eq(bulletins.schoolYearId, filters.schoolYearId));
  if (filters?.termId != null) conditions.push(eq(bulletins.termId, filters.termId));
  if (filters?.classId != null) conditions.push(eq(bulletins.classId, filters.classId));
  if (filters?.studentId != null) conditions.push(eq(bulletins.studentId, filters.studentId));

  return conditions;
};

export const createDbBulletinReadService = (): BulletinReadService => ({
  async list(actor, filters) {
    const page = Math.max(1, filters.page || 1);
    const pageSize = Math.min(100, Math.max(1, filters.pageSize || 20));
    const offset = (page - 1) * pageSize;
    const conditions = buildConditions(actor, filters);
    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    let totalQuery = db
      .select({ count: sql<number>`count(*)::integer` })
      .from(bulletins)
      .innerJoin(students, eq(bulletins.studentId, students.id));
    if (whereClause) totalQuery = totalQuery.where(whereClause) as any;
    const [totalRow] = await totalQuery;

    let listQuery = db
      .select({
        id: bulletins.id,
        studentId: bulletins.studentId,
        studentFirstName: students.firstName,
        studentLastName: students.lastName,
        classId: bulletins.classId,
        className: classes.name,
        schoolYearId: bulletins.schoolYearId,
        schoolYearName: academicYears.name,
        termId: bulletins.termId,
        termName: schoolTerms.name,
        average: bulletins.average,
        rank: bulletins.rank,
        mention: bulletins.mention,
        appreciation: bulletins.appreciation,
        generatedAt: bulletins.generatedAt,
        createdAt: bulletins.createdAt,
        updatedAt: bulletins.updatedAt,
      })
      .from(bulletins)
      .innerJoin(students, eq(bulletins.studentId, students.id))
      .innerJoin(classes, eq(bulletins.classId, classes.id))
      .innerJoin(academicYears, eq(bulletins.schoolYearId, academicYears.id))
      .innerJoin(schoolTerms, eq(bulletins.termId, schoolTerms.id))
      .orderBy(desc(bulletins.generatedAt), desc(bulletins.id))
      .limit(pageSize)
      .offset(offset);
    if (whereClause) listQuery = listQuery.where(whereClause) as any;
    const rows = await listQuery;

    return {
      page,
      pageSize,
      total: totalRow?.count || 0,
      items: rows.map((row) => ({
        id: row.id,
        studentId: row.studentId,
        studentName: `${row.studentFirstName} ${row.studentLastName}`.trim(),
        classId: row.classId,
        className: row.className,
        schoolYearId: row.schoolYearId,
        schoolYearName: row.schoolYearName,
        termId: row.termId,
        termName: row.termName,
        average: parseNumber(row.average),
        rank: row.rank,
        mention: row.mention,
        appreciation: row.appreciation,
        generatedAt: toIso(row.generatedAt),
        createdAt: toIso(row.createdAt),
        updatedAt: toIso(row.updatedAt),
      })),
    };
  },

  async getById(actor, id) {
    const conditions = buildConditions(actor);
    conditions.push(eq(bulletins.id, id));
    const whereClause = and(...conditions);

    const [header] = await db
      .select({
        id: bulletins.id,
        studentId: bulletins.studentId,
        studentFirstName: students.firstName,
        studentLastName: students.lastName,
        classId: bulletins.classId,
        className: classes.name,
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
        createdAt: bulletins.createdAt,
        updatedAt: bulletins.updatedAt,
      })
      .from(bulletins)
      .innerJoin(students, eq(bulletins.studentId, students.id))
      .innerJoin(classes, eq(bulletins.classId, classes.id))
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
        createdAt: bulletinLines.createdAt,
      })
      .from(bulletinLines)
      .where(eq(bulletinLines.bulletinId, id))
      .orderBy(bulletinLines.id);

    return {
      id: header.id,
      studentId: header.studentId,
      studentName: `${header.studentFirstName} ${header.studentLastName}`.trim(),
      classId: header.classId,
      className: header.className,
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
      generatedAt: toIso(header.generatedAt),
      createdAt: toIso(header.createdAt),
      updatedAt: toIso(header.updatedAt),
      lines: lines.map((line) => ({
        id: line.id,
        bulletinId: line.bulletinId,
        subjectId: line.subjectId,
        subjectName: line.subjectName,
        coefficient: line.coefficient,
        average: parseNumber(line.average),
        teacherComment: line.teacherComment,
        rank: line.rank,
        createdAt: toIso(line.createdAt),
      })),
    };
  },
});

interface RegisterBulletinReadRoutesOptions {
  resolveActor: (req: any) => Promise<BulletinReadActor | null>;
  readService?: BulletinReadService;
  verifyMiddleware?: express.RequestHandler;
  listAccessMiddleware?: express.RequestHandler;
  detailAccessMiddleware?: express.RequestHandler;
}

const parseOptionalPositiveInt = (value: unknown): number | undefined => {
  if (value == null || value === '') return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
};

export const registerBulletinReadRoutes = (app: express.Express, options: RegisterBulletinReadRoutesOptions) => {
  const {
    resolveActor,
    readService = createDbBulletinReadService(),
    verifyMiddleware = verifyToken as any,
    listAccessMiddleware = requireRole(['admin', 'teacher']) as any,
    detailAccessMiddleware = requireOwnership(isBulletinOwnedByCurrentUser, { bypassRoles: ['admin', 'teacher'] }) as any,
  } = options;

  app.get('/api/bulletins', verifyMiddleware, listAccessMiddleware, async (req: any, res) => {
    try {
      const actor = await resolveActor(req);
      if (!actor) return res.status(404).json({ error: 'User not found' });

      const response = await readService.list(actor, {
        schoolYearId: parseOptionalPositiveInt(req.query.schoolYearId),
        termId: parseOptionalPositiveInt(req.query.termId),
        classId: parseOptionalPositiveInt(req.query.classId),
        studentId: parseOptionalPositiveInt(req.query.studentId),
        page: parseOptionalPositiveInt(req.query.page) ?? 1,
        pageSize: parseOptionalPositiveInt(req.query.pageSize) ?? 20,
      });

      return res.json(response);
    } catch (err) {
      console.error('Failed to list persisted bulletins:', err);
      return res.status(500).json({ error: 'Failed to list persisted bulletins' });
    }
  });

  app.get('/api/bulletins/:id', verifyMiddleware, detailAccessMiddleware, async (req: any, res) => {
    try {
      const actor = await resolveActor(req);
      if (!actor) return res.status(404).json({ error: 'User not found' });

      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ error: 'Invalid bulletin id' });
      }

      const bulletin = await readService.getById(actor, id);
      if (!bulletin) {
        return res.status(404).json({ error: 'Bulletin not found' });
      }

      return res.json(bulletin);
    } catch (err) {
      console.error('Failed to retrieve persisted bulletin:', err);
      return res.status(500).json({ error: 'Failed to retrieve persisted bulletin' });
    }
  });
};
