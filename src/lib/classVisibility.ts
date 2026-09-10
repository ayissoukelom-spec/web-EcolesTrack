import type { Class } from '../types.ts';

export function isClassVisibleToSchool(klass: Class, schoolId?: number | null): boolean {
  if (schoolId == null) return false;
  if (klass.schoolId === schoolId) return true;
  return klass.schoolId == null && klass.status === 'approved';
}

export function getClassGroupsVisibleToSchool(classGroups: any[], classes: Class[], schoolId?: number | null) {
  const availableClassNames = new Set(
    classes
      .filter((klass) => isClassVisibleToSchool(klass, schoolId))
      .map((klass) => klass.name.trim().toLocaleLowerCase())
  );

  return classGroups.filter((group) =>
    Array.isArray(group.classNames) &&
    group.classNames.some((className: unknown) => {
      const normalizedName = String(className || '').trim().toLocaleLowerCase();
      return normalizedName !== '' && availableClassNames.has(normalizedName);
    })
  );
}

export default isClassVisibleToSchool;
