export interface GradeValidationResult {
  isValid: boolean;
  error?: string;
}

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
