import { and, eq, ne, sql, type SQL, type SQLWrapper } from 'drizzle-orm';

export const emailTrimCharactersSql = sql`chr(9) || chr(10) || chr(11) || chr(12) || chr(13) || chr(32) || chr(160) || chr(5760) || chr(8192) || chr(8193) || chr(8194) || chr(8195) || chr(8196) || chr(8197) || chr(8198) || chr(8199) || chr(8200) || chr(8201) || chr(8202) || chr(8232) || chr(8233) || chr(8239) || chr(8287) || chr(12288) || chr(65279)`;

export function normalizeEmail(email: string | null | undefined): string | null {
  if (typeof email !== 'string') return null;
  const trimmed = email.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : null;
}

export function normalizedEmailSql(emailColumn: SQLWrapper): SQL {
  return sql`LOWER(BTRIM(${emailColumn}, ${emailTrimCharactersSql}))`;
}

export function isEmailRequiredForRole(role: string | null | undefined): boolean {
  return role !== 'parent';
}

export function isUsersEmailUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const pgError = error as { code?: unknown; constraint?: unknown; cause?: { code?: unknown; constraint?: unknown } };
  if (pgError.code !== '23505' && pgError.cause?.code !== '23505') return false;

  return [pgError.constraint, pgError.cause?.constraint].some((constraint) =>
    constraint === 'users_email_normalized_unique_idx' || constraint === 'users_email_unique');
}

export function normalizedEmailConflictCondition(
  emailColumn: SQLWrapper,
  email: string | null | undefined,
  idColumn?: SQLWrapper,
  excludedUserId?: number,
): SQL | undefined {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) return undefined;

  const conditions = [eq(normalizedEmailSql(emailColumn), normalizedEmail)];
  if (idColumn && excludedUserId != null) conditions.push(ne(idColumn, excludedUserId));
  return and(...conditions);
}
