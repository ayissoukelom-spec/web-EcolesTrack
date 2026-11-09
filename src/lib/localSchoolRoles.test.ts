import { describe, expect, it } from 'vitest';
import { canGrantUserFunction, isLocalSchoolRole, LOCAL_SCHOOL_ROLES } from './localSchoolRoles';

describe('isLocalSchoolRole', () => {
  it.each(LOCAL_SCHOOL_ROLES)('accepts the canonical role %s', (role) => {
    expect(isLocalSchoolRole(role)).toBe(true);
  });

  describe('canGrantUserFunction', () => {
    const schoolAdmin = {
      actorId: 1,
      actorRole: 'school_admin',
      actorSchoolId: 10,
      targetUserId: 2,
      targetSchoolId: 10,
    };

    it.each(['parent', 'teacher', 'surveillant'])(
      'allows a school administrator to grant %s in their own school',
      (role) => {
        expect(canGrantUserFunction({ ...schoolAdmin, role })).toBe(true);
      },
    );

    it('rejects school-administrator self-grants, cross-school grants, and super-admin grants', () => {
      expect(canGrantUserFunction({ ...schoolAdmin, targetUserId: 1, role: 'teacher' })).toBe(false);
      expect(canGrantUserFunction({ ...schoolAdmin, targetSchoolId: 11, role: 'parent' })).toBe(false);
      expect(canGrantUserFunction({ ...schoolAdmin, role: 'super_admin', targetSchoolId: null })).toBe(false);
      expect(canGrantUserFunction({ ...schoolAdmin, role: 'school_admin' })).toBe(false);
    });

    it('allows a super administrator to grant local functions and the distinct global function', () => {
      const superAdmin = { ...schoolAdmin, actorRole: 'super_admin', actorSchoolId: null };
      for (const role of LOCAL_SCHOOL_ROLES) {
        expect(canGrantUserFunction({ ...superAdmin, role })).toBe(true);
      }
      expect(canGrantUserFunction({ ...superAdmin, role: 'super_admin', targetSchoolId: null })).toBe(true);
    });

    it('rejects global grants with a school and non-administrator actors', () => {
      expect(canGrantUserFunction({ ...schoolAdmin, actorRole: 'teacher', role: 'parent' })).toBe(false);
      expect(canGrantUserFunction({ ...schoolAdmin, actorRole: 'super_admin', role: 'super_admin', targetSchoolId: 10 })).toBe(false);
    });
  });

  it.each([
    'student',
    'admin',
    'super_admin',
    '',
    '   ',
    'Parent',
    'TEACHER',
    'School_Admin',
    'surveillant ',
    ' parent',
    'unknown',
  ])('rejects the non-canonical value %j', (value) => {
    expect(isLocalSchoolRole(value)).toBe(false);
  });

  it.each([null, undefined, 0, false, {}, [], ['parent']])(
    'rejects the non-text value %j',
    (value) => {
      expect(isLocalSchoolRole(value)).toBe(false);
    },
  );
});
