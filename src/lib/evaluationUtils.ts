import { Evaluation, Grade, Student, UserRole } from '../types.ts';

export const parseDateValue = (value: string | Date | undefined | null): Date | null => {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  const rawValue = String(value).trim();
  const normalizedIso = rawValue.replace(/\s+/g, 'T');
  const isoDate = new Date(normalizedIso);
  if (!Number.isNaN(isoDate.getTime())) {
    return isoDate;
  }

  const isoDateOnlyMatch = rawValue.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoDateOnlyMatch) {
    return new Date(`${rawValue}T00:00:00Z`);
  }

  const europeanMatch = rawValue.match(/^([0-3]?\d)[\/\-]([0-1]?\d)[\/\-](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (europeanMatch) {
    const day = parseInt(europeanMatch[1], 10);
    const month = parseInt(europeanMatch[2], 10) - 1;
    const year = parseInt(europeanMatch[3], 10);
    const hour = europeanMatch[4] ? parseInt(europeanMatch[4], 10) : 0;
    const minute = europeanMatch[5] ? parseInt(europeanMatch[5], 10) : 0;
    const second = europeanMatch[6] ? parseInt(europeanMatch[6], 10) : 0;
    const parsed = new Date(year, month, day, hour, minute, second);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  return null;
};

export const getDateOnlyMs = (date: Date): number => Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());

export const isStudentEligibleForEvaluation = (student: Student, evaluation: Evaluation): boolean => {
  if (!student.enrolledAt || (!evaluation.createdAt && !evaluation.date)) {
    console.log({
      student: student.firstName + ' ' + student.lastName,
      enrolledAt: student.enrolledAt,
      evaluationDate: evaluation.date,
      evaluationCreatedAt: evaluation.createdAt,
      comparisonDate: evaluation.createdAt ?? evaluation.date,
      eligible: true,
    });
    return true;
  }
  const enrollmentDate = parseDateValue(student.enrolledAt);
  const comparisonDate = evaluation.createdAt || evaluation.date;
  const evaluationTimestamp = parseDateValue(comparisonDate);
  if (!enrollmentDate || !evaluationTimestamp) {
    console.log({
      student: student.firstName + ' ' + student.lastName,
      enrolledAt: student.enrolledAt,
      evaluationDate: evaluation.date,
      evaluationCreatedAt: evaluation.createdAt,
      comparisonDate,
      eligible: true,
    });
    return true;
  }
  const eligible = enrollmentDate.getTime() <= evaluationTimestamp.getTime();
  console.log({
    student: student.firstName + ' ' + student.lastName,
    enrolledAt: student.enrolledAt,
    evaluationDate: evaluation.date,
    evaluationCreatedAt: evaluation.createdAt,
    comparisonDate,
    eligible,
  });
  return eligible;
};

export const getEligibleStudentsForEvaluation = (evaluation: Evaluation | null, students: Student[]): Student[] => {
  if (!evaluation) return students;
  return students.filter((st) => isStudentEligibleForEvaluation(st, evaluation));
};

export const isLegacyEvaluation = (evaluation: Evaluation | null): boolean => {
  if (!evaluation) return true;
  if (!evaluation.createdAt) return true;
  return parseDateValue(evaluation.createdAt) === null;
};

export const getEligibleStudentsForEvaluationWithGrades = (
  evaluation: Evaluation | null,
  students: Student[],
  grades: Grade[],
): Student[] => {
  if (!evaluation) return students;

  const currentlyEligible = getEligibleStudentsForEvaluation(evaluation, students);
  if (!isLegacyEvaluation(evaluation)) return currentlyEligible;

  const gradedStudentIds = new Set(
    grades
      .filter((g) => g.evaluationId === evaluation.id)
      .map((g) => g.studentId),
  );
  const gradedStudents = students.filter((st) => gradedStudentIds.has(st.id));

  return Array.from(new Map([...currentlyEligible, ...gradedStudents].map((st) => [st.id, st])).values());
};

export const getEligibleGradesForEvaluation = (evaluation: Evaluation | null, students: Student[], grades: Grade[]): Grade[] => {
  if (!evaluation) return [];
  if (isLegacyEvaluation(evaluation)) {
    return grades.filter((grade) => grade.evaluationId === evaluation.id);
  }

  const eligibleStudentIds = new Set(getEligibleStudentsForEvaluation(evaluation, students).map((st) => st.id));
  return grades.filter((grade) => grade.evaluationId === evaluation.id && eligibleStudentIds.has(grade.studentId));
};

export const getEligibleStudentsWithHistoryForEvaluation = (
  evaluation: Evaluation | null,
  students: Student[],
  grades: Grade[],
): Student[] => {
  if (!evaluation) return students;
  const currentlyEligible = getEligibleStudentsForEvaluation(evaluation, students);
  const gradedStudents = students.filter((st) =>
    grades.some((g) => g.evaluationId === evaluation.id && g.studentId === st.id),
  );
  return Array.from(new Map([...currentlyEligible, ...gradedStudents].map((st) => [st.id, st])).values());
};

export const isEvaluationFullyGraded = (evaluation: Evaluation, students: Student[], grades: Grade[]): boolean => {
  const classStudents = students.filter((st) => st.classId === evaluation.classId);
  if (classStudents.length === 0) return false;

  const eligibleStudents = getEligibleStudentsForEvaluationWithGrades(evaluation, classStudents, grades);
  if (eligibleStudents.length === 0) return false;

  const eligibleStudentIds = new Set(eligibleStudents.map((st) => st.id));
  const gradesForEval = grades.filter(
    (g) => g.evaluationId === evaluation.id && eligibleStudentIds.has(g.studentId),
  );

  return gradesForEval.length === eligibleStudentIds.size;
};

export const getOverdueEvaluations = (
  evaluations: Evaluation[],
  students: Student[],
  grades: Grade[],
  userRole: UserRole,
  teacherId?: number | null,
  options?: { overdueDays?: number; nowMs?: number },
): Evaluation[] => {
  const nowMs = options?.nowMs ?? Date.now();
  const overdueThresholdMs = (options?.overdueDays ?? 7) * 24 * 60 * 60 * 1000;

  return evaluations.filter((ev) => {
    const evaluationTimestamp = parseDateValue(ev.createdAt || ev.date);
    if (!evaluationTimestamp) return false;

    const ageMs = nowMs - evaluationTimestamp.getTime();
    if (ageMs < overdueThresholdMs) return false;

    const classStudents = students.filter((st) => st.classId === ev.classId);
    if (classStudents.length === 0) return false;

    const eligibleStudents = classStudents.filter((st) => {
      if (!st.enrolledAt || !evaluationTimestamp) return true;
      const enrollmentDate = parseDateValue(st.enrolledAt);
      return enrollmentDate ? enrollmentDate.getTime() <= evaluationTimestamp.getTime() : true;
    });
    if (eligibleStudents.length === 0) return false;

    const eligibleStudentIds = new Set(eligibleStudents.map((st) => st.id));
    const gradesForEval = grades.filter(
      (g) => g.evaluationId === ev.id && eligibleStudentIds.has(g.studentId),
    );
    if (gradesForEval.length >= eligibleStudents.length) return false;

    if (userRole === 'teacher') {
      return teacherId != null ? ev.teacherId === teacherId : true;
    }

    return true;
  });
};

export const countOverdueEvaluations = (
  evaluations: Evaluation[],
  students: Student[],
  grades: Grade[],
  userRole: UserRole,
  teacherId?: number | null,
  options?: { overdueDays?: number; nowMs?: number },
): number => getOverdueEvaluations(evaluations, students, grades, userRole, teacherId, options).length;

export const isEvaluationCompleted = (evaluation: Evaluation, students: Student[], grades: Grade[]): boolean => {
  const classStudents = students.filter((st) => st.classId === evaluation.classId);
  if (classStudents.length === 0) return false;

  const eligibleStudents = getEligibleStudentsForEvaluationWithGrades(evaluation, classStudents, grades);
  if (eligibleStudents.length === 0) return false;

  const eligibleStudentIds = new Set(eligibleStudents.map((st) => st.id));
  const gradesForEval = grades.filter(
    (g) => g.evaluationId === evaluation.id && eligibleStudentIds.has(g.studentId),
  );

  // Evaluation is completed when ALL eligible students have a grade
  return gradesForEval.length === eligibleStudentIds.size;
};

export const getFullyGradedEvaluations = (evaluations: Evaluation[], students: Student[], grades: Grade[]): Evaluation[] =>
  evaluations.filter((evaluation) => isEvaluationFullyGraded(evaluation, students, grades));

export const hasAnyGrade = (evaluation: Evaluation, grades: Grade[]): boolean =>
  grades.some((grade) => grade.evaluationId === evaluation.id);

export const isEvaluationArchived = (evaluation: Evaluation, students: Student[], grades: Grade[]): boolean =>
  isEvaluationCompleted(evaluation, students, grades);

export const isEvaluationArchivedForSchoolAdminByAge = (
  evaluation: Evaluation,
  students: Student[],
  grades: Grade[],
  daysThreshold = 30,
): boolean => {
  const classStudents = students.filter((st) => st.classId === evaluation.classId);
  if (classStudents.length === 0) return false;

  const eligibleStudents = getEligibleStudentsForEvaluationWithGrades(evaluation, classStudents, grades);
  if (eligibleStudents.length === 0) return false;

  const eligibleStudentIds = new Set(eligibleStudents.map((st) => st.id));
  const gradesForEval = grades.filter(
    (grade) => grade.evaluationId === evaluation.id && eligibleStudentIds.has(grade.studentId),
  );
  if (gradesForEval.length === 0) return false;

  const gradeTimestamps = gradesForEval
    .map((grade) => parseDateValue(grade.updatedAt ?? grade.createdAt))
    .filter((date): date is Date => date !== null)
    .map((date) => date.getTime());
  if (gradeTimestamps.length === 0) return false;

  const latestGradeTime = Math.max(...gradeTimestamps);
  const thresholdMs = daysThreshold * 24 * 60 * 60 * 1000;
  return Date.now() - latestGradeTime > thresholdMs;
};

export const isEvaluationLockedBySchoolAdmin = (evaluation: Evaluation, students: Student[], grades: Grade[]): boolean => {
  const classStudents = students.filter((st) => st.classId === evaluation.classId);
  if (classStudents.length === 0) return false;

  const eligibleStudents = getEligibleStudentsForEvaluationWithGrades(evaluation, classStudents, grades);
  if (eligibleStudents.length === 0) return false;

  const eligibleStudentIds = new Set(eligibleStudents.map((st) => st.id));
  const gradesForEval = grades.filter(
    (grade) => grade.evaluationId === evaluation.id && eligibleStudentIds.has(grade.studentId),
  );
  if (gradesForEval.length === 0) return false;

  return gradesForEval.every((grade) => grade.isModified ?? ((grade.editCount ?? 0) > 0));
};
