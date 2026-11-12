import { describe, expect, it, vi } from 'vitest';
import {
  buildGroupedPushNotificationPayload,
  getInternalNotificationDispatchOutcome,
  getGroupedPushDeliveryIdempotencyKey,
  groupedPushRetryDelayMs,
  processGroupedPushOutboxBatch,
  resolveMobileApiBaseUrl,
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

  async markAwaitingConfirmation(_id: number, attemptCount: number, detail: string) {
    if (this.status === 'sending' && this.attemptCount === attemptCount) this.lastError = detail;
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
      category: 'absence',
      metadata: { target: 'absence', notificationId: 20 },
      dedupeKey: 'late-arrival-justification-42-revision-3',
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

  it('accepts the response contract returned by the existing absence notification API', () => {
    expect(getInternalNotificationDispatchOutcome({
      success: true,
      result: { success: true, channels: ['push'], jobs: ['queued-1'] },
    })).toEqual({
      outcome: 'queued',
      error: 'Push API accepted job(s) queued-1; FCM completion was not reported.',
    });

    expect(getInternalNotificationDispatchOutcome({
      success: true,
      result: { success: true, channels: [], jobs: [] },
    })).toMatchObject({ outcome: 'no_subscription' });
  });

  it('keeps accepted jobs unconfirmed and does not submit them a second time', async () => {
    const repository = new FakeRepository();
    const send = vi.fn(async () => ({
      outcome: 'queued' as const,
      error: 'API accepted job-1; awaiting FCM result',
    }));

    await expect(processGroupedPushOutboxBatch(repository, { send })).resolves.toMatchObject({
      claimed: 1,
      queued: 1,
      sent: 0,
    });
    expect(repository.status).toBe('sending');
    expect(repository.lastError).toContain('awaiting FCM result');

    await expect(processGroupedPushOutboxBatch(repository, { send })).resolves.toMatchObject({
      claimed: 0,
      queued: 0,
    });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('uses the configured API URL and only defaults localhost in local or test mode', () => {
    expect(resolveMobileApiBaseUrl(undefined, 'development')).toBe('http://localhost:3001');
    expect(resolveMobileApiBaseUrl(undefined, 'test')).toBe('http://localhost:3001');
    expect(resolveMobileApiBaseUrl('https://staging-api.example.test/', 'production'))
      .toBe('https://staging-api.example.test');
    expect(resolveMobileApiBaseUrl('https://production-api.example.test', 'production'))
      .toBe('https://production-api.example.test');
    expect(() => resolveMobileApiBaseUrl(undefined, 'production')).toThrow('API_URL must be configured');
    expect(() => resolveMobileApiBaseUrl(undefined, 'staging')).toThrow('API_URL must be configured');
    expect(() => resolveMobileApiBaseUrl('http://localhost:3001', 'production'))
      .toThrow('API_URL cannot target localhost');
    expect(() => resolveMobileApiBaseUrl('http://127.0.0.2:3001', 'production'))
      .toThrow('API_URL cannot target localhost');
    expect(() => getInternalNotificationDispatchOutcome({
      success: true,
      result: { success: true, channels: ['push'], jobs: [] },
    })).toThrow('Push API reported a push channel without valid accepted job identifiers.');

    expect(() => getInternalNotificationDispatchOutcome({
      success: false,
      result: { success: false, channels: [], jobs: [] },
    })).toThrow('Push API did not accept the notification dispatch.');
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

  it('does not dispatch when a failed transaction produced no committed outbox row', async () => {
    const repository = new FakeRepository();
    vi.spyOn(repository, 'claimDue').mockResolvedValue([]);
    const send = vi.fn(async () => ({ outcome: 'sent' as const }));

    await expect(processGroupedPushOutboxBatch(repository, { send })).resolves.toMatchObject({
      claimed: 0,
      sent: 0,
    });
    expect(send).not.toHaveBeenCalled();
  });
});
