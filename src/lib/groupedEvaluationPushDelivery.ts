export type GroupedPushOutcome = 'sent' | 'queued' | 'retryable_failure' | 'permanent_failure' | 'no_subscription';

export interface GroupedPushDeliveryRecord {
  id: number;
  notificationId: number;
  attemptCount: number;
  userId: number;
  title: string;
  body: string;
  publicationId: number | null;
  dedupeKey: string | null;
}

export interface ClaimedGroupedPushDelivery extends GroupedPushDeliveryRecord {
  attemptCount: number;
}

export interface GroupedPushDeliveryRepository {
  claimDue(limit: number, now: Date): Promise<ClaimedGroupedPushDelivery[]>;
  markSent(id: number, attemptCount: number, sentAt: Date): Promise<void>;
  markFailed(id: number, attemptCount: number, error: string, updatedAt: Date): Promise<void>;
  scheduleRetry(id: number, attemptCount: number, error: string, nextAttemptAt: Date, updatedAt: Date): Promise<void>;
  markAwaitingConfirmation(id: number, attemptCount: number, detail: string, updatedAt: Date): Promise<void>;
  markUncertain(id: number, attemptCount: number, error: string, updatedAt: Date): Promise<void>;
}

export interface GroupedPushDeliveryTransport {
  send(
    delivery: GroupedPushDeliveryRecord,
    idempotencyKey: string,
  ): Promise<{ outcome: GroupedPushOutcome; error?: string }>;
}

export interface GroupedPushDeliveryOptions {
  now?: () => Date;
  batchSize?: number;
  maxAttempts?: number;
  baseRetryDelayMs?: number;
  maxRetryDelayMs?: number;
}

export interface GroupedPushNotificationPayload {
  parentId: string;
  title: string;
  message: string;
  category: 'absence';
  metadata: {
    target: 'absence';
    notificationId: number;
  };
  dedupeKey: string;
}

export function resolveMobileApiBaseUrl(apiUrl: string | undefined, nodeEnv: string | undefined): string {
  const configuredUrl = apiUrl?.trim();
  const baseUrl = configuredUrl || (
    nodeEnv === 'development' || nodeEnv === 'test'
      ? 'http://localhost:3001'
      : ''
  );
  if (!baseUrl) {
    throw new Error('API_URL must be configured outside local development.');
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(baseUrl);
  } catch {
    throw new Error('API_URL must be an absolute HTTP or HTTPS URL.');
  }
  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    throw new Error('API_URL must use HTTP or HTTPS.');
  }

  const hostname = parsedUrl.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const isLoopback = hostname === 'localhost'
    || hostname.endsWith('.localhost')
    || hostname === 'localhost.'
    || hostname === '::1'
    || /^127(?:\.\d{1,3}){3}$/.test(hostname);
  if (isLoopback && nodeEnv !== 'development' && nodeEnv !== 'test') {
    throw new Error('API_URL cannot target localhost outside local development.');
  }

  return baseUrl.replace(/\/+$/, '');
}

export function getGroupedPushDeliveryIdempotencyKey(delivery: GroupedPushDeliveryRecord): string | null {
  return delivery.publicationId == null && delivery.dedupeKey?.startsWith('late-arrival-justification-')
    ? delivery.dedupeKey
    : null;
}

export function buildGroupedPushNotificationPayload(
  delivery: GroupedPushDeliveryRecord,
  idempotencyKey: string,
): GroupedPushNotificationPayload {
  return {
    parentId: String(delivery.userId),
    title: delivery.title,
    message: delivery.body,
    category: 'absence',
    metadata: {
      target: 'absence',
      notificationId: delivery.notificationId,
    },
    dedupeKey: idempotencyKey,
  };
}

export function getInternalNotificationDispatchOutcome(response: unknown): {
  outcome: GroupedPushOutcome;
  error?: string;
} {
  if (!response || typeof response !== 'object') {
    throw new Error('Push API response did not contain a notification dispatch result.');
  }

  const body = response as {
    success?: unknown;
    result?: {
      success?: unknown;
      channels?: unknown;
      jobs?: unknown;
    } | null;
  };
  if (body.success !== true || body.result?.success !== true) {
    throw new Error('Push API did not accept the notification dispatch.');
  }

  if (!Array.isArray(body.result.channels) || !Array.isArray(body.result.jobs)) {
    throw new Error('Push API response did not contain valid channels and job identifiers.');
  }
  if (!body.result.channels.includes('push')) {
    return {
      outcome: 'no_subscription',
      error: 'The parent has no enabled push channel or registered device.',
    };
  }

  const jobIds = body.result.jobs.filter((job): job is string => typeof job === 'string');
  if (jobIds.length === 0 || jobIds.length !== body.result.jobs.length) {
    throw new Error('Push API reported a push channel without valid accepted job identifiers.');
  }

  return {
    outcome: 'queued',
    error: `Push API accepted job(s) ${jobIds.join(', ')}; FCM completion was not reported.`,
  };
}

const errorText = (message: string | undefined, fallback: string) =>
  (message?.trim() || fallback).slice(0, 1000);

export function groupedPushRetryDelayMs(
  attemptCount: number,
  baseDelayMs = 60_000,
  maxDelayMs = 6 * 60 * 60 * 1000,
): number {
  return Math.min(baseDelayMs * (2 ** Math.max(0, attemptCount - 1)), maxDelayMs);
}

export async function processGroupedPushOutboxBatch(
  repository: GroupedPushDeliveryRepository,
  transport: GroupedPushDeliveryTransport,
  options: GroupedPushDeliveryOptions = {},
): Promise<{ claimed: number; sent: number; queued: number; retrying: number; failed: number; uncertain: number }> {
  const now = options.now ?? (() => new Date());
  const maxAttempts = options.maxAttempts ?? 8;
  const claimed = await repository.claimDue(options.batchSize ?? 20, now());
  const summary = { claimed: claimed.length, sent: 0, queued: 0, retrying: 0, failed: 0, uncertain: 0 };

  for (const delivery of claimed) {
    const idempotencyKey = getGroupedPushDeliveryIdempotencyKey(delivery);
    if (!idempotencyKey) {
      await repository.markFailed(
        delivery.id,
        delivery.attemptCount,
        'Outbox record is not a supported late-arrival justification notification.',
        now(),
      );
      summary.failed += 1;
      continue;
    }

    let result: Awaited<ReturnType<GroupedPushDeliveryTransport['send']>>;
    try {
      result = await transport.send(delivery, idempotencyKey);
    } catch (error) {
      await repository.markUncertain(
        delivery.id,
        delivery.attemptCount,
        errorText(error instanceof Error ? error.message : undefined, 'Delivery outcome is unknown.'),
        now(),
      );
      summary.uncertain += 1;
      continue;
    }

    if (result.outcome === 'sent') {
      await repository.markSent(delivery.id, delivery.attemptCount, now());
      summary.sent += 1;
    } else if (result.outcome === 'queued') {
      await repository.markAwaitingConfirmation(
        delivery.id,
        delivery.attemptCount,
        errorText(result.error, 'Push API accepted the request; FCM completion is unconfirmed.'),
        now(),
      );
      summary.queued += 1;
    } else if (result.outcome === 'permanent_failure' || result.outcome === 'no_subscription') {
      await repository.markFailed(
        delivery.id,
        delivery.attemptCount,
        errorText(result.error, result.outcome === 'no_subscription'
          ? 'No authorized push subscription is available.'
          : 'Push delivery was permanently rejected.'),
        now(),
      );
      summary.failed += 1;
    } else if (delivery.attemptCount >= maxAttempts) {
      await repository.markFailed(
        delivery.id,
        delivery.attemptCount,
        errorText(result.error, 'Maximum push delivery attempts reached.'),
        now(),
      );
      summary.failed += 1;
    } else {
      const retryAt = new Date(now().getTime() + groupedPushRetryDelayMs(
        delivery.attemptCount,
        options.baseRetryDelayMs,
        options.maxRetryDelayMs,
      ));
      await repository.scheduleRetry(
        delivery.id,
        delivery.attemptCount,
        errorText(result.error, 'Temporary push delivery failure.'),
        retryAt,
        now(),
      );
      summary.retrying += 1;
    }
  }

  return summary;
}
