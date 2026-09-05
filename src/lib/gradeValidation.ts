export interface GradeValidationResult {
  isValid: boolean;
  error?: string;
}

export interface EvaluationScoreRow {
  evaluationId: number;
  score: string | number | null | undefined;
  maxScore: number | null | undefined;
  countInBulletin?: boolean;
}

export interface EvaluationScoreBounds {
  minimum: number | null;
  maximum: number | null;
}

const parseNumericScore = (score: string | number | null | undefined): number | null => {
  if (score == null) return null;
  const parsed = Number(String(score).trim().replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
};

export const calculateEvaluationScoreBounds = (rows: EvaluationScoreRow[]): Map<number, EvaluationScoreBounds> => {
  const bounds = new Map<number, EvaluationScoreBounds>();

  for (const row of rows) {
    if (row.countInBulletin === false) continue;
    const score = parseNumericScore(row.score);
    const maxScore = Number(row.maxScore);
    if (score == null || !Number.isFinite(maxScore) || maxScore <= 0) continue;

    const normalizedScore = (score / maxScore) * 20;
    const current = bounds.get(row.evaluationId) ?? { minimum: null, maximum: null };
    current.minimum = current.minimum == null ? normalizedScore : Math.min(current.minimum, normalizedScore);
    current.maximum = current.maximum == null ? normalizedScore : Math.max(current.maximum, normalizedScore);
    bounds.set(row.evaluationId, current);
  }

  return bounds;
};

export function validateGradeScore(score: string | number | null | undefined, maxScore?: number | null): GradeValidationResult {
  if (score === null || score === undefined || String(score).trim() === '') {
    return { isValid: false, error: 'La note est requise' };
  }

  const raw = String(score).trim();
  const parsed = typeof score === 'number' ? score : Number(raw);

  if (!Number.isFinite(parsed)) {
    return { isValid: false, error: 'La note doit être un nombre valide' };
  }

  if (parsed < 0) {
    return { isValid: false, error: 'La note ne peut pas être négative' };
  }

  if (maxScore != null && maxScore !== undefined && parsed > maxScore) {
    return { isValid: false, error: `La note ne peut pas dépasser ${maxScore}` };
  }

  return { isValid: true };
}
