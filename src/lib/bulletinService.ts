export interface BulletinTermLike {
  id: number;
}

export interface BulletinStudentLike {
  id: number;
  schoolId?: number | null;
  classId: number;
  firstName?: string;
  lastName?: string;
}

export interface BulletinEvaluationLike {
  id: number;
  classId: number;
  termId?: number | null;
  subject: string;
  title: string;
  coefficient: number;
  maxScore: number;
  countInBulletin?: boolean;
}

export interface BulletinGradeLike {
  id: number;
  evaluationId: number;
  studentId: number;
  score: string;
}

export interface BulletinEvaluationSnapshot {
  evaluationId: number;
  title: string;
  subject: string;
  coefficient: number;
  maxScore: number;
  rawScore: number | null;
  normalizedScore: number | null;
  weightedScore: number | null;
  countedInAverage: boolean;
  excludedReason?: 'excluded-from-bulletin' | 'missing-grade' | 'invalid-score' | 'invalid-max-score';
}

export interface BulletinTermAverageResult {
  termId: number;
  studentId: number;
  selectedEvaluations: BulletinEvaluationLike[];
  snapshots: BulletinEvaluationSnapshot[];
  totalCoefficient: number;
  totalWeightedScore: number;
  average: number | null;
}

export interface BulletinAverageInput {
  term: BulletinTermLike;
  student: BulletinStudentLike;
  evaluations: BulletinEvaluationLike[];
  grades: BulletinGradeLike[];
}

export const selectBulletinEvaluationsForTerm = (termId: number, evaluations: BulletinEvaluationLike[]): BulletinEvaluationLike[] =>
  evaluations.filter((evaluation) => evaluation.termId === termId && evaluation.countInBulletin !== false);

const parseNumericScore = (score: string): number | null => {
  const normalized = String(score).trim().replace(',', '.');
  if (!normalized) return null;

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
};

const findLatestGradeForStudent = (evaluationId: number, studentId: number, grades: BulletinGradeLike[]): BulletinGradeLike | null => {
  for (let index = grades.length - 1; index >= 0; index -= 1) {
    const grade = grades[index];
    if (grade.evaluationId === evaluationId && grade.studentId === studentId) {
      return grade;
    }
  }

  return null;
};

const normalizeScore = (rawScore: number, maxScore: number): number | null => {
  if (!Number.isFinite(maxScore) || maxScore <= 0) {
    return null;
  }

  return (rawScore / maxScore) * 20;
};

const resolveCoefficient = (evaluation: BulletinEvaluationLike): number => {
  const coefficient = Number(evaluation.coefficient ?? 1);
  return Number.isFinite(coefficient) && coefficient > 0 ? coefficient : 0;
};

export const calculateStudentTermAverage = ({ term, student, evaluations, grades }: BulletinAverageInput): BulletinTermAverageResult => {
  const selectedEvaluations = selectBulletinEvaluationsForTerm(term.id, evaluations).filter(
    (evaluation) => evaluation.classId === student.classId,
  );

  const snapshots: BulletinEvaluationSnapshot[] = [];
  let totalWeightedScore = 0;
  let totalCoefficient = 0;

  for (const evaluation of selectedEvaluations) {
    const coefficient = resolveCoefficient(evaluation);
    const latestGrade = findLatestGradeForStudent(evaluation.id, student.id, grades);

    if (!latestGrade) {
      snapshots.push({
        evaluationId: evaluation.id,
        title: evaluation.title,
        subject: evaluation.subject,
        coefficient,
        maxScore: evaluation.maxScore,
        rawScore: null,
        normalizedScore: null,
        weightedScore: null,
        countedInAverage: false,
        excludedReason: 'missing-grade',
      });
      continue;
    }

    const rawScore = parseNumericScore(latestGrade.score);
    if (rawScore == null) {
      snapshots.push({
        evaluationId: evaluation.id,
        title: evaluation.title,
        subject: evaluation.subject,
        coefficient,
        maxScore: evaluation.maxScore,
        rawScore: null,
        normalizedScore: null,
        weightedScore: null,
        countedInAverage: false,
        excludedReason: 'invalid-score',
      });
      continue;
    }

    const normalizedScore = normalizeScore(rawScore, evaluation.maxScore);
    if (normalizedScore == null || coefficient <= 0) {
      snapshots.push({
        evaluationId: evaluation.id,
        title: evaluation.title,
        subject: evaluation.subject,
        coefficient,
        maxScore: evaluation.maxScore,
        rawScore,
        normalizedScore,
        weightedScore: null,
        countedInAverage: false,
        excludedReason: coefficient <= 0 ? 'invalid-score' : 'invalid-max-score',
      });
      continue;
    }

    const weightedScore = normalizedScore * coefficient;
    totalCoefficient += coefficient;
    totalWeightedScore += weightedScore;

    snapshots.push({
      evaluationId: evaluation.id,
      title: evaluation.title,
      subject: evaluation.subject,
      coefficient,
      maxScore: evaluation.maxScore,
      rawScore,
      normalizedScore,
      weightedScore,
      countedInAverage: true,
    });
  }

  const average = totalCoefficient > 0 ? totalWeightedScore / totalCoefficient : null;

  return {
    termId: term.id,
    studentId: student.id,
    selectedEvaluations,
    snapshots,
    totalCoefficient,
    totalWeightedScore,
    average,
  };
};
