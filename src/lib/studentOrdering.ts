import { Student } from '../types';

export function sortStudentsAlphabetically(students: Student[]): Student[] {
  return students.slice().sort((left, right) => {
    const lastNameComparison = String(left.lastName ?? '').trim().localeCompare(
      String(right.lastName ?? '').trim(),
      'fr',
      { sensitivity: 'base' },
    );
    if (lastNameComparison !== 0) return lastNameComparison;

    const firstNameComparison = String(left.firstName ?? '').trim().localeCompare(
      String(right.firstName ?? '').trim(),
      'fr',
      { sensitivity: 'base' },
    );
    if (firstNameComparison !== 0) return firstNameComparison;

    return Number(left.id) - Number(right.id);
  });
}