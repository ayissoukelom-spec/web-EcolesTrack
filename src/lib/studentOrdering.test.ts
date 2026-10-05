import { describe, expect, test } from 'vitest';
import { sortStudentsAlphabetically } from './studentOrdering';

const student = (id: number, lastName: string, firstName: string) => ({
  id,
  lastName,
  firstName,
  schoolId: 1,
  classId: 10,
});

describe('sortStudentsAlphabetically', () => {
  test('sorts by family name, then first name', () => {
    const students = [
      student(1, 'Zoumana', 'Koffi'),
      student(2, 'Bernard', 'Paul'),
      student(3, 'Aïcha', 'Traoré'),
    ];

    expect(sortStudentsAlphabetically(students).map((item) => item.lastName)).toEqual([
      'Aïcha',
      'Bernard',
      'Zoumana',
    ]);
  });

  test('sorts equal family names by first name', () => {
    const students = [
      student(1, 'Amani', 'Zoé'),
      student(2, 'Amani', 'Aïcha'),
      student(3, 'Amani', 'Bernard'),
    ];

    expect(sortStudentsAlphabetically(students).map((item) => item.firstName)).toEqual([
      'Aïcha',
      'Bernard',
      'Zoé',
    ]);
  });

  test('ignores case and accents without mutating the source list', () => {
    const students = [
      student(1, 'éTOILE', 'Zoé'),
      student(2, 'ETOILE', 'aïcha'),
      student(3, 'Bernard', 'Émile'),
    ];

    const sorted = sortStudentsAlphabetically(students);

    expect(sorted.map((item) => item.id)).toEqual([3, 2, 1]);
    expect(students.map((item) => item.id)).toEqual([1, 2, 3]);
  });

  test('orders tied names by id while preserving every student exactly once', () => {
    const students = [
      student(12, 'KOFFI', 'Jean'),
      student(8, 'Étoile', 'Aïcha'),
      student(3, 'Amega', 'David'),
      student(4, 'ETOILE', 'AICHA'),
      student(7, 'Étoile', 'Zoé'),
      student(2, 'Etoile', 'Zoé'),
    ];

    const sorted = sortStudentsAlphabetically(students);

    expect(sorted.map((item) => item.id)).toEqual([3, 4, 8, 2, 7, 12]);
    expect(sorted).toHaveLength(students.length);
    expect(new Set(sorted.map((item) => item.id)).size).toBe(students.length);
  });
});