import { describe, expect, it } from 'vitest';
import { resolveExamPromotionDecision } from './examDecision';

describe('résolution des décisions d examen', () => {
  it.each([
    ['CEPD', 'ADMITTED', 'Admis au CEPD'],
    ['CEPD', 'NOT_ADMITTED', 'Non admis au CEPD'],
    ['BEPC', 'ADMITTED', 'Admis au BEPC'],
    ['BEPC', 'NOT_ADMITTED', 'Non admis au BEPC'],
    ['BAC_I', 'ADMITTED', 'Admis au BAC I'],
    ['BAC_I', 'NOT_ADMITTED', 'Non admis au BAC I'],
    ['BAC_II', 'ADMITTED', 'Admis au BAC II'],
    ['BAC_II', 'NOT_ADMITTED', 'Non admis au BAC II'],
  ] as const)('résout %s + %s', (examType, resultStatus, expected) => {
    expect(resolveExamPromotionDecision({ examType, resultStatus })).toBe(expected);
  });

  it.each(['CEPD', 'BEPC', 'BAC_I', 'BAC_II'] as const)('ne produit aucune décision sans résultat pour %s', (examType) => {
    expect(resolveExamPromotionDecision({ examType, resultStatus: null })).toBeNull();
    expect(resolveExamPromotionDecision({ examType, resultStatus: 'ABSENT' })).toBeNull();
  });
});