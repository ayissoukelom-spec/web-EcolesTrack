import type { Class } from '../types.ts';

export function isClassVisibleToSchool(klass: Class, schoolId?: number | null): boolean {
  if (schoolId == null) return false;
  if (klass.schoolId === schoolId) return true;
  return klass.schoolId == null && klass.status === 'approved';
}

export default isClassVisibleToSchool;
