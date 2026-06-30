export interface EvaluationAccessContext {
  role: string | null;
  schoolId: number | null;
  userId: number | null;
}

export function normalizeOptionalNumber(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === 'number') {
    return Number.isFinite(value) && value > 0 ? value : null;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }
  return null;
}

export function resolveEvaluationAccessContext(actor: { role?: string | null; schoolId?: unknown; id?: unknown } | null | undefined): EvaluationAccessContext {
  const normalizedRole = typeof actor?.role === 'string' && actor.role.trim() ? actor.role.trim() : null;
  const normalizedSchoolId = normalizeOptionalNumber(actor?.schoolId);
  const normalizedUserId = normalizeOptionalNumber(actor?.id);

  return {
    role: normalizedRole,
    schoolId: normalizedSchoolId,
    userId: normalizedUserId,
  };
}
