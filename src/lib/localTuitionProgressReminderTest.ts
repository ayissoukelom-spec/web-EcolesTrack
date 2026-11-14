import { localDateTimeInTimeZoneToInstant } from './tuitionProgressReminderSchedule.ts';

export type LocalTuitionProgressReminderTestTarget = {
  schoolId: number;
  studentId: number;
  parentUserId: number;
  deviceId: string;
};

export type LocalTuitionProgressReminderTestConfiguration = {
  availableLocally: boolean;
  enabled: boolean;
  reason: string | null;
  targets: LocalTuitionProgressReminderTestTarget[];
};

const isPositiveSafeInteger = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Number(value) > 0;

const isLoopbackHost = (value: string | undefined): boolean => {
  const host = value?.trim().toLowerCase().replace(/^\[|\]$/g, '');
  return host === 'localhost' || host === '127.0.0.1' || host === '::1';
};

export const isLoopbackPostgresAddress = (value: string | null | undefined): boolean => {
  const address = value?.trim().toLowerCase();
  if (!address) return false;
  const parsedAddress = /^([^/]+)(?:\/(\d+))?$/.exec(address);
  if (!parsedAddress) return false;
  const host = parsedAddress[1];
  const prefix = parsedAddress[2] ?? null;
  if (host === '::1' || host === '0:0:0:0:0:0:0:1') {
    return prefix === null || prefix === '128';
  }
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  return Boolean((prefix === null || prefix === '32')
    && ipv4
    && Number(ipv4[1]) === 127
    && ipv4.slice(2).every((octet) => Number(octet) >= 0 && Number(octet) <= 255));
};

export const isLocalTuitionReminderTestDatabaseIdentity = (
  identity: { databaseName: string | null; serverAddress: string | null },
  expectedDatabaseName: string | undefined,
): boolean => typeof expectedDatabaseName === 'string'
  && expectedDatabaseName.trim() !== ''
  && identity.databaseName === expectedDatabaseName.trim()
  && isLoopbackPostgresAddress(identity.serverAddress);

export const parseLocalTuitionProgressReminderTestTargets = (
  value: string | undefined,
): LocalTuitionProgressReminderTestTarget[] => {
  if (!value?.trim()) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const targets: LocalTuitionProgressReminderTestTarget[] = [];
  for (const candidate of parsed) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return [];
    const target = candidate as Record<string, unknown>;
    if (!isPositiveSafeInteger(target.schoolId)
      || !isPositiveSafeInteger(target.studentId)
      || !isPositiveSafeInteger(target.parentUserId)
      || typeof target.deviceId !== 'string'
      || !/^\d{1,32}$/.test(target.deviceId)) return [];
    const normalized = {
      schoolId: target.schoolId,
      studentId: target.studentId,
      parentUserId: target.parentUserId,
      deviceId: target.deviceId.trim(),
    };
    if (targets.some((existing) =>
      existing.schoolId === normalized.schoolId
      && existing.studentId === normalized.studentId
      && existing.parentUserId === normalized.parentUserId
      && existing.deviceId === normalized.deviceId)) return [];
    targets.push(normalized);
  }
  return targets;
};

export const getLocalTuitionProgressReminderTestConfiguration = (
  environment: Record<string, string | undefined>,
): LocalTuitionProgressReminderTestConfiguration => {
  const targets = parseLocalTuitionProgressReminderTestTargets(
    environment.ECOLETRACK_LOCAL_TUITION_REMINDER_TEST_TARGETS,
  );
  const databaseName = environment.SQL_DB_NAME?.trim() ?? '';
  const approvedDatabaseName = environment.ECOLETRACK_LOCAL_TUITION_REMINDER_TEST_DATABASE_NAME?.trim() ?? '';
  let localApiUrl: URL | null = null;
  try {
    localApiUrl = new URL(environment.API_URL ?? '');
  } catch {
    localApiUrl = null;
  }

  const databaseIsNotProductionOrStaging = !/(?:prod|production|stag|staging)/i.test(databaseName);
  const apiIsLoopback = localApiUrl != null
    && localApiUrl.protocol === 'http:'
    && isLoopbackHost(localApiUrl.hostname)
    && localApiUrl.username === ''
    && localApiUrl.password === ''
    && localApiUrl.search === ''
    && localApiUrl.hash === '';

  const globalRuntimeDisabled = !(environment.ECOLETRACK_TUITION_PROGRESS_REMINDERS_ENABLED === 'true'
    && environment.ECOLETRACK_TUITION_PROGRESS_REMINDERS_0800_CONFIRMED === 'true');
  const localEnvironmentChecks: Array<[boolean, string]> = [
    [environment.NODE_ENV === 'development', 'development_mode_required'],
    [isLoopbackHost(environment.SQL_HOST), 'sql_host_not_local'],
    [databaseName !== '', 'sql_database_name_missing'],
    [approvedDatabaseName === databaseName, 'database_name_not_approved'],
    [databaseIsNotProductionOrStaging, 'production_or_staging_database_name_rejected'],
    [apiIsLoopback, 'api_url_not_loopback'],
    [globalRuntimeDisabled, 'global_reminder_runtime_enabled'],
  ];
  const localEnvironmentFailure = localEnvironmentChecks.find(([passed]) => !passed)?.[1] ?? null;
  const availableLocally = localEnvironmentFailure == null;
  const checks: Array<[boolean, string]> = [
    [availableLocally, localEnvironmentFailure ?? 'not_an_isolated_local_environment'],
    [environment.ECOLETRACK_LOCAL_TUITION_REMINDER_TEST_ENABLED === 'true', 'local_test_not_enabled'],
    [Boolean(environment.INTERNAL_SECRET?.trim()), 'internal_secret_missing'],
    [targets.length > 0, 'test_targets_not_configured'],
  ];
  const failedCheck = checks.find(([passed]) => !passed);
  return {
    availableLocally,
    enabled: !failedCheck,
    reason: failedCheck?.[1] ?? null,
    targets,
  };
};

export const matchesLocalTuitionProgressReminderTestTarget = (
  target: LocalTuitionProgressReminderTestTarget,
  selection: LocalTuitionProgressReminderTestTarget,
): boolean => target.schoolId === selection.schoolId
  && target.studentId === selection.studentId
  && target.parentUserId === selection.parentUserId
  && target.deviceId === selection.deviceId;

export const shouldRetainLocalTuitionProgressReminderTestControl = (
  outcomes: readonly { status: string }[],
): boolean => outcomes.some(({ status }) => status === 'uncertain' || status === 'lease_lost');

export const getLocalTuitionReminderSimulationInstant = (
  monthStart: string,
  timeZone: string,
): Date | null => {
  const match = /^(\d{4})-(0[1-9]|1[0-2])-01$/.exec(monthStart);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const date = `${match[1]}-${match[2]}-${String(lastDay).padStart(2, '0')}`;
  return localDateTimeInTimeZoneToInstant(date, 8, 0, timeZone);
};

