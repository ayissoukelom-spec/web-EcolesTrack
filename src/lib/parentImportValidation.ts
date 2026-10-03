import { canonicalizeUserPhone } from './phoneCanonicalization';

export const PARENT_IMPORT_HEADERS = [
  'Nom',
  'Prénoms',
  'email',
  'phonePrefix',
  'phone',
  'address',
  'schoolId',
  'studentId',
  'parentType',
  'gender',
  'studentIds',
  'studentNames',
] as const;

export type ParentImportValidationOptions = {
  requireSchoolId?: boolean;
};

export type ParentImportValidationResult = {
  normalized: Record<string, string>;
  errors: string[];
};

export function canonicalizeParentImportPhone(phone: unknown, phonePrefix?: unknown): string | null {
  if (typeof phone !== 'string') return null;
  const rawPhone = phone.trim();
  if (!rawPhone || !/^(?:\+|00)?[\d\s()./-]+$/.test(rawPhone)) return null;

  const rawPrefix = String(phonePrefix ?? '').trim() || '+228';
  if (!/^(?:\+|00)?[\d\s()./-]+$/.test(rawPrefix)) return null;
  let prefixDigits = rawPrefix.replace(/\D/g, '');
  if (prefixDigits.startsWith('00')) prefixDigits = prefixDigits.slice(2);
  if (prefixDigits !== '228') return null;

  const phoneDigits = rawPhone.replace(/\D/g, '');
  const hasExplicitInternationalPrefix = rawPhone.startsWith('+') || rawPhone.startsWith('00');
  if (hasExplicitInternationalPrefix || /^228\d{8}$/.test(phoneDigits)) {
    const canonicalPhone = canonicalizeUserPhone(rawPhone);
    return canonicalPhone?.startsWith('+228') && canonicalPhone.length === 12
      ? canonicalPhone
      : null;
  }

  if (/^\d{8}$/.test(phoneDigits)) {
    return canonicalizeUserPhone(phoneDigits, '228');
  }
  return null;
}

export function validateParentImportRow(
  row: Record<string, unknown>,
  options: ParentImportValidationOptions = {},
): ParentImportValidationResult {
  const source = { ...row };
  if (source.Nom !== undefined && source.lastName === undefined) source.lastName = source.Nom;
  if (source['Prénoms'] !== undefined && source.firstName === undefined) source.firstName = source['Prénoms'];

  const normalized = Object.fromEntries(
    Object.entries(source).map(([key, value]) => [key, String(value ?? '').trim()]),
  );
  const errors: string[] = [];
  const email = normalized.email?.toLowerCase() || '';
  const phonePrefix = normalized.phonePrefix || '+228';
  const rawPhone = normalized.phone || '';
  const canonicalPhone = canonicalizeParentImportPhone(rawPhone, phonePrefix);
  const parentType = (normalized.parentType || '').toLowerCase();
  const gender = (normalized.gender || '').toUpperCase();

  normalized.email = email;
  normalized.phonePrefix = '+228';
  normalized.phone = canonicalPhone || rawPhone;
  normalized.parentType = parentType;
  normalized.gender = parentType === 'pere' ? 'M' : parentType === 'mere' ? 'F' : gender;

  if (normalized.lastName && normalized.firstName) {
    normalized.name = `${normalized.lastName} ${normalized.firstName}`.trim();
  } else if (!normalized.name) {
    errors.push('name est obligatoire');
    errors.push('Nom et Prénoms sont obligatoires');
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push('email doit être valide');
  if (!rawPhone) errors.push('phone est obligatoire');
  else if (!canonicalPhone) errors.push('phone doit correspondre à un numéro togolais valide au format +228XXXXXXXX');
  if (options.requireSchoolId && !normalized.schoolId) errors.push('schoolId est obligatoire');
  if (normalized.schoolId && !/^\d+$/.test(normalized.schoolId)) errors.push('schoolId doit être numérique');
  if (!['pere', 'mere', 'tuteur'].includes(parentType)) errors.push('parentType doit être pere, mere ou tuteur');
  if (parentType === 'tuteur' && !['M', 'F'].includes(gender)) errors.push('gender est obligatoire pour un tuteur et doit être M ou F');
  if (normalized.studentId && !/^\d+$/.test(normalized.studentId)) errors.push('studentId doit être numérique');

  return { normalized, errors };
}
