import { describe, expect, it } from 'vitest';
import { buildClassAgeStats } from './studentAgeStats';

describe('buildClassAgeStats', () => {
  it('uses completed ages, rounds the exact average, and returns the age distribution', () => {
    const stats = buildClassAgeStats([
      { classId: 5, className: '6ème A', schoolId: 10, birthDate: '2010-10-10' },
      { classId: 5, className: '6ème A', schoolId: 10, birthDate: '2010-10-12' },
    ], '2026-10-11');

    expect(stats).toEqual([{
      classId: 5,
      className: '6ème A',
      schoolId: 10,
      averageAge: 16,
      includedStudents: 2,
      distribution: [
        { age: 15, count: 1 },
        { age: 16, count: 1 },
      ],
    }]);
  });

  it('treats February 28 as the birthday for a February 29 birth in a non-leap year', () => {
    const stats = buildClassAgeStats([
      { classId: 5, className: '6ème A', schoolId: 10, birthDate: '2008-02-29' },
    ], '2025-02-28');

    expect(stats[0].averageAge).toBe(17);
    expect(stats[0].distribution).toEqual([{ age: 17, count: 1 }]);
  });

  it('excludes missing, malformed, impossible, and future birth dates from the count', () => {
    const stats = buildClassAgeStats([
      { classId: 5, className: '6ème A', schoolId: 10, birthDate: null },
      { classId: 5, className: '6ème A', schoolId: 10, birthDate: '2010/01/01' },
      { classId: 5, className: '6ème A', schoolId: 10, birthDate: '2010-02-31' },
      { classId: 5, className: '6ème A', schoolId: 10, birthDate: '2027-01-01' },
      { classId: 5, className: '6ème A', schoolId: 10, birthDate: '2012-04-01' },
    ], '2026-10-11');

    expect(stats[0]).toMatchObject({
      averageAge: 14,
      includedStudents: 1,
      distribution: [{ age: 14, count: 1 }],
    });
  });

  it('returns an explicit empty-age class state and keeps same class ids isolated by school', () => {
    const stats = buildClassAgeStats([
      { classId: 5, className: '6ème A', schoolId: 10, birthDate: '2010-02-31' },
      { classId: 5, className: '6ème A', schoolId: 20, birthDate: null },
    ], '2026-10-11');

    expect(stats).toEqual([
      {
        classId: 5,
        className: '6ème A',
        schoolId: 10,
        averageAge: null,
        includedStudents: 0,
        distribution: [],
      },
      {
        classId: 5,
        className: '6ème A',
        schoolId: 20,
        averageAge: null,
        includedStudents: 0,
        distribution: [],
      },
    ]);
  });

  it('rejects an invalid reference date', () => {
    expect(() => buildClassAgeStats([], '2026-02-31')).toThrow(RangeError);
  });
});
