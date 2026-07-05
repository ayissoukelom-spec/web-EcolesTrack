export function getStudentImportHeaders() {
  return ['firstName', 'lastName', 'birthDate', 'schoolId', 'classId', 'parentId', 'parentName', 'parentEmail', 'parentPhone', 'academicYearId', 'teacherId', 'schoolAdminId', 'gender'];
}

export function normalizeStudentGender(gender: unknown) {
  const trimmed = typeof gender === 'string' ? gender.trim() : '';
  return trimmed ? trimmed : null;
}
