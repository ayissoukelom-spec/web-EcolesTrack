import { describe, expect, it } from 'vitest';
import {
  isTuitionProgressReminderInAppNotificationsEnabled,
  isTuitionProgressReminderPushNotificationsEnabled,
  isTuitionProgressReminderRuntimeEnabled,
} from './tuitionProgressReminderRuntime.ts';

describe('tuition progress reminder runtime activation gate', () => {
  it('is disabled unless both the feature and the schedule confirmation are explicit', () => {
    expect(isTuitionProgressReminderRuntimeEnabled({})).toBe(false);
    expect(isTuitionProgressReminderRuntimeEnabled({
      ECOLETRACK_TUITION_PROGRESS_REMINDERS_ENABLED: 'true',
    })).toBe(false);
    expect(isTuitionProgressReminderRuntimeEnabled({
      ECOLETRACK_TUITION_PROGRESS_REMINDERS_0800_CONFIRMED: 'true',
    })).toBe(false);
    expect(isTuitionProgressReminderRuntimeEnabled({
      ECOLETRACK_TUITION_PROGRESS_REMINDERS_ENABLED: 'true',
      ECOLETRACK_TUITION_PROGRESS_REMINDERS_0800_CONFIRMED: 'true',
    })).toBe(true);
  });

  it('keeps in-app notifications disabled until their separate explicit gate is enabled', () => {
    const runtimeEnabled = {
      ECOLETRACK_TUITION_PROGRESS_REMINDERS_ENABLED: 'true',
      ECOLETRACK_TUITION_PROGRESS_REMINDERS_0800_CONFIRMED: 'true',
    };
    expect(isTuitionProgressReminderInAppNotificationsEnabled(runtimeEnabled)).toBe(false);
    expect(isTuitionProgressReminderInAppNotificationsEnabled({
      ...runtimeEnabled,
      ECOLETRACK_TUITION_PROGRESS_REMINDERS_IN_APP_NOTIFICATIONS_ENABLED: 'true',
    })).toBe(true);
  });

  it('keeps push disabled unless runtime, in-app, and push gates are all explicit', () => {
    const enabled = {
      ECOLETRACK_TUITION_PROGRESS_REMINDERS_ENABLED: 'true',
      ECOLETRACK_TUITION_PROGRESS_REMINDERS_0800_CONFIRMED: 'true',
      ECOLETRACK_TUITION_PROGRESS_REMINDERS_IN_APP_NOTIFICATIONS_ENABLED: 'true',
    };
    expect(isTuitionProgressReminderPushNotificationsEnabled(enabled)).toBe(false);
    expect(isTuitionProgressReminderPushNotificationsEnabled({
      ...enabled,
      ECOLETRACK_TUITION_PROGRESS_REMINDERS_PUSH_ENABLED: 'true',
    })).toBe(true);
  });
});
