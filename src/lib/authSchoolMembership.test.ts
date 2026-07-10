import { describe, it, expect } from 'vitest';
import { getFallbackSchoolIdsForActor } from './authSchoolMembership';

describe('getFallbackSchoolIdsForActor', () => {
  it('returns the teacher school id when a teacher profile is linked to a school', () => {
    const ids = getFallbackSchoolIdsForActor(
      { role: 'teacher', id: 7, schoolId: null },
      { teacherSchoolId: 3 }
    );

    expect(ids).toEqual([3]);
  });

  it('returns the school ids inherited from the parent profile', () => {
    const ids = getFallbackSchoolIdsForActor(
      { role: 'parent', id: 12, schoolId: null },
      { parentSchoolIds: [4, 5] }
    );

    expect(ids).toEqual([4, 5]);
  });

  it('uses the actor schoolId when a school admin already has one', () => {
    const ids = getFallbackSchoolIdsForActor(
      { role: 'school_admin', id: 8, schoolId: 2 },
      {}
    );

    expect(ids).toEqual([2]);
  });
});
