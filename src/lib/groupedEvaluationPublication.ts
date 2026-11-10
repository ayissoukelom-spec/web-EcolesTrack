export type GroupedEvaluationKind = 'devoir' | 'examen';
export type GroupedEvaluationType = 'devoir' | 'composition';
export type GroupedEvaluationPeriodType = 'trimester' | 'semester';

export interface GroupedEvaluationPublicationRequest {
  kind: GroupedEvaluationKind;
  startDate: string;
  endDate: string;
  classIds: number[];
  subjectIds: number[];
  idempotencyKey: string;
}

export interface ApprovedTeachingPair {
  classId: number;
  subjectId: number;
}

export interface SchoolTermPeriod {
  id: number;
  startDate: string;
  endDate: string;
  academicYearId?: number;
  periodType?: GroupedEvaluationPeriodType | null;
  orderIndex?: number;
}

export interface GroupedEvaluationValidationContext {
  approvedClassIds: number[];
  approvedSubjectIds: number[];
  activeTeachingPairs: ApprovedTeachingPair[];
  termsByClass: Record<number, SchoolTermPeriod[]>;
}

export type GroupedEvaluationValidationErrorCode =
  | 'invalid_kind'
  | 'invalid_date'
  | 'invalid_period'
  | 'invalid_selection'
  | 'invalid_idempotency_key'
  | 'class_not_approved'
  | 'subject_not_approved'
  | 'invalid_class_subject_pairs'
  | 'period_outside_single_term'
  | 'ambiguous_term'
  | 'incompatible_terms';

export interface GroupedEvaluationValidationError {
  code: GroupedEvaluationValidationErrorCode;
  message: string;
  details?: Record<string, unknown>;
}

export type GroupedEvaluationPublicationApiErrorCode =
  | GroupedEvaluationValidationErrorCode
  | 'unauthenticated'
  | 'forbidden'
  | 'school_context_missing'
  | 'idempotency_conflict'
  | 'persistence_failed'
  | 'notification_delivery_failed';

export interface GroupedEvaluationPublicationApiError {
  error: {
    code: GroupedEvaluationPublicationApiErrorCode;
    message: string;
    details?: Record<string, unknown>;
  };
}

export interface ValidatedGroupedEvaluationPublication {
  kind: GroupedEvaluationKind;
  evaluationType: GroupedEvaluationType;
  startDate: string;
  endDate: string;
  evaluationDate: string;
  classIds: number[];
  subjectIds: number[];
  idempotencyKey: string;
  termIdByClass: Record<number, number>;
}

export interface GroupedEvaluationPublicationResponse {
  publicationId: number;
  evaluationIds: number[];
  evaluationCount: number;
  notification: {
    local: 'created';
    push: 'pending' | 'sent' | 'partial' | 'failed';
    recipientCount: number;
    failedRecipientCount: number;
  };
}

const isDateOnly = (value: unknown): value is string => {
  if (typeof value !== 'string') return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};

const isPositiveIntegerList = (values: number[]): boolean =>
  values.length > 0
  && values.every((value) => Number.isInteger(value) && value > 0)
  && new Set(values).size === values.length;

export function validateGroupedEvaluationPublicationRequest(
  request: GroupedEvaluationPublicationRequest,
): GroupedEvaluationValidationError | null {
  if (request.kind !== 'devoir' && request.kind !== 'examen') {
    return { code: 'invalid_kind', message: 'Le type doit être « devoir » ou « examen ».' };
  }
  if (!isDateOnly(request.startDate) || !isDateOnly(request.endDate)) {
    return { code: 'invalid_date', message: 'Les dates doivent être valides au format AAAA-MM-JJ, sans heure.' };
  }
  if (request.startDate > request.endDate) {
    return { code: 'invalid_period', message: 'La date de fin doit être égale ou postérieure à la date de début.' };
  }
  if (
    !Array.isArray(request.classIds)
    || !Array.isArray(request.subjectIds)
    || !isPositiveIntegerList(request.classIds)
    || !isPositiveIntegerList(request.subjectIds)
  ) {
    return { code: 'invalid_selection', message: 'Sélectionnez au moins une classe et une matière, sans doublons.' };
  }
  if (
    typeof request.idempotencyKey !== 'string'
    || request.idempotencyKey !== request.idempotencyKey.trim()
    || request.idempotencyKey.trim().length < 8
    || request.idempotencyKey.length > 128
  ) {
    return {
      code: 'invalid_idempotency_key',
      message: 'La clé de soumission doit contenir entre 8 et 128 caractères.',
    };
  }
  return null;
}

export function validateGroupedEvaluationPublication(
  request: GroupedEvaluationPublicationRequest,
  context: GroupedEvaluationValidationContext,
): { value: ValidatedGroupedEvaluationPublication } | { error: GroupedEvaluationValidationError } {
  const requestError = validateGroupedEvaluationPublicationRequest(request);
  if (requestError) return { error: requestError };

  const approvedClasses = new Set(context.approvedClassIds);
  const unapprovedClassIds = request.classIds.filter((classId) => !approvedClasses.has(classId));
  if (unapprovedClassIds.length > 0) {
    return {
      error: {
        code: 'class_not_approved',
        message: 'Une ou plusieurs classes ne sont pas approuvées dans cet établissement.',
        details: { classIds: unapprovedClassIds },
      },
    };
  }

  const approvedSubjects = new Set(context.approvedSubjectIds);
  const unapprovedSubjectIds = request.subjectIds.filter((subjectId) => !approvedSubjects.has(subjectId));
  if (unapprovedSubjectIds.length > 0) {
    return {
      error: {
        code: 'subject_not_approved',
        message: 'Une ou plusieurs matières ne sont pas approuvées dans cet établissement.',
        details: { subjectIds: unapprovedSubjectIds },
      },
    };
  }

  const activePairs = new Set(
    context.activeTeachingPairs.map(({ classId, subjectId }) => `${classId}:${subjectId}`),
  );
  const invalidPairs = request.classIds.flatMap((classId) =>
    request.subjectIds
      .filter((subjectId) => !activePairs.has(`${classId}:${subjectId}`))
      .map((subjectId) => ({ classId, subjectId })),
  );
  if (invalidPairs.length > 0) {
    return {
      error: {
        code: 'invalid_class_subject_pairs',
        message: 'Certaines matières ne sont pas enseignées dans toutes les classes sélectionnées. Corrigez la sélection avant publication.',
        details: { pairs: invalidPairs },
      },
    };
  }

  const termIdByClass: Record<number, number> = {};
  const resolvedTerms = new Map<number, SchoolTermPeriod>();
  for (const classId of request.classIds) {
    const coveringTerms = (context.termsByClass[classId] ?? []).filter((term) =>
      isDateOnly(term.startDate)
      && isDateOnly(term.endDate)
      && term.startDate <= request.startDate
      && term.endDate >= request.endDate,
    );
    if (coveringTerms.length === 0) {
      return {
        error: {
          code: 'period_outside_single_term',
          message: 'La période doit être entièrement comprise dans un seul trimestre ou semestre pour chaque classe sélectionnée.',
          details: { classId },
        },
      };
    }
    if (coveringTerms.length > 1) {
      return {
        error: {
          code: 'ambiguous_term',
          message: 'Plusieurs périodes couvrent les dates pour une classe; la publication ne peut pas déterminer la période.',
          details: { classId, termIds: coveringTerms.map((term) => term.id) },
        },
      };
    }
    termIdByClass[classId] = coveringTerms[0].id;
    resolvedTerms.set(classId, coveringTerms[0]);
  }

  const selectedTerms = request.classIds.map((classId) => resolvedTerms.get(classId)!);
  const selectedPeriodType = selectedTerms[0].periodType ?? 'trimester';
  const hasPeriodMetadata = selectedTerms.some((term) =>
    term.academicYearId != null || term.periodType != null || term.orderIndex != null
  );
  if (
    selectedTerms.some((term) => (term.periodType ?? 'trimester') !== selectedPeriodType)
    || (hasPeriodMetadata && selectedTerms.some((term) =>
      term.academicYearId == null || term.orderIndex == null
    ))
  ) {
    return {
      error: {
        code: 'incompatible_terms',
          message: 'Toutes les classes doivent utiliser le même type de période, la même année scolaire et le même numéro de période.',
        details: { classIds: request.classIds },
      },
    };
  }
  if (hasPeriodMetadata) {
    const firstTerm = selectedTerms[0];
    const incompatibleClasses = request.classIds.filter((classId) => {
      const term = resolvedTerms.get(classId)!;
      return term.academicYearId !== firstTerm.academicYearId
        || (term.periodType ?? 'trimester') !== selectedPeriodType
        || term.orderIndex! <= 0
        || term.orderIndex !== firstTerm.orderIndex;
    });
    if (incompatibleClasses.length > 0) {
      return {
        error: {
          code: 'incompatible_terms',
            message: 'Toutes les classes doivent utiliser le même type de période, la même année scolaire et le même numéro de période.',
          details: { classIds: incompatibleClasses },
        },
      };
    }
  }

  return {
    value: {
      ...request,
      evaluationType: request.kind === 'examen' ? 'composition' : 'devoir',
      termIdByClass,
      evaluationDate: request.startDate,
    },
  };
}

export function formatGroupedEvaluationParentMessage(params: {
  kind: GroupedEvaluationKind;
  startDate: string;
  endDate: string;
  subjects: string[];
}): string {
  const formatDate = (date: string) => new Intl.DateTimeFormat('fr-FR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${date}T00:00:00.000Z`));
  const label = params.kind === 'examen' ? 'examens' : 'devoirs';
  const period = params.startDate === params.endDate
    ? `le ${formatDate(params.startDate)}`
    : `du ${formatDate(params.startDate)} au ${formatDate(params.endDate)}`;
  const subjects = [...new Set(params.subjects.map((subject) => subject.trim()).filter(Boolean))];
  const subjectText = subjects.length > 0 ? subjects.join(', ') : 'matières communiquées par l’établissement';
  return `Un programme de ${label} est prévu ${period}. Matières concernées : ${subjectText}.`;
}
