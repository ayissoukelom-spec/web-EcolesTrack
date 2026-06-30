import { describe, expect, it } from 'vitest';
import { normalizeOptionalNumber, resolveEvaluationAccessContext } from './evaluationAccess';

describe('evaluation access context', () => {
  it('normalizes nullish and invalid values to null', () => {
    expect(normalizeOptionalNumber(undefined)).toBeNull();
    expect(normalizeOptionalNumber(null)).toBeNull();
    expect(normalizeOptionalNumber('')).toBeNull();
    expect(normalizeOptionalNumber('abc')).toBeNull();
    expect(normalizeOptionalNumber('12')).toBe(12);
    expect(normalizeOptionalNumber(0)).toBeNull();
  });

  it('returns a safe evaluation access context for missing or invalid actor data', () => {
    const context = resolveEvaluationAccessContext({
      role: undefined,
      schoolId: undefined,
      id: undefined,
    } as any);

    expect(context.role).toBeNull();
    expect(context.schoolId).toBeNull();
    expect(context.userId).toBeNull();
  });

  it('keeps valid numeric filters and role values', () => {
    const context = resolveEvaluationAccessContext({
      role: 'teacher',
      schoolId: '56',
      id: '77',
    } as any);

    expect(context.role).toBe('teacher');
    expect(context.schoolId).toBe(56);
    expect(context.userId).toBe(77);
  });
});
