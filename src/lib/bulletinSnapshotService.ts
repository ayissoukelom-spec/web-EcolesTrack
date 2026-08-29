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
  schoolTerms,
  students,
  teachers,
  users,
} from '../db/schema.ts';
import {
  calculateStudentTermAverage,
  type BulletinEvaluationLike,
  type BulletinGradeLike,
  type BulletinStudentLike,
} from './bulletinService';

export interface BulletinLineSnapshotInput {
  subjectId: number | null;
  subjectName: string;
  coefficient: number;
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
}

export interface BulletinSnapshotContext {
  getStudentById(studentId: number): Promise<{ id: number; classId: number; schoolId: number; firstName: string; lastName: string } | null>;
  getClassById(classId: number): Promise<{ id: number; academicYearId: number } | null>;
  getTermById(termId: number): Promise<{ id: number; academicYearId: number } | null>;
  getClassStudents(classId: number): Promise<Array<{ id: number; classId: number; schoolId: number; firstName: string; lastName: string }>>;
  getClassTermEvaluations(classId: number, termId: number): Promise<BulletinEvaluationLike[]>;
  getGradesForStudents(studentIds: number[], evaluationIds: number[]): Promise<BulletinGradeLike[]>;
  getTeacherNames(teacherIds: number[]): Promise<Map<number, string>>;
  insertBulletin(payload: CreateBulletinInput): Promise<{ id: number }>;
  insertBulletinLines(bulletinId: number, lines: BulletinLineSnapshotInput[]): Promise<void>;
}

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

const resolveAppreciation = (average: number | null): string | null => {
  if (average == null) return 'Aucune note disponible pour ce trimestre.';
  if (average >= 16) return 'Excellent trimestre, continuez ainsi.';
  if (average >= 14) return 'Très bon trimestre avec des résultats solides.';
  if (average >= 12) return 'Bon trimestre, efforts réguliers.';
  if (average >= 10) return 'Trimestre satisfaisant, peut progresser.';
  return 'Des efforts supplémentaires sont attendus.';
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
): Promise<Map<string, string>> => {
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
    })
    .from(teachers)
    .innerJoin(users, eq(teachers.userId, users.id))
    .where(inArray(teachers.id, teacherIds));

  const teacherNameMap = new Map<number, string>();
  for (const row of teacherRows) {
    teacherNameMap.set(row.teacherId, row.name || `Teacher ${row.teacherId}`);
  }

  const bySubject = new Map<string, number[]>();
  for (const row of rows) {
    if (row.teacherId == null) continue;
    const current = bySubject.get(row.subject) ?? [];
    current.push(row.teacherId);
    bySubject.set(row.subject, current);
  }

  const result = new Map<string, string>();
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
  termEvaluations: BulletinEvaluationLike[],
  teacherNameMap: Map<number, string> = new Map(),
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
    current.coefficient += Math.max(0, Number(evaluation.coefficient || 0));
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

  // Compute class averages for each subject
  const classAveragesBySubject = new Map<string, number | null>();
  for (const [subjectName, bucket] of bySubject.entries()) {
    const classEvaluationsForSubject = evaluations.filter((e) => e.subject === subjectName);
    const subjectClassAverages: number[] = [];

    for (const classStudent of classStudents) {
      const studentEntries: Array<{ coefficient: number; score: number }> = [];
      for (const evaluation of classEvaluationsForSubject) {
        const grade = allGrades.find((g) => g.evaluationId === evaluation.id && g.studentId === classStudent.id);
        if (!grade) continue;
        const raw = parseNumericScore(grade.score);
        if (raw == null) continue;
        const normalized = (raw / (evaluation.maxScore || 20)) * 20;
        studentEntries.push({ coefficient: Number(evaluation.coefficient || 0), score: normalized });
      }
      const studentAverage = calculateTypeWeightedAverage(studentEntries);
      if (studentAverage != null) subjectClassAverages.push(studentAverage);
    }

    const classAverage = subjectClassAverages.length > 0
      ? subjectClassAverages.reduce((sum, val) => sum + val, 0) / subjectClassAverages.length
      : null;
    classAveragesBySubject.set(subjectName, classAverage);
  }

  return Array.from(bySubject.entries()).map(([subjectName, agg]) => {
    const interrogationAvg = calculateTypeWeightedAverage(agg.byType.interrogation);
    const devoirAvg = calculateTypeWeightedAverage(agg.byType.devoir);
    const compositionAvg = calculateTypeWeightedAverage(agg.byType.composition);
    const subjectAverage = agg.weightedCoefficient > 0 ? agg.weighted / agg.weightedCoefficient : null;
    const noteCoef = subjectAverage != null ? subjectAverage * agg.coefficient : null;
    const classAverage = classAveragesBySubject.get(subjectName) ?? null;

    const teacherName = resolveSubjectTeacherName(agg.teacherIds, teacherNameMap);

    // Calculate subject rank
    const rank = computeSubjectRank(subjectName, targetStudentId, classStudents, termEvaluations, allGrades);

    return {
      subjectId: null,
      subjectName,
      coefficient: agg.coefficient,
      average: subjectAverage,
      interrogation: interrogationAvg,
      devoir: devoirAvg,
      composition: compositionAvg,
      classAverage,
      noteCoef,
      teacherName,
      teacherComment: null,
      rank,
      signature: null,
    };
  });
};

const calculateTypeWeightedAverage = (entries: Array<{ coefficient: number; score: number }>): number | null => {
  let totalWeightedScore = 0;
  let totalCoefficient = 0;

  for (const entry of entries) {
    const coefficient = Number(entry.coefficient ?? 0);
    if (!Number.isFinite(coefficient) || coefficient <= 0) continue;
    totalWeightedScore += entry.score * coefficient;
    totalCoefficient += coefficient;
  }

  return totalCoefficient > 0 ? totalWeightedScore / totalCoefficient : null;
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

    // Calculate the subject average using the same logic as bulletin lines
    let totalWeightedScore = 0;
    let totalCoefficient = 0;

    for (const evaluation of subjectEvaluations) {
      const grade = studentSubjectGrades.find((g) => g.evaluationId === evaluation.id);
      if (!grade) continue;

      const rawScore = parseNumericScore(grade.score);
      if (rawScore == null) continue;

      // Normalize to /20 scale
      const normalized = (rawScore / (evaluation.maxScore || 20)) * 20;
      const coefficient = Number(evaluation.coefficient || 0);

      if (!Number.isFinite(coefficient) || coefficient <= 0) continue;

      totalWeightedScore += normalized * coefficient;
      totalCoefficient += coefficient;
    }

    const average = totalCoefficient > 0 ? totalWeightedScore / totalCoefficient : null;
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
                const [row] = await tx.select({ id: schoolTerms.id, academicYearId: schoolTerms.academicYearId }).from(schoolTerms).where(eq(schoolTerms.id, termId));
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
    const mention = resolveMention(calculation.average);
    const appreciation = resolveAppreciation(calculation.average);

    // Load teacher names for all evaluations
    const teacherIds = Array.from(new Set(termEvaluations.map((e) => e.teacherId).filter((id) => id != null) as number[]));
    const teacherNameMap = await ctx.getTeacherNames(teacherIds);

    const lines = computeSubjectLines(calculation.selectedEvaluations, calculation.snapshots, classStudents, allGrades, student.id, termEvaluations, teacherNameMap);

    const inserted = await ctx.insertBulletin({
      studentId: student.id,
      classId: student.classId,
      schoolYearId: klass.academicYearId,
      termId: term.id,
      average: calculation.average,
      totalPoints: calculation.totalWeightedScore,
      totalCoefficients: calculation.totalCoefficient,
      rank,
      mention,
      appreciation,
      generatedAt: new Date(),
    });

    await ctx.insertBulletinLines(inserted.id, lines);

    return {
      bulletinId: inserted.id,
      studentId: student.id,
      termId: term.id,
      average: calculation.average,
      totalPoints: calculation.totalWeightedScore,
      totalCoefficients: calculation.totalCoefficient,
      rank,
      mention,
      appreciation,
      linesCount: lines.length,
    };
  });
};
