import { describe, expect, it } from 'vitest';
import {
  GroupedEvaluationIdempotencyConflictError,
  isAuthorizedGroupedPublicationActor,
  publishGroupedEvaluations,
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
    date: string;
    type: string;
  }> = [];
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
        loadContext: async () => context,
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
            date: input.date,
            type: input.type,
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
    expect(repository.evaluations.map((evaluation) => evaluation.date)).toEqual(Array(4).fill(request.startDate));
    expect(result.notification.push).toBe('pending');
    expect(result.notification.recipientCount).toBe(2);
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
