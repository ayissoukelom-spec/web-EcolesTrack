import { describe, expect, it } from 'vitest';
import { resolveActiveSchoolSelection } from './activeSchool';

describe('active school selection', () => {
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
