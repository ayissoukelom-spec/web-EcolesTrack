export const PARENT_IMPORT_HEADERS = [
  'name',
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

export function validateParentImportRow(
  row: Record<string, unknown>,
  options: ParentImportValidationOptions = {},
): ParentImportValidationResult {
  const normalized = Object.fromEntries(
    Object.entries(row).map(([key, value]) => [key, String(value ?? '').trim()]),
  );
  const errors: string[] = [];
  const email = normalized.email?.toLowerCase() || '';
  const phonePrefix = normalized.phonePrefix || '+228';
  const phone = (normalized.phone || '').replace(/\D/g, '');
  const parentType = (normalized.parentType || '').toLowerCase();
  const gender = (normalized.gender || '').toUpperCase();

  normalized.email = email;
  normalized.phonePrefix = phonePrefix;
  normalized.phone = phone;
  normalized.parentType = parentType;
  normalized.gender = parentType === 'pere' ? 'M' : parentType === 'mere' ? 'F' : gender;

  if (!normalized.name) errors.push('name est obligatoire');
  if (!email) errors.push('email est obligatoire');
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push('email doit être valide');
  if (!phone) errors.push('phone est obligatoire');
  else if (phonePrefix === '+228' && phone.length !== 8) errors.push('phone doit contenir 8 chiffres pour +228');
  else if (phonePrefix !== '+228' && (phone.length < 1 || phone.length > 20)) errors.push('phone doit contenir entre 1 et 20 chiffres');
  if (options.requireSchoolId && !normalized.schoolId) errors.push('schoolId est obligatoire');
  if (normalized.schoolId && !/^\d+$/.test(normalized.schoolId)) errors.push('schoolId doit être numérique');
  if (!['pere', 'mere', 'tuteur'].includes(parentType)) errors.push('parentType doit être pere, mere ou tuteur');
  if (parentType === 'tuteur' && !['M', 'F'].includes(gender)) errors.push('gender est obligatoire pour un tuteur et doit être M ou F');
  if (normalized.studentId && !/^\d+$/.test(normalized.studentId)) errors.push('studentId doit être numérique');

  return { normalized, errors };
}
