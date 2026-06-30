import type express from 'express';
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { requireRole, verifyToken } from '../middleware/auth.ts';
import {
  bulletinLines,
  bulletins,
  classes,
  evaluations,
  grades,
  schoolTerms,
  students,
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
  teacherComment?: string | null;
  rank?: number | null;
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

const computeSubjectLines = (evaluations: BulletinEvaluationLike[], snapshots: ReturnType<typeof calculateStudentTermAverage>['snapshots']): BulletinLineSnapshotInput[] => {
  const bySubject = new Map<string, { coefficient: number; weighted: number; weightedCoefficient: number }>();

  for (const evaluation of evaluations) {
    const current = bySubject.get(evaluation.subject) ?? { coefficient: 0, weighted: 0, weightedCoefficient: 0 };
    current.coefficient += Math.max(0, Number(evaluation.coefficient || 0));
    bySubject.set(evaluation.subject, current);
  }

  for (const snapshot of snapshots) {
    if (!snapshot.countedInAverage || snapshot.normalizedScore == null) continue;
    const current = bySubject.get(snapshot.subject) ?? { coefficient: 0, weighted: 0, weightedCoefficient: 0 };
    current.weighted += snapshot.normalizedScore * snapshot.coefficient;
    current.weightedCoefficient += snapshot.coefficient;
    bySubject.set(snapshot.subject, current);
  }

  return Array.from(bySubject.entries()).map(([subjectName, agg]) => ({
    subjectId: null,
    subjectName,
    coefficient: agg.coefficient,
    average: agg.weightedCoefficient > 0 ? agg.weighted / agg.weightedCoefficient : null,
    teacherComment: null,
    rank: null,
  }));
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
            termId: evaluations.termId,
            subject: evaluations.subject,
            title: evaluations.title,
            coefficient: evaluations.coefficient,
            maxScore: evaluations.maxScore,
            countInBulletin: evaluations.countInBulletin,
          }).from(evaluations).where(and(eq(evaluations.classId, classId), eq(evaluations.termId, termId)));
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
  generateHandler?: (studentId: number, termId: number) => Promise<BulletinSnapshotResult>;
}

export const registerBulletinGenerateRoute = (
  app: express.Express,
  options: RegisterBulletinGenerateRouteOptions,
) => {
  const {
    resolveActor,
    verifyMiddleware = verifyToken as any,
    accessMiddleware = requireRole(['admin']) as any,
    generateHandler = async (studentId, termId) => generateBulletinSnapshot(studentId, termId),
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

      const result = await generateHandler(studentId, termId);
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
    } catch (err) {
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
    const lines = computeSubjectLines(calculation.selectedEvaluations, calculation.snapshots);

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
