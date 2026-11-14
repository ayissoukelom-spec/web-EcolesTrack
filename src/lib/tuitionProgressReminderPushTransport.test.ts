import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  createTuitionProgressReminderPushTransport,
} from './tuitionProgressReminderPushTransport.ts';
import type { TuitionProgressReminderPushClaim } from './tuitionProgressReminderPush.ts';

const claim: TuitionProgressReminderPushClaim = {
  outboxId: 71,
  attemptCount: 1,
  notificationId: 81,
  userId: 91,
  title: 'Rappel de scolarité',
  body: 'Cher parent, voici la situation des versements : 90 000 FCFA.',
  dedupeKey: 'tuition-progress-reminder:101',
  controlId: 101,
  schoolId: 7,
  academicYearId: 23,
  cycleId: 4,
  studentId: 31,
  monthStart: '2027-07-01',
  scheduledAt: new Date('2027-07-16T08:00:00.000Z'),
  expiresAt: new Date('2027-07-16T22:59:59.999Z'),
  timeZone: 'Africa/Lome',
};

const response = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('tuition progress reminder push relay client', () => {
  it('signs the exact JSON request for the authenticated push-only route', async () => {
    let requestedUrl = '';
    let requestInit: RequestInit | undefined;
    const fetcher: typeof fetch = async (input, init) => {
      requestedUrl = String(input);
      requestInit = init;
      return response({ status: 'fcm_accepted', acceptedDeviceCount: 1 });
    };
    const send = createTuitionProgressReminderPushTransport({
      endpoint: 'https://mobile.example.test/',
      internalSecret: 'test-secret',
      fetcher,
      clock: () => new Date('2027-07-16T10:00:00.000Z'),
    });

    await expect(send(claim)).resolves.toEqual({
      status: 'fcm_accepted',
      acceptedDeviceCount: 1,
    });
    expect(requestedUrl).toBe('https://mobile.example.test/api/internal/tuition-progress-push');
    const body = String(requestInit?.body);
    const timestamp = String(new Date('2027-07-16T10:00:00.000Z').getTime());
    const signature = createHmac('sha256', 'test-secret')
      .update(`${body}${timestamp}`)
      .digest('hex');
    expect(requestInit?.headers).toMatchObject({
      'X-Internal-Signature': signature,
      'X-Internal-Timestamp': timestamp,
    });
    expect(JSON.parse(body)).toMatchObject({
      parentId: '91',
      notificationId: 81,
      title: claim.title,
      body: claim.body,
      dedupeKey: 'tuition-progress-reminder:101',
      controlId: 101,
      schoolId: 7,
      studentId: 31,
    });
  });

  it('preserves deferred and uncertain relay outcomes without marking delivery', async () => {
    const deferred = createTuitionProgressReminderPushTransport({
      endpoint: 'https://mobile.example.test',
      internalSecret: 'test-secret',
      fetcher: vi.fn(async () => response({ status: 'deferred' })),
    });

    const uncertain = createTuitionProgressReminderPushTransport({
      endpoint: 'https://mobile.example.test',
      internalSecret: 'test-secret',
      fetcher: vi.fn(async () => response({ status: 'uncertain', error: 'result_unknown' })),
    });

    await expect(deferred(claim)).resolves.toEqual({ status: 'deferred' });
    await expect(uncertain(claim)).resolves.toEqual({
      status: 'uncertain',
      error: 'result_unknown',
    });
  });

  it('adds a simulated clock and one target device only for an explicitly configured local test transport', async () => {
    let sentBody = '';
    const send = createTuitionProgressReminderPushTransport({
      endpoint: 'http://127.0.0.1:3001',
      internalSecret: 'test-secret',
      testDelivery: {
        deviceId: '42',
        simulatedNow: new Date('2027-07-16T08:00:00.000Z'),
      },
      fetcher: async (_input, init) => {
        sentBody = String(init?.body);
        return response({ status: 'fcm_accepted', acceptedDeviceCount: 1 });
      },
      clock: () => new Date('2026-11-14T07:00:00.000Z'),
    });

    await expect(send(claim)).resolves.toMatchObject({ status: 'fcm_accepted' });
    expect(JSON.parse(sentBody)).toMatchObject({
      testDeviceId: '42',
      simulationNow: '2027-07-16T08:00:00.000Z',
    });
  });

  it('retries explicit rate limiting but treats a lost server response as uncertain', async () => {
    const rateLimited = createTuitionProgressReminderPushTransport({
      endpoint: 'https://mobile.example.test',
      internalSecret: 'test-secret',
      fetcher: vi.fn(async () => response({}, 429)),
    });
    const lostResponse = createTuitionProgressReminderPushTransport({
      endpoint: 'https://mobile.example.test',
      internalSecret: 'test-secret',
      fetcher: vi.fn(async () => response({}, 500)),
    });

    await expect(rateLimited(claim)).resolves.toEqual({
      status: 'retryable_failure',
      error: 'push_relay_http_429',
    });
    await expect(lostResponse(claim)).resolves.toEqual({
      status: 'uncertain',
      error: 'push_relay_http_500',
    });
  });
});
