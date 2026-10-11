import { pbkdf2Sync, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

const PBKDF2_ITERATIONS = 310000;
const PBKDF2_KEY_LENGTH = 64;
const PBKDF2_DIGEST = 'sha512';
const TEMPORARY_PASSWORD_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';

export function hashLocalPassword(password: string, salt: string): string {
  return pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, PBKDF2_KEY_LENGTH, PBKDF2_DIGEST).toString('hex');
}

export function verifyLocalPassword(password: string, salt: string, passwordHash: string): boolean {
  if (!/^[a-f0-9]{128}$/i.test(passwordHash)) return false;

  const expectedHash = Buffer.from(passwordHash, 'hex');
  const actualHash = Buffer.from(hashLocalPassword(password, salt), 'hex');
  return expectedHash.length === actualHash.length && timingSafeEqual(actualHash, expectedHash);
}

export function generateTemporaryLocalPassword() {
  const temporaryPassword = Array.from(
    { length: 8 },
    () => TEMPORARY_PASSWORD_ALPHABET[randomInt(TEMPORARY_PASSWORD_ALPHABET.length)],
  ).join('');
  const salt = randomBytes(16).toString('hex');

  return {
    temporaryPassword,
    salt,
    passwordHash: hashLocalPassword(temporaryPassword, salt),
  };
}
