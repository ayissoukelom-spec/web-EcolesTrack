import { describe, expect, it } from 'vitest';
import { getEmailUniquenessScope, normalizeEmail } from './emailUniqueness';

describe('email uniqueness scope', () => {
  it('keeps all accounts globally scoped by email', () => {
    expect(getEmailUniquenessScope('super_admin', 2)).toEqual({ mode: 'global' });
    expect(getEmailUniquenessScope('teacher', 7)).toEqual({ mode: 'global' });
    expect(getEmailUniquenessScope('parent', null)).toEqual({ mode: 'global' });
  });

  it('normalizes emails before comparison', () => {
    expect(normalizeEmail('  USER@Example.COM  ')).toBe('user@example.com');
  });
});
