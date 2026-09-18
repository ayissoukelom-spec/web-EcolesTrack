import { describe, it, expect } from 'vitest';
import { hasSchoolTermDateOverlap, findConflictingSchoolTerm } from '../server.ts';

describe('School terms uniqueness and overlap validation', () => {
  it('allows two different periods in the same academic year and cycle when the dates are different', () => {
    const existing = [{
      id: 1,
      academicYearId: 10,
      schoolId: 1,
      cycleId: 2,
      startDate: '2025-09-01',
      endDate: '2025-12-31',
    }];

    const candidate = {
      academicYearId: 10,
      schoolId: 1,
      cycleId: 2,
      startDate: '2026-01-01',
      endDate: '2026-06-30',
    };

    expect(findConflictingSchoolTerm(existing, candidate)).toBeNull();
    expect(hasSchoolTermDateOverlap('2025-09-01', '2025-12-31', '2026-01-01', '2026-06-30')).toBe(false);
  });

  it('rejects overlapping periods for the same school, year and cycle', () => {
    const existing = [{
      id: 1,
      academicYearId: 10,
      schoolId: 1,
      cycleId: 2,
      startDate: '2025-09-01',
      endDate: '2025-12-31',
    }];

    const candidate = {
      academicYearId: 10,
      schoolId: 1,
      cycleId: 2,
      startDate: '2025-11-15',
      endDate: '2026-02-15',
    };

    expect(hasSchoolTermDateOverlap('2025-09-01', '2025-12-31', '2025-11-15', '2026-02-15')).toBe(true);
    expect(findConflictingSchoolTerm(existing, candidate)).toMatchObject({ id: 1 });
  });
});
