import { createHmac } from 'node:crypto';
import type {
  TuitionProgressReminderPushClaim,
  TuitionProgressReminderPushTransportResult,
} from './tuitionProgressReminderPush.ts';

type PushApiResult = {
  status: string;
  acceptedDeviceCount?: number;
  error?: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value != null && typeof value === 'object' && !Array.isArray(value);

const parseApiResult = (value: unknown): PushApiResult | null => {
  if (!isRecord(value) || typeof value.status !== 'string') return null;
  return {
    status: value.status,
    acceptedDeviceCount: typeof value.acceptedDeviceCount === 'number' ? value.acceptedDeviceCount : undefined,
    error: typeof value.error === 'string' ? value.error : undefined,
  };
};

export const createTuitionProgressReminderPushTransport = (input: {
  endpoint: string;
  internalSecret: string;
  testDelivery?: {
    deviceId: string;
    simulatedNow: Date;
  };
  fetcher?: typeof fetch;
  clock?: () => Date;
}): ((claim: TuitionProgressReminderPushClaim) => Promise<TuitionProgressReminderPushTransportResult>) => {
  const endpoint = input.endpoint.trim().replace(/\/+$/, '');
  let parsedEndpoint: URL;
  try {
    parsedEndpoint = new URL(endpoint);
  } catch {
    throw new Error('A valid internal push endpoint and secret are required.');
  }
  const hostname = parsedEndpoint.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const isLoopback = hostname === 'localhost'
    || hostname.endsWith('.localhost')
    || hostname === '::1'
    || /^127(?:\.\d{1,3}){3}$/.test(hostname);
  if ((parsedEndpoint.protocol !== 'https:' && !(parsedEndpoint.protocol === 'http:' && isLoopback))
    || parsedEndpoint.username !== ''
    || parsedEndpoint.password !== ''
    || parsedEndpoint.search !== ''
    || parsedEndpoint.hash !== ''
    || !input.internalSecret.trim()) {
    throw new Error('A valid internal push endpoint and secret are required.');
  }
  if (input.testDelivery
    && (!/^\d{1,32}$/.test(input.testDelivery.deviceId)
      || !(input.testDelivery.simulatedNow instanceof Date)
      || !Number.isFinite(input.testDelivery.simulatedNow.getTime()))) {
    throw new Error('A valid local test device and simulated timestamp are required.');
  }
  const fetcher = input.fetcher ?? fetch;
  const clock = input.clock ?? (() => new Date());

  return async (claim) => {
    const payload = {
      parentId: String(claim.userId),
      notificationId: claim.notificationId,
      title: claim.title,
      body: claim.body,
      dedupeKey: claim.dedupeKey,
      controlId: claim.controlId,
      schoolId: claim.schoolId,
      academicYearId: claim.academicYearId,
      cycleId: claim.cycleId,
      studentId: claim.studentId,
      scheduledAt: claim.scheduledAt.toISOString(),
      expiresAt: claim.expiresAt.toISOString(),
      timeZone: claim.timeZone,
      ...(input.testDelivery ? {
        testDeviceId: input.testDelivery.deviceId,
        simulationNow: input.testDelivery.simulatedNow.toISOString(),
      } : {}),
    };
    const body = JSON.stringify(payload);
    const now = clock();
    if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
      throw new Error('The internal push transport clock returned an invalid timestamp.');
    }
    const timestamp = String(now.getTime());
    const signature = createHmac('sha256', input.internalSecret)
      .update(`${body}${timestamp}`)
      .digest('hex');
    const response = await fetcher(`${endpoint}/api/internal/tuition-progress-push`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Signature': signature,
        'X-Internal-Timestamp': timestamp,
      },
      body,
    });

    if (response.status === 429 || response.status === 503) {
      return { status: 'retryable_failure', error: `push_relay_http_${response.status}` };
    }
    if (!response.ok) {
      return response.status >= 500
        ? { status: 'uncertain', error: `push_relay_http_${response.status}` }
        : { status: 'permanent_failure', error: `push_relay_http_${response.status}` };
    }

    let result: PushApiResult | null = null;
    try {
      result = parseApiResult(await response.json());
    } catch {
      return { status: 'uncertain', error: 'push_relay_invalid_response' };
    }
    if (!result) return { status: 'uncertain', error: 'push_relay_invalid_response' };
    if (result.status === 'fcm_accepted'
      && Number.isSafeInteger(result.acceptedDeviceCount)
      && Number(result.acceptedDeviceCount) > 0) {
      return { status: 'fcm_accepted', acceptedDeviceCount: Number(result.acceptedDeviceCount) };
    }
    if (result.status === 'deferred') return { status: 'deferred' };
    if (result.status === 'retryable_failure') {
      return { status: 'retryable_failure', error: result.error ?? result.status };
    }
    if (result.status === 'uncertain') return { status: 'uncertain', error: result.error ?? result.status };
    if (result.status === 'no_subscription' || result.status === 'permanent_failure') {
      return { status: 'permanent_failure', error: result.error ?? result.status };
    }
    return { status: 'uncertain', error: 'push_relay_invalid_response' };
  };
};
