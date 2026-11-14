import { describe, expect, it } from 'vitest';
import {
  getLocalTuitionProgressReminderTestConfiguration,
  getLocalTuitionReminderSimulationInstant,
  isLocalTuitionReminderTestDatabaseIdentity,
  matchesLocalTuitionProgressReminderTestTarget,
  parseLocalTuitionProgressReminderTestTargets,
  shouldRetainLocalTuitionProgressReminderTestControl,
} from './localTuitionProgressReminderTest.ts';

const validEnvironment = {
  ECOLETRACK_LOCAL_TUITION_REMINDER_TEST_ENABLED: 'true',
  ECOLETRACK_LOCAL_TUITION_REMINDER_TEST_DATABASE_NAME: 'ecoletrack',
  ECOLETRACK_LOCAL_TUITION_REMINDER_TEST_TARGETS: '[{"schoolId":1,"studentId":2,"parentUserId":3,"deviceId":"12345"}]',
  NODE_ENV: 'development',
  SQL_HOST: '127.0.0.1',
  SQL_DB_NAME: 'ecoletrack',
  API_URL: 'http://localhost:5000',
  INTERNAL_SECRET: 'local-only-secret',
};

describe('local tuition reminder test configuration', () => {
  it('allows the explicitly approved local database name and rejects staging or production environments', () => {
    expect(getLocalTuitionProgressReminderTestConfiguration(validEnvironment).enabled).toBe(true);

    for (const override of [
      { NODE_ENV: 'production' },
      { SQL_HOST: 'db.example.com' },
      { SQL_DB_NAME: 'ecoletrack_staging', ECOLETRACK_LOCAL_TUITION_REMINDER_TEST_DATABASE_NAME: 'ecoletrack_staging' },
      { SQL_DB_NAME: 'ecoletrack_production', ECOLETRACK_LOCAL_TUITION_REMINDER_TEST_DATABASE_NAME: 'ecoletrack_production' },
      { API_URL: 'https://mobile.example.com' },
      { ECOLETRACK_LOCAL_TUITION_REMINDER_TEST_ENABLED: 'false' },
    ]) {
      expect(getLocalTuitionProgressReminderTestConfiguration({
        ...validEnvironment,
        ...override,
      }).enabled).toBe(false);
    }
  });

  it('reports the specific missing or unsafe local prerequisite', () => {
    expect(getLocalTuitionProgressReminderTestConfiguration({
      ...validEnvironment,
      ECOLETRACK_LOCAL_TUITION_REMINDER_TEST_DATABASE_NAME: '',
    }).reason).toBe('database_name_not_approved');
    expect(getLocalTuitionProgressReminderTestConfiguration({
      ...validEnvironment,
      ECOLETRACK_TUITION_PROGRESS_REMINDERS_ENABLED: 'true',
      ECOLETRACK_TUITION_PROGRESS_REMINDERS_0800_CONFIRMED: 'true',
    }).reason).toBe('global_reminder_runtime_enabled');
  });

  it('keeps the panel environment available but disables sending when targets are not configured', () => {
    const configuration = getLocalTuitionProgressReminderTestConfiguration({
      ...validEnvironment,
      ECOLETRACK_LOCAL_TUITION_REMINDER_TEST_TARGETS: undefined,
    });

    expect(configuration.availableLocally).toBe(true);
    expect(configuration.enabled).toBe(false);
    expect(configuration.reason).toBe('test_targets_not_configured');
    expect(configuration.targets).toEqual([]);
  });

  it('rejects malformed, duplicate or incomplete test target allowlists', () => {
    expect(parseLocalTuitionProgressReminderTestTargets('{')).toEqual([]);
    expect(parseLocalTuitionProgressReminderTestTargets('[]')).toEqual([]);
    expect(parseLocalTuitionProgressReminderTestTargets(
      '[{"schoolId":1,"studentId":2,"parentUserId":3,"deviceId":"not-numeric"}]',
    )).toEqual([]);
    const duplicate = '[{"schoolId":1,"studentId":2,"parentUserId":3,"deviceId":"12345"},'
      + '{"schoolId":1,"studentId":2,"parentUserId":3,"deviceId":"12345"}]';
    expect(parseLocalTuitionProgressReminderTestTargets(duplicate)).toEqual([]);
  });

  it('matches the complete school, student, parent and device tuple', () => {
    const [target] = parseLocalTuitionProgressReminderTestTargets(
      validEnvironment.ECOLETRACK_LOCAL_TUITION_REMINDER_TEST_TARGETS,
    );
    expect(matchesLocalTuitionProgressReminderTestTarget(target, target)).toBe(true);
    expect(matchesLocalTuitionProgressReminderTestTarget(target, { ...target, deviceId: '54321' })).toBe(false);
  });

  it('does not leave retryable test controls available to the general reminder runtime', () => {
    expect(shouldRetainLocalTuitionProgressReminderTestControl([{ status: 'retry_pending' }])).toBe(false);
    expect(shouldRetainLocalTuitionProgressReminderTestControl([{ status: 'deferred' }])).toBe(false);
    expect(shouldRetainLocalTuitionProgressReminderTestControl([{ status: 'uncertain' }])).toBe(true);
    expect(shouldRetainLocalTuitionProgressReminderTestControl([{ status: 'lease_lost' }])).toBe(true);
  });

  it('creates an end-of-month 08:00 instant in the school timezone without changing the clock', () => {
    const instant = getLocalTuitionReminderSimulationInstant('2026-11-01', 'Africa/Lome');
    expect(instant?.toISOString()).toBe('2026-11-30T08:00:00.000Z');
    expect(getLocalTuitionReminderSimulationInstant('2026-13-01', 'Africa/Lome')).toBeNull();
  });

  it('accepts IPv4 and IPv6 loopback addresses with or without full-length CIDR masks', () => {
    for (const serverAddress of [
      '127.0.0.1',
      '127.0.0.1/32',
      '::1',
      '::1/128',
      '0:0:0:0:0:0:0:1/128',
    ]) {
      expect(isLocalTuitionReminderTestDatabaseIdentity({
        databaseName: 'ecoletrack',
        serverAddress,
      }, 'ecoletrack')).toBe(true);
    }

    for (const serverAddress of ['10.0.0.4', '127.0.0.1/24', '::2', '::1/64', null]) {
      expect(isLocalTuitionReminderTestDatabaseIdentity({
        databaseName: 'ecoletrack',
        serverAddress,
      }, 'ecoletrack')).toBe(false);
    }
    expect(isLocalTuitionReminderTestDatabaseIdentity({
      databaseName: 'ecoletrack',
      serverAddress: '::1',
    }, 'another_database')).toBe(false);
    expect(isLocalTuitionReminderTestDatabaseIdentity({
      databaseName: 'ecoletrack',
      serverAddress: '::1',
    }, ' ecoletrack ')).toBe(true);
  });
});
