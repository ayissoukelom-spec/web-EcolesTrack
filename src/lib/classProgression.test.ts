import { describe, expect, it } from 'vitest';
import { normalizeClassProgressionCode } from './classProgression';

describe('class progression codes', () => {
  it('keeps the stream in a stable normalized code', () => {
    expect(normalizeClassProgressionCode('2nde CD')).toBe('2NDE-CD');
    expect(normalizeClassProgressionCode('1ère D')).toBe('1ERE-D');
    expect(normalizeClassProgressionCode(' Terminale D ')).toBe('TERMINALE-D');
  });

  it('does not depend on annual class ids', () => {
    expect(normalizeClassProgressionCode('2nde CD')).toBe(normalizeClassProgressionCode('2nde CD'));
  });
});
