import { describe, expect, it } from 'vitest';
import { normalizeClassNameForDisplay } from './classDisplay';

describe('normalizeClassNameForDisplay', () => {
  it.each([
    ['6EME', '6ème'],
    ['5EME', '5ème'],
    ['4EME', '4ème'],
    ['3EME', '3ème'],
    ['2NDE', '2nde'],
    ['2EME', '2ème'],
    ['1ERE', '1ère'],
    ['TERMINALE', 'Tle'],
    ['TLE', 'Tle'],
  ])('normalizes %s to %s', (input, expected) => {
    expect(normalizeClassNameForDisplay(input)).toBe(expected);
  });

  it.each([
    ['4eme a', '4ème a'],
    ['  3EmE   B  ', '3ème B'],
    [' 2nde  CD ', '2nde CD'],
    ['1ere D', '1ère D'],
    ['Tle A4', 'Tle A4'],
    ['tle d', 'Tle d'],
    ['4ème A', '4ème A'],
    ['Classe supérieure', 'Classe supérieure'],
  ])('displays class label %s as %s', (input, expected) => {
    expect(normalizeClassNameForDisplay(input)).toBe(expected);
  });

  it('does not mutate the original class name', () => {
    const className = ' 4EME ';
    normalizeClassNameForDisplay(className);
    expect(className).toBe(' 4EME ');
  });
});
