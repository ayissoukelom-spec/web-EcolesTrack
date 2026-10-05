import type express from 'express';
import { and, eq, inArray, or, sql } from 'drizzle-orm';
import { db } from '../db/index.ts';
import {
  academicYears,
  classes,
  cycles,
  evaluations,
  grades,
  levels,
  schools,
  schoolClasses,
  schoolTerms,
} from '../db/schema.ts';
import { requireRole, verifyToken } from '../middleware/auth.ts';
import studentAccess from './studentAccess';
import {
  filterAvailableSchoolTerms,
  getSchoolPeriodTypeStates,
  validateSchoolCycle,
} from './educationStructure.ts';
import { calculateOfficialStudentAverage } from './bulletinSnapshotService';

interface ClassSubjectPivotActor {
  id?: number | null;
  role: string;
  schoolId?: number | null;
  academicYearId?: number | null;
}

interface RegisterClassSubjectPivotRouteOptions {
  resolveActor: (req: any) => Promise<ClassSubjectPivotActor | null>;
  verifyMiddleware?: express.RequestHandler;
  accessMiddleware?: express.RequestHandler;
}

const parsePositiveInteger = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

export const registerClassSubjectPivotRoute = (
  app: express.Express,
  options: RegisterClassSubjectPivotRouteOptions,
) => {
  const {
    resolveActor,
    verifyMiddleware = verifyToken as any,
    accessMiddleware = requireRole(['admin']) as any,
  } = options;

  app.get('/api/results/class-subject-pivot', verifyMiddleware, accessMiddleware, async (req: any, res) => {
    try {
      const actor = await resolveActor(req);
      if (!actor) return res.status(404).json({ error: 'User not found' });
      if (!['super_admin', 'school_admin'].includes(actor.role)) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      const requestedSchoolId = parsePositiveInteger(req.query?.schoolId);
      const academicYearId = parsePositiveInteger(req.query?.academicYearId);
      const termId = parsePositiveInteger(req.query?.periodId);
      if (academicYearId == null || termId == null) {
        return res.status(400).json({ error: 'academicYearId and periodId are required' });
      }

      if (actor.role === 'school_admin') {
        if (actor.schoolId == null) return res.status(403).json({ error: 'School context required' });
        if (requestedSchoolId != null && requestedSchoolId !== actor.schoolId) {
          return res.status(403).json({ error: 'Forbidden' });
        }
        if (actor.academicYearId != null && academicYearId !== actor.academicYearId) {
          return res.status(403).json({ error: 'Academic year is outside the school admin scope' });
        }
      }

      const schoolId = actor.role === 'school_admin' ? actor.schoolId! : requestedSchoolId;
      if (schoolId == null) return res.status(400).json({ error: 'schoolId is required' });

      const [school] = await db.select({
        id: schools.id,
        name: schools.name,
      }).from(schools).where(eq(schools.id, schoolId));
      if (!school) return res.status(404).json({ error: 'School not found' });

      const classRows = await db.select({
        id: classes.id,
        name: classes.name,
        schoolId: classes.schoolId,
        academicYearId: classes.academicYearId,
        yearName: academicYears.name,
        levelId: classes.levelId,
        levelName: levels.name,
        cycleId: cycles.id,
        cycleCode: cycles.code,
      })
        .from(classes)
        .leftJoin(academicYears, eq(academicYears.id, classes.academicYearId))
        .leftJoin(levels, eq(levels.id, classes.levelId))
        .leftJoin(cycles, eq(cycles.id, levels.cycleId))
        .leftJoin(schoolClasses, and(
          eq(schoolClasses.classId, classes.id),
          eq(schoolClasses.schoolId, schoolId),
          eq(schoolClasses.status, 'approved'),
        ))
        .where(and(
          eq(classes.academicYearId, academicYearId),
          or(
            eq(classes.schoolId, schoolId),
            and(sql`${classes.schoolId} IS NULL`, sql`${schoolClasses.id} IS NOT NULL`),
          ),
        ));

      const [availableTerms, periodStates] = await Promise.all([
        db.select().from(schoolTerms).where(and(
          eq(schoolTerms.academicYearId, academicYearId),
          or(sql`${schoolTerms.schoolId} IS NULL`, eq(schoolTerms.schoolId, schoolId)),
        )),
        getSchoolPeriodTypeStates(schoolId),
      ]);
      const classCycleIds = Array.from(new Set(
        classRows
          .map((classRecord) => classRecord.cycleId)
          .filter((cycleId): cycleId is number => cycleId != null),
      ));
      const enabledCycles = new Map(await Promise.all(classCycleIds.map(async (cycleId) => [
        cycleId,
        await validateSchoolCycle(schoolId, cycleId),
      ] as const)));
      const eligibleClasses = classRows.flatMap((classRecord) => {
        if (classRecord.cycleId != null && enabledCycles.get(classRecord.cycleId) !== true) return [];
        const classTerms = filterAvailableSchoolTerms(availableTerms, periodStates, {
          cycleId: classRecord.cycleId,
          cycleCode: classRecord.cycleCode,
        });
        const term = classTerms.find((item) => item.id === termId);
        return term ? [{ classRecord, term }] : [];
      });
      const selectedPeriod = eligibleClasses[0]?.term
        ?? filterAvailableSchoolTerms(availableTerms, periodStates).find((item) => item.id === termId);

      if (classRows.length > 0 && eligibleClasses.length === 0) {
        return res.status(400).json({ error: 'Selected period is not compatible with any class in this school' });
      }

      const classIds = eligibleClasses.map(({ classRecord }) => classRecord.id);
      if (classIds.length === 0) {
        return res.json({
          school,
          academicYear: { id: academicYearId },
          period: {
            id: termId,
            name: selectedPeriod?.name ?? '',
            periodType: selectedPeriod?.periodType ?? null,
          },
          classes: [],
          subjects: [],
          cells: [],
        });
      }

      const authorizedStudents = await studentAccess.getAuthorizedStudents(actor, { classIds });
      const studentsByClassId = new Map<number, Array<{
        id: number;
        classId: number;
        schoolId: number;
        firstName?: string;
        lastName?: string;
      }>>();
      for (const student of authorizedStudents) {
        if (student.classId == null || !classIds.includes(student.classId) || student.schoolId !== schoolId) continue;
        const group = studentsByClassId.get(student.classId) ?? [];
        group.push({
          id: student.id,
          classId: student.classId,
          schoolId: student.schoolId,
          firstName: student.firstName,
          lastName: student.lastName,
        });
        studentsByClassId.set(student.classId, group);
      }

      const evaluationRows = await db.select({
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
        inArray(evaluations.classId, classIds),
        eq(evaluations.schoolId, schoolId),
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

      const studentIds = authorizedStudents
        .filter((student) => student.classId != null && classIds.includes(student.classId) && student.schoolId === schoolId)
        .map((student) => student.id);
      const evaluationIds = evaluationRows.map((evaluation) => evaluation.id);
      const gradeRows = studentIds.length === 0 || evaluationIds.length === 0
        ? []
        : await db.select({
          id: grades.id,
          evaluationId: grades.evaluationId,
          studentId: grades.studentId,
          score: grades.score,
        }).from(grades).where(and(
          inArray(grades.studentId, studentIds),
          inArray(grades.evaluationId, evaluationIds),
        ));

      const subjectsById = new Map<number, string>();
      for (const evaluation of evaluationRows) {
        if (
          evaluation.countInBulletin !== false
          && evaluation.subjectId != null
          && !subjectsById.has(evaluation.subjectId)
        ) {
          subjectsById.set(evaluation.subjectId, evaluation.subject);
        }
      }

      const cells: Array<{
        classId: number;
        subjectId: number;
        average: number | null;
        studentsWithResult: number;
        studentsWithoutResult: number;
      }> = [];
      const cellValues = new Map<string, number[]>();
      const cellCounts = new Map<string, { withResult: number; withoutResult: number }>();

      for (const { classRecord } of eligibleClasses) {
        const classStudents = studentsByClassId.get(classRecord.id) ?? [];
        const classEvaluations = evaluationRows.filter((evaluation) => evaluation.classId === classRecord.id);
        const classEvaluationIds = new Set(classEvaluations.map((evaluation) => evaluation.id));
        const classGrades = gradeRows.filter((grade) => classEvaluationIds.has(grade.evaluationId));
        for (const student of classStudents) {
          const { lines } = calculateOfficialStudentAverage({
            student,
            classStudents,
            termId,
            termEvaluations: classEvaluations,
            allGrades: classGrades,
          });
          const linesBySubjectId = new Map<number, number[]>();
          for (const line of lines) {
            if (line.subjectId == null) continue;
            subjectsById.set(line.subjectId, line.subjectName);
            if (line.average == null || !Number.isFinite(line.average)) continue;
            const values = linesBySubjectId.get(line.subjectId) ?? [];
            values.push(line.average);
            linesBySubjectId.set(line.subjectId, values);
          }
          for (const subjectId of subjectsById.keys()) {
            const key = `${classRecord.id}:${subjectId}`;
            const values = linesBySubjectId.get(subjectId) ?? [];
            const count = cellCounts.get(key) ?? { withResult: 0, withoutResult: 0 };
            if (values.length === 1) {
              const cellResults = cellValues.get(key) ?? [];
              cellResults.push(values[0]);
              cellValues.set(key, cellResults);
              count.withResult += 1;
            } else {
              count.withoutResult += 1;
            }
            cellCounts.set(key, count);
          }
        }
      }

      for (const { classRecord } of eligibleClasses) {
        for (const subjectId of subjectsById.keys()) {
          const key = `${classRecord.id}:${subjectId}`;
          const counts = cellCounts.get(key) ?? { withResult: 0, withoutResult: 0 };
          const results = cellValues.get(key) ?? [];
          const classStudentCount = studentsByClassId.get(classRecord.id)?.length ?? 0;
          cells.push({
            classId: classRecord.id,
            subjectId,
            average: results.length > 0
              ? results.reduce((sum, value) => sum + value, 0) / results.length
              : null,
            studentsWithResult: counts.withResult,
            studentsWithoutResult: classStudentCount - counts.withResult,
          });
        }
      }

      return res.json({
        school,
        academicYear: {
          id: academicYearId,
          name: eligibleClasses[0]?.classRecord.yearName ?? null,
        },
        period: {
          id: selectedPeriod?.id ?? termId,
          name: selectedPeriod?.name ?? '',
          periodType: selectedPeriod?.periodType ?? null,
        },
        classes: eligibleClasses.map(({ classRecord }) => ({
          id: classRecord.id,
          name: classRecord.name,
          levelId: classRecord.levelId,
          levelName: classRecord.levelName,
        })),
        subjects: Array.from(subjectsById, ([id, name]) => ({ id, name })),
        cells,
      });
    } catch (error) {
      console.error('Failed to calculate class-subject pivot:', error);
      return res.status(500).json({ error: 'Failed to calculate class-subject pivot' });
    }
  });
};
