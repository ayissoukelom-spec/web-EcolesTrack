import { afterEach, describe, expect, it, vi } from 'vitest';

const apiFetchMock = vi.hoisted(() => vi.fn());

vi.mock('./api.ts', () => ({ apiFetch: apiFetchMock }));

import {
  GroupedEvaluationPublicationApiError,
  getGroupedEvaluationPublicationAvailability,
  getGroupedEvaluationPublicationOptions,
  submitGroupedEvaluationPublication,
} from './groupedEvaluationPublicationApi';

afterEach(() => {
  vi.clearAllMocks();
});

describe('grouped evaluation publication API', () => {
  it('scopes super-admin availability and options requests to the selected school', async () => {
    apiFetchMock.mockResolvedValue({ available: true });

    await getGroupedEvaluationPublicationAvailability(12);
    await getGroupedEvaluationPublicationOptions(12);

    expect(apiFetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/admin/evaluation-publications/grouped/availability?schoolId=12',
      undefined,
    );
    expect(apiFetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/admin/evaluation-publications/grouped/options?schoolId=12',
      undefined,
    );
  });

  it('submits the program with an idempotency key and no client-supplied school context', async () => {
    apiFetchMock.mockResolvedValue({ publicationId: 7 });
    const request = {
      kind: 'devoir' as const,
      startDate: '2026-11-12',
      endDate: '2026-11-15',
      classIds: [1],
      subjectIds: [10],
      idempotencyKey: 'key-12345678',
    };

    await submitGroupedEvaluationPublication(request, 'key-12345678');

    expect(apiFetchMock).toHaveBeenCalledWith(
      '/api/admin/evaluation-publications/grouped',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Idempotency-Key': 'key-12345678' },
        body: JSON.stringify({
          kind: 'devoir',
          startDate: '2026-11-12',
          endDate: '2026-11-15',
          classIds: [1],
          subjectIds: [10],
          coefficientsByPair: {},
          idempotencyKey: 'key-12345678',
        }),
      }),
    );
    expect(apiFetchMock.mock.calls[0][1].body).not.toContain('schoolId');
  });

  it('transmits per-pair composition coefficients unchanged', async () => {
    apiFetchMock.mockResolvedValue({ publicationId: 7 });

    await submitGroupedEvaluationPublication({
      kind: 'examen',
      startDate: '2026-11-12',
      endDate: '2026-11-15',
      classIds: [1],
      subjectIds: [10],
      coefficientsByPair: { '1:10': 3 },
      idempotencyKey: 'key-12345678',
    }, 'key-12345678');

    expect(JSON.parse(apiFetchMock.mock.calls[0][1].body)).toMatchObject({
      kind: 'examen',
      coefficientsByPair: { '1:10': 3 },
    });
  });

  it('includes an explicit school only for a super-admin scoped submission', async () => {
    apiFetchMock.mockResolvedValue({ publicationId: 7 });

    await submitGroupedEvaluationPublication({
      kind: 'devoir',
      startDate: '2026-11-12',
      endDate: '2026-11-15',
      classIds: [1],
      subjectIds: [10],
      idempotencyKey: 'key-12345678',
    }, 'key-12345678', 12);

    expect(JSON.parse(apiFetchMock.mock.calls[0][1].body)).toMatchObject({ schoolId: 12 });
  });

  it.each([
    [400, 'La sélection ou la période n’est pas valide.'],
    [401, 'Votre session a expiré.'],
    [403, 'Vous n’êtes pas autorisé'],
    [404, 'n’est pas disponible'],
    [409, 'associée à un autre programme'],
    [500, 'n’a pas pu être enregistré'],
  ])('translates HTTP %i into an actionable error', async (status, expectedMessage) => {
    apiFetchMock.mockRejectedValue({ status });

    await expect(submitGroupedEvaluationPublication({
      kind: 'devoir',
      startDate: '2026-11-12',
      endDate: '2026-11-15',
      classIds: [1],
      subjectIds: [10],
      idempotencyKey: 'key-12345678',
    }, 'key-12345678')).rejects.toMatchObject({
      name: GroupedEvaluationPublicationApiError.name,
      status,
      message: expect.stringContaining(expectedMessage),
    });
  });
});
