import type express from 'express';
import { and, eq, inArray, or, sql } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { requireRole, verifyToken } from '../middleware/auth.ts';
import studentAccess from './studentAccess';
import {
  bulletinLines,
  bulletins,
  classes,
  evaluations,
  grades,
  schoolSubjects,
  schoolTerms,
  students,
  subjects,
  teachers,
  users,
} from '../db/schema.ts';
import {
  calculateStudentTermAverage,
  calculateClassAverage,
  calculateFinalSubjectAverage,
  calculateTypeWeightedAverage,
  calculateWeightedSubjectAverage,
  resolveSubjectCoefficientFromPublishedComposition,
  type BulletinEvaluationLike,
  type BulletinGradeLike,
  type BulletinStudentLike,
} from './bulletinService';
import { getGradeAppreciation } from './gradeColor';

export interface BulletinLineSnapshotInput {
  subjectId: number | null;
  subjectName: string;
  subjectTypeName?: string | null;
  coefficient: number | null;
  average: number | null;
  interrogation?: number | null;
  devoir?: number | null;
  composition?: number | null;
  classAverage?: number | null;
  noteCoef?: number | null;
  teacherName?: string | null;
  teacherComment?: string | null;
  rank?: number | null;
  signature?: string | null;
  subjectTypeId?: number | null;
  sortOrder?: number | null;
}

export interface BulletinSubjectGroup<T> {
  subjectTypeId: number | null;
  subjectTypeName: string;
  sortOrder: number;
  lines: T[];
}

export const groupBulletinLinesBySubjectType = <T extends { subjectTypeName?: string | null }>(
  lines: T[],
): BulletinSubjectGroup<T>[] => {
  const groups = new Map<string, BulletinSubjectGroup<T>>();

  for (const line of lines) {
    const subjectTypeId = typeof (line as { subjectTypeId?: number | null }).subjectTypeId === 'number'
      ? (line as { subjectTypeId: number }).subjectTypeId
      : null;
    const subjectTypeName = line.subjectTypeName?.trim() || 'Matières sans type';
    const sortOrder = Number((line as { sortOrder?: number | null }).sortOrder ?? 0);
    const groupKey = subjectTypeId == null ? 'null' : String(subjectTypeId);
    const group = groups.get(groupKey) ?? {
      subjectTypeId,
      subjectTypeName,
      sortOrder: Number.isFinite(sortOrder) ? sortOrder : 0,
      lines: [],
    };
    group.lines.push(line);
    groups.set(groupKey, group);
  }

  return [...groups.values()].sort((a, b) => {
    if (a.subjectTypeId == null) return 1;
    if (b.subjectTypeId == null) return -1;
    return a.sortOrder - b.sortOrder || a.subjectTypeId - b.subjectTypeId;
  });
};

export interface SubjectTypeMetadata {
  subjectTypeId: number;
  subjectTypeName: string;
  sortOrder: number;
}

export interface CreateBulletinInput {
  studentId: number;
  classId: number;
  schoolYearId: number;
  termId: number;
  average: number | null;
  totalPoints: number;
  totalCoefficients: number;
  rank: number | null;
  mention: string | null;
  appreciation: string | null;
  generatedAt: Date;
}

export interface BulletinSnapshotResult {
  bulletinId: number;
  studentId: number;
  termId: number;
  average: number | null;
  totalPoints: number;
  totalCoefficients: number;
  rank: number | null;
  mention: string | null;
  appreciation: string | null;
  linesCount: number;
  subjectGroups: BulletinSubjectGroup<BulletinLineSnapshotInput>[];
}

export interface BulletinSnapshotContext {
  getStudentById(studentId: number): Promise<{ id: number; classId: number; schoolId: number; firstName: string; lastName: string } | null>;
  getClassById(classId: number): Promise<{ id: number; academicYearId: number } | null>;
  getTermById(termId: number): Promise<{ id: number; academicYearId: number; periodType?: string | null } | null>;
  getClassStudents(classId: number): Promise<Array<{ id: number; classId: number; schoolId: number; firstName: string; lastName: string }>>;
  getClassTermEvaluations(classId: number, termId: number): Promise<BulletinEvaluationLike[]>;
  getGradesForStudents(studentIds: number[], evaluationIds: number[]): Promise<BulletinGradeLike[]>;
  getTeacherNames(teacherIds: number[]): Promise<Map<number, string>>;
  getSubjectTypes(schoolId: number): Promise<Map<string, SubjectTypeMetadata>>;
  getSubjectIdsByName(schoolId: number, subjectNames: string[]): Promise<Map<string, number>>;
  getSubjectMetadataByName(schoolId: number, subjectNames: string[]): Promise<Map<string, { id: number; name: string }>>;
  getSubjectMetadataByIds(subjectIds: number[]): Promise<Map<number, { id: number; name: string }>>;
  insertBulletin(payload: CreateBulletinInput): Promise<{ id: number }>;
  insertBulletinLines(bulletinId: number, lines: BulletinLineSnapshotInput[]): Promise<void>;
}

export const loadSubjectTypeNames = async (tx: any, schoolId: number): Promise<Map<string, SubjectTypeMetadata>> => {
  const result = await tx.execute(sql`
    SELECT
      s.name AS "subjectName",
      COALESCE(st_school.id, st_local.id) AS "subjectTypeId",
      COALESCE(st_school.name, st_local.name) AS "subjectTypeName",
      COALESCE(st_school.sort_order, st_local.sort_order, 0) AS "sortOrder"
    FROM subjects s
    INNER JOIN school_subjects ss
      ON ss.subject_id = s.id
     AND ss.school_id = ${schoolId}
     AND ss.status = 'approved'
    LEFT JOIN subject_types st_school ON st_school.id = ss.subject_type_id
    LEFT JOIN subject_types st_local ON st_local.id = s.subject_type_id
    ORDER BY s.id
  `);
  const rows = (result?.rows ?? result) as Array<{ subjectName: string; subjectTypeId?: number | null; subjectTypeName?: string | null; sortOrder?: number | null }>;

  return new Map(rows
    .filter((row) => row.subjectTypeId != null && row.subjectTypeName != null)
    .map((row) => [row.subjectName, {
      subjectTypeId: Number(row.subjectTypeId),
      subjectTypeName: row.subjectTypeName as string,
      sortOrder: Number(row.sortOrder ?? 0),
    }]));
};

const normalizeSubjectResolutionKey = (value: string | null | undefined): string => String(value ?? '')
  .trim()
  .toLowerCase()
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const buildSubjectResolutionKeys = (value: string | null | undefined): string[] => {
  const normalized = normalizeSubjectResolutionKey(value);
  if (!normalized) return [];

  const keys = new Set<string>([normalized]);
  const words = normalized.split(' ');
  const lastWord = words.at(-1);
  if (!lastWord) return [...keys];

  const singularWithoutS = lastWord.replace(/s$/, '');
  const singularWithoutEs = lastWord.replace(/es$/, '');

  if (singularWithoutS && singularWithoutS !== lastWord) {
    keys.add([...words.slice(0, -1), singularWithoutS].join(' '));
  }
  if (singularWithoutEs && singularWithoutEs !== lastWord) {
    keys.add([...words.slice(0, -1), singularWithoutEs].join(' '));
  }

  return [...keys];
};

export const resolveCurrentSubjectMetadataByName = async (
  tx: any,
  schoolId: number,
  subjectNames: string[],
): Promise<Map<string, { id: number; name: string }>> => {
  const uniqueNames = Array.from(new Set(subjectNames
    .map((name) => String(name ?? '').trim())
    .filter(Boolean)));
  if (uniqueNames.length === 0) return new Map();

  const approvedRows = await tx.select({
    id: subjects.id,
    name: subjects.name,
    schoolId: subjects.schoolId,
  })
    .from(subjects)
    .innerJoin(schoolSubjects, eq(schoolSubjects.subjectId, subjects.id))
    .where(and(
      eq(schoolSubjects.schoolId, schoolId),
      eq(schoolSubjects.status, 'approved'),
    ));

  const approvedByKey = new Map<string, { id: number; name: string }[]>();
  for (const row of approvedRows) {
    const currentName = String(row.name ?? '').trim();
    if (!currentName) continue;
    for (const key of buildSubjectResolutionKeys(currentName)) {
      const existing = approvedByKey.get(key) ?? [];
      existing.push({ id: row.id, name: currentName });
      approvedByKey.set(key, existing);
    }
  }

  const result = new Map<string, { id: number; name: string }>();

  for (const legacyName of uniqueNames) {
    if (result.has(legacyName)) continue;

    const candidateMatches = Array.from(new Set(
      buildSubjectResolutionKeys(legacyName)
        .flatMap((key) => approvedByKey.get(key) ?? [])
        .map((match) => `${match.id}:${match.name}`),
    )).map((key) => {
      const [id, ...nameParts] = key.split(':');
      return { id: Number(id), name: nameParts.join(':') };
    });

    if (candidateMatches.length !== 1) continue;
    result.set(legacyName, candidateMatches[0]);
  }

  return result;
};

export const resolveCurrentSubjectIdsByName = async (
  tx: any,
  schoolId: number,
  subjectNames: string[],
): Promise<Map<string, number>> => {
  const metadata = await resolveCurrentSubjectMetadataByName(tx, schoolId, subjectNames);
  return new Map(Array.from(metadata.entries()).map(([legacyName, subject]) => [legacyName, subject.id]));
};

export interface BulletinSnapshotPersistence {
  transaction<T>(run: (ctx: BulletinSnapshotContext) => Promise<T>): Promise<T>;
}

const toStoredNumber = (value: number | null): string | null => {
  if (value == null || !Number.isFinite(value)) return null;
  return value.toFixed(4);
};

const toStoredStrictNumber = (value: number): string => {
  if (!Number.isFinite(value)) return '0.0000';
  return value.toFixed(4);
};

const resolveMention = (average: number | null): string | null => {
  if (average == null) return null;
  if (average >= 16) return 'Très bien';
  if (average >= 14) return 'Bien';
  if (average >= 12) return 'Assez bien';
  if (average >= 10) return 'Passable';
  return 'Insuffisant';
};

const resolveAppreciation = (average: number | null, periodType: string | null | undefined = 'trimester'): string | null => {
  const periodLabel = periodType === 'semester' ? 'semestre' : 'trimestre';
  if (average == null) return `Aucune note disponible pour ce ${periodLabel}.`;
  if (average >= 16) return `Excellent ${periodLabel}, continuez ainsi.`;
  if (average >= 14) return `Très bon ${periodLabel}, avec des résultats solides.`;
  if (average >= 12) return `Bon ${periodLabel}, efforts réguliers.`;
  if (average >= 10) return `${periodLabel.charAt(0).toUpperCase()}${periodLabel.slice(1)} satisfaisant, peut progresser.`;
  return 'Des efforts supplémentaires sont attendus.';
};

export interface AnnualPeriodLike {
  id: number;
  name: string;
  periodType?: string | null;
  orderIndex?: number | null;
  academicYearId?: number | null;
  cycleId?: number | null;
  startDate?: string | null;
  endDate?: string | null;
}

export interface AnnualBulletinLike {
  id: number;
  studentId: number;
  schoolYearId: number;
  termId: number;
  average: number | string | null;
}

const inferAnnualPeriodType = (term: AnnualPeriodLike): string | null => {
  if (term.periodType) return term.periodType;
  const normalizedName = String(term.name ?? '').trim();
  if (/semestre/i.test(normalizedName)) return 'semester';
  if (/trimestre/i.test(normalizedName)) return 'trimester';
  return null;
};

export const resolveAnnualPeriodScope = (
  currentTermId: number,
  terms: AnnualPeriodLike[],
  schoolYearId: number,
): { periods: AnnualPeriodLike[]; isLastPeriod: boolean } => {
  const currentTerm = terms.find((term) => term.id === currentTermId);
  if (!currentTerm) return { periods: [], isLastPeriod: false };

  const currentType = inferAnnualPeriodType(currentTerm);
  const scopedTerms = terms.filter((term) => (
    (term.academicYearId == null || term.academicYearId === schoolYearId)
    && (!currentType || inferAnnualPeriodType(term) === currentType)
    && (currentTerm.cycleId == null || term.cycleId == null || term.cycleId === currentTerm.cycleId)
  ));
  const hasCompleteDates = scopedTerms.every((term) => term.startDate && term.endDate);
  const orderedTerms = [...scopedTerms].sort((a, b) => {
    if (hasCompleteDates && a.startDate !== b.startDate) return String(a.startDate).localeCompare(String(b.startDate));
    if (hasCompleteDates && a.endDate !== b.endDate) return String(a.endDate).localeCompare(String(b.endDate));
    return (a.orderIndex ?? 0) - (b.orderIndex ?? 0) || a.id - b.id;
  });
  const expectedPeriodCount = currentType === 'semester' ? 2 : currentType === 'trimester' ? 3 : orderedTerms.length;
  const annualTerms = orderedTerms.length > expectedPeriodCount
    ? currentType === 'semester'
      ? [orderedTerms[0], orderedTerms.at(-1)!]
      : orderedTerms.slice(-expectedPeriodCount)
    : orderedTerms;

  return {
    periods: annualTerms,
    isLastPeriod: annualTerms.at(-1)?.id === currentTermId,
  };
};

const parseAnnualAverage = (value: number | string | null): number | null => {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export const calculateAnnualBulletinResults = ({
  targetStudentId,
  classStudentIds,
  periods,
  bulletins,
}: {
  targetStudentId: number;
  classStudentIds: number[];
  periods: AnnualPeriodLike[];
  bulletins: AnnualBulletinLike[];
}): { annualAverage: number | null; annualRank: number | null } => {
  if (periods.length === 0) return { annualAverage: null, annualRank: null };

  const latestByStudentTerm = new Map<string, AnnualBulletinLike>();
  for (const bulletin of bulletins) {
    if (!periods.some((period) => period.id === bulletin.termId)) continue;
    const key = `${bulletin.studentId}:${bulletin.termId}`;
    const current = latestByStudentTerm.get(key);
    if (!current || bulletin.id > current.id) latestByStudentTerm.set(key, bulletin);
  }

  const annualAverages = classStudentIds.map((studentId) => {
    const periodAverages = periods.map((period) => parseAnnualAverage(latestByStudentTerm.get(`${studentId}:${period.id}`)?.average ?? null));
    const average = periodAverages.every((value) => value != null)
      ? periodAverages.reduce((sum, value) => sum + (value as number), 0) / periodAverages.length
      : null;
    return { studentId, average };
  }).filter((entry): entry is { studentId: number; average: number } => entry.average != null);

  annualAverages.sort((a, b) => b.average - a.average);
  const targetIndex = annualAverages.findIndex((entry) => entry.studentId === targetStudentId);
  if (targetIndex < 0) return { annualAverage: null, annualRank: null };

  return {
    annualAverage: annualAverages[targetIndex].average,
    annualRank: targetIndex + 1,
  };
};

const buildTeacherNameMap = async (
  tx: any,
  teacherIds: number[],
): Promise<Map<number, string>> => {
  if (teacherIds.length === 0) return new Map();

  const rows = await tx
    .select({
      teacherId: teachers.id,
      name: users.name,
    })
    .from(teachers)
    .innerJoin(users, eq(teachers.userId, users.id))
    .where(inArray(teachers.id, Array.from(new Set(teacherIds))));

  const map = new Map<number, string>();
  for (const row of rows) {
    map.set(row.teacherId, row.name || `Teacher ${row.teacherId}`);
  }
  return map;
};

export const resolveSubjectTeacherName = (
  teacherIds: number[],
  teacherNameMap: Map<number, string>,
): string | null => {
  if (!teacherIds || teacherIds.length === 0) return null;

  const counts = new Map<number, number>();
  for (const teacherId of teacherIds) {
    if (teacherId == null) continue;
    counts.set(teacherId, (counts.get(teacherId) ?? 0) + 1);
  }

  const bestTeacher = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0];
  if (!bestTeacher) return null;

  return teacherNameMap.get(bestTeacher[0]) ?? null;
};

export const buildSubjectTeacherNameMap = async (
  classId: number,
  termId: number,
): Promise<Map<string, { name: string; lastName: string | null; firstNames: string | null }>> => {
  const rows = await db
    .select({
      subject: evaluations.subject,
      teacherId: evaluations.teacherId,
    })
    .from(evaluations)
    .where(and(
      eq(evaluations.classId, classId),
      eq(evaluations.termId, termId),
      eq(evaluations.countInBulletin, true),
    ));

  if (rows.length === 0) {
    return new Map();
  }

  const teacherIds = Array.from(new Set(rows.map((row) => row.teacherId).filter((id): id is number => Number.isInteger(id) && id > 0)));
  if (teacherIds.length === 0) {
    return new Map();
  }

  const teacherRows = await db
    .select({
      teacherId: teachers.id,
      name: users.name,
      lastName: users.lastName,
      firstNames: users.firstNames,
    })
    .from(teachers)
    .innerJoin(users, eq(teachers.userId, users.id))
    .where(inArray(teachers.id, teacherIds));

  const teacherNameMap = new Map<number, { name: string; lastName: string | null; firstNames: string | null }>();
  for (const row of teacherRows) {
    teacherNameMap.set(row.teacherId, {
      name: row.name || `Teacher ${row.teacherId}`,
      lastName: row.lastName,
      firstNames: row.firstNames,
    });
  }

  const bySubject = new Map<string, number[]>();
  for (const row of rows) {
    if (row.teacherId == null) continue;
    const current = bySubject.get(row.subject) ?? [];
    current.push(row.teacherId);
    bySubject.set(row.subject, current);
  }

  const result = new Map<string, { name: string; lastName: string | null; firstNames: string | null }>();
  for (const [subject, teacherIdsForSubject] of bySubject.entries()) {
    const teacherName = resolveSubjectTeacherName(teacherIdsForSubject, teacherNameMap);
    if (teacherName) result.set(subject, teacherName);
  }

  return result;
};

const computeSubjectLines = (
  evaluations: BulletinEvaluationLike[],
  snapshots: ReturnType<typeof calculateStudentTermAverage>['snapshots'],
  classStudents: BulletinStudentLike[],
  allGrades: BulletinGradeLike[],
  targetStudentId: number,
  classId: number,
  termId: number,
  termEvaluations: BulletinEvaluationLike[],
  teacherNameMap: Map<number, string> = new Map(),
  subjectTypeNames: Map<string, SubjectTypeMetadata> = new Map(),
  subjectIdsByName: Map<string, number> = new Map(),
  subjectMetadataByName: Map<string, { id: number; name: string }> = new Map(),
  subjectMetadataById: Map<number, { id: number; name: string }> = new Map(),
): BulletinLineSnapshotInput[] => {
  const bySubject = new Map<string, {
    coefficient: number;
    weighted: number;
    weightedCoefficient: number;
    byType: Record<'interrogation' | 'devoir' | 'composition', Array<{ coefficient: number; score: number }>>;
    teacherIds: number[];
  }>();

  // Aggregate evaluations by subject and type
  for (const evaluation of evaluations) {
    const current = bySubject.get(evaluation.subject) ?? {
      coefficient: 0,
      weighted: 0,
      weightedCoefficient: 0,
      byType: { interrogation: [], devoir: [], composition: [] },
      teacherIds: [],
    };
    if (evaluation.teacherId) current.teacherIds.push(evaluation.teacherId);
    bySubject.set(evaluation.subject, current);
  }

  // Calculate per-type averages for the target student
  for (const snapshot of snapshots) {
    if (!snapshot.countedInAverage || snapshot.normalizedScore == null) continue;
    const current = bySubject.get(snapshot.subject) ?? {
      coefficient: 0,
      weighted: 0,
      weightedCoefficient: 0,
      byType: { interrogation: [], devoir: [], composition: [] },
      teacherIds: [],
    };
    current.weighted += snapshot.normalizedScore * snapshot.coefficient;
    current.weightedCoefficient += snapshot.coefficient;

    const type = snapshot.type as 'interrogation' | 'devoir' | 'composition' | null;
    if (type && (type === 'interrogation' || type === 'devoir' || type === 'composition')) {
      current.byType[type].push({ coefficient: snapshot.coefficient, score: snapshot.normalizedScore });
    }
    bySubject.set(snapshot.subject, current);
  }

  return Array.from(bySubject.entries()).map(([legacySubjectName, agg]) => {
    const subjectIdFromEvaluation = evaluations
      .filter((evaluation) => evaluation.subject === legacySubjectName && evaluation.subjectId != null)
      .map((evaluation) => evaluation.subjectId as number)
      .find((subjectId) => subjectId != null) ?? null;
    const subjectMetadataFromId = subjectIdFromEvaluation != null ? subjectMetadataById.get(subjectIdFromEvaluation) ?? null : null;
    const subjectMetadata = subjectMetadataFromId ?? subjectMetadataByName.get(legacySubjectName) ?? null;
    const subjectName = subjectMetadataFromId?.name ?? subjectMetadata?.name ?? legacySubjectName;
    const subjectId = subjectIdFromEvaluation ?? subjectMetadata?.id ?? subjectIdsByName.get(legacySubjectName) ?? null;

    const interrogationAvg = calculateTypeWeightedAverage(
      agg.byType.interrogation.map((entry) => ({ coefficient: entry.coefficient, normalizedScore: entry.score })),
    );
    const devoirAvg = calculateTypeWeightedAverage(
      agg.byType.devoir.map((entry) => ({ coefficient: entry.coefficient, normalizedScore: entry.score })),
    );
    const compositionAvg = calculateTypeWeightedAverage(
      agg.byType.composition.map((entry) => ({ coefficient: entry.coefficient, normalizedScore: entry.score })),
    );
    const classAverage = calculateClassAverage(interrogationAvg, devoirAvg);
    const subjectAverage = calculateFinalSubjectAverage(classAverage, compositionAvg);
    const subjectCoefficient = resolveSubjectCoefficientFromPublishedComposition(
      termEvaluations,
      legacySubjectName,
      classId,
      termId,
    );
    const noteCoef = subjectAverage != null && subjectCoefficient != null
      ? subjectAverage * subjectCoefficient
      : null;

    const teacherName = resolveSubjectTeacherName(agg.teacherIds, teacherNameMap);

    // Calculate subject rank
    const rank = computeSubjectRank(legacySubjectName, targetStudentId, classStudents, termEvaluations, allGrades);

    return {
      subjectId: subjectId,
      subjectName,
      coefficient: subjectCoefficient,
      average: subjectAverage,
      interrogation: interrogationAvg,
      devoir: devoirAvg,
      composition: compositionAvg,
      classAverage,
      noteCoef,
      teacherName,
      teacherComment: getGradeAppreciation(subjectAverage),
      rank,
      signature: null,
      subjectTypeId: subjectTypeNames.get(subjectName)?.subjectTypeId ?? null,
      subjectTypeName: subjectTypeNames.get(subjectName)?.subjectTypeName ?? null,
      sortOrder: subjectTypeNames.get(subjectName)?.sortOrder ?? null,
    };
  });
};

const parseNumericScore = (score: string | number | null | undefined): number | null => {
  if (score == null) return null;
  const normalized = String(score).trim().replace(',', '.');
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
};

/**
 * Calculates the rank of a student within their subject and class for the term.
 * Uses the same average calculation as the bulletin line.
 *
 * Rule: Students with identical averages share the same rank,
 * and the next rank accounts for all students above (e.g., 1, 1, 3).
 *
 * @param subjectName - The subject for which to calculate rank
 * @param targetStudentId - The student whose rank we want
 * @param classStudents - All students in the class
 * @param termEvaluations - Evaluations for the term
 * @param allGrades - All grades for the class
 * @returns The rank (1-based) or null if no valid average
 */
const computeSubjectRank = (
  subjectName: string,
  targetStudentId: number,
  classStudents: BulletinStudentLike[],
  termEvaluations: BulletinEvaluationLike[],
  allGrades: BulletinGradeLike[],
): number | null => {
  // Filter evaluations for this subject only
  const subjectEvaluations = termEvaluations.filter((e) => e.subject === subjectName);
  if (subjectEvaluations.length === 0) return null;

  // Calculate average for each student in the subject
  const studentAverages: Array<{ studentId: number; average: number | null }> = [];

  for (const classStudent of classStudents) {
    // Collect grades for this student in this subject
    const studentSubjectGrades = allGrades.filter(
      (grade) => grade.studentId === classStudent.id &&
                 subjectEvaluations.some((e) => e.id === grade.evaluationId)
    );

    const entriesByType: Record<'interrogation' | 'devoir' | 'composition', Array<{ coefficient: number; score: number }>> = {
      interrogation: [],
      devoir: [],
      composition: [],
    };

    for (const evaluation of subjectEvaluations) {
      const grade = studentSubjectGrades.find((g) => g.evaluationId === evaluation.id);
      if (!grade) continue;

      const rawScore = parseNumericScore(grade.score);
      if (rawScore == null) continue;

      // Normalize to /20 scale
      const normalized = (rawScore / (evaluation.maxScore || 20)) * 20;
      const coefficient = Number(evaluation.coefficient || 0);
      const type = evaluation.type as 'interrogation' | 'devoir' | 'composition' | null;
      if (!Number.isFinite(coefficient) || coefficient <= 0) continue;
      if (type === 'interrogation' || type === 'devoir' || type === 'composition') {
        entriesByType[type].push({ coefficient, score: normalized });
      }
    }

    const classAverage = calculateClassAverage(
      calculateTypeWeightedAverage(entriesByType.interrogation.map((entry) => ({ coefficient: entry.coefficient, normalizedScore: entry.score }))),
      calculateTypeWeightedAverage(entriesByType.devoir.map((entry) => ({ coefficient: entry.coefficient, normalizedScore: entry.score }))),
    );
    const average = calculateFinalSubjectAverage(
      classAverage,
      calculateTypeWeightedAverage(entriesByType.composition.map((entry) => ({ coefficient: entry.coefficient, normalizedScore: entry.score }))),
    );
    studentAverages.push({ studentId: classStudent.id, average });
  }

  // Filter students with valid averages
  const validAverages = studentAverages.filter((entry) => entry.average != null);
  if (validAverages.length === 0) return null;

  // Sort by average descending
  validAverages.sort((a, b) => (b.average as number) - (a.average as number));

  // Find the target student and compute rank (accounting for ties)
  let currentRank = 1;
  for (let i = 0; i < validAverages.length; i++) {
    if (validAverages[i].studentId === targetStudentId) {
      return currentRank;
    }
    // Next rank increments by 1 for each new student
    currentRank = i + 2;
  }

  return null;
};

const computeRank = (
  targetStudentId: number,
  classStudents: BulletinStudentLike[],
  termEvaluations: BulletinEvaluationLike[],
  allGrades: BulletinGradeLike[],
  termId: number,
): number | null => {
  const averages = classStudents
    .map((student) => {
      const studentGrades = allGrades.filter((grade) => grade.studentId === student.id);
      const result = calculateStudentTermAverage({
        term: { id: termId },
        student,
        evaluations: termEvaluations,
        grades: studentGrades,
      });
      return { studentId: student.id, average: result.average };
    })
    .filter((entry) => entry.average != null)
    .sort((a, b) => (b.average as number) - (a.average as number));

  const rank = averages.findIndex((entry) => entry.studentId === targetStudentId);
  return rank >= 0 ? rank + 1 : null;
};

export const createDbBulletinSnapshotPersistence = (): BulletinSnapshotPersistence => ({
  transaction: async <T>(run: (ctx: BulletinSnapshotContext) => Promise<T>) => {
    return db.transaction(async (tx) => {
      const ctx: BulletinSnapshotContext = {
        async getStudentById(studentId) {
          const [row] = await tx.select({
            id: students.id,
            classId: students.classId,
            schoolId: students.schoolId,
            firstName: students.firstName,
            lastName: students.lastName,
          }).from(students).where(eq(students.id, studentId));
          return row ?? null;
        },
        async getClassById(classId) {
          const [row] = await tx.select({
            id: classes.id,
            academicYearId: classes.academicYearId,
          }).from(classes).where(eq(classes.id, classId));
          return row ?? null;
        },
        async getTermById(termId) {
          const [row] = await tx.select({
            id: schoolTerms.id,
            academicYearId: schoolTerms.academicYearId,
            periodType: schoolTerms.periodType,
          }).from(schoolTerms).where(eq(schoolTerms.id, termId));
          return row ?? null;
        },
        async getClassStudents(classId) {
          return tx.select({
            id: students.id,
            classId: students.classId,
            schoolId: students.schoolId,
            firstName: students.firstName,
            lastName: students.lastName,
          }).from(students).where(eq(students.classId, classId));
        },
        async getClassTermEvaluations(classId, termId) {
          return tx.select({
            id: evaluations.id,
            classId: evaluations.classId,
            teacherId: evaluations.teacherId,
            termId: evaluations.termId,
            subjectId: evaluations.subjectId,
            subject: evaluations.subject,
            title: evaluations.title,
            type: evaluations.type,
            coefficient: evaluations.coefficient,
            maxScore: evaluations.maxScore,
            countInBulletin: evaluations.countInBulletin,
          }).from(evaluations).where(and(
            eq(evaluations.classId, classId),
            or(
              eq(evaluations.termId, termId),
              and(
                sql`${evaluations.termId} IS NULL`,
                sql`EXISTS (
                  SELECT 1
                  FROM school_terms st
                  WHERE st.id = ${termId}
                    AND st.start_date IS NOT NULL
                    AND st.end_date IS NOT NULL
                    AND ${evaluations.date} >= st.start_date
                    AND ${evaluations.date} <= st.end_date
                )`,
              ),
            ),
          ));
        },
        async getGradesForStudents(studentIds, evaluationIds) {
          if (studentIds.length === 0 || evaluationIds.length === 0) return [];
          return tx.select({
            id: grades.id,
            evaluationId: grades.evaluationId,
            studentId: grades.studentId,
            score: grades.score,
          }).from(grades).where(and(inArray(grades.studentId, studentIds), inArray(grades.evaluationId, evaluationIds)));
        },
        async getTeacherNames(teacherIds) {
          if (teacherIds.length === 0) return new Map();
          const rows = await tx
            .select({
              teacherId: teachers.id,
              name: users.name,
            })
            .from(teachers)
            .innerJoin(users, eq(teachers.userId, users.id))
            .where(inArray(teachers.id, Array.from(new Set(teacherIds))));
          const map = new Map<number, string>();
          for (const row of rows) {
            map.set(row.teacherId, row.name || `Teacher ${row.teacherId}`);
          }
          return map;
        },
        async getSubjectTypes(schoolId) {
          return loadSubjectTypeNames(tx, schoolId);
        },
        async getSubjectIdsByName(schoolId, subjectNames) {
          return resolveCurrentSubjectIdsByName(tx, schoolId, subjectNames);
        },
        async getSubjectMetadataByName(schoolId, subjectNames) {
          return resolveCurrentSubjectMetadataByName(tx, schoolId, subjectNames);
        },
        async getSubjectMetadataByIds(subjectIds) {
          if (subjectIds.length === 0) return new Map();
          const rows = await tx.select({ id: subjects.id, name: subjects.name }).from(subjects).where(inArray(subjects.id, Array.from(new Set(subjectIds))));
          const result = new Map<number, { id: number; name: string }>();
          for (const row of rows) {
            result.set(row.id, { id: row.id, name: row.name });
          }
          return result;
        },
        async insertBulletin(payload) {
          const [inserted] = await tx.insert(bulletins).values({
            studentId: payload.studentId,
            classId: payload.classId,
            schoolYearId: payload.schoolYearId,
            termId: payload.termId,
            average: toStoredNumber(payload.average),
            totalPoints: toStoredStrictNumber(payload.totalPoints),
            totalCoefficients: toStoredStrictNumber(payload.totalCoefficients),
            rank: payload.rank,
            mention: payload.mention,
            appreciation: payload.appreciation,
            generatedAt: payload.generatedAt,
          }).returning({ id: bulletins.id });
          return inserted;
        },
        async insertBulletinLines(bulletinId, lines) {
          if (lines.length === 0) return;
          await tx.insert(bulletinLines).values(lines.map((line) => ({
            bulletinId,
            subjectId: line.subjectId,
            subjectName: line.subjectName,
            coefficient: line.coefficient,
            average: toStoredNumber(line.average),
            teacherComment: line.teacherComment ?? null,
            rank: line.rank ?? null,
          })));
        },
      };

      return run(ctx);
    });
  },
});

interface RegisterBulletinGenerateRouteOptions {
  resolveActor: (req: any) => Promise<{ role?: string; schoolId?: number | null } | null>;
  verifyMiddleware?: express.RequestHandler;
  accessMiddleware?: express.RequestHandler;
  generateHandler?: (studentId: number, termId: number, persistence?: BulletinSnapshotPersistence) => Promise<BulletinSnapshotResult>;
}

class StudentAuthorizationError extends Error {
  constructor(message?: string) {
    super(message ?? 'Student authorization failed');
    this.name = 'StudentAuthorizationError';
  }
}

const requireBulletinSuperAdmin: express.RequestHandler = (req: any, res, next) => {
  if (req.user?.role !== 'super_admin') {
    return res.status(403).json({ error: 'Forbidden' });
  }
  return next();
};

export const registerBulletinGenerateRoute = (
  app: express.Express,
  options: RegisterBulletinGenerateRouteOptions,
) => {
  const {
    resolveActor,
    verifyMiddleware = verifyToken as any,
    accessMiddleware = requireBulletinSuperAdmin as any,
    generateHandler = async (studentId, termId, persistence) => generateBulletinSnapshot(studentId, termId, persistence),
  } = options;

  app.post('/api/bulletins/generate', verifyMiddleware, accessMiddleware, async (req: any, res) => {
    try {
      const actor = await resolveActor(req);
      if (!actor) return res.status(404).json({ error: 'User not found' });

      const studentId = Number(req.body?.studentId);
      const termId = Number(req.body?.termId);
      if (!Number.isInteger(studentId) || studentId <= 0 || !Number.isInteger(termId) || termId <= 0) {
        return res.status(400).json({ error: 'studentId and termId are required' });
      }

      // Build a persistence that uses studentAccess.getAuthorizedStudents when an actor is present
      const persistence: BulletinSnapshotPersistence = {
        transaction: async <T>(run: (ctx: BulletinSnapshotContext) => Promise<T>) => {
          return db.transaction(async (tx) => {
            const ctx: BulletinSnapshotContext = {
              async getStudentById(studentId) {
                const [row] = await tx.select({
                  id: students.id,
                  classId: students.classId,
                  schoolId: students.schoolId,
                  firstName: students.firstName,
                  lastName: students.lastName,
                }).from(students).where(eq(students.id, studentId));
                return row ?? null;
              },
              async getClassById(classId) {
                const [row] = await tx.select({ id: classes.id, academicYearId: classes.academicYearId }).from(classes).where(eq(classes.id, classId));
                return row ?? null;
              },
              async getTermById(termId) {
                const [row] = await tx.select({ id: schoolTerms.id, academicYearId: schoolTerms.academicYearId, periodType: schoolTerms.periodType }).from(schoolTerms).where(eq(schoolTerms.id, termId));
                return row ?? null;
              },
              async getClassStudents(classId) {
                if (actor) {
                  try {
                    const rows = await studentAccess.getAuthorizedStudents(actor as any, { classIds: [classId] });
                    return (rows as any).map((r: any) => ({ id: r.id, classId: r.classId, schoolId: r.schoolId, firstName: r.firstName, lastName: r.lastName }));
                  } catch (e: any) {
                    console.error('Bulletin generation student authorization failed', {
                      classId,
                      actor,
                      error: e?.message || e,
                    });
                    throw new StudentAuthorizationError('Failed to authorize access to class students');
                  }
                }
                return tx.select({
                  id: students.id,
                  classId: students.classId,
                  schoolId: students.schoolId,
                  firstName: students.firstName,
                  lastName: students.lastName,
                }).from(students).where(eq(students.classId, classId));
              },
              async getClassTermEvaluations(classId, termId) {
                return tx.select({
                  id: evaluations.id,
                  classId: evaluations.classId,
                  teacherId: evaluations.teacherId,
                  termId: evaluations.termId,
                  subjectId: evaluations.subjectId,
                  subject: evaluations.subject,
                  title: evaluations.title,
                  type: evaluations.type,
                  coefficient: evaluations.coefficient,
                  maxScore: evaluations.maxScore,
                  countInBulletin: evaluations.countInBulletin,
                }).from(evaluations).where(and(
                  eq(evaluations.classId, classId),
                  or(
                    eq(evaluations.termId, termId),
                    and(
                      sql`${evaluations.termId} IS NULL`,
                      sql`EXISTS (
                        SELECT 1
                        FROM school_terms st
                        WHERE st.id = ${termId}
                          AND st.start_date IS NOT NULL
                          AND st.end_date IS NOT NULL
                          AND ${evaluations.date} >= st.start_date
                          AND ${evaluations.date} <= st.end_date
                      )`,
                    ),
                  ),
                ));
              },
              async getGradesForStudents(studentIds, evaluationIds) {
                if (studentIds.length === 0 || evaluationIds.length === 0) return [];
                return tx.select({ id: grades.id, evaluationId: grades.evaluationId, studentId: grades.studentId, score: grades.score }).from(grades).where(and(inArray(grades.studentId, studentIds), inArray(grades.evaluationId, evaluationIds)));
              },
              async getTeacherNames(teacherIds) {
                if (teacherIds.length === 0) return new Map();
                const rows = await tx
                  .select({
                    teacherId: teachers.id,
                    name: users.name,
                  })
                  .from(teachers)
                  .innerJoin(users, eq(teachers.userId, users.id))
                  .where(inArray(teachers.id, Array.from(new Set(teacherIds))));
                const map = new Map<number, string>();
                for (const row of rows) {
                  map.set(row.teacherId, row.name || `Teacher ${row.teacherId}`);
                }
                return map;
              },
              async getSubjectTypes(schoolId) {
                return loadSubjectTypeNames(tx, schoolId);
              },
              async getSubjectIdsByName(schoolId, subjectNames) {
                return resolveCurrentSubjectIdsByName(tx, schoolId, subjectNames);
              },
              async getSubjectMetadataByName(schoolId, subjectNames) {
                return resolveCurrentSubjectMetadataByName(tx, schoolId, subjectNames);
              },
              async getSubjectMetadataByIds(subjectIds) {
                if (subjectIds.length === 0) return new Map();
                const rows = await tx.select({ id: subjects.id, name: subjects.name }).from(subjects).where(inArray(subjects.id, Array.from(new Set(subjectIds))));
                const result = new Map<number, { id: number; name: string }>();
                for (const row of rows) {
                  result.set(row.id, { id: row.id, name: row.name });
                }
                return result;
              },
              async insertBulletin(payload) {
                const [inserted] = await tx.insert(bulletins).values({
                  studentId: payload.studentId,
                  classId: payload.classId,
                  schoolYearId: payload.schoolYearId,
                  termId: payload.termId,
                  average: toStoredNumber(payload.average),
                  totalPoints: toStoredStrictNumber(payload.totalPoints),
                  totalCoefficients: toStoredStrictNumber(payload.totalCoefficients),
                  rank: payload.rank,
                  mention: payload.mention,
                  appreciation: payload.appreciation,
                  generatedAt: payload.generatedAt,
                }).returning({ id: bulletins.id });
                return inserted;
              },
              async insertBulletinLines(bulletinId, lines) {
                if (lines.length === 0) return;
                await tx.insert(bulletinLines).values(lines.map((line) => ({ bulletinId, subjectId: line.subjectId, subjectName: line.subjectName, coefficient: line.coefficient, average: toStoredNumber(line.average), teacherComment: line.teacherComment ?? null, rank: line.rank ?? null })));
              },
            };

            return run(ctx);
          });
        },
      };

      const result = await generateHandler(studentId, termId, persistence);
      const createdId = (result as BulletinSnapshotResult & { id?: number }).id ?? result.bulletinId;
      return res.status(201).json({
        id: createdId,
        studentId: result.studentId,
        termId: result.termId,
        average: result.average,
        rank: result.rank,
        mention: result.mention,
        appreciation: result.appreciation,
      });
    } catch (err: any) {
      if (err instanceof StudentAuthorizationError) {
        console.error('Bulletin generation authorization error:', err.message);
        return res.status(403).json({ error: 'Unauthorized to generate bulletin for this class' });
      }
      console.error('Failed to generate bulletin:', err);
      return res.status(500).json({ error: 'Failed to generate bulletin' });
    }
  });
};

export const generateBulletinSnapshot = async (
  studentId: number,
  termId: number,
  persistence: BulletinSnapshotPersistence = createDbBulletinSnapshotPersistence(),
): Promise<BulletinSnapshotResult> => {
  return persistence.transaction(async (ctx) => {
    const student = await ctx.getStudentById(studentId);
    if (!student) throw new Error('Student not found');

    const klass = await ctx.getClassById(student.classId);
    if (!klass) throw new Error('Class not found');

    const term = await ctx.getTermById(termId);
    if (!term) throw new Error('Term not found');

    if (klass.academicYearId !== term.academicYearId) {
      throw new Error('Term does not belong to student class academic year');
    }

    const classStudents = await ctx.getClassStudents(student.classId);
    const termEvaluations = await ctx.getClassTermEvaluations(student.classId, termId);
    const subjectTypeNames = await ctx.getSubjectTypes(student.schoolId);
    const subjectMetadataByName = await ctx.getSubjectMetadataByName(student.schoolId, termEvaluations.map((evaluation) => evaluation.subject));
    const subjectIdsByName = await ctx.getSubjectIdsByName(student.schoolId, termEvaluations.map((evaluation) => evaluation.subject));
    const subjectIdsToLoad = Array.from(new Set(termEvaluations.map((evaluation) => evaluation.subjectId).filter((subjectId): subjectId is number => subjectId != null)));
    const subjectMetadataById = await ctx.getSubjectMetadataByIds(subjectIdsToLoad);

    const evaluationIds = termEvaluations.map((evaluation) => evaluation.id);
    const classStudentIds = classStudents.map((row) => row.id);
    const allGrades = await ctx.getGradesForStudents(classStudentIds, evaluationIds);
    const studentGrades = allGrades.filter((grade) => grade.studentId === student.id);

    const calculation = calculateStudentTermAverage({
      term: { id: term.id },
      student,
      evaluations: termEvaluations,
      grades: studentGrades,
    });

    const rank = computeRank(student.id, classStudents, termEvaluations, allGrades, term.id);

    // Load teacher names for all evaluations
    const teacherIds = Array.from(new Set(termEvaluations.map((e) => e.teacherId).filter((id) => id != null) as number[]));
    const teacherNameMap = await ctx.getTeacherNames(teacherIds);

    const lines = computeSubjectLines(
      calculation.selectedEvaluations,
      calculation.snapshots,
      classStudents,
      allGrades,
      student.id,
      student.classId,
      term.id,
      termEvaluations,
      teacherNameMap,
      subjectTypeNames,
      subjectIdsByName,
      subjectMetadataByName,
      subjectMetadataById,
    );
    const subjectGroups = groupBulletinLinesBySubjectType(lines);
    const subjectAverage = calculateWeightedSubjectAverage(lines);
    const finalAverage = subjectAverage.average;

    const inserted = await ctx.insertBulletin({
      studentId: student.id,
      classId: student.classId,
      schoolYearId: klass.academicYearId,
      termId: term.id,
      average: finalAverage,
      totalPoints: subjectAverage.totalPoints,
      totalCoefficients: subjectAverage.totalCoefficients,
      rank,
      mention: resolveMention(finalAverage),
      appreciation: resolveAppreciation(finalAverage, term.periodType),
      generatedAt: new Date(),
    });

    await ctx.insertBulletinLines(inserted.id, lines);

    return {
      bulletinId: inserted.id,
      studentId: student.id,
      termId: term.id,
      average: finalAverage,
      totalPoints: subjectAverage.totalPoints,
      totalCoefficients: subjectAverage.totalCoefficients,
      rank,
      mention: resolveMention(finalAverage),
      appreciation: resolveAppreciation(finalAverage, term.periodType),
      linesCount: lines.length,
      subjectGroups,
    };
  });
};
