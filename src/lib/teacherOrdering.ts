type TeacherSortable = {
  id?: number | null;
  lastName?: string | null;
  firstNames?: string | null;
  firstName?: string | null;
  name?: string | null;
};

export function sortTeachersAlphabetically<T extends TeacherSortable>(teachers: T[]): T[] {
  return teachers.slice().sort((left, right) => {
    const leftLastName = String(left.lastName ?? '').trim() || String(left.name ?? '').trim();
    const rightLastName = String(right.lastName ?? '').trim() || String(right.name ?? '').trim();
    const lastNameComparison = leftLastName.localeCompare(rightLastName, 'fr', { sensitivity: 'base' });
    if (lastNameComparison !== 0) return lastNameComparison;

    const leftFirstName = String(left.firstNames ?? left.firstName ?? '').trim();
    const rightFirstName = String(right.firstNames ?? right.firstName ?? '').trim();
    const firstNameComparison = leftFirstName.localeCompare(rightFirstName, 'fr', { sensitivity: 'base' });
    if (firstNameComparison !== 0) return firstNameComparison;

    return Number(left.id ?? 0) - Number(right.id ?? 0);
  });
}