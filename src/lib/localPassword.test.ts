import { describe, expect, it } from 'vitest';
import { generateTemporaryLocalPassword, hashLocalPassword, verifyLocalPassword } from './localPassword.ts';

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

describe('verifyLocalPassword', () => {
  it('verifies a derived password hash without accepting malformed hashes', () => {
    const salt = 'test-salt';
    const passwordHash = hashLocalPassword('test-password', salt);

    expect(verifyLocalPassword('test-password', salt, passwordHash)).toBe(true);
    expect(verifyLocalPassword('wrong-password', salt, passwordHash)).toBe(false);
    expect(verifyLocalPassword('test-password', salt, 'not-a-hash')).toBe(false);
  });
});
