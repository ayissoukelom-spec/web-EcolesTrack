import { describe, expect, it } from 'vitest';
import { resolveActiveSchoolSelection, resolveLegacyMembershipSchool } from './activeSchool';

describe('active school selection', () => {
  it.each(['parent', 'teacher', 'school_admin', 'surveillant'])(
    'resolves a single legacy %s membership for true, false, and null selection flags',
    (role) => {
      for (const isActive of [true, false, null]) {
        expect(resolveLegacyMembershipSchool(
          [{ schoolId: 10, role, isActive }],
          role,
        )).toBe(10);
      }
    },
  );

  it('does not use a membership with another role as the account school', () => {
    expect(resolveLegacyMembershipSchool(
      [{ schoolId: 10, role: 'teacher', isActive: true }],
      'parent',
    )).toBeNull();
  });

  it.each(['parent', 'teacher', 'school_admin', 'surveillant'])(
    'matches only an exact canonical %s membership',
    (role) => {
      expect(resolveLegacyMembershipSchool(
        [{ schoolId: 10, role, isActive: true }],
        role,
      )).toBe(10);
    },
  );

  it.each([null, '', 'unknown', 'admin'])(
    'does not infer a role from a membership recorded as %s',
    (membershipRole) => {
      expect(resolveLegacyMembershipSchool(
        [{ schoolId: 10, role: membershipRole, isActive: true }],
        'school_admin',
      )).toBeNull();
    },
  );

  it('does not infer a function from the account role when membership role is missing', () => {
    expect(resolveLegacyMembershipSchool(
      [{ schoolId: 10, isActive: true }],
      'parent',
    )).toBeNull();
  });

  it('resolves the requested exact function among several functions in one school', () => {
    expect(resolveLegacyMembershipSchool(
      [
        { schoolId: 10, role: 'parent', isActive: true },
        { schoolId: 10, role: 'teacher', isActive: false },
        { schoolId: 10, role: 'surveillant', isActive: null },
      ],
      'teacher',
    )).toBe(10);
    expect(resolveLegacyMembershipSchool(
      [{ schoolId: 10, role: 'teacher', isActive: true }],
      'surveillant',
    )).toBeNull();
  });

  it('does not choose arbitrarily between multiple active schools for the exact role', () => {
    expect(resolveLegacyMembershipSchool(
      [
        { schoolId: 10, role: 'teacher', isActive: true },
        { schoolId: 20, role: 'teacher', isActive: true },
      ],
      'teacher',
    )).toBeNull();
  });

  it('uses the account school only when it has a matching legacy membership', () => {
    expect(resolveLegacyMembershipSchool(
      [
        { schoolId: 10, role: 'school_admin', isActive: false },
        { schoolId: 20, role: 'school_admin', isActive: null },
      ],
      'school_admin',
      20,
    )).toBe(20);
    expect(resolveLegacyMembershipSchool(
      [{ schoolId: 10, role: 'school_admin', isActive: false }],
      'school_admin',
      20,
    )).toBeNull();
  });

  it('prefers the requested school when it is accessible', () => {
    const result = resolveActiveSchoolSelection({
      userSchoolId: 2,
      memberships: [{ schoolId: 1, isActive: false }, { schoolId: 2, isActive: true }],
      requestedSchoolId: 2,
      isSuperAdmin: false,
    });

    expect(result).toBe(2);
  });

  it('falls back to the active membership when no request is provided', () => {
    const result = resolveActiveSchoolSelection({
      userSchoolId: 3,
      memberships: [{ schoolId: 1, isActive: false }, { schoolId: 3, isActive: true }],
      requestedSchoolId: null,
      isSuperAdmin: false,
    });

    expect(result).toBe(3);
  });

  it('does not treat multiple active schools as an arbitrary selection', () => {
    expect(resolveActiveSchoolSelection({
      memberships: [
        { schoolId: 1, role: 'parent', isActive: true },
        { schoolId: 2, role: 'teacher', isActive: true },
      ],
      requestedSchoolId: null,
    })).toBeNull();
  });

  it('uses the account school after an ambiguous active selection when it is a member school', () => {
    expect(resolveActiveSchoolSelection({
      userSchoolId: 2,
      memberships: [
        { schoolId: 1, role: 'parent', isActive: true },
        { schoolId: 2, role: 'teacher', isActive: true },
      ],
      requestedSchoolId: null,
    })).toBe(2);
  });

  it('counts multiple functions in one school as one automatic school choice', () => {
    expect(resolveActiveSchoolSelection({
      memberships: [
        { schoolId: 4, role: 'parent', isActive: false },
        { schoolId: 4, role: 'teacher', isActive: null },
      ],
      requestedSchoolId: null,
    })).toBe(4);
  });

  it('does not choose arbitrarily among multiple unselected legacy memberships', () => {
    expect(resolveActiveSchoolSelection({
      memberships: [
        { schoolId: 1, isActive: false },
        { schoolId: 2, isActive: null },
      ],
      requestedSchoolId: null,
    })).toBeNull();
  });

  it('uses the sole legacy membership even when its selection flag is false or null', () => {
    for (const isActive of [false, null]) {
      expect(resolveActiveSchoolSelection({
        memberships: [{ schoolId: 4, isActive }],
        requestedSchoolId: null,
      })).toBe(4);
    }
  });

  it('keeps super admins unrestricted', () => {
    const result = resolveActiveSchoolSelection({
      userSchoolId: 7,
      memberships: [{ schoolId: 1, isActive: false }],
      requestedSchoolId: 9,
      isSuperAdmin: true,
    });

    expect(result).toBe(9);
  });
});
