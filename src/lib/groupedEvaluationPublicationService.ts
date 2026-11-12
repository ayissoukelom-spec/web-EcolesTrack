import { createHash } from 'node:crypto';
import {
  formatGroupedEvaluationParentMessage,
  validateGroupedEvaluationPublication,
  getGroupedEvaluationCoefficient,
  validateGroupedEvaluationPublicationRequest,
  type GroupedEvaluationPeriodType,
  type GroupedEvaluationPublicationRequest,
  type GroupedEvaluationPublicationResponse,
  type GroupedEvaluationValidationContext,
  type SchoolTermPeriod,
  type ValidatedGroupedEvaluationPublication,
} from './groupedEvaluationPublication.ts';

export interface GroupedPublicationContext extends GroupedEvaluationValidationContext {
  academicYearId: number;
  periodType: GroupedEvaluationPeriodType;
  periodOrderIndex: number;
  subjectNamesById: Record<number, string>;
}

export interface GroupedPublicationRecord {
  id: number;
  evaluationIds: number[];
  recipientCount: number;
}

export interface GroupedEvaluationPublicationTransaction {
  findPublication(
    schoolId: number,
    idempotencyKey: string,
  ): Promise<GroupedPublicationRecord & { requestHash: string } | null>;
  loadContext(
    schoolId: number,
    request: GroupedEvaluationPublicationRequest,
  ): Promise<GroupedPublicationContext>;
  createPublication(input: {
    schoolId: number;
    authorUserId: number;
    academicYearId: number;
    kind: GroupedEvaluationPublicationRequest['kind'];
    periodType: GroupedEvaluationPeriodType;
    periodOrderIndex: number;
    startDate: string;
    endDate: string;
    idempotencyKey: string;
    requestHash: string;
  }): Promise<{ id: number } | null>;
  nextSequence(schoolId: number, termId: number, classId: number): Promise<number>;
  createEvaluation(input: {
    publicationId: number;
    schoolId: number;
    classId: number;
    subjectId: number;
    subject: string;
    termId: number;
    type: 'devoir' | 'composition';
    coefficient: number;
    countInBulletin: boolean;
    date: string;
    sequenceNumber: number;
    generatedName: string;
  }): Promise<{ id: number }>;
  getParentUserIds(schoolId: number, classIds: number[]): Promise<number[]>;
  createLocalNotifications(input: {
    publicationId: number;
    recipientUserIds: number[];
    title: string;
    body: string;
  }): Promise<number[]>;
  createPushOutbox(notificationIds: number[]): Promise<void>;
  getPublication(
    schoolId: number,
    idempotencyKey: string,
  ): Promise<GroupedPublicationRecord & { requestHash: string } | null>;
}

export interface GroupedEvaluationPublicationRepository {
  transaction<T>(
    work: (transaction: GroupedEvaluationPublicationTransaction) => Promise<T>,
  ): Promise<T>;
}

export class GroupedEvaluationIdempotencyConflictError extends Error {
  constructor() {
    super('Cette clé de soumission a déjà été utilisée avec un contenu différent.');
    this.name = 'GroupedEvaluationIdempotencyConflictError';
  }
}

export class GroupedEvaluationValidationError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'GroupedEvaluationValidationError';
  }
}

export function isAuthorizedGroupedPublicationActor(
  actor: { id?: number | null; role?: string | null; schoolId?: number | null } | null,
  membership: {
    userId: number;
    schoolId: number;
    role: string;
    isActive: boolean | null;
  } | null,
): actor is { id: number; role: 'school_admin'; schoolId: number } {
  return actor?.role === 'school_admin'
    && Number.isInteger(actor.id)
    && actor.id != null
    && actor.id > 0
    && Number.isInteger(actor.schoolId)
    && actor.schoolId != null
    && actor.schoolId > 0
    && membership != null
    && membership.userId === actor.id
    && membership.schoolId === actor.schoolId
    && membership.role === 'school_admin'
    && membership.isActive !== false;
}

export function resolveGroupedPublicationSchoolId(
  actor: { id?: number | null; role?: string | null; schoolId?: number | null } | null,
  requestedSchoolId: number | null,
  hasRequestedSchoolId: boolean,
  membership: {
    userId: number;
    schoolId: number;
    role: string;
    isActive: boolean | null;
  } | null,
  requestedSchoolExists: boolean,
): number | null {
  if (actor?.role === 'school_admin') {
    return !hasRequestedSchoolId && isAuthorizedGroupedPublicationActor(actor, membership)
      ? actor.schoolId
      : null;
  }
  if (
    actor?.role === 'super_admin'
    && Number.isInteger(actor.id)
    && actor.id != null
    && actor.id > 0
    && hasRequestedSchoolId
    && Number.isInteger(requestedSchoolId)
    && requestedSchoolId != null
    && requestedSchoolId > 0
    && requestedSchoolExists
  ) {
    return requestedSchoolId;
  }
  return null;
}

export function hashGroupedEvaluationRequest(
  request: GroupedEvaluationPublicationRequest,
): string {
  const customCoefficientsByPair = Object.fromEntries(
    [...request.classIds].sort((a, b) => a - b).flatMap((classId) =>
      [...request.subjectIds].sort((a, b) => a - b).map((subjectId) => [
        `${classId}:${subjectId}`,
        getGroupedEvaluationCoefficient(request, classId, subjectId),
      ] as const),
    ).filter(([, coefficient]) => coefficient !== 1),
  );
  const canonicalRequest = {
    kind: request.kind,
    startDate: request.startDate,
    endDate: request.endDate,
    classIds: [...request.classIds].sort((a, b) => a - b),
    subjectIds: [...request.subjectIds].sort((a, b) => a - b),
    ...(Object.keys(customCoefficientsByPair).length > 0
      ? { coefficientsByPair: customCoefficientsByPair }
      : {}),
  };
  return createHash('sha256').update(JSON.stringify(canonicalRequest)).digest('hex');
}

function assertCompatibleTerms(
  request: GroupedEvaluationPublicationRequest,
  termsByClass: Record<number, SchoolTermPeriod[]>,
  context: Pick<GroupedPublicationContext, 'academicYearId' | 'periodType' | 'periodOrderIndex'>,
): void {
  const selectedTerms = request.classIds.map((classId) => {
    const covering = (termsByClass[classId] ?? []).filter((term) =>
      term.startDate <= request.startDate && term.endDate >= request.endDate,
    );
    return covering.length === 1 ? covering[0] : null;
  });
  if (selectedTerms.some((term) => term == null)) {
    throw new GroupedEvaluationValidationError(
      'period_outside_single_term',
      'La période doit être entièrement comprise dans un seul trimestre ou semestre pour chaque classe sélectionnée.',
    );
  }
  const firstTerm = selectedTerms[0]!;
  const firstPeriodType = firstTerm.periodType ?? 'trimester';
  const incompatibleClasses = request.classIds.filter((classId, index) => {
    const term = selectedTerms[index]!;
    return term.academicYearId !== firstTerm.academicYearId
      || (term.periodType ?? 'trimester') !== firstPeriodType
      || (term.orderIndex ?? 0) <= 0
      || term.orderIndex !== firstTerm.orderIndex
      || term.academicYearId !== context.academicYearId
      || firstPeriodType !== context.periodType
      || firstTerm.orderIndex !== context.periodOrderIndex;
  });
  if (incompatibleClasses.length > 0) {
    throw new GroupedEvaluationValidationError(
      'incompatible_terms',
      'Toutes les classes doivent utiliser le même type de période, la même année scolaire et le même numéro de période.',
      { classIds: incompatibleClasses },
    );
  }
}

function publicationResponse(
  record: GroupedPublicationRecord,
): GroupedEvaluationPublicationResponse {
  return {
    publicationId: record.id,
    evaluationIds: record.evaluationIds,
    evaluationCount: record.evaluationIds.length,
    notification: {
      local: 'created',
      push: 'pending',
      recipientCount: record.recipientCount,
      failedRecipientCount: 0,
    },
  };
}

export async function publishGroupedEvaluations(
  repository: GroupedEvaluationPublicationRepository,
  input: {
    schoolId: number;
    authorUserId: number;
    request: GroupedEvaluationPublicationRequest;
  },
): Promise<GroupedEvaluationPublicationResponse> {
  const { schoolId, authorUserId, request } = input;
  const requestError = validateGroupedEvaluationPublicationRequest(request);
  if (requestError) {
    throw new GroupedEvaluationValidationError(
      requestError.code,
      requestError.message,
      requestError.details,
    );
  }
  const requestHash = hashGroupedEvaluationRequest(request);

  return repository.transaction(async (tx) => {
    const existing = await tx.findPublication(schoolId, request.idempotencyKey);
    if (existing) {
      if (existing.requestHash !== requestHash) throw new GroupedEvaluationIdempotencyConflictError();
      return publicationResponse(existing);
    }

    const context = await tx.loadContext(schoolId, request);
    const validation = validateGroupedEvaluationPublication(request, context);
    if ('error' in validation) {
      throw new GroupedEvaluationValidationError(
        validation.error.code,
        validation.error.message,
        validation.error.details,
      );
    }
    assertCompatibleTerms(request, context.termsByClass, context);
    const value: ValidatedGroupedEvaluationPublication = validation.value;

    const publication = await tx.createPublication({
      schoolId,
      authorUserId,
      academicYearId: context.academicYearId,
      kind: value.kind,
      periodType: context.periodType,
      periodOrderIndex: context.periodOrderIndex,
      startDate: value.startDate,
      endDate: value.endDate,
      idempotencyKey: value.idempotencyKey,
      requestHash,
    });

    if (!publication) {
      const conflicting = await tx.getPublication(schoolId, request.idempotencyKey);
      if (!conflicting) throw new Error('Idempotent publication conflict could not be resolved.');
      if (conflicting.requestHash !== requestHash) throw new GroupedEvaluationIdempotencyConflictError();
      return publicationResponse(conflicting);
    }

    const evaluationIds: number[] = [];
    for (const classId of [...value.classIds].sort((a, b) => a - b)) {
      for (const subjectId of [...value.subjectIds].sort((a, b) => a - b)) {
        const termId = value.termIdByClass[classId];
        const sequenceNumber = await tx.nextSequence(schoolId, termId, classId);
        const subjectName = context.subjectNamesById[subjectId];
        if (!subjectName) {
          throw new GroupedEvaluationValidationError(
            'subject_not_approved',
            'Une matière sélectionnée n’est plus disponible dans cet établissement.',
            { subjectIds: [subjectId] },
          );
        }
        const coefficient = getGroupedEvaluationCoefficient(request, classId, subjectId);
        const evaluation = await tx.createEvaluation({
          publicationId: publication.id,
          schoolId,
          classId,
          subjectId,
          subject: subjectName,
          termId,
          type: value.evaluationType,
          coefficient,
          countInBulletin: value.evaluationType === 'devoir',
          date: value.evaluationDate,
          sequenceNumber,
          generatedName: `${value.evaluationType === 'composition' ? 'Composition' : 'Devoir'} ${context.periodType === 'trimester' ? 'T' : 'S'}${context.periodOrderIndex}.${sequenceNumber}`,
        });
        evaluationIds.push(evaluation.id);
      }
    }

    const recipientUserIds = [...new Set(await tx.getParentUserIds(schoolId, value.classIds))];
    const notificationIds = await tx.createLocalNotifications({
      publicationId: publication.id,
      recipientUserIds,
      title: value.kind === 'examen' ? 'Nouveau programme d’examens' : 'Nouveau programme de devoirs',
      body: formatGroupedEvaluationParentMessage({
        kind: value.kind,
        startDate: value.startDate,
        endDate: value.endDate,
        subjects: value.subjectIds.map((subjectId) => context.subjectNamesById[subjectId] ?? ''),
      }),
    });
    await tx.createPushOutbox(notificationIds);

    return publicationResponse({
      id: publication.id,
      evaluationIds,
      recipientCount: recipientUserIds.length,
    });
  });
}
