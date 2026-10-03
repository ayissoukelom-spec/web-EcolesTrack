import { describe, expect, it } from 'vitest';
import { validateParentImportRow } from './parentImportValidation';

describe('parentImportValidation', () => {
  const validRow = {
    name: 'Marie Parent',
    email: 'marie@example.com',
    phonePrefix: '+228',
    phone: '90000000',
    schoolId: '1',
    studentId: '12',
    parentType: 'mere',
  };

  const parentWithoutStudent = { ...validRow, studentId: '' };

  it('accepts a complete parent row', () => {
    expect(validateParentImportRow(validRow, { requireSchoolId: true }).errors).toEqual([]);
  });

  it('reports missing required non-email fields', () => {
    const result = validateParentImportRow({}, { requireSchoolId: true });
    expect(result.errors).toEqual(expect.arrayContaining([
      'name est obligatoire',
      'phone est obligatoire',
      'schoolId est obligatoire',
      'parentType doit être pere, mere ou tuteur',
    ]));
  });

  it('rejects invalid email and phone formats', () => {
    const result = validateParentImportRow({ ...validRow, email: 'bad', phone: '123' }, { requireSchoolId: true });
    expect(result.errors).toEqual(expect.arrayContaining([
      'email doit être valide',
      'phone doit correspondre à un numéro togolais valide au format +228XXXXXXXX',
    ]));
  });

  it('accepts a parent with a valid phone and no email', () => {
    const result = validateParentImportRow({ ...validRow, email: '' }, { requireSchoolId: true });
    expect(result.errors).toEqual([]);
    expect(result.normalized.email).toBe('');
    expect(result.normalized.phone).toBe('+22890000000');
  });

  it('accepts optional address and legacy student reference columns', () => {
    const result = validateParentImportRow({ ...validRow, address: '', studentId: '', studentIds: '12' }, { requireSchoolId: true });
    expect(result.errors).toEqual([]);
  });

  it('accepts a complete parent without any student reference', () => {
    expect(validateParentImportRow(parentWithoutStudent, { requireSchoolId: true }).errors).toEqual([]);
  });

  it('uses the form default phone prefix and derives gender for a mother', () => {
    const result = validateParentImportRow({ ...parentWithoutStudent, phonePrefix: '', gender: '' }, { requireSchoolId: true });
    expect(result.errors).toEqual([]);
    expect(result.normalized.phonePrefix).toBe('+228');
    expect(result.normalized.gender).toBe('F');
  });

  it('accepts an empty optional address without a student reference', () => {
    expect(validateParentImportRow({ ...parentWithoutStudent, address: '' }, { requireSchoolId: true }).errors).toEqual([]);
  });

  it('rejects an invalid studentId only when it is provided', () => {
    const result = validateParentImportRow({ ...parentWithoutStudent, studentId: 'invalid' }, { requireSchoolId: true });
    expect(result.errors).toContain('studentId doit être numérique');
  });

  it('accepts multiple complete parent rows independently', () => {
    const rows = [parentWithoutStudent, { ...parentWithoutStudent, name: 'Paul Parent', email: 'paul@example.com', parentType: 'pere' }];
    expect(rows.map((row) => validateParentImportRow(row, { requireSchoolId: true }).errors)).toEqual([[], []]);
  });

  it('requires gender for a tutor', () => {
    const result = validateParentImportRow({ ...validRow, parentType: 'tuteur', gender: '' }, { requireSchoolId: true });
    expect(result.errors).toContain('gender est obligatoire pour un tuteur et doit être M ou F');
  });

  it.each([
    ['22890121212', '+228'],
    ['228 90121212', '+228'],
    ['0022890121212', '+228'],
    ['00228 90121212', '+228'],
    ['+22890121212', '+228'],
    ['+228 90121212', '+228'],
    ['90121212', '228'],
    ['90121212', '+228'],
  ])('canonicalizes phone %s with prefix %s without adding a second country code', (phone, phonePrefix) => {
    const result = validateParentImportRow({
      ...validRow,
      phone,
      phonePrefix,
    }, { requireSchoolId: true });

    expect(result.errors).toEqual([]);
    expect(result.normalized.phone).toBe('+22890121212');
    expect(result.normalized.phone).not.toBe('+22822890121212');
  });

  it('rejects phone prefixes and complete phone numbers outside the Togo country code', () => {
    const wrongPrefix = validateParentImportRow({ ...validRow, phonePrefix: '+229' }, { requireSchoolId: true });
    const wrongNumber = validateParentImportRow({ ...validRow, phone: '+229 90121212' }, { requireSchoolId: true });

    expect(wrongPrefix.errors).toContain('phone doit correspondre à un numéro togolais valide au format +228XXXXXXXX');
    expect(wrongNumber.errors).toContain('phone doit correspondre à un numéro togolais valide au format +228XXXXXXXX');
  });
});
