export function getStudentImportHeaders() {
  return ['firstName', 'lastName', 'birthDate', 'schoolId', 'classId', 'parentId', 'parentName', 'parentEmail', 'parentPhone', 'academicYearId', 'teacherId', 'schoolAdminId', 'gender'];
}

export function isValidStudentGender(gender: unknown): boolean {
  if (typeof gender !== 'string') return false;
  const trimmed = gender.trim();
  if (!trimmed) return false;

  const normalized = trimmed.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return ['m', 'male', 'masculin', 'homme', 'garcon', 'garcons', 'boy', 'boys', 'f', 'female', 'feminin', 'feminine', 'femme', 'fille', 'filles', 'girl', 'girls'].includes(normalized)
    || ['M', 'F', 'Masculin', 'Féminin', 'Feminin', 'Masculin', 'Feminin'].includes(trimmed);
}

export function normalizeStudentGender(gender: unknown) {
  if (typeof gender !== 'string') return null;
  const trimmed = gender.trim();
  if (!trimmed) return null;
  return trimmed;
}
