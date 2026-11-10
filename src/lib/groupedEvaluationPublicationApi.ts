import { apiFetch } from './api.ts';
import type {
  GroupedEvaluationPublicationRequest,
  GroupedEvaluationPublicationResponse,
  GroupedEvaluationValidationContext,
  SchoolTermPeriod,
} from './groupedEvaluationPublication.ts';

export interface GroupedEvaluationPublicationOptions {
  available: boolean;
  classes: Array<{ id: number; name: string }>;
  subjects: Array<{ id: number; name: string }>;
  approvedClassIds: number[];
  approvedSubjectIds: number[];
  activeTeachingPairs: Array<{ classId: number; subjectId: number }>;
  termsByClass: Record<number, SchoolTermPeriod[]>;
}

export class GroupedEvaluationPublicationApiError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'GroupedEvaluationPublicationApiError';
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const normalizeApiError = (error: unknown): GroupedEvaluationPublicationApiError => {
  if (!isRecord(error)) {
    return new GroupedEvaluationPublicationApiError(
      'Une erreur réseau est survenue. Réessayez sans modifier le programme.',
      null,
    );
  }
  const status = typeof error.status === 'number' ? error.status : null;
  const code = typeof error.code === 'string' ? error.code : undefined;
  const message = typeof error.message === 'string' && !error.message.includes('[object Object]')
    ? error.message
    : null;
  return new GroupedEvaluationPublicationApiError(
    message ?? ({
      400: 'La sélection ou la période n’est pas valide. Vérifiez le programme avant de réessayer.',
      401: 'Votre session a expiré. Reconnectez-vous puis réessayez.',
      403: 'Vous n’êtes pas autorisé à publier dans le contexte scolaire actif.',
      404: 'La publication groupée n’est pas disponible pour le moment.',
      409: 'Cette clé de soumission est associée à un autre programme. Révisez la sélection puis réessayez.',
      500: 'Le programme n’a pas pu être enregistré. La clé de soumission est conservée pour une nouvelle tentative.',
    } as Record<number, string>)[status ?? 0]
      ?? 'Une erreur réseau est survenue. Réessayez sans modifier le programme.',
    status,
    code,
  );
};

async function request<T>(endpoint: string, options?: RequestInit): Promise<T> {
  try {
    return await apiFetch(endpoint, options) as T;
  } catch (error) {
    throw normalizeApiError(error);
  }
}

export const getGroupedEvaluationPublicationAvailability = () =>
  request<{ available: boolean }>('/api/admin/evaluation-publications/grouped/availability');

export const getGroupedEvaluationPublicationOptions = () =>
  request<GroupedEvaluationPublicationOptions>('/api/admin/evaluation-publications/grouped/options');

export const submitGroupedEvaluationPublication = (
  publication: GroupedEvaluationPublicationRequest,
  idempotencyKey: string,
) => request<GroupedEvaluationPublicationResponse>('/api/admin/evaluation-publications/grouped', {
  method: 'POST',
  headers: { 'Idempotency-Key': idempotencyKey },
  body: JSON.stringify({
    kind: publication.kind,
    startDate: publication.startDate,
    endDate: publication.endDate,
    classIds: publication.classIds,
    subjectIds: publication.subjectIds,
    idempotencyKey,
  }),
});

export function getGroupedEvaluationValidationContext(
  options: GroupedEvaluationPublicationOptions,
): GroupedEvaluationValidationContext {
  return {
    approvedClassIds: options.approvedClassIds,
    approvedSubjectIds: options.approvedSubjectIds,
    activeTeachingPairs: options.activeTeachingPairs,
    termsByClass: options.termsByClass,
  };
}
