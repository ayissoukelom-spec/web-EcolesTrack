import { describe, expect, it } from 'vitest';
import { canonicalizeStudentParentPhone, getStudentImportHeaders, isValidStudentGender, normalizeFirstName, normalizeStudentGender } from './studentImport.ts';

describe('student import parent phone', () => {
  it.each([
    ['22890121212', undefined],
    ['228 90121212', undefined],
    ['0022890121212', undefined],
    ['00228 90121212', undefined],
    ['+22890121212', undefined],
    ['+228 90121212', undefined],
    ['90121212', '228'],
    ['90121212', '+228'],
    ['90121212', '00228'],
  ])('canonicalizes %s with prefix %s without duplicating the country code', (phone, prefix) => {
    expect(canonicalizeStudentParentPhone(phone, prefix)).toBe('+22890121212');
    expect(canonicalizeStudentParentPhone(phone, prefix)).not.toBe('+22822890121212');
  });

  it('keeps both legacy parent identifiers and the separated phone prefix columns', () => {
    expect(getStudentImportHeaders()).toContain('parentId');
    expect(getStudentImportHeaders()).toContain('parentEmail');
    expect(getStudentImportHeaders()).toContain('parentPhonePrefix');
    expect(getStudentImportHeaders()).toContain('parentPhone');
  });
});

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

describe('normalizeFirstName', () => {
  it('normalizes single and multi-part first names according to the business rule', () => {
    expect(normalizeFirstName('jean')).toBe('Jean');
    expect(normalizeFirstName('JEAN')).toBe('Jean');
    expect(normalizeFirstName('jEAN')).toBe('Jean');
    expect(normalizeFirstName('jean pierre')).toBe('Jean Pierre');
    expect(normalizeFirstName('JEAN PIERRE')).toBe('Jean Pierre');
    expect(normalizeFirstName('jean pierre paul')).toBe('Jean Pierre Paul');
    expect(normalizeFirstName('jean-pierre')).toBe('Jean-Pierre');
    expect(normalizeFirstName('JEAN-PIERRE')).toBe('Jean-Pierre');
  });

  it('trims spaces and normalizes hyphenated names without changing the surname field', () => {
    expect(normalizeFirstName('  jEaN   pIeRrE  ')).toBe('Jean Pierre');
    expect(normalizeFirstName('  jEaN-pIeRrE  ')).toBe('Jean-Pierre');
    expect(normalizeFirstName('')).toBe('');
  });
});
