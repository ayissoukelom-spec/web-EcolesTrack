import { describe, expect, test } from 'vitest';
import { getTeacherAvailableSubjects, normalizeSubjectName } from '../subjectMatching.ts';

describe('subjectMatching helpers', () => {
  test('normalizeSubjectName removes accents and punctuation', () => {
    expect(normalizeSubjectName('Mathématique')).toBe('mathematique');
    expect(normalizeSubjectName('Histoire et Géographie')).toBe('histoire et geographie');
    expect(normalizeSubjectName('  PHyLoSoPhie  ')).toBe('phylosophie');
    expect(normalizeSubjectName('Anglais')).toBe('anglais');
  });

  test('getTeacherAvailableSubjects returns matching approved subjects', () => {
    const approvedSubjects = [
      { id: 1, name: 'Mathématique' },
      { id: 2, name: 'Histoire et Géographie' },
      { id: 3, name: 'Phylosophie' },
      { id: 4, name: 'Anglais' },
    ];

    const available = getTeacherAvailableSubjects(approvedSubjects, [
      'mathématique',
      '  Histoire et Géographie ',
      'PHyLoSoPhie',
    ]);

    expect(available).toEqual([
      'Mathématique',
      'Histoire et Géographie',
      'Phylosophie',
    ]);
  });

  test('getTeacherAvailableSubjects returns no subjects when assigned subjects are not approved', () => {
    const approvedSubjects = [
      { id: 1, name: 'Mathématique' },
      { id: 2, name: 'Histoire et Géographie' },
    ];

    const available = getTeacherAvailableSubjects(approvedSubjects, ['Anglais']);

    expect(available).toEqual([]);
  });

  test('getTeacherAvailableSubjects returns only the approved intersection for one subject', () => {
    const approvedSubjects = [
      { id: 1, name: 'Mathématique' },
      { id: 2, name: 'Anglais' },
    ];

    expect(getTeacherAvailableSubjects(approvedSubjects, ['Anglais'])).toEqual(['Anglais']);
  });

  test('getTeacherAvailableSubjects handles multiple assigned subjects', () => {
    const approvedSubjects = [
      { id: 1, name: 'Anglais' },
    ];

    expect(getTeacherAvailableSubjects(approvedSubjects, ['Anglais', 'Education Physique et Sportive'])).toEqual(['Anglais']);
  });

  test('getTeacherAvailableSubjects returns no subjects for an empty assignment', () => {
    const approvedSubjects = [
      { id: 1, name: 'Mathématique' },
      { id: 2, name: 'Anglais' },
    ];

    expect(getTeacherAvailableSubjects(approvedSubjects, [])).toEqual([]);
  });
});
