import { describe, expect, it } from 'vitest';
import { matchesParentSearch } from './parentSearch';

const parent = {
  name: 'Awa Mensah',
  phone: '+228 90 12 34 56',
};

describe('matchesParentSearch', () => {
  it('matches a parent name', () => {
    expect(matchesParentSearch(parent, 'Awa')).toBe(true);
  });

  it('matches a first name', () => {
    expect(matchesParentSearch(parent, 'Mensah')).toBe(true);
  });

  it('matches the complete name', () => {
    expect(matchesParentSearch(parent, 'Awa Mensah')).toBe(true);
  });

  it('matches the complete phone number with its plus prefix', () => {
    expect(matchesParentSearch(parent, '+22890123456')).toBe(true);
  });

  it('matches a partial phone number', () => {
    expect(matchesParentSearch(parent, '901234')).toBe(true);
  });

  it('ignores spaces in a phone search', () => {
    expect(matchesParentSearch(parent, '90 12 34 56')).toBe(true);
  });

  it('matches a phone number searched with +228', () => {
    expect(matchesParentSearch(parent, '+228 90 12 34 56')).toBe(true);
  });

  it('matches a phone number searched with 228 but no plus sign', () => {
    expect(matchesParentSearch(parent, '22890123456')).toBe(true);
  });

  it('matches a phone number searched without its country prefix', () => {
    expect(matchesParentSearch(parent, '90123456')).toBe(true);
  });

  it('matches partial digits after stripping formatting punctuation', () => {
    expect(matchesParentSearch(parent, '90-12 (34)')).toBe(true);
  });

  it('does not match a name or phone number that is absent', () => {
    expect(matchesParentSearch(parent, 'introuvable')).toBe(false);
    expect(matchesParentSearch(parent, '77999999')).toBe(false);
  });

  it('matches first and last name fields when a combined name is not supplied', () => {
    expect(matchesParentSearch({ firstName: 'Awa', lastName: 'Mensah' }, 'Awa Mensah')).toBe(true);
  });
});
