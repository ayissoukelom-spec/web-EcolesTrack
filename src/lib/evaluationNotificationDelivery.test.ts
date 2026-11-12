import { describe, expect, it, vi } from 'vitest';
import {
  buildGroupedEvaluationNotificationPayloads,
  sendEvaluationNotification,
} from './evaluationNotificationDelivery';

describe('evaluation notification delivery', () => {
  it('creates one standard homework notification per distinct grouped recipient', () => {
    const payloads = buildGroupedEvaluationNotificationPayloads(12, [41, 42], [
      { userId: 501, title: 'Nouveau programme de devoirs', body: 'Programme du 12 au 15 novembre.' },
      { userId: 501, title: 'duplicate', body: 'duplicate' },
      { userId: 502, title: 'Nouveau programme de devoirs', body: 'Programme du 12 au 15 novembre.' },
    ]);

    expect(payloads).toEqual([
      {
        parentId: 501,
        title: 'Nouveau programme de devoirs',
        message: 'Programme du 12 au 15 novembre.',
        category: 'evaluation',
        metadata: { target: 'homework', publicationId: 12, evaluationIds: [41, 42] },
        dedupeKey: 'evaluation-publication-12-501',
      },
      {
        parentId: 502,
        title: 'Nouveau programme de devoirs',
        message: 'Programme du 12 au 15 novembre.',
        category: 'evaluation',
        metadata: { target: 'homework', publicationId: 12, evaluationIds: [41, 42] },
        dedupeKey: 'evaluation-publication-12-502',
      },
    ]);
  });

  it('sends grouped exam announcements through the same evaluation notification channel', () => {
    const [payload] = buildGroupedEvaluationNotificationPayloads(13, [51], [
      {
        userId: 503,
        title: 'Nouveau programme d’examens',
        body: 'Un programme d’examens est prévu. Encouragez votre enfant à se préparer !',
      },
    ]);

    expect(payload).toEqual({
      parentId: 503,
      title: 'Nouveau programme d’examens',
      message: 'Un programme d’examens est prévu. Encouragez votre enfant à se préparer !',
      category: 'evaluation',
      metadata: { target: 'homework', publicationId: 13, evaluationIds: [51] },
      dedupeKey: 'evaluation-publication-13-503',
    });
  });

  it('uses the existing internal evaluation-notification route and preserves individual payloads', async () => {
    const payload = {
      parentId: 501,
      title: 'Nouveau devoir à venir : Devoir 1',
      message: 'Un devoir a été programmé.',
      category: 'evaluation',
      metadata: { target: 'homework', evaluationId: 41, classId: 10 },
      dedupeKey: 'evaluation-41-501',
    };
    const signPayload = vi.fn(() => ({ signature: 'signed-payload', timestamp: '12345' }));
    const fetcher = vi.fn(async () => new Response(null, { status: 200 }));

    await sendEvaluationNotification(
      payload,
      'http://127.0.0.1:3001',
      signPayload,
      fetcher,
    );

    expect(signPayload).toHaveBeenCalledWith(payload);
    expect(fetcher).toHaveBeenCalledWith(
      'http://127.0.0.1:3001/api/internal/evaluation-notification',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-Signature': 'signed-payload',
          'X-Internal-Timestamp': '12345',
        },
        body: JSON.stringify(payload),
      }),
    );
  });
});
