import { describe, expect, it } from 'vitest';
import { generateTemporaryLocalPassword, hashLocalPassword } from './localPassword.ts';

describe('generateTemporaryLocalPassword', () => {
  it('generates readable random credentials and stores only the derived hash and salt', () => {
    const first = generateTemporaryLocalPassword();
    const second = generateTemporaryLocalPassword();

    for (const { temporaryPassword, passwordHash } of [first, second]) {
      expect(temporaryPassword).toMatch(/^[A-Za-z0-9]{8}$/);
      expect(temporaryPassword).not.toMatch(/[O0Il]/);
      expect(temporaryPassword).not.toBe('123456');
      expect(passwordHash).not.toBe(temporaryPassword);
    }

    expect(second.temporaryPassword).not.toBe(first.temporaryPassword);
    expect(first.passwordHash).toBe(hashLocalPassword(first.temporaryPassword, first.salt));
  });
});
