import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  GroupedEvaluationIdempotencyConflictError,
  hashGroupedEvaluationRequest,
  isAuthorizedGroupedPublicationActor,
  publishGroupedEvaluations,
  resolveGroupedPublicationSchoolId,
  type GroupedEvaluationPublicationRepository,
  type GroupedEvaluationPublicationTransaction,
  type GroupedPublicationContext,
  type GroupedPublicationRecord,
} from './groupedEvaluationPublicationService.ts';
import type { GroupedEvaluationPublicationRequest } from './groupedEvaluationPublication.ts';

const request: GroupedEvaluationPublicationRequest = {
  kind: 'devoir',
  startDate: '2026-11-12',
  endDate: '2026-11-15',
  classIds: [10, 11],
  subjectIds: [20, 21],
  idempotencyKey: 'grouped-publication-001',
};

const context: GroupedPublicationContext = {
  academicYearId: 7,
  periodType: 'trimester',
  periodOrderIndex: 1,
  approvedClassIds: [10, 11],
  approvedSubjectIds: [20, 21],
  activeTeachingPairs: [
    { classId: 10, subjectId: 20 },
    { classId: 10, subjectId: 21 },
    { classId: 11, subjectId: 20 },
    { classId: 11, subjectId: 21 },
  ],
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
      orderIndex: 1,
    }],
  },
  subjectNamesById: { 20: 'Mathématiques', 21: 'Physique' },
};

class FakeRepository implements GroupedEvaluationPublicationRepository {
  records = new Map<string, GroupedPublicationRecord & { requestHash: string }>();
  evaluations: Array<{
    id: number;
    classId: number;
    subjectId: number;
    sequenceNumber: number;
    coefficient: number;
    countInBulletin: boolean;
    date: string;
    type: string;
    generatedName: string;
  }> = [];
  context = context;
  notifications: Array<{ publicationId: number; userId: number }> = [];
  outboxNotificationIds: number[] = [];
  transactions = 0;
  failEvaluationAt: number | null = null;
  private nextId = 1;
  private lock = Promise.resolve();

  async transaction<T>(work: (transaction: GroupedEvaluationPublicationTransaction) => Promise<T>): Promise<T> {
    this.transactions += 1;
    const snapshot = {
      records: new Map(this.records),
      evaluations: [...this.evaluations],
      notifications: [...this.notifications],
      outboxNotificationIds: [...this.outboxNotificationIds],
      nextId: this.nextId,
    };
    const previousLock = this.lock;
    let release!: () => void;
    this.lock = new Promise<void>((resolve) => { release = resolve; });
    await previousLock;
    try {
      const tx: GroupedEvaluationPublicationTransaction = {
        findPublication: async (_schoolId, key) => this.records.get(key) ?? null,
        loadContext: async () => this.context,
        createPublication: async (input) => {
          if (this.records.has(input.idempotencyKey)) return null;
          const record = { id: this.nextId++, evaluationIds: [], recipientCount: 0, requestHash: input.requestHash };
          this.records.set(input.idempotencyKey, record);
          return { id: record.id };
        },
        nextSequence: async (_schoolId, _termId, classId) =>
          Math.max(0, ...this.evaluations.filter((item) => item.classId === classId).map((item) => item.sequenceNumber)) + 1,
        createEvaluation: async (input) => {
          if (this.failEvaluationAt === this.evaluations.length) throw new Error('test evaluation insert failure');
          const id = this.nextId++;
          this.evaluations.push({
            id,
            classId: input.classId,
            subjectId: input.subjectId,
            sequenceNumber: input.sequenceNumber,
            coefficient: input.coefficient,
            countInBulletin: input.countInBulletin,
            date: input.date,
            type: input.type,
            generatedName: input.generatedName,
          });
          const record = [...this.records.values()].find((item) => item.id === input.publicationId)!;
          record.evaluationIds.push(id);
          return { id };
        },
        getParentUserIds: async () => [501, 501, 502],
        createLocalNotifications: async ({ publicationId, recipientUserIds }) => {
          const ids = recipientUserIds.map((userId) => {
            this.notifications.push({ publicationId, userId });
            return this.nextId++;
          });
          const record = [...this.records.values()].find((item) => item.id === publicationId)!;
          record.recipientCount = recipientUserIds.length;
          return ids;
        },
        createPushOutbox: async (ids) => { this.outboxNotificationIds.push(...ids); },
        getPublication: async (_schoolId, key) => this.records.get(key) ?? null,
      };
      return await work(tx);
    } catch (error) {
      this.records = snapshot.records;
      this.evaluations = snapshot.evaluations;
      this.notifications = snapshot.notifications;
      this.outboxNotificationIds = snapshot.outboxNotificationIds;
      this.nextId = snapshot.nextId;
      throw error;
    } finally {
      release();
    }
  }
}

describe('grouped evaluation publication service', () => {
  it('preserves legacy idempotency hashes for default coefficients', () => {
    const legacyCanonicalRequest = {
      kind: request.kind,
      startDate: request.startDate,
      endDate: request.endDate,
      classIds: [...request.classIds].sort((a, b) => a - b),
      subjectIds: [...request.subjectIds].sort((a, b) => a - b),
    };
    const legacyHash = createHash('sha256')
      .update(JSON.stringify(legacyCanonicalRequest))
      .digest('hex');

    expect(hashGroupedEvaluationRequest(request)).toBe(legacyHash);
    expect(hashGroupedEvaluationRequest({
      ...request,
      coefficientsByPair: { '10:20': 1, '10:21': 1, '11:20': 1, '11:21': 1 },
    })).toBe(legacyHash);
  });

  it('requires an active school-admin membership matching the verified actor context', () => {
    const actor = { id: 8, role: 'school_admin', schoolId: 4 };
    const membership = { userId: 8, schoolId: 4, role: 'school_admin', isActive: true };

    expect(isAuthorizedGroupedPublicationActor(actor, membership)).toBe(true);
    expect(isAuthorizedGroupedPublicationActor({ ...actor, schoolId: null }, membership)).toBe(false);
    expect(isAuthorizedGroupedPublicationActor({ ...actor, role: 'teacher' }, membership)).toBe(false);
    expect(isAuthorizedGroupedPublicationActor(actor, { ...membership, schoolId: 5 })).toBe(false);
    expect(isAuthorizedGroupedPublicationActor(actor, { ...membership, role: 'teacher' })).toBe(false);
    expect(isAuthorizedGroupedPublicationActor(actor, { ...membership, isActive: false })).toBe(false);
  });

  it('resolves school-admin publication scope only from the verified active school context', () => {
    const actor = { id: 8, role: 'school_admin', schoolId: 4 };
    const membership = { userId: 8, schoolId: 4, role: 'school_admin', isActive: true };

    expect(resolveGroupedPublicationSchoolId(actor, null, false, membership, false)).toBe(4);
    expect(resolveGroupedPublicationSchoolId(actor, 5, true, membership, true)).toBeNull();
    expect(resolveGroupedPublicationSchoolId(actor, null, false, null, false)).toBeNull();
    expect(resolveGroupedPublicationSchoolId({ ...actor, schoolId: null }, null, false, membership, false)).toBeNull();
  });

  it('allows only a verified super admin to select an existing publication school', () => {
    const actor = { id: 1, role: 'super_admin', schoolId: null };

    expect(resolveGroupedPublicationSchoolId(actor, 4, true, null, true)).toBe(4);
    expect(resolveGroupedPublicationSchoolId(actor, 4, true, null, false)).toBeNull();
    expect(resolveGroupedPublicationSchoolId(actor, null, false, null, true)).toBeNull();
    expect(resolveGroupedPublicationSchoolId({ ...actor, role: 'teacher' }, 4, true, null, true)).toBeNull();
    expect(resolveGroupedPublicationSchoolId({ ...actor, id: null }, 4, true, null, true)).toBeNull();
  });

  it('creates one evaluation for each approved class-subject pair with no teacher id', async () => {
    const repository = new FakeRepository();
    const result = await publishGroupedEvaluations(repository, {
      schoolId: 4,
      authorUserId: 8,
      request: { ...request, kind: 'examen' },
    });

    expect(result.evaluationCount).toBe(4);
    expect(repository.evaluations.map(({ classId, subjectId }) => `${classId}:${subjectId}`)).toEqual([
      '10:20', '10:21', '11:20', '11:21',
    ]);
    expect(repository.evaluations.map((evaluation) => evaluation.type)).toEqual(Array(4).fill('composition'));
    expect(repository.evaluations.map((evaluation) => evaluation.coefficient)).toEqual(Array(4).fill(1));
    expect(repository.evaluations.map((evaluation) => evaluation.countInBulletin)).toEqual(Array(4).fill(false));
    expect(repository.evaluations.map((evaluation) => evaluation.date)).toEqual(Array(4).fill(request.startDate));
    expect(repository.evaluations.map((evaluation) => evaluation.generatedName)).toEqual([
      'Composition T1.1',
      'Composition T1.2',
      'Composition T1.1',
      'Composition T1.2',
    ]);
    expect(result.notification.push).toBe('pending');
    expect(result.notification.recipientCount).toBe(2);
  });

  it('uses the default coefficient of 1 and keeps grouped devoirs in the bulletin', async () => {
    const repository = new FakeRepository();
    const result = await publishGroupedEvaluations(repository, {
      schoolId: 4,
      authorUserId: 8,
      request: { ...request, kind: 'devoir', classIds: [10], subjectIds: [20] },
    });

    expect(result.evaluationCount).toBe(1);
    expect(repository.evaluations[0].coefficient).toBe(1);
    expect(repository.evaluations[0].countInBulletin).toBe(true);
  });

  it('persists per class-subject coefficients and rejects invalid values', async () => {
    const repository = new FakeRepository();
    const result = await publishGroupedEvaluations(repository, {
      schoolId: 4,
      authorUserId: 8,
      request: {
        ...request,
        classIds: [10],
        subjectIds: [20, 21],
        coefficientsByPair: {
          '10:20': 2,
          '10:21': 3,
        },
      },
    });

    expect(result.evaluationCount).toBe(2);
    expect(repository.evaluations.map((evaluation) => evaluation.coefficient)).toEqual([2, 3]);

    await expect(publishGroupedEvaluations(repository, {
      schoolId: 4,
      authorUserId: 8,
      request: {
        ...request,
        classIds: [10],
        subjectIds: [20],
        coefficientsByPair: { '10:20': 0 },
      },
    })).rejects.toMatchObject({ code: 'invalid_coefficient' });
  });

  it('rejects custom coefficients for compositions to preserve their prior behavior', async () => {
    const repository = new FakeRepository();

    await expect(publishGroupedEvaluations(repository, {
      schoolId: 4,
      authorUserId: 8,
      request: {
        ...request,
        kind: 'examen',
        classIds: [10],
        subjectIds: [20],
        coefficientsByPair: { '10:20': 2 },
      },
    })).rejects.toMatchObject({ code: 'invalid_coefficient' });
    expect(repository.evaluations).toHaveLength(0);
  });

  it('publishes lycée evaluations in the approved semester and names them S1', async () => {
    const repository = new FakeRepository();
    repository.context = {
      ...context,
      periodType: 'semester',
      periodOrderIndex: 1,
      termsByClass: {
        10: [{
          id: 110,
          startDate: '2026-09-01',
          endDate: '2027-01-31',
          academicYearId: 7,
          periodType: 'semester',
          orderIndex: 1,
        }],
      },
    };

    const result = await publishGroupedEvaluations(repository, {
      schoolId: 4,
      authorUserId: 8,
      request: { ...request, classIds: [10], subjectIds: [20] },
    });

    expect(result.evaluationCount).toBe(1);
    expect(repository.evaluations[0].generatedName).toBe('Devoir S1.1');
  });

  it('rejects a program mixing trimester and semester classes', async () => {
    const repository = new FakeRepository();
    repository.context = {
      ...context,
      termsByClass: {
        10: context.termsByClass[10],
        11: [{
          id: 111,
          startDate: '2026-10-01',
          endDate: '2027-01-31',
          academicYearId: 7,
          periodType: 'semester',
          orderIndex: 1,
        }],
      },
    };

    await expect(publishGroupedEvaluations(repository, {
      schoolId: 4,
      authorUserId: 8,
      request,
    })).rejects.toMatchObject({ code: 'incompatible_terms' });
    expect(repository.records.size).toBe(0);
    expect(repository.evaluations).toHaveLength(0);
  });

  it('rejects semester classes with different period numbers', async () => {
    const repository = new FakeRepository();
    repository.context = {
      ...context,
      periodType: 'semester',
      termsByClass: {
        10: [{
          id: 110,
          startDate: '2026-09-01',
          endDate: '2027-01-31',
          academicYearId: 7,
          periodType: 'semester',
          orderIndex: 1,
        }],
        11: [{
          id: 111,
          startDate: '2026-09-01',
          endDate: '2027-01-31',
          academicYearId: 7,
          periodType: 'semester',
          orderIndex: 2,
        }],
      },
    };

    await expect(publishGroupedEvaluations(repository, {
      schoolId: 4,
      authorUserId: 8,
      request,
    })).rejects.toMatchObject({ code: 'incompatible_terms' });
    expect(repository.records.size).toBe(0);
  });

  it('rejects classes assigned to different academic years', async () => {
    const repository = new FakeRepository();
    repository.context = {
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
          academicYearId: 8,
          periodType: 'trimester',
          orderIndex: 1,
        }],
      },
    };

    await expect(publishGroupedEvaluations(repository, {
      schoolId: 4,
      authorUserId: 8,
      request,
    })).rejects.toMatchObject({ code: 'incompatible_terms' });
    expect(repository.records.size).toBe(0);
  });

  it('rejects a class without a compatible approved period', async () => {
    const repository = new FakeRepository();
    repository.context = {
      ...context,
      termsByClass: { ...context.termsByClass, 11: [] },
    };

    await expect(publishGroupedEvaluations(repository, {
      schoolId: 4,
      authorUserId: 8,
      request,
    })).rejects.toMatchObject({ code: 'period_outside_single_term' });
    expect(repository.records.size).toBe(0);
  });

  it('rejects a class that is not approved for the active school', async () => {
    const repository = new FakeRepository();
    repository.context = { ...context, approvedClassIds: [10] };

    await expect(publishGroupedEvaluations(repository, {
      schoolId: 4,
      authorUserId: 8,
      request,
    })).rejects.toMatchObject({ code: 'class_not_approved' });
    expect(repository.records.size).toBe(0);
  });

  it('assigns a distinct sequence within each class for the shared term', async () => {
    const repository = new FakeRepository();
    await publishGroupedEvaluations(repository, { schoolId: 4, authorUserId: 8, request });

    expect(repository.evaluations.map(({ classId, sequenceNumber }) => `${classId}:${sequenceNumber}`)).toEqual([
      '10:1', '10:2', '11:1', '11:2',
    ]);
  });

  it('refuses invalid class-subject pairs without persisting any records', async () => {
    const repository = new FakeRepository();
    await expect(publishGroupedEvaluations({
      transaction: (work) => repository.transaction((tx) => work({
        ...tx,
        loadContext: async () => ({
          ...context,
          activeTeachingPairs: context.activeTeachingPairs.slice(0, 3),
        }),
      })),
    }, { schoolId: 4, authorUserId: 8, request })).rejects.toMatchObject({
      code: 'invalid_class_subject_pairs',
    });
    expect(repository.records.size).toBe(0);
    expect(repository.evaluations).toHaveLength(0);
  });

  it('rolls back publication, evaluations, notifications, and outbox on a child insert failure', async () => {
    const repository = new FakeRepository();
    repository.failEvaluationAt = 2;
    await expect(publishGroupedEvaluations(repository, {
      schoolId: 4,
      authorUserId: 8,
      request,
    })).rejects.toThrow('test evaluation insert failure');
    expect(repository.records.size).toBe(0);
    expect(repository.evaluations).toHaveLength(0);
    expect(repository.notifications).toHaveLength(0);
    expect(repository.outboxNotificationIds).toHaveLength(0);
  });

  it('deduplicates parent recipients and queues one push outbox item per local notification', async () => {
    const repository = new FakeRepository();
    await publishGroupedEvaluations(repository, { schoolId: 4, authorUserId: 8, request });

    expect(repository.notifications).toHaveLength(2);
    expect(repository.outboxNotificationIds).toHaveLength(2);
    expect(new Set(repository.notifications.map(({ userId }) => userId)).size).toBe(2);
  });

  it('returns the original result for the same key and rejects a different payload', async () => {
    const repository = new FakeRepository();
    const first = await publishGroupedEvaluations(repository, { schoolId: 4, authorUserId: 8, request });
    const retry = await publishGroupedEvaluations(repository, { schoolId: 4, authorUserId: 8, request });

    expect(retry).toEqual(first);
    expect(repository.records.size).toBe(1);
    await expect(publishGroupedEvaluations(repository, {
      schoolId: 4,
      authorUserId: 8,
      request: { ...request, endDate: '2026-11-16' },
    })).rejects.toBeInstanceOf(GroupedEvaluationIdempotencyConflictError);
    await expect(publishGroupedEvaluations(repository, {
      schoolId: 4,
      authorUserId: 8,
      request: { ...request, coefficientsByPair: { '10:20': 2 } },
    })).rejects.toBeInstanceOf(GroupedEvaluationIdempotencyConflictError);
  });

  it('handles concurrent duplicate submissions without creating a second publication', async () => {
    const repository = new FakeRepository();
    const input = { schoolId: 4, authorUserId: 8, request };
    const results = await Promise.all([
      publishGroupedEvaluations(repository, input),
      publishGroupedEvaluations(repository, input),
    ]);

    expect(results[0]).toEqual(results[1]);
    expect(repository.records.size).toBe(1);
    expect(repository.evaluations).toHaveLength(4);
    expect(repository.notifications).toHaveLength(2);
  });
});
