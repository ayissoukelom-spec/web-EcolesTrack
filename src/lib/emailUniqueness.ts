export type EmailUniquenessScope = { mode: 'global' } | { mode: 'per-school'; schoolId: number | null };

export function normalizeEmail(email: string | null | undefined): string | null {
  if (typeof email !== 'string') return null;
  const trimmed = email.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : null;
}

export function getEmailUniquenessScope(role: string | null | undefined, schoolId: number | null | undefined): EmailUniquenessScope {
  // super_admin emails remain globally unique (no duplicates across any school)
  // all other roles: uniqueness is per-school (same email allowed in different schools)
  if (role === 'super_admin') {
    return { mode: 'global' };
  }
  return { mode: 'per-school', schoolId: schoolId ?? null };
}
