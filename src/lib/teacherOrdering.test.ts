import { describe, expect, test } from 'vitest';
import { sortTeachersAlphabetically } from './teacherOrdering';

const teacher = (id: number, lastName?: string, firstNames?: string) => ({
  id,
  lastName,
  firstNames,
});

describe('sortTeachersAlphabetically', () => {
  test('sorts by family name, then first name', () => {
    const teachers = [
      teacher(1, 'Zoumana', 'Ali'),
      teacher(2, 'Aïcha', 'Koffi'),
      teacher(3, 'Bernard', 'Yao'),
    ];

    expect(sortTeachersAlphabetically(teachers).map((item) => `${item.lastName} ${item.firstNames}`)).toEqual([
      'Aïcha Koffi',
      'Bernard Yao',
      'Zoumana Ali',
    ]);
  });

  test('sorts equal family names by first name', () => {
    const teachers = [
      teacher(1, 'Amani', 'Zoé'),
      teacher(2, 'Amani', 'Aïcha'),
      teacher(3, 'Amani', 'Bernard'),
    ];

    expect(sortTeachersAlphabetically(teachers).map((item) => item.firstNames)).toEqual([
      'Aïcha',
      'Bernard',
      'Zoé',
    ]);
  });

  test('ignores case and handles missing names without mutating the source list', () => {
    const teachers = [
      teacher(1, 'éTOILE', 'Zoé'),
      teacher(2, 'etoile', 'aïcha'),
      teacher(3),
    ];

    const sorted = sortTeachersAlphabetically(teachers);

    expect(sorted.map((item) => item.id)).toEqual([3, 2, 1]);
    expect(teachers.map((item) => item.id)).toEqual([1, 2, 3]);
  });
});