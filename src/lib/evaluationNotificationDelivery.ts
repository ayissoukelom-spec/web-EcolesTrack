export interface EvaluationNotificationPayload {
  parentId: number | string;
  title: string;
  message: string;
  category: 'evaluation';
  metadata: Record<string, unknown>;
  dedupeKey: string;
}

export interface GroupedEvaluationNotificationRecipient {
  userId: number;
  title: string;
  body: string;
}

export function buildGroupedEvaluationNotificationPayloads(
  publicationId: number,
  evaluationIds: number[],
  recipients: GroupedEvaluationNotificationRecipient[],
): EvaluationNotificationPayload[] {
  const uniqueRecipients = new Map<number, GroupedEvaluationNotificationRecipient>();
  for (const recipient of recipients) {
    if (!uniqueRecipients.has(recipient.userId)) uniqueRecipients.set(recipient.userId, recipient);
  }

  return [...uniqueRecipients.values()].map((recipient) => ({
    parentId: recipient.userId,
    title: recipient.title,
    message: recipient.body,
    category: 'evaluation',
    metadata: {
      target: 'homework',
      publicationId,
      evaluationIds,
    },
    dedupeKey: `evaluation-publication-${publicationId}-${recipient.userId}`,
  }));
}

export async function sendEvaluationNotification(
  payload: object,
  apiUrl: string,
  signPayload: (payload: unknown) => { signature: string; timestamp: string },
  fetcher: typeof fetch,
): Promise<Response> {
  const { signature, timestamp } = signPayload(payload);
  return fetcher(`${apiUrl}/api/internal/evaluation-notification`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Internal-Signature': signature,
      'X-Internal-Timestamp': timestamp,
    },
    body: JSON.stringify(payload),
  });
}
