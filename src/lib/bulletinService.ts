// Test-time stub for bulletin service to avoid loading heavy/optional runtime
// dependencies when running unit/E2E tests. This file is intentionally minimal
// and should not change application semantics in production.
export async function generateBulletinSnapshot(..._args: any[]) {
  return null;
}

export async function createBulletinPdf(..._args: any[]) {
  return null;
}
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

export type BulletinEvaluationType = 'interrogation' | 'devoir' | 'composition';

export interface BulletinEvaluationLike {
  id: number;
  classId: number;
  teacherId?: number | null;
  termId?: number | null;
  subject: string;
  title: string;
  type?: string | null;
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
  type?: BulletinEvaluationType | null;
  coefficient: number;
  maxScore: number;
  rawScore: number | null;
  normalizedScore: number | null;
  weightedScore: number | null;
  countedInAverage: boolean;
  excludedReason?: 'excluded-from-bulletin' | 'missing-grade' | 'invalid-score' | 'invalid-max-score';
}

export interface BulletinTypeAverageSummary {
  interrogation: number | null;
  devoir: number | null;
  composition: number | null;
}

export const normalizeEvaluationType = (value?: string | null): BulletinEvaluationType | null => {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (normalized === 'interrogation') return 'interrogation';
  if (normalized === 'devoir') return 'devoir';
  if (normalized === 'composition') return 'composition';
  return null;
};

export const calculateTypeWeightedAverage = (entries: Array<{ coefficient: number; normalizedScore: number | null }>): number | null => {
  let totalWeightedScore = 0;
  let totalCoefficient = 0;

  for (const entry of entries) {
    const coefficient = Number(entry.coefficient ?? 0);
    const normalizedScore = entry.normalizedScore;
    if (!Number.isFinite(coefficient) || coefficient <= 0 || normalizedScore == null) continue;
    totalWeightedScore += normalizedScore * coefficient;
    totalCoefficient += coefficient;
  }

  return totalCoefficient > 0 ? totalWeightedScore / totalCoefficient : null;
};

export const summarizeTypeAveragesBySubject = (subjectSnapshots: BulletinEvaluationSnapshot[]): BulletinTypeAverageSummary => {
  const grouped: Record<BulletinEvaluationType, Array<{ coefficient: number; normalizedScore: number | null }>> = {
    interrogation: [],
    devoir: [],
    composition: [],
  };

  for (const snapshot of subjectSnapshots) {
    const type = snapshot.type ?? normalizeEvaluationType((snapshot as any).evaluationType ?? null);
    if (!type) continue;
    grouped[type].push({
      coefficient: Number(snapshot.coefficient ?? 0),
      normalizedScore: snapshot.normalizedScore,
    });
  }

  return {
    interrogation: calculateTypeWeightedAverage(grouped.interrogation),
    devoir: calculateTypeWeightedAverage(grouped.devoir),
    composition: calculateTypeWeightedAverage(grouped.composition),
  };
};

export const calculateFinalSubjectAverage = (
  classAverage: number | null | undefined,
  composition: number | null | undefined,
): number | null => {
  if (classAverage != null && composition != null) return (classAverage + composition) / 2;
  return classAverage ?? composition ?? null;
};

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
  const selectedEvaluations = evaluations.filter((evaluation) => {
    if (evaluation.classId !== student.classId) return false;
    if (evaluation.countInBulletin === false) return false;
    // Term-less evaluations are allowed here because callers may pre-scope by term dates.
    return evaluation.termId === term.id || evaluation.termId == null;
  });

  const snapshots: BulletinEvaluationSnapshot[] = [];
  let totalWeightedScore = 0;
  let totalCoefficient = 0;

  for (const evaluation of selectedEvaluations) {
    const coefficient = resolveCoefficient(evaluation);
    const type = normalizeEvaluationType(evaluation.type);
    const latestGrade = findLatestGradeForStudent(evaluation.id, student.id, grades);

    if (!latestGrade) {
      snapshots.push({
        evaluationId: evaluation.id,
        title: evaluation.title,
        subject: evaluation.subject,
        type,
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
        type,
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
        type,
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
      type,
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
