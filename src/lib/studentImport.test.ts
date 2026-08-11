import { describe, expect, it } from 'vitest';
import { isValidStudentGender, normalizeStudentGender } from './studentImport.ts';

describe('student gender validation', () => {
  it('rejects missing or empty gender values', () => {
    expect(isValidStudentGender(null)).toBe(false);
    expect(isValidStudentGender(undefined)).toBe(false);
    expect(isValidStudentGender('')).toBe(false);
    expect(isValidStudentGender('   ')).toBe(false);
  });

  it('accepts the gender values already used by the app', () => {
    expect(isValidStudentGender('M')).toBe(true);
    expect(isValidStudentGender('F')).toBe(true);
    expect(isValidStudentGender('Masculin')).toBe(true);
    expect(isValidStudentGender('Féminin')).toBe(true);
    expect(isValidStudentGender('male')).toBe(true);
    expect(isValidStudentGender('female')).toBe(true);
  });

  it('keeps valid values but returns null for empty input', () => {
    expect(normalizeStudentGender('M')).toBe('M');
    expect(normalizeStudentGender('  Féminin  ')).toBe('Féminin');
    expect(normalizeStudentGender('')).toBeNull();
  });
});
