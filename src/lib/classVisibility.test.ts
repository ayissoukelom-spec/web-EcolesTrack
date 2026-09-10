import { describe, expect, it } from 'vitest';
import { getClassGroupsVisibleToSchool } from './classVisibility';

const classGroups = [
  { id: 'ceg', name: 'CEG (6ème à 3ème)', classNames: ['6ème', '5ème', '4ème', '3ème'] },
  { id: 'lycee', name: 'Lycée (2nde à Tle)', classNames: ['2nde', '1ère', 'Tle'] },
];

const classRow = (id: number, name: string, schoolId: number | null, status?: string) => ({
  id,
  name,
  schoolId,
  academicYearId: 2,
  status,
});

describe('getClassGroupsVisibleToSchool', () => {
  it('hides all groups when the school has no available classes', () => {
    expect(getClassGroupsVisibleToSchool(classGroups, [], 50)).toEqual([]);
  });

  it('keeps only CEG when the school has 6ème and 5ème', () => {
    expect(getClassGroupsVisibleToSchool(classGroups, [
      classRow(1, '6ème', 50),
      classRow(2, '5ème', 50),
    ], 50).map((group) => group.id)).toEqual(['ceg']);
  });

  it('keeps only Lycée when the school has 2nde and Tle', () => {
    expect(getClassGroupsVisibleToSchool(classGroups, [
      classRow(1, '2nde', 50),
      classRow(2, 'Tle', 50),
    ], 50).map((group) => group.id)).toEqual(['lycee']);
  });

  it('keeps both groups when both cycles are available', () => {
    expect(getClassGroupsVisibleToSchool(classGroups, [
      classRow(1, '6ème', 50),
      classRow(2, '5ème', 50),
      classRow(3, '4ème', 50),
      classRow(4, '3ème', 50),
      classRow(5, '2nde', 50),
      classRow(6, '1ère', 50),
      classRow(7, 'Tle', 50),
    ], 50).map((group) => group.id)).toEqual(['ceg', 'lycee']);
  });

  it('does not expose an unapproved global class', () => {
    expect(getClassGroupsVisibleToSchool(classGroups, [
      classRow(1, '6ème', null, 'pending'),
    ], 50)).toEqual([]);
  });

  it('exposes an approved global class only to its school', () => {
    const classesForSchoolA = [classRow(1, '6ème', null, 'approved')];

    expect(getClassGroupsVisibleToSchool(classGroups, classesForSchoolA, 50).map((group) => group.id)).toEqual(['ceg']);
    expect(getClassGroupsVisibleToSchool(classGroups, [], 51)).toEqual([]);
  });
});