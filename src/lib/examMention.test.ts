import { describe, expect, it } from 'vitest';
import { EXAM_MENTIONS, isExamMention } from './examMention';

describe('exam mentions', () => {
  it('accepts exactly the supported exam mentions', () => {
    expect(EXAM_MENTIONS).toEqual(['Passable', 'Assez bien', 'Bien', 'Très bien', 'Excellent']);
    for (const mention of EXAM_MENTIONS) expect(isExamMention(mention)).toBe(true);
  });

  it.each([null, undefined, '', 'Admis', 'excellent', 'Très Bien', 1])('rejects unsupported mention %s', (value) => {
    expect(isExamMention(value)).toBe(false);
  });
});
