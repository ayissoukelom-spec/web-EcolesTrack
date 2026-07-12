import { describe, expect, it } from 'vitest';
import { getEmailUniquenessScope, normalizeEmail } from './emailUniqueness';

describe('email uniqueness scope', () => {
  it('returns the expected uniqueness scope by role', () => {
    expect(getEmailUniquenessScope('super_admin', 2)).toEqual({ mode: 'global' });
    expect(getEmailUniquenessScope('teacher', 7)).toEqual({ mode: 'per-school', schoolId: 7 });
    expect(getEmailUniquenessScope('parent', null)).toEqual({ mode: 'per-school', schoolId: null });
  });

  it('normalizes emails before comparison', () => {
    expect(normalizeEmail('  USER@Example.COM  ')).toBe('user@example.com');
  });
});
