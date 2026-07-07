export type GradeBand = 'below' | 'average' | 'above' | 'unknown';

export const parseGradeValue = (score: string | number | null | undefined): number | null => {
  if (score == null) return null;
  const normalized = typeof score === 'number' ? score : Number(String(score).replace(',', '.'));
  return Number.isFinite(normalized) ? normalized : null;
};

export const getGradeBand = (
  score: string | number | null | undefined,
  maxScore: number | null | undefined,
): GradeBand => {
  const numericScore = parseGradeValue(score);
  const numericMax = maxScore == null ? 20 : Number(maxScore);

  if (numericScore == null || !Number.isFinite(numericMax) || numericMax <= 0) {
    return 'unknown';
  }

  const onTwenty = (numericScore / numericMax) * 20;
  if (onTwenty < 10) return 'below';
  if (onTwenty < 14) return 'average';
  return 'above';
};

export const getGradeBadgeClass = (band: GradeBand): string => {
  if (band === 'below') return 'bg-rose-50 text-rose-700 border border-rose-100/80';
  if (band === 'average') return 'bg-amber-50 text-amber-700 border border-amber-100/80';
  if (band === 'above') return 'bg-emerald-50 text-emerald-700 border border-emerald-100/80';
  return 'bg-slate-50 text-slate-700 border border-slate-100/80';
};
