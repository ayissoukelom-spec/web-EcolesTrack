import type express from 'express';
import { and, eq, inArray, or, sql } from 'drizzle-orm';
import { db } from '../db/index.ts';
import {
  classes,
  evaluations,
  grades,
  schools,
} from '../db/schema.ts';
import { requireRole, verifyToken } from '../middleware/auth.ts';
import studentAccess, { isApprovedClassForSchool } from './studentAccess';
import { resolveSchoolTermForClass } from './educationStructure.ts';
import { calculateOfficialClassResults } from './bulletinSnapshotService';

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

export const registerClassRankingRoute = (
  app: express.Express,
  options: RegisterClassRankingRouteOptions,
) => {
  const {
    resolveActor,
    verifyMiddleware = verifyToken as any,
    accessMiddleware = requireRole(['admin']) as any,
    resolveAvailableTerm = resolveSchoolTermForClass,
  } = options;

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

      const results = calculateOfficialClassResults(classStudents, termId, evaluationRows, gradeRows);
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
