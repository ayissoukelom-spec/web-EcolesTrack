import { describe, expect, it, vi } from 'vitest';
import {
  buildGroupedPushNotificationPayload,
  getGroupedPushDeliveryIdempotencyKey,
  groupedPushRetryDelayMs,
  isGroupedPushDeliveryEnabled,
  processGroupedPushOutboxBatch,
  type ClaimedGroupedPushDelivery,
  type GroupedPushDeliveryRepository,
  type GroupedPushDeliveryTransport,
} from './groupedEvaluationPushDelivery';

const row: ClaimedGroupedPushDelivery = {
  id: 1,
  notificationId: 20,
  attemptCount: 1,
  userId: 7,
  title: 'Nouveau programme',
  body: 'Programme annoncé',
  publicationId: null,
  dedupeKey: 'late-arrival-justification-42-revision-3',
};

class FakeRepository implements GroupedPushDeliveryRepository {
  status: 'pending' | 'sending' | 'sent' | 'failed' = 'pending';
  attemptCount = 0;
  nextAttemptAt = new Date(0);
  lastError: string | null = null;
  private lock = Promise.resolve();

  async claimDue(_limit: number, now: Date) {
    const previousLock = this.lock;
    let release!: () => void;
    this.lock = new Promise<void>((resolve) => { release = resolve; });
    await previousLock;
    try {
      if (this.status !== 'pending' || this.nextAttemptAt > now) return [];
      this.status = 'sending';
      this.attemptCount += 1;
      return [{ ...row, attemptCount: this.attemptCount }];
    } finally {
      release();
    }
  }

  async markSent(_id: number, attemptCount: number) {
    if (this.status === 'sending' && this.attemptCount === attemptCount) this.status = 'sent';
  }

  async markFailed(_id: number, attemptCount: number, error: string) {
    if (this.status === 'sending' && this.attemptCount === attemptCount) {
      this.status = 'failed';
      this.lastError = error;
    }
  }

  async scheduleRetry(_id: number, attemptCount: number, error: string, nextAttemptAt: Date) {
    if (this.status === 'sending' && this.attemptCount === attemptCount) {
      this.status = 'pending';
      this.lastError = error;
      this.nextAttemptAt = nextAttemptAt;
    }
  }

  async markUncertain(_id: number, attemptCount: number, error: string) {
    if (this.status === 'sending' && this.attemptCount === attemptCount) this.lastError = error;
  }
}

describe('grouped push outbox processor', () => {
  it('does not deliver grouped evaluation publications through the push outbox', async () => {
    const repository = new FakeRepository();
    const publicationDelivery: ClaimedGroupedPushDelivery = {
      ...row,
      publicationId: 3,
      dedupeKey: 'grouped-publication-3-notification-20',
    };
    vi.spyOn(repository, 'claimDue').mockImplementation(async () => {
      repository.status = 'sending';
      repository.attemptCount = 1;
      return [publicationDelivery];
    });
    const send = vi.fn(async () => ({ outcome: 'sent' as const }));

    expect(getGroupedPushDeliveryIdempotencyKey(publicationDelivery)).toBeNull();
    await expect(processGroupedPushOutboxBatch(repository, { send })).resolves.toMatchObject({
      claimed: 1,
      failed: 1,
    });
    expect(send).not.toHaveBeenCalled();
  });

  it('supports late-arrival justification rows without a publication id using push-only routing', () => {
    const justificationDelivery: ClaimedGroupedPushDelivery = {
      ...row,
      publicationId: null,
      dedupeKey: 'late-arrival-justification-42-revision-3',
    };
    const idempotencyKey = getGroupedPushDeliveryIdempotencyKey(justificationDelivery);

    expect(idempotencyKey).toBe('late-arrival-justification-42-revision-3');
    expect(buildGroupedPushNotificationPayload(justificationDelivery, idempotencyKey!)).toEqual({
      parentId: '7',
      title: 'Nouveau programme',
      message: 'Programme annoncé',
      category: 'evaluation',
      metadata: { target: 'absence', notificationId: 20, publicationId: 20 },
      dedupeKey: 'late-arrival-justification-42-revision-3',
      groupedDelivery: true,
    });
  });

  it('fails unsupported non-publication outbox rows closed without dispatching', async () => {
    const repository = new FakeRepository();
    const unsupportedDelivery: ClaimedGroupedPushDelivery = {
      ...row,
      publicationId: null,
      dedupeKey: 'unrelated-notification',
    };
    vi.spyOn(repository, 'claimDue').mockImplementation(async () => {
      repository.status = 'sending';
      repository.attemptCount = 1;
      return [unsupportedDelivery];
    });
    const send = vi.fn(async () => ({ outcome: 'sent' as const }));

    await expect(processGroupedPushOutboxBatch(repository, { send })).resolves.toMatchObject({
      claimed: 1,
      failed: 1,
    });
    expect(send).not.toHaveBeenCalled();
    expect(repository.status).toBe('failed');
  });

  it('remains disabled unless both grouped publication and push flags are explicitly enabled', () => {
    expect(isGroupedPushDeliveryEnabled({})).toBe(false);
    expect(isGroupedPushDeliveryEnabled({ GROUPED_EVALUATION_PUBLICATIONS_ENABLED: 'true' })).toBe(false);
    expect(isGroupedPushDeliveryEnabled({
      GROUPED_EVALUATION_PUBLICATIONS_ENABLED: 'true',
      GROUPED_EVALUATION_PUSH_ENABLED: 'true',
    })).toBe(true);
  });

  it('marks sent only after the transport confirms provider success', async () => {
    const repository = new FakeRepository();
    const transport: GroupedPushDeliveryTransport = {
      send: async () => ({ outcome: 'sent' }),
    };

    await expect(processGroupedPushOutboxBatch(repository, transport)).resolves.toMatchObject({
      claimed: 1,
      sent: 1,
    });
    expect(repository.status).toBe('sent');
  });

  it('retries temporary failures with bounded exponential delay', async () => {
    const repository = new FakeRepository();
    const transport: GroupedPushDeliveryTransport = {
      send: async () => ({ outcome: 'retryable_failure', error: 'FCM unavailable' }),
    };

    await processGroupedPushOutboxBatch(repository, transport, {
      now: () => new Date(1_000),
      baseRetryDelayMs: 100,
      maxRetryDelayMs: 500,
    });

    expect(repository.status).toBe('pending');
    expect(repository.nextAttemptAt.getTime()).toBe(1_100);
    expect(repository.lastError).toBe('FCM unavailable');
    expect(groupedPushRetryDelayMs(8, 100, 500)).toBe(500);
  });

  it('marks permanent provider errors and missing subscriptions as terminal', async () => {
    for (const outcome of ['permanent_failure', 'no_subscription'] as const) {
      const repository = new FakeRepository();
      await processGroupedPushOutboxBatch(repository, { send: async () => ({ outcome }) });
      expect(repository.status).toBe('failed');
      expect(repository.lastError).toBeTruthy();
    }
  });

  it('does not claim the same row concurrently', async () => {
    const repository = new FakeRepository();
    let sends = 0;
    const transport: GroupedPushDeliveryTransport = {
      send: async () => {
        sends += 1;
        await new Promise((resolve) => setTimeout(resolve, 5));
        return { outcome: 'sent' };
      },
    };

    const summaries = await Promise.all([
      processGroupedPushOutboxBatch(repository, transport),
      processGroupedPushOutboxBatch(repository, transport),
    ]);

    expect(sends).toBe(1);
    expect(summaries.reduce((total, item) => total + item.claimed, 0)).toBe(1);
  });

  it('uses the same notification idempotency key on retry attempts', async () => {
    const repository = new FakeRepository();
    const keys: string[] = [];
    const transport: GroupedPushDeliveryTransport = {
      send: async (_delivery, key) => {
        keys.push(key);
        return keys.length === 1
          ? { outcome: 'retryable_failure' }
          : { outcome: 'sent' };
      },
    };

    await processGroupedPushOutboxBatch(repository, transport, { now: () => new Date(0) });
    await processGroupedPushOutboxBatch(repository, transport, {
      now: () => new Date(repository.nextAttemptAt.getTime()),
    });

    expect(keys).toEqual([
      'late-arrival-justification-42-revision-3',
      'late-arrival-justification-42-revision-3',
    ]);
    expect(repository.status).toBe('sent');
  });

  it('leaves ambiguous network outcomes in sending instead of risking a duplicate', async () => {
    const repository = new FakeRepository();
    await processGroupedPushOutboxBatch(repository, {
      send: async () => { throw new Error('Socket closed after request submission'); },
    });

    expect(repository.status).toBe('sending');
    expect(repository.lastError).toContain('Socket closed');
  });
});
