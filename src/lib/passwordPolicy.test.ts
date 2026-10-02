import { describe, expect, it } from 'vitest';
import { getNewPasswordPolicyError } from './passwordPolicy';

describe('new password policy', () => {
  it.each(['Abcd1234', 'Ecole2026', 'Abcd123!', 'A1234567'])(
    'accepts %s',
    (password) => expect(getNewPasswordPolicyError(password)).toBeNull(),
  );

  it.each([
    ['abcdef12', 'Le nouveau mot de passe doit contenir au moins une lettre majuscule.'],
    ['Abcdefgh', 'Le nouveau mot de passe doit contenir au moins un chiffre.'],
    ['Ab123', 'Le nouveau mot de passe doit contenir au moins 8 caractères.'],
    ['12345678', 'Le nouveau mot de passe doit contenir au moins une lettre majuscule.'],
    ['abcdefgh', 'Le nouveau mot de passe doit contenir au moins une lettre majuscule et au moins un chiffre.'],
    ['123456', 'Le nouveau mot de passe ne peut pas être le mot de passe temporaire.'],
    ['abc', 'Le nouveau mot de passe doit contenir au moins 8 caractères, au moins une lettre majuscule et au moins un chiffre.'],
  ])('reports every missing rule for %s', (password, expected) => {
    expect(getNewPasswordPolicyError(password)).toBe(expected);
  });
});