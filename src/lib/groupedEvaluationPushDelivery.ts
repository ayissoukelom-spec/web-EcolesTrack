export type GroupedPushOutcome = 'sent' | 'retryable_failure' | 'permanent_failure' | 'no_subscription';

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
  category: 'evaluation';
  metadata: {
    target: 'homework' | 'absence';
    notificationId: number;
    publicationId: number;
  };
  dedupeKey: string;
  groupedDelivery: true;
}

export function isGroupedPushDeliveryEnabled(environment: Record<string, string | undefined>): boolean {
  return environment.GROUPED_EVALUATION_PUBLICATIONS_ENABLED === 'true'
    && environment.GROUPED_EVALUATION_PUSH_ENABLED === 'true';
}

export function getGroupedPushDeliveryIdempotencyKey(delivery: GroupedPushDeliveryRecord): string | null {
  if (delivery.publicationId != null) {
    return `grouped-publication-${delivery.publicationId}-notification-${delivery.notificationId}`;
  }
  return delivery.dedupeKey?.startsWith('late-arrival-justification-')
    ? delivery.dedupeKey
    : null;
}

export function buildGroupedPushNotificationPayload(
  delivery: GroupedPushDeliveryRecord,
  idempotencyKey: string,
): GroupedPushNotificationPayload {
  const isLateArrivalJustification = delivery.publicationId == null;
  return {
    parentId: String(delivery.userId),
    title: delivery.title,
    message: delivery.body,
    category: 'evaluation',
    metadata: {
      target: isLateArrivalJustification ? 'absence' : 'homework',
      notificationId: delivery.notificationId,
      publicationId: delivery.publicationId ?? delivery.notificationId,
    },
    dedupeKey: idempotencyKey,
    groupedDelivery: true,
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
): Promise<{ claimed: number; sent: number; retrying: number; failed: number; uncertain: number }> {
  const now = options.now ?? (() => new Date());
  const maxAttempts = options.maxAttempts ?? 8;
  const claimed = await repository.claimDue(options.batchSize ?? 20, now());
  const summary = { claimed: claimed.length, sent: 0, retrying: 0, failed: 0, uncertain: 0 };

  for (const delivery of claimed) {
    const idempotencyKey = getGroupedPushDeliveryIdempotencyKey(delivery);
    if (!idempotencyKey) {
      await repository.markFailed(
        delivery.id,
        delivery.attemptCount,
        'Outbox record is not a supported grouped publication or late-arrival justification notification.',
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
