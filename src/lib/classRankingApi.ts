import type express from 'express';
import { and, eq, inArray, or, sql } from 'drizzle-orm';
import { db } from '../db/index.ts';
import {
  classes,
  evaluations,
  grades,
  schools,
  students,
} from '../db/schema.ts';
import { requireRole, verifyToken } from '../middleware/auth.ts';
import studentAccess, { isApprovedClassForSchool } from './studentAccess';
import { resolveSchoolTermForClass } from './educationStructure.ts';
import { calculateOfficialClassResults, computeRank } from './bulletinSnapshotService';
import { normalizeEvaluationType } from './bulletinService';
import { validateGradeScore } from './gradeValidation.ts';

interface ClassRankingActor {
  id?: number | null;
  role: string;
  schoolId?: number | null;
}

interface RegisterClassRankingRouteOptions {
  resolveActor: (req: any) => Promise<ClassRankingActor | null>;
  verifyMiddleware?: express.RequestHandler;
  accessMiddleware?: express.RequestHandler;
  resolveAvailableTerm?: typeof resolveSchoolTermForClass;
}

const parsePositiveInteger = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

const parseOptionalPositiveInteger = (value: unknown): number | undefined | null => {
  if (value == null || value === '') return undefined;
  return parsePositiveInteger(value);
};

interface SelectedEvaluationLike {
  id: number;
  subjectId?: number | null;
  subject: string;
  title: string;
  type?: string | null;
  coefficient: number;
  maxScore: number;
  date?: string;
}

interface SelectedGradeLike {
  id: number;
  evaluationId: number;
  studentId: number;
  score: string;
  createdAt?: Date | string | null;
  updatedAt?: Date | string | null;
}

interface SelectedClassStudent {
  id: number;
  classId: number;
  schoolId: number;
  firstName: string;
  lastName: string;
  matricule?: string | null;
}

interface SelectedSubjectAverage {
  subjectId: number | null;
  subjectName: string;
  average: number | null;
}

interface SelectedClassResult {
  studentId: number;
  matricule: string | null;
  firstName: string;
  lastName: string;
  subjectAverages: SelectedSubjectAverage[];
  missingSubjects: string[];
  missingEvaluations: string[];
  average: number | null;
  rank: number | null;
}

const parseNumericScore = (score: string | number | null | undefined): number | null => {
  if (score == null) return null;
  const parsed = Number(String(score).trim().replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
};

const gradeTimestamp = (grade: SelectedGradeLike): number => {
  const value = grade.updatedAt ?? grade.createdAt;
  if (value == null) return 0;
  const timestamp = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
};

const getLatestGradeByEvaluationAndStudent = (
  grades: SelectedGradeLike[],
): Map<string, SelectedGradeLike> => {
  const latestGrades = new Map<string, SelectedGradeLike>();
  for (const grade of grades) {
    const key = `${grade.evaluationId}:${grade.studentId}`;
    const current = latestGrades.get(key);
    if (!current
      || gradeTimestamp(grade) > gradeTimestamp(current)
      || (gradeTimestamp(grade) === gradeTimestamp(current) && grade.id > current.id)) {
      latestGrades.set(key, grade);
    }
  }
  return latestGrades;
};

const subjectKey = (evaluation: SelectedEvaluationLike): string => {
  if (evaluation.subjectId != null) return `id:${evaluation.subjectId}`;
  const normalizedName = evaluation.subject.trim().toLocaleLowerCase('fr')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  return `name:${normalizedName}`;
};

export const calculateSelectedEvaluationResults = (
  classStudents: SelectedClassStudent[],
  selectedEvaluations: SelectedEvaluationLike[],
  allGrades: SelectedGradeLike[],
): SelectedClassResult[] => {
  const subjectByKey = new Map<string, { subjectId: number | null; subjectName: string }>();
  for (const evaluation of selectedEvaluations) {
    const key = subjectKey(evaluation);
    if (!subjectByKey.has(key)) {
      subjectByKey.set(key, {
        subjectId: evaluation.subjectId ?? null,
        subjectName: evaluation.subject.trim(),
      });
    }
  }

  const latestGrades = getLatestGradeByEvaluationAndStudent(allGrades);
  const results = classStudents.map((student) => {
    const subjectTotals = new Map<string, { weightedScore: number; totalCoefficient: number }>();
    const missingEvaluations: string[] = [];
    for (const evaluation of selectedEvaluations) {
      const key = subjectKey(evaluation);
      const grade = latestGrades.get(`${evaluation.id}:${student.id}`);
      const score = parseNumericScore(grade?.score);
      const maxScore = Number(evaluation.maxScore);
      const coefficient = Number(evaluation.coefficient);
      if (score == null
        || !validateGradeScore(score, maxScore).isValid
        || !Number.isFinite(maxScore)
        || maxScore <= 0
        || !Number.isFinite(coefficient)
        || coefficient <= 0) {
        missingEvaluations.push(`${evaluation.subject.trim()} — ${evaluation.title}`);
        continue;
      }

      const normalizedScore = (score / maxScore) * 20;
      const total = subjectTotals.get(key) ?? { weightedScore: 0, totalCoefficient: 0 };
      total.weightedScore += normalizedScore * coefficient;
      total.totalCoefficient += coefficient;
      subjectTotals.set(key, total);
    }

    const subjectAverages = Array.from(subjectByKey.entries()).map(([key, subject]) => {
      const total = subjectTotals.get(key);
      return {
        ...subject,
        average: total && total.totalCoefficient > 0
          ? total.weightedScore / total.totalCoefficient
          : null,
      };
    });
    const availableSubjectAverages = subjectAverages
      .map(({ average }) => average)
      .filter((average): average is number => average != null && Number.isFinite(average));
    const average = availableSubjectAverages.length > 0
      ? availableSubjectAverages.reduce((sum, value) => sum + value, 0) / availableSubjectAverages.length
      : null;

    return {
      studentId: student.id,
      matricule: student.matricule ?? null,
      firstName: student.firstName ?? '',
      lastName: student.lastName ?? '',
      subjectAverages,
      missingSubjects: subjectAverages
        .filter((subject) => subject.average == null)
        .map((subject) => subject.subjectName),
      missingEvaluations,
      average,
      rank: null,
    };
  });

  const averagesForRank = results.map(({ studentId, average }) => ({ studentId, average }));
  for (const result of results) {
    result.rank = computeRank(result.studentId, averagesForRank);
  }

  const collator = new Intl.Collator('fr', { sensitivity: 'base' });
  return results.sort((a, b) => {
    if (a.average == null) return b.average == null
      ? collator.compare(a.lastName, b.lastName)
        || collator.compare(a.firstName, b.firstName)
        || a.studentId - b.studentId
      : 1;
    if (b.average == null) return -1;
    return b.average - a.average
      || collator.compare(a.lastName, b.lastName)
      || collator.compare(a.firstName, b.firstName)
      || a.studentId - b.studentId;
  });
};

interface ClassRankingScope {
  actor: ClassRankingActor;
  school: { id: number; name: string };
  schoolId: number;
  classRecord: { id: number; name: string; schoolId: number | null; academicYearId: number };
  term: {
    id: number;
    name: string;
    periodType?: string | null;
    startDate?: string | null;
    endDate?: string | null;
  };
  classId: number;
  termId: number;
}

const resolveCustomClassRankingScope = async (
  req: any,
  res: any,
  resolveActor: RegisterClassRankingRouteOptions['resolveActor'],
  resolveAvailableTerm: NonNullable<RegisterClassRankingRouteOptions['resolveAvailableTerm']>,
): Promise<ClassRankingScope | null> => {
  const actor = await resolveActor(req);
  if (!actor) {
    res.status(404).json({ error: 'User not found' });
    return null;
  }
  if (!['super_admin', 'school_admin'].includes(actor.role)) {
    res.status(403).json({ error: 'Forbidden' });
    return null;
  }

  const input = req.method === 'POST' ? req.body : req.query;
  const classId = parsePositiveInteger(input?.classId);
  const termId = parsePositiveInteger(input?.periodId);
  const requestedSchoolId = parseOptionalPositiveInteger(input?.schoolId);
  if (classId == null || termId == null || requestedSchoolId === null) {
    res.status(400).json({ error: 'classId, periodId, and a valid schoolId are required' });
    return null;
  }
  if (actor.role === 'school_admin' && actor.schoolId == null) {
    res.status(403).json({ error: 'School context required' });
    return null;
  }
  if (actor.role === 'school_admin'
    && requestedSchoolId != null
    && requestedSchoolId !== actor.schoolId) {
    res.status(403).json({ error: 'Forbidden' });
    return null;
  }

  const schoolId = actor.role === 'school_admin' ? actor.schoolId! : requestedSchoolId;
  if (schoolId == null) {
    res.status(400).json({ error: 'schoolId is required' });
    return null;
  }

  const [classRecord] = await db.select({
    id: classes.id,
    name: classes.name,
    schoolId: classes.schoolId,
    academicYearId: classes.academicYearId,
  }).from(classes).where(eq(classes.id, classId));
  if (!classRecord) {
    res.status(404).json({ error: 'Class not found' });
    return null;
  }
  if (classRecord.schoolId != null && classRecord.schoolId !== schoolId) {
    res.status(403).json({ error: 'Class is outside the school scope' });
    return null;
  }
  if (!(await isApprovedClassForSchool(classId, schoolId))) {
    res.status(403).json({ error: 'Class is not approved for this school' });
    return null;
  }

  const [school] = await db.select({
    id: schools.id,
    name: schools.name,
  }).from(schools).where(eq(schools.id, schoolId));
  if (!school) {
    res.status(404).json({ error: 'School not found' });
    return null;
  }

  const periodAvailability = await resolveAvailableTerm({
    classId,
    academicYearId: classRecord.academicYearId,
    schoolId,
    date: '',
    requestedTermId: termId,
  });
  if ('error' in periodAvailability) {
    res.status(400).json({ error: periodAvailability.error });
    return null;
  }

  return {
    actor,
    school,
    schoolId,
    classRecord,
    term: periodAvailability.term,
    classId,
    termId,
  };
};

const getEvaluationsInPeriod = async (
  classId: number,
  schoolId: number,
  termId: number,
) => db.select({
  id: evaluations.id,
  classId: evaluations.classId,
  schoolId: evaluations.schoolId,
  termId: evaluations.termId,
  subjectId: evaluations.subjectId,
  subject: evaluations.subject,
  title: evaluations.title,
  type: evaluations.type,
  coefficient: evaluations.coefficient,
  maxScore: evaluations.maxScore,
  countInBulletin: evaluations.countInBulletin,
  date: evaluations.date,
}).from(evaluations).where(and(
  eq(evaluations.classId, classId),
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

const isEvaluationWithinScope = (
  evaluation: {
    classId: number;
    schoolId: number | null;
    termId: number | null;
    date: string;
  },
  scope: ClassRankingScope,
): boolean => (
  evaluation.classId === scope.classId
  && evaluation.schoolId === scope.schoolId
  && (
    evaluation.termId === scope.termId
    || (
      evaluation.termId == null
      && scope.term.startDate != null
      && scope.term.endDate != null
      && evaluation.date >= scope.term.startDate
      && evaluation.date <= scope.term.endDate
    )
  )
);

export const registerClassRankingRoute = (
  app: express.Express,
  options: RegisterClassRankingRouteOptions,
) => {
  const {
    resolveActor,
    verifyMiddleware = verifyToken as any,
    accessMiddleware = requireRole(['school_admin', 'super_admin']) as any,
    resolveAvailableTerm = resolveSchoolTermForClass,
  } = options;

  app.get('/api/results/class-ranking/available-evaluations', verifyMiddleware, accessMiddleware, async (req: any, res) => {
    try {
      const scope = await resolveCustomClassRankingScope(req, res, resolveActor, resolveAvailableTerm);
      if (!scope) return;

      const rows = await getEvaluationsInPeriod(scope.classId, scope.schoolId, scope.termId);
      return res.json(rows.filter((evaluation) => {
        const type = normalizeEvaluationType(evaluation.type);
        return isEvaluationWithinScope(evaluation, scope)
          && type != null;
      }).map((evaluation) => ({
        id: evaluation.id,
        subjectId: evaluation.subjectId,
        subject: evaluation.subject,
        title: evaluation.title,
        type: normalizeEvaluationType(evaluation.type),
        coefficient: evaluation.coefficient,
        maxScore: evaluation.maxScore,
        countInBulletin: evaluation.countInBulletin,
        date: evaluation.date,
      })));
    } catch (error) {
      console.error('Failed to load custom class ranking evaluations:', error);
      return res.status(500).json({ error: 'Failed to load available evaluations' });
    }
  });

  app.post('/api/results/class-ranking/custom', verifyMiddleware, accessMiddleware, async (req: any, res) => {
    try {
      const scope = await resolveCustomClassRankingScope(req, res, resolveActor, resolveAvailableTerm);
      if (!scope) return;

      const evaluationIds = req.body?.evaluationIds;
      if (!Array.isArray(evaluationIds)
        || evaluationIds.length === 0
        || evaluationIds.some((id: unknown) => !Number.isInteger(id) || Number(id) <= 0)
        || new Set(evaluationIds).size !== evaluationIds.length) {
        return res.status(400).json({ error: 'evaluationIds must be a non-empty list of unique positive integers' });
      }

      const availableEvaluations = await getEvaluationsInPeriod(scope.classId, scope.schoolId, scope.termId);
      const selectedEvaluations = availableEvaluations.filter((evaluation) => (
        evaluationIds.includes(evaluation.id) && isEvaluationWithinScope(evaluation, scope)
      ));
      if (selectedEvaluations.length !== evaluationIds.length
        || selectedEvaluations.some((evaluation) => normalizeEvaluationType(evaluation.type) == null)) {
        return res.status(400).json({ error: 'One or more selected evaluations are unavailable for this class and period' });
      }

      const authorizedStudents = await studentAccess.getAuthorizedStudents(
        scope.actor,
        { classIds: [scope.classId] },
      );
      const classStudents = authorizedStudents
        .filter((student: any) => student.classId === scope.classId && student.schoolId === scope.schoolId)
        .map((student: any) => ({
          id: student.id,
          classId: student.classId,
          schoolId: student.schoolId,
          firstName: student.firstName,
          lastName: student.lastName,
        }));
      const studentIds = classStudents.map((student: SelectedClassStudent) => student.id);
      const [studentRows, gradeRows] = studentIds.length === 0
        ? [[], []]
        : await Promise.all([
          db.select({
            id: students.id,
            matricule: students.matricule,
          }).from(students).where(and(
            eq(students.classId, scope.classId),
            eq(students.schoolId, scope.schoolId),
            inArray(students.id, studentIds),
          )),
          db.select({
            id: grades.id,
            evaluationId: grades.evaluationId,
            studentId: grades.studentId,
            score: grades.score,
            createdAt: grades.createdAt,
            updatedAt: grades.updatedAt,
          }).from(grades).where(and(
            inArray(grades.studentId, studentIds),
            inArray(grades.evaluationId, evaluationIds),
          )),
        ]);
      const matriculeByStudentId = new Map(studentRows.map((student) => [student.id, student.matricule]));
      const results = calculateSelectedEvaluationResults(
        classStudents.map((student: SelectedClassStudent) => ({
          ...student,
          matricule: matriculeByStudentId.get(student.id) ?? null,
        })),
        selectedEvaluations,
        gradeRows,
      );

      return res.json({
        school: scope.school,
        class: { id: scope.classRecord.id, name: scope.classRecord.name },
        period: { id: scope.term.id, name: scope.term.name, periodType: scope.term.periodType ?? null },
        evaluations: selectedEvaluations.map((evaluation) => ({
          id: evaluation.id,
          subjectId: evaluation.subjectId,
          subject: evaluation.subject,
          title: evaluation.title,
          type: normalizeEvaluationType(evaluation.type),
          coefficient: evaluation.coefficient,
          maxScore: evaluation.maxScore,
          date: evaluation.date,
        })),
        rankedStudentCount: results.filter((student) => student.rank != null).length,
        calculatedAt: new Date().toISOString(),
        students: results,
      });
    } catch (error) {
      console.error('Failed to calculate custom class ranking:', error);
      return res.status(500).json({ error: 'Failed to calculate custom class ranking' });
    }
  });

  app.get('/api/results/class-ranking', verifyMiddleware, accessMiddleware, async (req: any, res) => {
    try {
      const actor = await resolveActor(req);
      if (!actor) return res.status(404).json({ error: 'User not found' });
      if (!['super_admin', 'school_admin'].includes(actor.role)) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      const classId = parsePositiveInteger(req.query?.classId);
      const termId = parsePositiveInteger(req.query?.periodId);
      const requestedSchoolId = parsePositiveInteger(req.query?.schoolId);
      if (classId == null || termId == null) {
        return res.status(400).json({ error: 'classId and periodId are required' });
      }

      if (actor.role === 'school_admin' && actor.schoolId == null) {
        return res.status(403).json({ error: 'School context required' });
      }
      if (actor.role === 'school_admin' && requestedSchoolId != null && requestedSchoolId !== actor.schoolId) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      const schoolId = actor.role === 'school_admin' ? actor.schoolId! : requestedSchoolId;
      if (schoolId == null) return res.status(400).json({ error: 'schoolId is required' });

      const [classRecord] = await db.select({
        id: classes.id,
        name: classes.name,
        schoolId: classes.schoolId,
        academicYearId: classes.academicYearId,
      }).from(classes).where(eq(classes.id, classId));
      if (!classRecord) return res.status(404).json({ error: 'Class not found' });

      if (classRecord.schoolId != null && classRecord.schoolId !== schoolId) {
        return res.status(403).json({ error: 'Class is outside the school scope' });
      }
      if (!(await isApprovedClassForSchool(classId, schoolId))) {
        return res.status(403).json({ error: 'Class is not approved for this school' });
      }

      const [school] = await db.select({
        id: schools.id,
        name: schools.name,
      }).from(schools).where(eq(schools.id, schoolId));
      if (!school) return res.status(404).json({ error: 'School not found' });

      const periodAvailability = await resolveAvailableTerm({
        classId,
        academicYearId: classRecord.academicYearId,
        schoolId,
        date: '',
        requestedTermId: termId,
      });
      if ('error' in periodAvailability) {
        return res.status(400).json({ error: periodAvailability.error });
      }
      const term = periodAvailability.term;

      const authorizedStudents = await studentAccess.getAuthorizedStudents(actor, { classIds: [classId] });
      const classStudents = authorizedStudents
        .filter((student) => student.classId === classId && student.schoolId === schoolId)
        .map((student) => ({
          id: student.id,
          classId: student.classId,
          schoolId: student.schoolId,
          firstName: student.firstName,
          lastName: student.lastName,
        }));
      const studentRows = classStudents.length === 0
        ? []
        : await db.select({
          id: students.id,
          matricule: students.matricule,
        }).from(students).where(and(
          eq(students.classId, classId),
          eq(students.schoolId, schoolId),
          inArray(students.id, classStudents.map((student) => student.id)),
        ));
      const matriculeByStudentId = new Map(studentRows.map((student) => [student.id, student.matricule]));

      if (classStudents.length === 0) {
        return res.json({
          school,
          class: { id: classRecord.id, name: classRecord.name },
          period: { id: term.id, name: term.name, periodType: term.periodType ?? null },
          students: [],
        });
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
        eq(evaluations.classId, classId),
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

      const evaluationIds = evaluationRows.map((evaluation) => evaluation.id);
      const gradeRows = evaluationIds.length === 0
        ? []
        : await db.select({
          id: grades.id,
          evaluationId: grades.evaluationId,
          studentId: grades.studentId,
          score: grades.score,
        }).from(grades).where(and(
          inArray(grades.studentId, classStudents.map((student) => student.id)),
          inArray(grades.evaluationId, evaluationIds),
        ));

      const results = calculateOfficialClassResults(classStudents, termId, evaluationRows, gradeRows)
        .map((result) => ({
          ...result,
          matricule: matriculeByStudentId.get(result.studentId) ?? null,
        }));
      return res.json({
        school,
        class: { id: classRecord.id, name: classRecord.name },
        period: { id: term.id, name: term.name, periodType: term.periodType ?? null },
        students: results,
      });
    } catch (error) {
      console.error('Failed to calculate class ranking:', error);
      return res.status(500).json({ error: 'Failed to calculate class ranking' });
    }
  });
};
