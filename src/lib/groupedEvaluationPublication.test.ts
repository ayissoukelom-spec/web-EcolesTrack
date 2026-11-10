import { describe, expect, it } from 'vitest';
import {
  formatGroupedEvaluationParentMessage,
  validateGroupedEvaluationPublication,
  type GroupedEvaluationPublicationRequest,
  type GroupedEvaluationValidationContext,
} from './groupedEvaluationPublication';

const request: GroupedEvaluationPublicationRequest = {
  kind: 'devoir',
  startDate: '2026-11-12',
  endDate: '2026-11-15',
  classIds: [10, 11],
  subjectIds: [20, 21],
  idempotencyKey: 'grouped-publication-001',
};

const context: GroupedEvaluationValidationContext = {
  approvedClassIds: [10, 11],
  approvedSubjectIds: [20, 21],
  activeTeachingPairs: [
    { classId: 10, subjectId: 20 },
    { classId: 10, subjectId: 21 },
    { classId: 11, subjectId: 20 },
    { classId: 11, subjectId: 21 },
  ],
  termsByClass: {
    10: [{ id: 100, startDate: '2026-11-01', endDate: '2026-12-31' }],
    11: [{ id: 101, startDate: '2026-11-01', endDate: '2026-12-31' }],
  },
};

describe('grouped evaluation publication contracts', () => {
  it('maps Examen to the existing composition evaluation type', () => {
    const result = validateGroupedEvaluationPublication({ ...request, kind: 'examen' }, context);

    expect('value' in result && result.value.evaluationType).toBe('composition');
  });

  it('accepts a date-only period fully contained in one term for each class', () => {
    const result = validateGroupedEvaluationPublication(request, context);

    expect(result).toEqual({
      value: expect.objectContaining({
        evaluationType: 'devoir',
        termIdByClass: { 10: 100, 11: 101 },
        evaluationDate: request.startDate,
        startDate: request.startDate,
        endDate: request.endDate,
      }),
    });
  });

  it('rejects invalid date-only values and periods with reversed dates', () => {
    expect(validateGroupedEvaluationPublication(
      { ...request, startDate: '2026-02-30' },
      context,
    )).toMatchObject({ error: { code: 'invalid_date' } });
    expect(validateGroupedEvaluationPublication(
      { ...request, startDate: '2026-11-16' },
      context,
    )).toMatchObject({ error: { code: 'invalid_period' } });
  });

  it('rejects a period that crosses a term boundary', () => {
    const crossingTerms = {
      ...context,
      termsByClass: {
        ...context.termsByClass,
        10: [
          { id: 100, startDate: '2026-09-01', endDate: '2026-11-13' },
          { id: 102, startDate: '2026-11-14', endDate: '2027-01-31' },
        ],
      },
    };

    expect(validateGroupedEvaluationPublication(request, crossingTerms))
      .toMatchObject({ error: { code: 'period_outside_single_term', details: { classId: 10 } } });
  });

  it('rejects classes covered by different school years or trimester indexes', () => {
    const incompatibleTerms = {
      ...context,
      termsByClass: {
        10: [{
          id: 100,
          startDate: '2026-11-01',
          endDate: '2026-12-31',
          academicYearId: 7,
          periodType: 'trimester',
          orderIndex: 1,
        }],
        11: [{
          id: 101,
          startDate: '2026-11-01',
          endDate: '2026-12-31',
          academicYearId: 7,
          periodType: 'trimester',
          orderIndex: 2,
        }],
      },
    };

    expect(validateGroupedEvaluationPublication(request, incompatibleTerms))
      .toMatchObject({ error: { code: 'incompatible_terms', details: { classIds: [11] } } });
  });

  it('rejects classes or subjects that are not approved by the establishment', () => {
    expect(validateGroupedEvaluationPublication(
      { ...request, classIds: [10, 12] },
      context,
    )).toMatchObject({ error: { code: 'class_not_approved', details: { classIds: [12] } } });
    expect(validateGroupedEvaluationPublication(
      { ...request, subjectIds: [20, 22] },
      context,
    )).toMatchObject({ error: { code: 'subject_not_approved', details: { subjectIds: [22] } } });
  });

  it('rejects a requested class-subject combination without an active teaching assignment', () => {
    const result = validateGroupedEvaluationPublication(request, {
      ...context,
      activeTeachingPairs: context.activeTeachingPairs.filter(
        (pair) => pair.classId !== 11 || pair.subjectId !== 21,
      ),
    });

    expect(result).toMatchObject({
      error: {
        code: 'invalid_class_subject_pairs',
        details: { pairs: [{ classId: 11, subjectId: 21 }] },
      },
    });
  });

  it('rejects duplicate selections and a missing idempotency key', () => {
    expect(validateGroupedEvaluationPublication(
      { ...request, classIds: [10, 10] },
      context,
    )).toMatchObject({ error: { code: 'invalid_selection' } });
    expect(validateGroupedEvaluationPublication(
      { ...request, idempotencyKey: 'short' },
      context,
    )).toMatchObject({ error: { code: 'invalid_idempotency_key' } });
  });

  it('formats a parent message with the full period and deduplicated subjects, without a time', () => {
    const message = formatGroupedEvaluationParentMessage({
      kind: 'examen',
      startDate: '2026-11-12',
      endDate: '2026-11-15',
      subjects: ['Mathématiques', ' Physique ', 'Mathématiques'],
    });

    expect(message).toContain('examens');
    expect(message).toContain('du 12 novembre 2026 au 15 novembre 2026');
    expect(message).toContain('Mathématiques, Physique');
    expect(message).not.toMatch(/\b\d{1,2}:\d{2}\b/);
  });
});
