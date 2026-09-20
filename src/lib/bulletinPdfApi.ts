import type express from 'express';
import { and, desc, eq, or, sql, type SQL } from 'drizzle-orm';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { db } from '../db/index.ts';
import { requireOwnership, requireRole, verifyToken } from '../middleware/auth.ts';
import { isBulletinOwnedByCurrentUser } from './bulletinAccess.ts';
import {
  absences,
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
  studentAcademicYearStatuses,
  teachers,
  users,
} from '../db/schema.ts';
import {
  buildSubjectTeacherNameMap,
  calculateAnnualBulletinResults,
  groupBulletinLinesBySubjectType,
  loadSubjectTypeNames,
  resolveAnnualPeriodScope,
  type BulletinSubjectGroup,
  type SubjectTypeMetadata,
} from './bulletinSnapshotService';
import {
  calculateClassAverage,
  calculateFinalSubjectAverage,
  calculateTypeWeightedAverage,
  resolveSubjectCoefficientFromPublishedComposition,
} from './bulletinService';
import { getGradeAppreciation } from './gradeColor';
import { inferPeriodTypeFromLegacyName } from './educationStructure';
import studentAccess from './studentAccess';

export const formatStudentStatusForPdf = (status: string | null | undefined): string | null => {
  const abbreviations: Record<string, string> = {
    Nouveau: 'N',
    Doublant: 'D',
    Triplant: 'T',
    Quadruplant: 'Q',
    Quintuplant: '5',
    Sextuplant: '6',
  };
  return status ? abbreviations[status] ?? null : null;
};

export const resolveStudentStatusForAcademicYear = (
  rows: Array<{ studentId: number; academicYearId: number; status: string | null }>,
  studentId: number,
  academicYearId: number,
): string | null => rows.find((row) => row.studentId === studentId && row.academicYearId === academicYearId)?.status ?? null;

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
  subjectTypeId?: number | null;
  subjectTypeName?: string | null;
  sortOrder?: number | null;
  coefficient: number | null;
  average: number | null;
  teacherName?: string | null;
  interrogation?: number | null;
  devoir?: number | null;
  composition?: number | null;
  classAverage?: number | null;
  teacherComment: string | null;
  rank: number | null;
}

export interface PreviousPeriodSummary {
  termId: number;
  label: string;
  average: number | null;
  rank: number | null;
}

export interface BulletinPdfData {
  id: number;
  studentId: number;
  studentName: string;
  studentMatricule?: string | null;
  studentGender: string | null;
  studentStatus: string | null;
  classId: number;
  className: string;
  classTeacherName?: string | null;
  classStudentCount: number;
  schoolName: string;
  school?: {
    name: string;
    officialName?: string | null;
    abbreviation?: string | null;
    motto?: string | null;
    address?: string | null;
    postalBox?: string | null;
    phone?: string | null;
    phone2?: string | null;
    email?: string | null;
    city?: string | null;
    region?: string | null;
    educationDirection?: string | null;
    ministryName?: string | null;
    logoPath?: string | null;
    logo?: string | null;
  };
  schoolYearId: number;
  schoolYearName: string;
  termId: number;
  termName: string;
  average: number | null;
  totalPoints: number;
  totalCoefficients: number;
  rank: number | null;
  annualAverage?: number | null;
  annualRank?: number | null;
  mention: string | null;
  appreciation: string | null;
  absences: number;
  retards: number;
  generatedAt: string | null;
  lines: BulletinPdfLine[];
  subjectGroups?: BulletinSubjectGroup<BulletinPdfLine>[];
  previousPeriodSummaries?: PreviousPeriodSummary[];
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
  primaryColor: '#1f2937',
  secondaryColor: '#e5e7eb',
  textColor: '#111827',
  labels: {
    title: 'BULLETIN DE NOTES',
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

export const formatPdfDisplayNumber = (value: number | string | null | undefined): string => {
  if (value == null || value === '') return '-';
  if (typeof value === 'string' && value.trim() === '-') return '-';

  const numericValue = typeof value === 'string'
    ? Number(value.trim().replace(',', '.'))
    : Number(value);

  if (!Number.isFinite(numericValue)) return '-';
  if (Number.isInteger(numericValue)) return String(numericValue);

  return numericValue.toFixed(2).replace('.', ',').replace(/,?0+$/, '');
};

const formatPdfDisplayNumberFixed = (value: number | string | null | undefined): string => {
  if (value == null || value === '') return '-';
  if (typeof value === 'string' && value.trim() === '-') return '-';

  const numericValue = typeof value === 'string'
    ? Number(value.trim().replace(',', '.'))
    : Number(value);

  if (!Number.isFinite(numericValue)) return '-';
  return numericValue.toFixed(2);
};

const formatGeneralRankLabel = (value: number | string | null | undefined): string => {
  const numericValue = typeof value === 'string' ? Number(value.trim().replace(',', '.')) : Number(value);
  if (!Number.isFinite(numericValue) || numericValue <= 0) return '-';

  const ordinal = Math.trunc(numericValue);
  const suffixMap: Record<number, string> = {
    1: 'er',
    2: 'ème',
    3: 'ème',
    4: 'ème',
    5: 'ème',
    6: 'ème',
    7: 'ème',
    8: 'ème',
    9: 'ème',
    10: 'ème',
  };
  const suffix = suffixMap[ordinal] ?? 'ème';
  return `${ordinal}${suffix}`;
};

const formatPeriodSummaryLabel = (termName?: string | null): string => {
  const normalizedName = String(termName ?? '').trim();
  if (!normalizedName) return 'Période';

  const simpleMatch = normalizedName.match(/^(Trimestre|Semestre)\s+(\d+)/i);
  if (simpleMatch) {
    const periodType = simpleMatch[1].charAt(0).toUpperCase() + simpleMatch[1].slice(1).toLowerCase();
    const ordinal = Number(simpleMatch[2]);
    const ordinalLabel = ordinal === 1 ? '1er' : `${ordinal}ème`;
    return `${ordinalLabel} ${periodType}`;
  }

  const ordinalMatch = normalizedName.match(/^(\d+)(er|ère|eme|ème)?\s+(Trimestre|Semestre)$/i);
  if (ordinalMatch) {
    const ordinalNumber = Number(ordinalMatch[1]);
    const ordinalLabel = ordinalNumber === 1 ? '1er' : `${ordinalNumber}ème`;
    const periodType = ordinalMatch[3].charAt(0).toUpperCase() + ordinalMatch[3].slice(1).toLowerCase();
    return `${ordinalLabel} ${periodType}`;
  }

  return normalizedName;
};

export const resolvePreviousPeriodSummaries = ({
  currentTermId,
  studentId,
  schoolYearId,
  terms,
  bulletins,
}: {
  currentTermId: number;
  studentId: number;
  schoolYearId: number;
  terms: Array<{
    id: number;
    name: string;
    periodType?: string | null;
    orderIndex?: number | null;
    academicYearId?: number | null;
    startDate?: string | null;
    endDate?: string | null;
  }>;
  bulletins: Array<{ id: number; termId: number; studentId: number; schoolYearId: number; average: number | string | null; rank: number | string | null }>;
}): PreviousPeriodSummary[] => {
  const latestByTerm = new Map<number, { id: number; termId: number; studentId: number; schoolYearId: number; average: number | string | null; rank: number | string | null }>();

  for (const row of bulletins) {
    if (row.studentId !== studentId || row.schoolYearId !== schoolYearId) continue;
    const current = latestByTerm.get(row.termId);
    if (!current || Number(row.id) > Number(current.id)) {
      latestByTerm.set(row.termId, row);
    }
  }

  const currentTerm = terms.find((term) => term.id === currentTermId) ?? null;
  const inferHistoricalPeriodType = (termName?: string | null) => {
    const inferred = inferPeriodTypeFromLegacyName(termName);
    if (inferred) return inferred;
    const normalizedName = String(termName ?? '').trim();
    if (/semestre/i.test(normalizedName)) return 'semester';
    if (/trimestre/i.test(normalizedName)) return 'trimester';
    return null;
  };
  const currentType = currentTerm?.periodType ?? inferHistoricalPeriodType(currentTerm?.name);
  const currentOrder = currentTerm?.orderIndex ?? 0;
  const currentHasDateRange = Boolean(currentTerm?.startDate && currentTerm?.endDate);

  const previousTerms = terms
    .filter((term) => term.academicYearId == null || term.academicYearId === schoolYearId)
    .filter((term) => {
      if (term.id === currentTermId) return false;
      const inferredType = term.periodType ?? inferHistoricalPeriodType(term.name);
      if (currentType && inferredType && inferredType !== currentType) return false;
      if (currentType && inferredType === currentType) {
        if (currentHasDateRange && term.startDate && term.endDate) {
          return term.endDate < (currentTerm?.startDate ?? '');
        }
        return (term.orderIndex ?? 0) < currentOrder;
      }
      return false;
    })
    .sort((a, b) => {
      if (a.startDate && b.startDate && a.startDate !== b.startDate) {
        return a.startDate.localeCompare(b.startDate);
      }
      return (a.orderIndex ?? 0) - (b.orderIndex ?? 0);
    });

  return previousTerms.map((term) => {
    const latest = latestByTerm.get(term.id);
    return {
      termId: term.id,
      label: term.name,
      average: latest ? parseNumber(latest.average) : null,
      rank: latest && latest.rank != null ? Number(latest.rank) : null,
    };
  });
};

const parseNumericScore = (score: string): number | null => {
  const normalized = String(score || '').trim().replace(',', '.');
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
};

export const calculateStudentSubjectTypeAverages = (
  rows: Array<{
    subject: string;
    studentId: number;
    type?: string | null;
    coefficient: number | string;
    maxScore: number | string;
    score: number | string | null;
  }>,
  studentId: number,
  subjectName: string,
): { interrogation: number | null; devoir: number | null; composition: number | null } => {
  const result: { interrogation: number | null; devoir: number | null; composition: number | null } = {
    interrogation: null,
    devoir: null,
    composition: null,
  };

  for (const type of ['interrogation', 'devoir', 'composition'] as const) {
    const entries = rows
      .filter((row) => row.subject === subjectName && row.studentId === studentId && (row.type ?? '').trim().toLowerCase() === type)
      .map((row) => {
        const rawScore = parseNumericScore(String(row.score ?? ''));
        const maxScore = Number(row.maxScore);
        if (rawScore == null || !Number.isFinite(maxScore) || maxScore <= 0) return null;
        return {
          coefficient: Number(row.coefficient),
          normalizedScore: (rawScore / maxScore) * 20,
        };
      })
      .filter((entry): entry is { coefficient: number; normalizedScore: number } => entry != null);

    result[type] = calculateTypeWeightedAverage(entries);
  }

  return result;
};

const buildFallbackLinesFromGrades = (
  rows: Array<{ subject: string; coefficient: number; maxScore: number; score: string; type?: string | null }>,
): BulletinPdfLine[] => {
  const bySubject = new Map<string, { coefficient: number; weighted: number; weightedCoefficient: number; groups: Record<'interrogation' | 'devoir' | 'composition', Array<{ coefficient: number; score: number }>> }>();

  for (const row of rows) {
    const coefficient = Number(row.coefficient || 0);
    const maxScore = Number(row.maxScore || 0);
    const rawScore = parseNumericScore(row.score);
    if (!(coefficient > 0) || !(maxScore > 0) || rawScore == null) continue;
    const normalizedScore = (rawScore / maxScore) * 20;
    const type = row.type?.trim().toLowerCase();
    const key = type === 'interrogation' || type === 'devoir' || type === 'composition' ? type : null;
    const current = bySubject.get(row.subject) ?? { coefficient: 0, weighted: 0, weightedCoefficient: 0, groups: { interrogation: [], devoir: [], composition: [] } };
    current.weighted += normalizedScore * coefficient;
    current.weightedCoefficient += coefficient;
    if (key) {
      current.groups[key].push({ coefficient, score: normalizedScore });
    }
    bySubject.set(row.subject, current);
  }

  let runningId = 1;
  return Array.from(bySubject.entries()).map(([subjectName, agg]) => ({
    ...(() => {
      const interrogation = calculateTypeWeightedAverage(agg.groups.interrogation.map((entry) => ({ coefficient: entry.coefficient, normalizedScore: entry.score })));
      const devoir = calculateTypeWeightedAverage(agg.groups.devoir.map((entry) => ({ coefficient: entry.coefficient, normalizedScore: entry.score })));
      return {
        classAverage: calculateClassAverage(interrogation, devoir),
      };
    })(),
    id: runningId++,
    bulletinId: 0,
    subjectId: null,
    subjectName,
    coefficient: resolveSubjectCoefficientFromPublishedComposition(
      rows.map((row) => ({
        subject: row.subject,
        classId: undefined,
        termId: undefined,
        type: row.type,
        coefficient: row.coefficient,
        countInBulletin: true,
      })),
      subjectName,
      undefined,
      undefined,
    ),
    average: calculateFinalSubjectAverage(
      calculateClassAverage(interrogation, devoir),
      calculateTypeWeightedAverage(agg.groups.composition.map((entry) => ({ coefficient: entry.coefficient, normalizedScore: entry.score }))),
    ),
    interrogation: calculateTypeWeightedAverage(agg.groups.interrogation.map((entry) => ({ coefficient: entry.coefficient, normalizedScore: entry.score }))),
    devoir: calculateTypeWeightedAverage(agg.groups.devoir.map((entry) => ({ coefficient: entry.coefficient, normalizedScore: entry.score }))),
    composition: calculateTypeWeightedAverage(agg.groups.composition.map((entry) => ({ coefficient: entry.coefficient, normalizedScore: entry.score }))),
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

const computeSubjectBreakdown = async (
  studentId: number,
  classId: number,
  termId: number,
  termStartDate: Date | string | null,
  termEndDate: Date | string | null,
): Promise<Map<string, { interrogation: number | null; devoir: number | null; composition: number | null; classAverage: number | null }>> => {
  const termScopeCondition: SQL = (termStartDate && termEndDate)
    ? sql`(
        ${evaluations.termId} = ${termId}
        or (
          ${evaluations.termId} is null
          and ${evaluations.date} >= ${termStartDate}
          and ${evaluations.date} <= ${termEndDate}
        )
      )`
    : sql`${evaluations.termId} = ${termId}`;

  const rows = await db
    .select({
      subject: evaluations.subject,
      studentId: grades.studentId,
      type: evaluations.type,
      coefficient: evaluations.coefficient,
      maxScore: evaluations.maxScore,
      score: grades.score,
    })
    .from(grades)
    .innerJoin(evaluations, eq(grades.evaluationId, evaluations.id))
    .where(and(
      eq(evaluations.classId, classId),
      eq(evaluations.countInBulletin, true),
      termScopeCondition,
    ));

  const bySubject = new Map<string, { studentEntries: Array<{ coefficient: number; score: number }>; byType: Record<'interrogation' | 'devoir' | 'composition', Array<{ coefficient: number; score: number }>>; allStudentAverages: number[] }>();

  for (const row of rows) {
    const subjectName = String(row.subject ?? '').trim();
    if (!subjectName) continue;
    const rawScore = parseNumericScore(row.score);
    const maxScore = Number(row.maxScore || 0);
    if (rawScore == null || maxScore <= 0) continue;
    const normalizedScore = (rawScore / maxScore) * 20;
    const type = (row.type ?? '').trim().toLowerCase();
    const asType = type === 'interrogation' || type === 'devoir' || type === 'composition' ? type : null;

    const current = bySubject.get(subjectName) ?? { studentEntries: [], byType: { interrogation: [], devoir: [], composition: [] }, allStudentAverages: [] };
    current.studentEntries.push({ coefficient: Number(row.coefficient || 0), score: normalizedScore });
    if (asType) current.byType[asType].push({ coefficient: Number(row.coefficient || 0), score: normalizedScore });
    bySubject.set(subjectName, current);
  }

  const studentAverageMap = new Map<string, number>();
  for (const [subjectName, bucket] of bySubject.entries()) {
    const studentSpecific = bucket.studentEntries.filter((entry) => {
      const matchingRows = rows.filter((row) => row.subject === subjectName && row.studentId === studentId);
      const studentValues = matchingRows
        .map((row) => {
          const raw = parseNumericScore(row.score);
          const max = Number(row.maxScore || 0);
          return raw == null || max <= 0 ? null : (raw / max) * 20;
        })
        .filter((value): value is number => value != null);
      return studentValues.length > 0;
    });
    const studentAverage = calculateTypeWeightedAverage(
      (studentSpecific.length > 0 ? studentSpecific : bucket.studentEntries.filter((entry) => rows.some((row) => row.subject === subjectName && row.studentId === studentId && parseNumericScore(row.score) != null)))
        .map((entry) => ({ coefficient: entry.coefficient, normalizedScore: entry.score })),
    );
    if (studentAverage != null) studentAverageMap.set(subjectName, studentAverage);
  }

  const result = new Map<string, { interrogation: number | null; devoir: number | null; composition: number | null; classAverage: number | null }>();
  for (const [subjectName, bucket] of bySubject.entries()) {
    const studentTypeAverages = calculateStudentSubjectTypeAverages(rows, studentId, subjectName);
    result.set(subjectName, {
      ...studentTypeAverages,
      classAverage: calculateClassAverage(studentTypeAverages.interrogation, studentTypeAverages.devoir),
    });
  }

  return result;
};

const sanitizePdfText = (value: string): string => {
  const raw = String(value ?? '');
  return raw
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[^\p{L}\p{N}\p{P}\p{S}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

const sanitizePdfTextPreservingAccents = sanitizePdfText;

const loadPdfFonts = async (pdf: PDFDocument) => {
  const candidates = [
    { regular: 'C:/Windows/Fonts/calibri.ttf', bold: 'C:/Windows/Fonts/calibrib.ttf', boldItalic: 'C:/Windows/Fonts/calibriz.ttf' },
    { regular: 'C:/Windows/Fonts/segoeui.ttf', bold: 'C:/Windows/Fonts/segoeuib.ttf', boldItalic: 'C:/Windows/Fonts/segoeuiz.ttf' },
    { regular: 'C:/Windows/Fonts/arial.ttf', bold: 'C:/Windows/Fonts/arialbd.ttf', boldItalic: 'C:/Windows/Fonts/arialbi.ttf' },
  ];

  for (const candidate of candidates) {
    try {
      return {
        regular: await pdf.embedFont(await readFile(candidate.regular)),
        bold: await pdf.embedFont(await readFile(candidate.bold)),
        boldItalic: await pdf.embedFont(await readFile(candidate.boldItalic)),
      };
    } catch {
      // Fall back to built-in fonts if a local TTF is unavailable.
    }
  }

  return {
    regular: await pdf.embedFont(StandardFonts.TimesRoman),
    bold: await pdf.embedFont(StandardFonts.TimesRomanBold),
    boldItalic: await pdf.embedFont(StandardFonts.TimesRomanBoldItalic),
  };
};

export const BULLETIN_FINAL_AVERAGE_LABEL = 'Note /20';

const loadAuthorizedBulletinHeader = async (actor: BulletinPdfActor, bulletinId: number) => {
  const [header] = await db
    .select({
      id: bulletins.id,
      studentId: bulletins.studentId,
      studentFirstName: students.firstName,
      studentLastName: students.lastName,
      studentMatricule: students.matricule,
      studentGender: students.gender,
      studentStatus: studentAcademicYearStatuses.status,
      classId: bulletins.classId,
      className: classes.name,
      schoolName: schools.name,
      school: {
        name: schools.name,
        officialName: schools.officialName,
        abbreviation: schools.abbreviation,
        motto: schools.motto,
        address: schools.address,
        postalBox: schools.postalBox,
        phone: schools.phone,
        phone2: schools.phone2,
        email: schools.email,
        city: schools.city,
        region: schools.region,
        educationDirection: schools.educationDirection,
        ministryName: schools.ministryName,
        logoPath: schools.logoPath,
      },
      schoolYearId: bulletins.schoolYearId,
      schoolYearName: academicYears.name,
      termId: bulletins.termId,
      termName: schoolTerms.name,
      termStartDate: schoolTerms.startDate,
      termEndDate: schoolTerms.endDate,
      termPeriodType: schoolTerms.periodType,
      termOrderIndex: schoolTerms.orderIndex,
      termCycleId: schoolTerms.cycleId,
      average: bulletins.average,
      totalPoints: bulletins.totalPoints,
      totalCoefficients: bulletins.totalCoefficients,
      rank: bulletins.rank,
      mention: bulletins.mention,
      appreciation: bulletins.appreciation,
      generatedAt: bulletins.generatedAt,
      studentSchoolId: students.schoolId,
      parentUserId: parents.userId,
      classTeacherName: users.name,
    })
    .from(bulletins)
    .innerJoin(students, eq(bulletins.studentId, students.id))
    .leftJoin(parents, eq(students.parentId, parents.id))
    .innerJoin(classes, eq(bulletins.classId, classes.id))
    .leftJoin(teachers, eq(classes.teacherId, teachers.id))
    .leftJoin(users, eq(teachers.userId, users.id))
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
    .leftJoin(
      studentAcademicYearStatuses,
      and(
        eq(studentAcademicYearStatuses.studentId, bulletins.studentId),
        eq(studentAcademicYearStatuses.academicYearId, bulletins.schoolYearId),
      ),
    )
    .where(eq(bulletins.id, bulletinId));

  if (!header) return null;

  const classStudentCount = header.studentSchoolId == null
    ? 0
    : ((await db
      .select({ count: sql<number>`count(${students.id})::integer` })
      .from(students)
      .where(and(
        eq(students.classId, header.classId),
        eq(students.schoolId, header.studentSchoolId),
      ))
    ))[0]?.count ?? 0;

  if (actor.role === 'super_admin') return { ...header, classStudentCount };

  if (actor.role === 'teacher') {
    const authorizedStudentIds = await studentAccess.getAuthorizedStudentIds(actor as any);
    if (authorizedStudentIds.length === 0 || !authorizedStudentIds.includes(header.studentId)) return null;
    return { ...header, classStudentCount };
  }

  if (actor.role === 'school_admin') {
    if (actor.schoolId == null || header.studentSchoolId !== actor.schoolId) return null;
    return { ...header, classStudentCount };
  }

  if (actor.role === 'parent') {
    if (!actor.id || header.parentUserId !== actor.id) return null;
    return { ...header, classStudentCount };
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

    const subjectTeacherMap = await buildSubjectTeacherNameMap(header.classId, header.termId);

    const subjectTypeNames = header.studentSchoolId == null
      ? new Map<string, SubjectTypeMetadata>()
      : await loadSubjectTypeNames(db, header.studentSchoolId);

    let resolvedLines = lines.map((line) => ({
      id: line.id,
      bulletinId: line.bulletinId,
      subjectId: line.subjectId,
      subjectName: line.subjectName,
      subjectTypeId: subjectTypeNames.get(line.subjectName)?.subjectTypeId ?? null,
      subjectTypeName: subjectTypeNames.get(line.subjectName)?.subjectTypeName ?? null,
      sortOrder: subjectTypeNames.get(line.subjectName)?.sortOrder ?? null,
      coefficient: line.coefficient,
      average: parseNumber(line.average),
      teacherName: subjectTeacherMap.get(line.subjectName) ?? null,
      teacherComment: line.teacherComment,
      rank: line.rank,
    }));

    const breakdownBySubject = await computeSubjectBreakdown(header.studentId, header.classId, header.termId, header.termStartDate ?? null, header.termEndDate ?? null);
    resolvedLines = resolvedLines.map((line) => {
      const subjectBreakdown = breakdownBySubject.get(line.subjectName) ?? null;
      const classAverage = subjectBreakdown?.classAverage ?? null;
      const composition = subjectBreakdown?.composition ?? null;
      const finalAverage = calculateFinalSubjectAverage(classAverage, composition) ?? line.average;
      return {
        ...line,
        average: finalAverage,
        teacherComment: finalAverage != null ? getGradeAppreciation(finalAverage) : line.teacherComment,
        interrogation: subjectBreakdown?.interrogation ?? null,
        devoir: subjectBreakdown?.devoir ?? null,
        composition,
        classAverage,
      };
    });

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
            type: evaluations.type,
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
        subjectTypeId: subjectTypeNames.get(line.subjectName)?.subjectTypeId ?? null,
        subjectTypeName: subjectTypeNames.get(line.subjectName)?.subjectTypeName ?? null,
        sortOrder: subjectTypeNames.get(line.subjectName)?.sortOrder ?? null,
      }));
    }

    const subjectGroups = groupBulletinLinesBySubjectType(resolvedLines);

    const previousTerms = await db
      .select({
        id: schoolTerms.id,
        name: schoolTerms.name,
        periodType: schoolTerms.periodType,
        orderIndex: schoolTerms.orderIndex,
        academicYearId: schoolTerms.academicYearId,
        cycleId: schoolTerms.cycleId,
        startDate: schoolTerms.startDate,
        endDate: schoolTerms.endDate,
      })
      .from(schoolTerms)
      .where(eq(schoolTerms.academicYearId, header.schoolYearId))
      .orderBy(schoolTerms.orderIndex);

    const historicalBulletins = await db
      .select({
        id: bulletins.id,
        termId: bulletins.termId,
        studentId: bulletins.studentId,
        schoolYearId: bulletins.schoolYearId,
        average: bulletins.average,
        rank: bulletins.rank,
      })
      .from(bulletins)
      .where(and(
        eq(bulletins.studentId, header.studentId),
        eq(bulletins.schoolYearId, header.schoolYearId),
      ))
      .orderBy(desc(bulletins.id));

    const annualClassStudents = await db
      .select({ id: students.id })
      .from(students)
      .where(eq(students.classId, header.classId));
    const annualBulletins = await db
      .select({
        id: bulletins.id,
        studentId: bulletins.studentId,
        schoolYearId: bulletins.schoolYearId,
        termId: bulletins.termId,
        average: bulletins.average,
      })
      .from(bulletins)
      .where(and(
        eq(bulletins.classId, header.classId),
        eq(bulletins.schoolYearId, header.schoolYearId),
      ));
    const annualPeriodScope = resolveAnnualPeriodScope(header.termId, previousTerms, header.schoolYearId);
    const annualResults = annualPeriodScope.isLastPeriod
      ? calculateAnnualBulletinResults({
        targetStudentId: header.studentId,
        classStudentIds: annualClassStudents.map((student) => student.id),
        periods: annualPeriodScope.periods,
        bulletins: annualBulletins,
      })
      : { annualAverage: null, annualRank: null };

    const previousPeriodSummaries = resolvePreviousPeriodSummaries({
      currentTermId: header.termId,
      studentId: header.studentId,
      schoolYearId: header.schoolYearId,
      terms: previousTerms,
      bulletins: historicalBulletins,
    });

    // Count only real absences for the student within the bulletin's class and term date range.
    // The existing schema keeps absences in the `absences` table and does not have a dedicated delays table.
    let absencesCount = 0;
    if (header.termStartDate && header.termEndDate) {
      const absenceRows = await db
        .select({ count: sql<number>`count(distinct ${absences.id})::int` })
        .from(absences)
        .where(
          and(
            eq(absences.studentId, header.studentId),
            eq(absences.classId, header.classId),
            sql`${absences.date} >= ${header.termStartDate}`,
            sql`${absences.date} <= ${header.termEndDate}`,
          ),
        );
      absencesCount = Number(absenceRows[0]?.count ?? 0);
    }

    return {
      id: header.id,
      studentId: header.studentId,
      studentName: `${header.studentLastName} ${header.studentFirstName}`.trim(),
      studentMatricule: header.studentMatricule,
      studentGender: header.studentGender,
      studentStatus: header.studentStatus,
      classId: header.classId,
      className: header.className,
      classTeacherName: header.classTeacherName,
      classStudentCount: header.classStudentCount,
      schoolName: header.schoolName,
      school: header.school ? { ...header.school, logoPath: header.school.logoPath ?? null, logo: null } : { name: header.schoolName },
      schoolYearId: header.schoolYearId,
      schoolYearName: header.schoolYearName,
      termId: header.termId,
      termName: header.termName,
      average: parseNumber(header.average),
      totalPoints: parseNumber(header.totalPoints) ?? 0,
      totalCoefficients: parseNumber(header.totalCoefficients) ?? 0,
      rank: header.rank,
      annualAverage: annualResults.annualAverage,
      annualRank: annualResults.annualRank,
      mention: header.mention,
      appreciation: header.appreciation,
      absences: absencesCount,
      retards: 0,
      generatedAt: header.generatedAt ? header.generatedAt.toISOString() : null,
      lines: resolvedLines,
      subjectGroups,
      previousPeriodSummaries,
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

export const computeWrappedTextLines = (
  value: string,
  maxWidth: number,
  font: any,
  size: number,
  maxLines = 2,
): { lines: string[]; width: number } => {
  const rawValue = sanitizePdfText(value ?? '-');
  const normalized = rawValue.trim() ? rawValue : '-';
  const words = normalized.split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return { lines: ['-'], width: font.widthOfTextAtSize('-', size) };
  }

  const lines: string[] = [];
  let current = '';

  const pushCurrent = () => {
    if (current.trim()) {
      lines.push(current.trim());
    }
    current = '';
  };

  for (const word of words) {
    if (font.widthOfTextAtSize(word, size) > maxWidth && !current) {
      let fragment = '';
      for (const character of word) {
        const candidate = `${fragment}${character}`;
        if (font.widthOfTextAtSize(candidate, size) > maxWidth && fragment) {
          lines.push(fragment);
          fragment = character;
        } else {
          fragment = candidate;
        }
      }
      current = fragment;
      continue;
    }

    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      current = candidate;
    } else if (current) {
      pushCurrent();
      const nextCandidate = word;
      if (font.widthOfTextAtSize(nextCandidate, size) <= maxWidth) {
        current = nextCandidate;
      } else {
        let fragment = '';
        for (const character of word) {
          const candidateChar = `${fragment}${character}`;
          if (font.widthOfTextAtSize(candidateChar, size) > maxWidth && fragment) {
            lines.push(fragment);
            fragment = character;
          } else {
            fragment = candidateChar;
          }
        }
        current = fragment;
      }
    } else {
      current = word;
    }
  }

  if (current.trim()) {
    lines.push(current.trim());
  }

  const clampedLines = lines.slice(0, maxLines).length > 0 ? lines.slice(0, maxLines) : ['-'];
  const lineWidth = clampedLines.reduce((maxValue, line) => Math.max(maxValue, font.widthOfTextAtSize(line, size)), 0);
  return { lines: clampedLines, width: lineWidth };
};

export const computeSchoolLogoRenderMetrics = (
  imageWidth: number,
  imageHeight: number,
  targetWidth: number,
  centerX = 0,
  centerY = 0,
  targetHeight?: number,
) => {
  const safeTargetWidth = Math.max(1, Number.isFinite(targetWidth) ? targetWidth : 44);
  const safeTargetHeight = Number.isFinite(targetHeight) ? Math.max(1, targetHeight) : safeTargetWidth;
  const width = Math.max(1, Number.isFinite(imageWidth) ? imageWidth : 1);
  const height = Math.max(1, Number.isFinite(imageHeight) ? imageHeight : 1);
  const scale = Math.min(safeTargetWidth / width, safeTargetHeight / height);
  const drawWidth = width * scale;
  const drawHeight = height * scale;
  const x = centerX - drawWidth / 2;
  const y = centerY - drawHeight / 2;

  return {
    targetWidth: safeTargetWidth,
    targetHeight: safeTargetHeight,
    scale,
    drawWidth,
    drawHeight,
    x,
    y,
  };
};

export interface HeaderParagraphLineLayout {
  text: string;
  words: string[];
  wordSpacing: number;
  justify: boolean;
  width: number;
}

export const computeHeaderParagraphLayout = (
  value: string,
  maxWidth: number,
  font: any,
  size: number,
): HeaderParagraphLineLayout[] => {
  const rawValue = String(value ?? '');
  const createLine = (lineText: string): HeaderParagraphLineLayout => {
    const text = sanitizePdfText(lineText).replace(/\s+/g, ' ').trim();
    const words = text.split(/\s+/).filter(Boolean);
    return {
      text,
      words,
      wordSpacing: words.length > 1 ? font.widthOfTextAtSize(' ', size) : 0,
      justify: false,
      width: font.widthOfTextAtSize(text, size),
    };
  };

  const normalizedValue = sanitizePdfText(rawValue).replace(/\s+/g, ' ').trim();
  if (!normalizedValue) {
    return [
      { text: '', words: [], wordSpacing: 0, justify: false, width: 0 },
      { text: '', words: [], wordSpacing: 0, justify: false, width: 0 },
    ];
  }

  const explicitSegments = normalizedValue
    .split('|')
    .map((segment) => segment.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  if (explicitSegments.length > 1) {
    const [first, ...rest] = explicitSegments;
    const lines = [createLine(first), createLine(rest.join(' '))].filter((line) => line.text.length > 0);
    return lines.length > 0 ? lines : [
      { text: normalizedValue, words: normalizedValue.split(/\s+/).filter(Boolean), wordSpacing: 0, justify: false, width: font.widthOfTextAtSize(normalizedValue, size) },
    ];
  }

  const words = normalizedValue.split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return [
      { text: '', words: [], wordSpacing: 0, justify: false, width: 0 },
      { text: '', words: [], wordSpacing: 0, justify: false, width: 0 },
    ];
  }

  if (words.length === 1) {
    return [createLine(words[0])];
  }

  let bestLeftWords: string[] = [];
  let bestRightWords: string[] = [];
  let bestScore = Number.POSITIVE_INFINITY;

  for (let cut = 1; cut < words.length; cut += 1) {
    const leftWords = words.slice(0, cut);
    const rightWords = words.slice(cut);
    const leftText = leftWords.join(' ');
    const rightText = rightWords.join(' ');

    const leftWidth = font.widthOfTextAtSize(leftText, size);
    const rightWidth = font.widthOfTextAtSize(rightText, size);
    if (leftWidth > maxWidth || rightWidth > maxWidth) continue;

    const widthGap = Math.abs((leftWidth + rightWidth) - maxWidth);
    const balancePenalty = Math.abs(leftWidth - rightWidth);
    const score = widthGap + balancePenalty * 0.1;

    if (score < bestScore) {
      bestLeftWords = leftWords;
      bestRightWords = rightWords;
      bestScore = score;
    }
  }

  if (bestLeftWords.length > 0 && bestRightWords.length > 0) {
    return [createLine(bestLeftWords.join(' ')), createLine(bestRightWords.join(' '))];
  }

  const midpoint = Math.ceil(words.length / 2);
  const fallbackLeftWords = words.slice(0, midpoint);
  const fallbackRightWords = words.slice(midpoint);
  return [
    createLine(fallbackLeftWords.join(' ')),
    createLine(fallbackRightWords.join(' ')),
  ].filter((line) => line.text.length > 0);
};

export const fitHeaderParagraphFontSize = (
  value: string,
  maxWidth: number,
  font: any,
  initialSize: number,
  minSize: number,
): number => {
  let size = initialSize;
  while (size >= minSize) {
    const lines = computeHeaderParagraphLayout(value, maxWidth, font, size);
    if (lines.every((line) => line.width <= maxWidth)) {
      return size;
    }
    if (size === minSize) {
      break;
    }
    size -= 0.2;
  }

  return minSize;
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

  const black = rgb(0, 0, 0);
  const primary = black;
  const secondary = black;
  const text = black;
  const muted = black;

  const pdf = await PDFDocument.create();
  const pageSize: [number, number] = [595.28, 841.89];
  const margin = 16;

  const { regular: fontRegular, bold: fontBold, boldItalic: fontBoldItalic } = await loadPdfFonts(pdf);
  let logo: any = null;
  let resolvedLogoPath: string | null = null;
  const logoPath = data.school?.logoPath?.trim();
  if (logoPath) {
    try {
      const rawLogoPath = logoPath.replace(/\\/g, '/');
      const logoStorageDir = path.resolve(process.cwd(), 'uploads', 'school-logos');
      const candidatePaths = new Set<string>();

      const addCandidate = (candidate: string | undefined | null) => {
        if (!candidate) return;
        const cleaned = candidate.trim().replace(/\\/g, '/');
        if (!cleaned) return;

        const normalized = cleaned.startsWith('/') ? path.resolve(cleaned) : path.resolve(process.cwd(), cleaned);
        candidatePaths.add(normalized);

        const relativeCandidate = cleaned.replace(/^\.\//, '');
        if (relativeCandidate.startsWith('uploads/')) {
          candidatePaths.add(path.resolve(process.cwd(), relativeCandidate));
        }
        if (relativeCandidate.startsWith('school-logos/')) {
          candidatePaths.add(path.resolve(process.cwd(), 'uploads', relativeCandidate));
          candidatePaths.add(path.resolve(logoStorageDir, path.basename(relativeCandidate)));
        }
        candidatePaths.add(path.resolve(logoStorageDir, path.basename(cleaned)));
      };

      addCandidate(rawLogoPath);
      addCandidate(path.basename(rawLogoPath));

      const candidate = Array.from(candidatePaths)
        .find((filePath) => (filePath === logoStorageDir || filePath.startsWith(`${logoStorageDir}${path.sep}`)) && !filePath.includes(`${path.sep}..${path.sep}`));

      resolvedLogoPath = candidate ?? null;
      const logoFilePath = resolvedLogoPath ?? path.resolve(logoStorageDir, path.basename(rawLogoPath));
      const logoExtension = path.extname(logoFilePath).toLowerCase();
      const isSupportedType = ['.png', '.jpg', '.jpeg'].includes(logoExtension);
      const isInsideLogoStorage = logoFilePath === logoStorageDir || logoFilePath.startsWith(`${logoStorageDir}${path.sep}`);

      let fileExists = false;
      let fileSize = 0;
      try {
        const fileInfo = await stat(logoFilePath);
        fileExists = fileInfo.isFile();
        fileSize = fileInfo.size;
      } catch (statErr) {
        console.warn('[bulletinPdf] school logo file missing', {
          rawLogoPath,
          resolvedPath: logoFilePath,
          extension: logoExtension,
          isInsideLogoStorage,
          fileExists: false,
          error: statErr instanceof Error ? statErr.message : String(statErr),
        });
      }

      if (!isInsideLogoStorage || !isSupportedType) {
        throw new Error(`Unsupported school logo path: ${rawLogoPath}`);
      }

      if (!fileExists) {
        throw new Error(`School logo file not found: ${logoFilePath}`);
      }

      console.warn('[bulletinPdf] school logo diagnostics', {
        rawLogoPath,
        resolvedPath: logoFilePath,
        exists: fileExists,
        extension: logoExtension,
        size: fileSize,
        isInsideLogoStorage,
      });

      const logoBytes = new Uint8Array(await readFile(logoFilePath));
      logo = logoExtension === '.png'
        ? await pdf.embedPng(logoBytes)
        : await pdf.embedJpg(logoBytes);

      console.info('[bulletinPdf] LOGO_EMBEDDED_AND_DRAWN', {
        rawLogoPath,
        resolvedPath: logoFilePath,
        extension: logoExtension,
        width: logo.width,
        height: logo.height,
      });
    } catch (err) {
      console.warn('[bulletinPdf] school logo load failed', {
        rawLogoPath: logoPath,
        resolvedPath: resolvedLogoPath,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const school = data.school ?? { name: data.schoolName };
  const white = rgb(1, 1, 1);
  const lightBorder = hexToRgb('#cbd5e1');
  const tableBorder = rgb(0, 0, 0);
  const tableBorderWidth = 1.0;
  const softBackground = hexToRgb('#f8fafc');
  const tableX = margin;
  const tableWidth = pageSize[0] - margin * 2;
  const notationColumnWidth = 30;
  const compoColumnWidth = 37;
  const noteCoefColumnWidth = 39;
  const signatureColumnWidth = 66;
  const appreciationColumnWidth = 54;
  const professorColumnWidth = tableWidth - (86 + notationColumnWidth * 6 + compoColumnWidth + noteCoefColumnWidth + appreciationColumnWidth + signatureColumnWidth);
  const columns = [
    { label: 'Matières', width: 86 },
    { label: 'Moy. interro', width: notationColumnWidth },
    { label: 'Devoir', width: notationColumnWidth },
    { label: 'Moy. Clas', width: notationColumnWidth },
    { label: 'Compo.', width: compoColumnWidth },
    { label: BULLETIN_FINAL_AVERAGE_LABEL, width: notationColumnWidth },
    { label: 'Coef.', width: notationColumnWidth },
    { label: 'Note coef.', width: noteCoefColumnWidth },
    { label: 'Rang', width: notationColumnWidth },
    { label: 'Professeur', width: professorColumnWidth },
    { label: 'Appréciation', width: appreciationColumnWidth },
    { label: 'Signature', width: signatureColumnWidth },
  ];

  // Define multi-line headers for better space usage
  const headerLines = [
    ['Matières'],
    ['Inter.'],
    ['Dev.'],
    ['Moy.', 'Clas'],
    ['Compo.'],
    ['Note', '/20'],
    ['Coef.'],
    ['Note', 'coef.'],
    ['Rang'],
    ['Professeur'],
    ['Appréciation'],
    ['Signature'],
  ];

  const wrapText = (value: string, maxWidth: number, font: any, size: number): string[] => computeWrappedTextLines(value, maxWidth, font, size, Number.MAX_SAFE_INTEGER).lines;

  const fitSubjectCellLayout = (value: string, maxWidth: number, initialSize = 7.5, minSize = 5.5, activeFont = fontBold): { lines: string[]; size: number } => {
    const normalizedValue = sanitizePdfText(value ?? '-').trim() || '-';
    const words = normalizedValue.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      return { lines: ['-'], size: initialSize };
    }

    const buildWordWrappedLines = (size: number): string[] => {
      const lines: string[] = [];
      let current = '';

      const pushCurrent = () => {
        if (current.trim()) {
          lines.push(current.trim());
        }
        current = '';
      };

      for (const word of words) {
        const candidate = current ? `${current} ${word}` : word;
        if (activeFont.widthOfTextAtSize(candidate, size) <= maxWidth) {
          current = candidate;
          continue;
        }

        if (current) {
          pushCurrent();
        }

        if (activeFont.widthOfTextAtSize(word, size) <= maxWidth) {
          current = word;
          continue;
        }

        let fragment = '';
        for (const character of word) {
          const fragmentCandidate = `${fragment}${character}`;
          if (activeFont.widthOfTextAtSize(fragmentCandidate, size) <= maxWidth || fragment.length === 0) {
            fragment = fragmentCandidate;
          } else {
            lines.push(fragment);
            fragment = character;
          }
        }
        current = fragment;
      }

      if (current.trim()) {
        lines.push(current.trim());
      }

      return lines.length > 0 ? lines : ['-'];
    };

    for (let size = initialSize; size >= minSize; size -= 0.2) {
      const candidateLines = buildWordWrappedLines(size);
      if (candidateLines.length <= 2 && candidateLines.every((line) => activeFont.widthOfTextAtSize(line, size) <= maxWidth)) {
        return { lines: candidateLines, size };
      }
    }

    const fallbackLines = buildWordWrappedLines(minSize);
    return {
      lines: fallbackLines.slice(0, 2),
      size: minSize,
    };
  };

  const drawWrappedText = (page: any, value: string, x: number, y: number, maxWidth: number, size: number, color: any, font: any, maxLines = 2) => {
    const lines = computeWrappedTextLines(value, maxWidth, font, size, maxLines).lines;
    lines.forEach((line, index) => drawText(page, line, x, y - index * (size + 2), size, color, font));
  };

  const drawCenteredWrappedText = (page: any, value: string, centerX: number, y: number, maxWidth: number, size: number, color: any, font: any, maxLines = 2) => {
    const lines = computeWrappedTextLines(value, maxWidth, font, size, maxLines).lines;
    lines.forEach((line, index) => {
      const lineWidth = font.widthOfTextAtSize(sanitizePdfText(line), size);
      drawText(page, line, centerX - lineWidth / 2, y - index * (size + 2), size, color, font);
    });
  };

  const drawCenteredSingleLine = (page: any, value: string, centerX: number, y: number, maxWidth: number, initialSize: number, minSize: number, color: any, font: any) => {
    let size = initialSize;
    const safeValue = sanitizePdfText(value);
    while (size > minSize && font.widthOfTextAtSize(safeValue, size) > maxWidth) {
      size -= 0.2;
    }
    if (font.widthOfTextAtSize(safeValue, size) <= maxWidth) {
      drawText(page, value, centerX - font.widthOfTextAtSize(safeValue, size) / 2, y, size, color, font);
      return;
    }
    drawCenteredWrappedText(page, value, centerX, y, maxWidth, minSize, color, font, 2);
  };

  const drawCenteredCellValue = (page: any, value: string, columnX: number, columnWidth: number, cellTopY: number, cellBottomY: number, size: number, color: any, font: any) => {
    const safeValue = sanitizePdfText(value);
    const textWidth = font.widthOfTextAtSize(safeValue, size);
    const textHeight = font.heightAtSize(size, { descender: false });
    const textX = columnX + (columnWidth - textWidth) / 2;
    const cellCenterY = (cellTopY + cellBottomY) / 2;
    const textY = cellCenterY - textHeight / 2;
    drawText(page, value, textX, textY, size, color, font);
  };

  const drawCenteredFittedCellText = (page: any, value: string, columnX: number, columnWidth: number, cellTopY: number, cellBottomY: number, initialSize: number, color: any, font: any) => {
    const cellPadding = 7;
    const maxWidth = columnWidth - cellPadding * 2;
    let size = initialSize;
    let lines = computeWrappedTextLines(value, maxWidth, font, size, 2).lines;
    while (size > 5.5 && lines.some((line) => font.widthOfTextAtSize(sanitizePdfText(line), size) > maxWidth)) {
      size = Math.max(5.5, size - 0.2);
      lines = computeWrappedTextLines(value, maxWidth, font, size, 2).lines;
    }

    const textHeight = font.heightAtSize(size, { descender: false });
    const lineSpacing = size + 2;
    const textBlockHeight = textHeight + Math.max(0, lines.length - 1) * lineSpacing;
    const cellCenterY = (cellTopY + cellBottomY) / 2;
    const firstBaselineY = cellCenterY - textHeight / 2 + (textBlockHeight - textHeight) / 2;
    lines.forEach((line, index) => {
      const textWidth = font.widthOfTextAtSize(sanitizePdfText(line), size);
      const textX = columnX + (columnWidth - textWidth) / 2;
      const textY = firstBaselineY - index * lineSpacing;
      drawText(page, line, textX, textY, size, color, font);
    });
  };

  const drawHeaderParagraph = (page: any, value: string, x: number, y: number, maxWidth: number, initialSize: number, minSize: number, color: any, font: any, lineSpacing = initialSize + 11, fitToWidth = true) => {
    const size = fitToWidth ? fitHeaderParagraphFontSize(value, maxWidth, font, initialSize, minSize) : initialSize;
    const lines = computeHeaderParagraphLayout(value, maxWidth, font, size);
    lines.forEach((line, lineIndex) => {
      const lineWidth = font.widthOfTextAtSize(line.text, size);
      drawText(page, line.text, x + (maxWidth - lineWidth) / 2, y - lineIndex * lineSpacing, size, color, font);
    });
  };

  const drawHeader = (page: any, _includeStudentBlock: boolean) => {
    const width = page.getWidth();
    const height = page.getHeight();
    const headerTop = height - 18;
    const headerBottom = height - 136;
    const leftX = margin + 6;
    const centerX = width / 2;
    const rightX = width - margin - 145;
    page.drawCircle({ x: centerX, y: height - 70, size: 26, borderColor: lightBorder, borderWidth: 0.8 });
    if (logo) {
      const centralRectLeft = margin + 178 + 8;
      const centralRectRight = width - margin - 178 - 8;
      const centralRectBottom = headerBottom + 8;
      const centralRectTop = headerTop - 8;
      const centralRectWidth = Math.max(1, centralRectRight - centralRectLeft);
      const centralRectHeight = Math.max(1, centralRectTop - centralRectBottom);
      const logoZoneCenterX = (centralRectLeft + centralRectRight) / 2;
      const logoZoneCenterY = (centralRectBottom + centralRectTop) / 2;

      const logoRender = computeSchoolLogoRenderMetrics(
        logo.width,
        logo.height,
        centralRectWidth,
        logoZoneCenterX,
        logoZoneCenterY,
        centralRectHeight,
      );

      page.drawImage(logo, {
        x: logoRender.x,
        y: logoRender.y,
        width: logoRender.drawWidth,
        height: logoRender.drawHeight,
      });
      console.info('[bulletinPdf] LOGO_EMBEDDED_AND_DRAWN', {
        x: logoRender.x,
        y: logoRender.y,
        width: logoRender.drawWidth,
        height: logoRender.drawHeight,
        targetWidth: logoRender.targetWidth,
        targetHeight: logoRender.targetHeight,
        logoZone: {
          left: centralRectLeft,
          right: centralRectRight,
          top: centralRectTop,
          bottom: centralRectBottom,
          width: centralRectWidth,
          height: centralRectHeight,
        },
      });
    }
    const leftColumnCenter = margin + 89;
    const leftHeaderWidth = 170;
    const ministryLabel = school.ministryName?.trim() ?? '';
    const educationDirectionLabel = school.educationDirection?.trim()
      || (school.region?.trim()
        ? `DIRECTION RÉGIONALE DE L'ÉDUCATION ${school.region.trim()}`
        : "DIRECTION RÉGIONALE DE L'ÉDUCATION");
    const headerInstitutionText = [ministryLabel, educationDirectionLabel].filter(Boolean).join(' ');
    const institutionHeaderWidth = margin + 178 - leftX;
    if (headerInstitutionText) drawHeaderParagraph(page, headerInstitutionText, leftX + 25, height - 34, institutionHeaderWidth, 8, 5.5, text, fontBold, 20, false);
    if (school.abbreviation) drawCenteredWrappedText(page, school.abbreviation, leftColumnCenter, height - 80, 166, 10, text, fontBold, 1);
    drawCenteredWrappedText(page, school.officialName || school.name, leftColumnCenter, height - 98, 166, 11, text, fontBold, 2);
    const postalAndPhone = [
      school.postalBox?.trim() ? `BP : ${school.postalBox.trim()}` : null,
      school.phone?.trim()
        ? school.phone2?.trim()
          ? `Tél : ${school.phone.trim()} / ${school.phone2.trim().replace(/^\+228\s*/, '')}`
          : `Tél : ${school.phone.trim()}`
        : school.phone2?.trim() ? `Tél : ${school.phone2.trim()}` : null,
      school.email?.trim() ? `Email : ${school.email.trim()}` : null,
    ].filter((value): value is string => Boolean(value));
    if (postalAndPhone.length > 0) {
      const emailLine = school.email?.trim() ? `Email : ${school.email.trim()}` : null;
      const nonEmailLines = postalAndPhone.filter((value) => !value.startsWith('Email :'));
      const coordinateLines = emailLine
        ? nonEmailLines.length > 0 ? [nonEmailLines.join(' '), emailLine] : [emailLine]
        : [postalAndPhone.join(' ')];
      const firstLineWidth = fontBoldItalic.widthOfTextAtSize(coordinateLines[0], 7);
      const coordinateCenterX = leftX + 25 + firstLineWidth / 2;
      coordinateLines.forEach((line, lineIndex) => {
        const lineWidth = fontBoldItalic.widthOfTextAtSize(line, 7);
        drawCenteredWrappedText(page, line, coordinateCenterX, height - 119 - lineIndex * 9, lineWidth, 7, text, fontBoldItalic, 1);
      });
    }
    const republicText = 'REPUBLIQUE TOGOLAISE';
    const republicTextWidth = fontBold.widthOfTextAtSize(republicText, 9);
    const republicMarker = '-----------------';
    const republicMarkerWidth = fontBold.widthOfTextAtSize('LIQUE TOG', 9);
    drawText(page, republicText, rightX, height - 38, 9, text, fontBold);
    drawText(page, republicMarker, rightX + (republicTextWidth - republicMarkerWidth) / 2, height - 47, 9, text, fontBold);
    const mottoText = school.motto?.trim() || 'Travail-Liberté-Patrie';
    const mottoWidth = fontBold.widthOfTextAtSize(mottoText, 8);
    const mottoX = rightX + (republicTextWidth - mottoWidth) / 2;
    drawText(page, mottoText, mottoX, height - 56, 8, text, fontBold);
    const schoolYearText = `${template.labels.schoolYear}: ${data.schoolYearName}`;
    const schoolYearWidth = fontBold.widthOfTextAtSize(schoolYearText, 11);
    const schoolYearX = rightX + (republicTextWidth - schoolYearWidth) / 2;
    drawText(page, schoolYearText, schoolYearX, height - 98, 11, text, fontBold);
    return height - 148;
  };

  const drawTableHeader = (page: any, y: number) => {
    // Header height accommodates up to 2 lines of text
    const headerHeight = 28;
    const headerOuterOverlap = tableBorderWidth / 2;
    page.drawRectangle({ x: tableX, y: y - headerHeight, width: tableWidth, height: headerHeight, borderColor: tableBorder, borderWidth: tableBorderWidth });
    page.drawLine({ start: { x: tableX, y: y + headerOuterOverlap }, end: { x: tableX, y: y - headerHeight - headerOuterOverlap }, color: tableBorder, thickness: tableBorderWidth });
    page.drawLine({ start: { x: tableX + tableWidth, y: y + headerOuterOverlap }, end: { x: tableX + tableWidth, y: y - headerHeight - headerOuterOverlap }, color: tableBorder, thickness: tableBorderWidth });
    let x = tableX;
    columns.forEach((column, index) => {
      const lines = headerLines[index];
      const columnX = x;
      const columnWidth = column.width;
      if (lines.length === 1) {
        const line = lines[0];
        const lineWidth = fontBold.widthOfTextAtSize(line, 10);
        const headerSize = 10;
        const renderedWidth = fontBold.widthOfTextAtSize(line, headerSize);
        const textX = line === 'Signature'
          ? columnX + (tableX + tableWidth - columnX - renderedWidth) / 2
          : columnX + (columnWidth - renderedWidth) / 2;
        drawText(page, line, textX, y - 18, headerSize, text, fontBold);
      } else {
        const isNoteOverTwentyHeader = index === 5 && lines.length === 2 && lines[0] === 'Note' && lines[1] === '/20';
        const isMoyClasHeader = index === 3 && lines.length === 2 && lines[0] === 'Moy.' && lines[1] === 'Clas';
        lines.forEach((line, lineIndex) => {
          const lineWidth = fontBold.widthOfTextAtSize(line, 9.5);
          const textX = columnX + (columnWidth - lineWidth) / 2;
          const verticalOffset = isNoteOverTwentyHeader
            ? 13 + lineIndex * 8
            : isMoyClasHeader
              ? 13 + lineIndex * 8
              : 21 - lineIndex * 8;
          drawText(page, line, textX, y - verticalOffset, 9.5, text, fontBold);
        });
      }
      x += column.width;
    });
    let separatorX = tableX;
    columns.slice(0, -1).forEach((column) => {
      separatorX += column.width;
      page.drawLine({ start: { x: separatorX, y }, end: { x: separatorX, y: y - headerHeight }, color: tableBorder, thickness: tableBorderWidth });
    });
    return y - (headerHeight + 4);
  };

  const page = pdf.addPage(pageSize);
  const studentHeaderOffsetY = 8;
  const outerBoxTop = page.getHeight() - 18 + 8;
  const outerBoxBottom = page.getHeight() - 148 - 25 - studentHeaderOffsetY - 10;
  const outerBoxWidth = tableWidth;
  const outerBoxHeight = outerBoxTop - outerBoxBottom;
  page.drawSvgPath(
    `M 8,0 H ${outerBoxWidth - 8} Q ${outerBoxWidth},0 ${outerBoxWidth},8 V ${outerBoxHeight - 8} Q ${outerBoxWidth},${outerBoxHeight} ${outerBoxWidth - 8},${outerBoxHeight} H 8 Q 0,${outerBoxHeight} 0,${outerBoxHeight - 8} V 8 Q 0,0 8,0 Z`,
    {
      x: margin,
      y: outerBoxTop,
      borderColor: hexToRgb('#000000'),
      borderWidth: 1.2,
    },
  );
  let cursorY = drawHeader(page, true);

  const title = `${template.labels.title} DU ${data.termName}`;
  const titleWidth = fontBold.widthOfTextAtSize(sanitizePdfText(title), 14);
  const titleBoxWidth = titleWidth + 16;
  const titleBoxHeight = 26;
  const titleBoxX = (page.getWidth() - titleBoxWidth) / 2;
  page.drawSvgPath(
    `M 5,0 H ${titleBoxWidth - 5} Q ${titleBoxWidth},0 ${titleBoxWidth},5 V ${titleBoxHeight - 5} Q ${titleBoxWidth},${titleBoxHeight} ${titleBoxWidth - 5},${titleBoxHeight} H 5 Q 0,${titleBoxHeight} 0,${titleBoxHeight - 5} V 5 Q 0,0 5,0 Z`,
    {
      x: titleBoxX,
      y: cursorY + 13 + fontBold.heightAtSize(14, { descender: false }) / 2 - studentHeaderOffsetY,
      color: hexToRgb('#f8f8f2'),
      borderColor: hexToRgb('#000000'),
      borderWidth: 1.2,
    },
  );
  drawText(page, title, (page.getWidth() - titleWidth) / 2, cursorY - studentHeaderOffsetY, 14, text, fontBold);
  const classLabel = `${template.labels.class}: ${data.className}`;
  const classEffectif = `EFFECTIF : ${data.classStudentCount}`;
  const classLabelWidth = fontBold.widthOfTextAtSize(sanitizePdfText(classLabel), 14);
  const classEffectifWidth = fontBold.widthOfTextAtSize(sanitizePdfText(classEffectif), 14);
  const classLineGap = 12;
  const classLineWidth = classLabelWidth + classLineGap + classEffectifWidth;
  const classLineX = (page.getWidth() - classLineWidth) / 2;
  const classLineY = cursorY - 25 - studentHeaderOffsetY;
  drawText(page, classLabel, classLineX, classLineY, 14, text, fontBold);
  drawText(page, classEffectif, classLineX + classLabelWidth + classLineGap, classLineY, 14, text, fontBold);
  const studentLabel = "NOM ET PRENOMS DE L'ELEVE :";
  const studentName = sanitizePdfText(data.studentName);
  const studentLabelSize = 8;
  const studentNameSize = 10.5;
  const studentGap = 4;
  const studentLabelWidth = fontBold.widthOfTextAtSize(studentLabel, 13);
  const studentNameWidth = fontBold.widthOfTextAtSize(studentName, studentNameSize);
  const studentNameX = tableX + 12 + studentLabelWidth + studentGap;
  const studentBlockCenterX = (tableX + 12 + studentNameX + studentNameWidth) / 2;
  drawText(page, studentLabel, tableX + 12, cursorY - 51 - studentHeaderOffsetY, 13, text, fontBold);
  drawText(page, studentName, studentNameX, cursorY - 51 - studentHeaderOffsetY, 13, text, fontBold);
  if (data.studentMatricule?.trim()) {
    const matriculeText = `N° Mle : ${sanitizePdfTextPreservingAccents(data.studentMatricule)}`;
    const matriculeWidth = fontRegular.widthOfTextAtSize(matriculeText, studentLabelSize);
    drawText(page, matriculeText, studentBlockCenterX - matriculeWidth / 2, cursorY - 67 - studentHeaderOffsetY, 13, text, fontBold);
  }
  const pdfStatus = formatStudentStatusForPdf(data.studentStatus);
  const statusValue = pdfStatus ? sanitizePdfText(pdfStatus) : null;
  const genderValue = data.studentGender?.trim() ? sanitizePdfText(data.studentGender) : null;
  const rightEdge = tableX + tableWidth - 12;
  const rightBlocks = [
    statusValue ? { label: 'STATUT :', value: statusValue } : null,
    genderValue ? { label: 'SEXE :', value: genderValue } : null,
  ].filter((block): block is { label: string; value: string } => block !== null);
  rightBlocks.forEach((block, index) => {
    const isStatusBlock = block.label === 'STATUT :';
    const isGenderBlock = block.label === 'SEXE :';
    const labelWidth = isStatusBlock || isGenderBlock
      ? fontBold.widthOfTextAtSize(block.label, 13)
      : fontRegular.widthOfTextAtSize(block.label, studentLabelSize);
    const valueWidth = isStatusBlock || isGenderBlock
      ? fontBold.widthOfTextAtSize(block.value, 13)
      : fontBold.widthOfTextAtSize(block.value, studentNameSize);
    const blockWidth = labelWidth + studentGap + valueWidth;
    const blockY = cursorY - 51 - index * 16 - (isStatusBlock || isGenderBlock ? studentHeaderOffsetY : 0);
    const rightAlignedX = rightEdge - blockWidth;
    const minimumX = index === 0 ? studentNameX + studentNameWidth + 12 : rightAlignedX;
    const blockX = Math.max(rightAlignedX, minimumX);
    drawText(page, block.label, blockX, blockY, isStatusBlock || isGenderBlock ? 13 : studentLabelSize, text, isStatusBlock || isGenderBlock ? fontBold : fontRegular);
    drawText(page, block.value, blockX + labelWidth + studentGap, blockY, isStatusBlock || isGenderBlock ? 13 : studentNameSize, text, fontBold);
  });
  cursorY -= 80;

  const tableSummaryY = cursorY;

  const tableTop = tableSummaryY - 12;
  const groupedDataAvailable = data.subjectGroups !== undefined;
  const orderedSubjectGroups = [...(data.subjectGroups ?? [])].sort((a, b) => {
    if (a.subjectTypeId == null) return 1;
    if (b.subjectTypeId == null) return -1;
    return a.sortOrder - b.sortOrder || a.subjectTypeId - b.subjectTypeId;
  });
  const renderEntries: Array<{ groupTitle?: string; subtotal?: { label: string; lines: BulletinPdfLine[] }; line?: BulletinPdfLine }> = groupedDataAvailable
    ? orderedSubjectGroups.flatMap((group) => [
      { groupTitle: `MATIERES ${group.subjectTypeName.toUpperCase()}` },
      ...group.lines.map((line) => ({ line })),
      { subtotal: { label: `TOTAL MATIERES ${group.subjectTypeName.toUpperCase()}`, lines: group.lines } },
    ])
    : data.lines.map((line) => ({ line }));
  const totalRowHeight = 20;
  const tableContentHeight = renderEntries.reduce((height, entry) => {
    if (entry.groupTitle || entry.subtotal) return height + totalRowHeight;
    const line = entry.line;
    if (!line) return height;
    const subjectLines = wrapText(line.subjectName, columns[0].width - 14, fontRegular, 7.5).slice(0, 2);
    const commentLines = wrapText(line.teacherComment || '-', columns[4].width - 14, fontRegular, 7.5).slice(0, 2);
    const rowHeight = Math.max(18, Math.max(subjectLines.length, commentLines.length) * 8 + 6);
    return height + rowHeight;
  }, 0);
  const tableBottom = tableTop - (28 + 4) - tableContentHeight - totalRowHeight;
  cursorY = drawTableHeader(page, tableTop);

  for (const entry of renderEntries) {
    if (entry.groupTitle) {
      const groupRowLeftX = tableX;
      const groupRowRightX = tableX + tableWidth;
      const groupRowCenterX = (groupRowLeftX + groupRowRightX) / 2;
      const groupTitleFontSize = 11;
      const groupTitleTextWidth = fontBold.widthOfTextAtSize(entry.groupTitle, groupTitleFontSize);
      const groupTitleTextX = groupRowCenterX - groupTitleTextWidth / 2;
      drawText(page, entry.groupTitle, groupTitleTextX, cursorY - 14, groupTitleFontSize, primary, fontBold);
      const groupTitleOuterOverlap = tableBorderWidth / 2;
      page.drawLine({ start: { x: tableX, y: cursorY + 4 + groupTitleOuterOverlap }, end: { x: tableX, y: cursorY - totalRowHeight - groupTitleOuterOverlap }, color: tableBorder, thickness: tableBorderWidth });
      page.drawLine({ start: { x: tableX + tableWidth, y: cursorY + 4 + groupTitleOuterOverlap }, end: { x: tableX + tableWidth, y: cursorY - totalRowHeight - groupTitleOuterOverlap }, color: tableBorder, thickness: tableBorderWidth });
      cursorY -= 20;
      continue;
    }

    if (entry.subtotal) {
      const subtotalCoefficients = entry.subtotal.lines.reduce((total, line) => total + (line.coefficient ?? 0), 0);
      const subtotalWeightedPoints = entry.subtotal.lines.reduce(
        (total, line) => total + (line.average != null && line.coefficient != null ? line.average * line.coefficient : 0),
        0,
      );
      page.drawRectangle({
        x: tableX,
        y: cursorY - totalRowHeight,
        width: tableWidth,
        height: totalRowHeight,
        borderColor: tableBorder,
        borderWidth: tableBorderWidth,
      });
      drawText(page, entry.subtotal.label, tableX + 7, cursorY - 14, 10, primary, fontBold);
      const subtotalCoefficientColumnX = tableX + columns.slice(0, 6).reduce((total, column) => total + column.width, 0);
      const subtotalWeightedPointsColumnX = subtotalCoefficientColumnX + columns[6].width;
      drawCenteredCellValue(page, formatPdfDisplayNumberFixed(subtotalCoefficients), subtotalCoefficientColumnX, columns[6].width, cursorY, cursorY - totalRowHeight, 10, primary, fontBold);
      drawCenteredCellValue(page, formatPdfDisplayNumberFixed(subtotalWeightedPoints), subtotalWeightedPointsColumnX, columns[7].width, cursorY, cursorY - totalRowHeight, 10, primary, fontBold);
      [6, 7, 8].forEach((columnCount) => {
        const separatorX = tableX + columns.slice(0, columnCount).reduce((total, column) => total + column.width, 0);
        page.drawLine({ start: { x: separatorX, y: cursorY }, end: { x: separatorX, y: cursorY - totalRowHeight }, color: tableBorder, thickness: tableBorderWidth });
      });
      cursorY -= totalRowHeight;
      continue;
    }

    const line = entry.line;
    if (!line) continue;
    const subjectLayout = fitSubjectCellLayout(line.subjectName, columns[0].width - 14, 7.5, 5.5, fontBold);
    const subjectLines = subjectLayout.lines;
    const commentLines = wrapText(line.teacherComment || '-', columns[4].width - 14, fontBold, 7.5).slice(0, 2);
    const rowHeight = Math.max(18, Math.max(subjectLines.length, commentLines.length) * 8 + 6);
    page.drawRectangle({ x: tableX, y: cursorY - rowHeight, width: tableWidth, height: rowHeight, borderColor: tableBorder, borderWidth: tableBorderWidth });
    let x = tableX;
    const subjectBreakdown = {
      interrogation: line.interrogation ?? null,
      devoir: line.devoir ?? null,
      composition: line.composition ?? null,
      classAverage: line.classAverage ?? null,
    };
    const noteCoef = line.average != null && line.coefficient != null
      ? formatPdfDisplayNumberFixed(parseFloat(String(line.average)) * line.coefficient)
      : '-';

    // Column 1: Matières
    {
      const subjectCellWidth = columns[0].width;
      const subjectCellLeft = x;
      const subjectTextMaxWidth = subjectCellWidth - 14;
      const subjectLayout = fitSubjectCellLayout(line.subjectName, subjectTextMaxWidth, 7.5, 5.5, fontBold);
      const subjectTextLines = subjectLayout.lines;
      const subjectFontSize = subjectLayout.size + 2;
      const lineHeight = Math.max(8.5, subjectFontSize + 1.2);
      const textHeight = fontBold.heightAtSize(subjectFontSize, { descender: false });
      const lineSpacing = lineHeight + 1;
      const textBlockHeight = textHeight + Math.max(0, subjectTextLines.length - 1) * lineSpacing;
      const cellCenterY = cursorY - rowHeight / 2;
      const firstBaselineY = cellCenterY - textHeight / 2 + (textBlockHeight - textHeight) / 2;
      subjectTextLines.forEach((subjectLine, index) => {
        const lineWidth = fontBold.widthOfTextAtSize(sanitizePdfText(subjectLine), subjectFontSize);
        const lineX = subjectCellLeft + (subjectCellWidth - lineWidth) / 2;
        const lineY = firstBaselineY - index * (lineHeight + 1);
        drawText(page, subjectLine, lineX, lineY, subjectFontSize, text, fontBold);
      });
    }
    x += columns[0].width;

    // Column 2: Inter.
    drawCenteredCellValue(page, subjectBreakdown.interrogation == null ? '-' : formatPdfDisplayNumberFixed(subjectBreakdown.interrogation), x, columns[1].width, cursorY, cursorY - rowHeight, 9.5, text, fontBold);
    x += columns[1].width;

    // Column 3: Dev.
    drawCenteredCellValue(page, subjectBreakdown.devoir == null ? '-' : formatPdfDisplayNumberFixed(subjectBreakdown.devoir), x, columns[2].width, cursorY, cursorY - rowHeight, 9.5, text, fontBold);
    x += columns[2].width;

    // Column 4: Moy. Clas
    drawCenteredCellValue(page, subjectBreakdown.classAverage == null ? '-' : formatPdfDisplayNumberFixed(subjectBreakdown.classAverage), x, columns[3].width, cursorY, cursorY - rowHeight, 9.5, text, fontBold);
    x += columns[3].width;

    // Column 5: Compo.
    drawCenteredCellValue(page, subjectBreakdown.composition == null ? '-' : formatPdfDisplayNumberFixed(subjectBreakdown.composition), x, columns[4].width, cursorY, cursorY - rowHeight, 9.5, text, fontBold);
    x += columns[4].width;

    // Column 6: Moy. Général
    drawCenteredCellValue(page, line.average == null ? '-' : formatPdfDisplayNumberFixed(line.average), x, columns[5].width, cursorY, cursorY - rowHeight, 9.5, text, fontBold);
    x += columns[5].width;

    // Column 7: Coef.
    drawCenteredCellValue(page, line.coefficient == null ? '-' : String(line.coefficient), x, columns[6].width, cursorY, cursorY - rowHeight, 9.5, text, fontBold);
    x += columns[6].width;

    // Column 8: Note coef.
    drawCenteredCellValue(page, String(noteCoef), x, columns[7].width, cursorY, cursorY - rowHeight, 9.5, text, fontBold);
    x += columns[7].width;

    // Column 9: Rang
    drawCenteredCellValue(page, line.rank == null ? '-' : String(line.rank), x, columns[8].width, cursorY, cursorY - rowHeight, 9.5, text, fontBold);
    x += columns[8].width;

    // Column 10: Prof. (Teacher name)
    const teacherName = sanitizePdfText(line.teacherName || '-');
    const teacherNameSize = 9.2;
    const teacherColumnWidth = columns[9].width;
    const teacherTextMaxWidth = teacherColumnWidth - 14;
    const teacherColumnCenterX = x + teacherColumnWidth / 2;
    const nameParts = teacherName.split(/\s+/).filter(Boolean);
    const familyName = nameParts[0] || '-';
    const givenName = nameParts.slice(1).join(' ');
    const familyNameWidth = fontBold.widthOfTextAtSize(familyName, teacherNameSize);
    const fullTeacherName = givenName ? `${familyName} ${givenName}` : familyName;
    const fullTeacherNameWidth = fontBold.widthOfTextAtSize(fullTeacherName, teacherNameSize);
    let renderedTeacherName = fullTeacherName;
    if (fullTeacherNameWidth > teacherTextMaxWidth && givenName) {
      const availableGivenNameWidth = teacherTextMaxWidth - familyNameWidth - fontBold.widthOfTextAtSize(' ', teacherNameSize);
      let truncatedGivenName = '';
      for (const character of givenName) {
        const candidate = `${truncatedGivenName}${character}`;
        if (fontBold.widthOfTextAtSize(candidate, teacherNameSize) > availableGivenNameWidth) break;
        truncatedGivenName = candidate;
      }
      renderedTeacherName = truncatedGivenName ? `${familyName} ${truncatedGivenName}` : familyName;
    }
    const renderedTeacherNameWidth = fontBold.widthOfTextAtSize(renderedTeacherName, teacherNameSize);
    drawText(page, renderedTeacherName, teacherColumnCenterX - renderedTeacherNameWidth / 2, cursorY - 13, teacherNameSize, text, fontBold);
    x += columns[9].width;

    // Column 11: Appréciation
    drawCenteredFittedCellText(page, line.teacherComment || '-', x, columns[10].width, cursorY, cursorY - rowHeight, 9.2, text, fontBold);
    x += columns[10].width;

    // Column 12: Signature (leave empty for signature)
    drawText(page, '', x + 7, cursorY - 13, 7.5, text, fontBold);

    let separatorX = tableX;
    columns.slice(0, -1).forEach((column) => {
      separatorX += column.width;
      page.drawLine({ start: { x: separatorX, y: cursorY }, end: { x: separatorX, y: cursorY - rowHeight }, color: tableBorder, thickness: tableBorderWidth });
    });

    cursorY -= rowHeight;
  }

  const renderedLines = renderEntries.flatMap((entry) => entry.line ? [entry.line] : []);
  const totalCoefficients = renderedLines.reduce((total, line) => total + (line.coefficient ?? 0), 0);
  const totalWeightedPoints = renderedLines.reduce(
    (total, line) => total + (line.average != null && line.coefficient != null ? line.average * line.coefficient : 0),
    0,
  );
  page.drawRectangle({
    x: tableX,
    y: cursorY - totalRowHeight,
    width: columns.slice(0, 8).reduce((total, column) => total + column.width, 0),
    height: totalRowHeight,
    borderColor: tableBorder,
    borderWidth: tableBorderWidth,
  });
  drawText(page, 'TOTAL GENERAL', tableX + 7, cursorY - 14, 8, primary, fontBold);
  const totalCoefficientColumnX = tableX + columns.slice(0, 6).reduce((total, column) => total + column.width, 0);
  const totalWeightedPointsColumnX = totalCoefficientColumnX + columns[6].width;
  drawCenteredCellValue(page, formatPdfDisplayNumberFixed(totalCoefficients), totalCoefficientColumnX, columns[6].width, cursorY, cursorY - totalRowHeight, 10, primary, fontBold);
  drawCenteredCellValue(page, formatPdfDisplayNumberFixed(totalWeightedPoints), totalWeightedPointsColumnX, columns[7].width, cursorY, cursorY - totalRowHeight, 10, primary, fontBold);
  [6, 7, 8].forEach((columnCount) => {
    const separatorX = tableX + columns.slice(0, columnCount).reduce((total, column) => total + column.width, 0);
    page.drawLine({ start: { x: separatorX, y: cursorY }, end: { x: separatorX, y: cursorY - totalRowHeight }, color: tableBorder, thickness: tableBorderWidth });
  });
  cursorY -= totalRowHeight;

  const summaryLeftX = tableX + 5;
  const summaryRightX = tableX + 150 - 28.35;
  const summaryY = cursorY - 16;
  const summaryBlocks: Array<{ label: string; average: number | null; rank: number | null }> = [];
  const currentSummaryLabel = formatPeriodSummaryLabel(data.termName);
  const currentSummary = {
    label: currentSummaryLabel,
    average: data.average,
    rank: data.rank,
  };

  const isSecondSemester = /\bsemestre\b.*\b2\b|^2\s*(?:e|è|eme|ème)?\s*semestre\b/i.test(String(data.termName ?? '')) || /\b2(?:e|è|eme|ème)?\s*semestre\b/i.test(String(data.termName ?? ''));
  const previousSummary = (data.previousPeriodSummaries ?? []).find((entry) => {
    const entryLabel = formatPeriodSummaryLabel(entry.label);
    if (!entryLabel) return false;
    return /\bsemestre\b/i.test(entryLabel) && !/\b2(?:e|è|eme|ème)?\s*semestre\b/i.test(entryLabel);
  }) ?? null;

  if (isSecondSemester && previousSummary) {
    summaryBlocks.push({
      label: formatPeriodSummaryLabel(previousSummary.label),
      average: previousSummary.average,
      rank: previousSummary.rank,
    });
  }

  summaryBlocks.push(currentSummary);

  summaryBlocks.forEach((entry, index) => {
    const averageText = `${entry.label} : ${entry.average == null ? '-' : formatPdfDisplayNumberFixed(entry.average).replace('.', ',')}`;
    const rankText = `Rang : ${entry.rank == null ? '-' : formatGeneralRankLabel(entry.rank)}`;
    const y = summaryY - index * 16;
    drawText(page, averageText, summaryLeftX, y, 10, text, fontBold);
    drawText(page, rankText, summaryRightX, y, 10, text, fontBold);
  });

  if (data.annualAverage != null || data.annualRank != null) {
    const annualY = summaryY - summaryBlocks.length * 16;
    const annualAverageText = `Moy. Ann = ${data.annualAverage == null ? '-' : formatPdfDisplayNumberFixed(data.annualAverage).replace('.', ',')}`;
    const annualRankText = `Rang : ${data.annualRank == null ? '-' : formatGeneralRankLabel(data.annualRank)}`;
    drawText(page, annualAverageText, summaryLeftX, annualY, 10, text, fontBold);
    drawText(page, annualRankText, summaryRightX, annualY, 10, text, fontBold);
  }

  const lastSummaryY = summaryY - (summaryBlocks.length - 1 + (data.annualAverage != null || data.annualRank != null ? 1 : 0)) * 16;
  const signatureLabelY = lastSummaryY - 28;
  const signatureNameY = signatureLabelY - 46;
  const signatureCenterX = page.getWidth() - margin - 85;
  if (signatureNameY > 64) {
    const signatureLabel = 'Signature du titulaire de la classe';
    const signatureLabelWidth = fontBold.widthOfTextAtSize(signatureLabel, 9);
    drawText(page, signatureLabel, signatureCenterX - signatureLabelWidth / 2, signatureLabelY, 9, text, fontBold);
    const classTeacherName = sanitizePdfText(data.classTeacherName || 'Aucun');
    const classTeacherNameWidth = fontBold.widthOfTextAtSize(classTeacherName, 9);
    const classTeacherNameX = signatureCenterX - classTeacherNameWidth / 2;
    const signatureBoxWidth = Math.max(signatureLabelWidth, classTeacherNameWidth) + 20;
    const signatureBoxHeight = signatureLabelY - signatureNameY + 14;
    const signatureBoxX = signatureCenterX - signatureBoxWidth / 2;
    const signatureBoxY = signatureLabelY + 10;
    page.drawSvgPath(
      `M 8,0 H ${signatureBoxWidth - 8} Q ${signatureBoxWidth},0 ${signatureBoxWidth},8 V ${signatureBoxHeight - 8} Q ${signatureBoxWidth},${signatureBoxHeight} ${signatureBoxWidth - 8},${signatureBoxHeight} H 8 Q 0,${signatureBoxHeight} 0,${signatureBoxHeight - 8} V 8 Q 0,0 8,0 Z`,
      {
        x: signatureBoxX,
        y: signatureBoxY,
        borderColor: hexToRgb('#000000'),
        borderWidth: 1.2,
      },
    );
    drawText(page, classTeacherName, classTeacherNameX, signatureNameY, 9, text, fontBold);
    page.drawLine({
      start: { x: classTeacherNameX, y: signatureNameY - 2 },
      end: { x: classTeacherNameX + classTeacherNameWidth, y: signatureNameY - 2 },
      color: text,
      thickness: 0.7,
    });
  }

  page.drawLine({ start: { x: margin, y: 54 }, end: { x: page.getWidth() - margin, y: 54 }, color: lightBorder, thickness: 0.7 });
  drawText(page, `${school.name} · ${template.labels.generationDate}: ${toDateLabel(data.generatedAt)}`, margin, 38, 7.5, muted, fontBold);
  drawText(page, 'Page 1/1', page.getWidth() - margin - 55, 38, 7.5, muted, fontBold);

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
