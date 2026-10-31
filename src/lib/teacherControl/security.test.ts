import { describe, expect, it } from 'vitest';
import {
  getTeacherControlDocumentPermissionsPolicy,
  isTeacherControlTeacherDocumentRequest,
  isTeacherControlGpsEnabled,
  TEACHER_CONTROL_APP_PERMISSIONS_POLICY,
  TEACHER_CONTROL_DEFAULT_PERMISSIONS_POLICY,
  TEACHER_CONTROL_TEACHER_DOCUMENT_PATH,
  TEACHER_CONTROL_TEACHER_PERMISSIONS_POLICY,
} from './security.ts';

describe('teacher control geolocation policy scope', () => {
  it('keeps the existing default policy restrictive and grants only on the dedicated GET document', () => {
    expect(TEACHER_CONTROL_DEFAULT_PERMISSIONS_POLICY).toBe('geolocation=(), microphone=(), camera=()');
    expect(TEACHER_CONTROL_APP_PERMISSIONS_POLICY).toBe('geolocation=(self), microphone=(), camera=()');
    expect(TEACHER_CONTROL_TEACHER_PERMISSIONS_POLICY).toBe('geolocation=(self), microphone=(), camera=()');
    expect(isTeacherControlTeacherDocumentRequest('GET', TEACHER_CONTROL_TEACHER_DOCUMENT_PATH)).toBe(true);
    expect(isTeacherControlTeacherDocumentRequest('POST', TEACHER_CONTROL_TEACHER_DOCUMENT_PATH)).toBe(false);
    expect(isTeacherControlTeacherDocumentRequest('GET', '/teacher-control/admin')).toBe(false);
    expect(isTeacherControlTeacherDocumentRequest('GET', `${TEACHER_CONTROL_TEACHER_DOCUMENT_PATH}/`)).toBe(false);
    expect(isTeacherControlTeacherDocumentRequest('GET', `${TEACHER_CONTROL_TEACHER_DOCUMENT_PATH}?next=/`)).toBe(false);
  });

  it('grants the browser capability only when valid school GPS settings are enabled', () => {
    expect(isTeacherControlGpsEnabled({
      isEnabled: true,
      latitude: '6.1375',
      longitude: '1.2123',
    })).toBe(true);
    expect(isTeacherControlGpsEnabled({
      isEnabled: false,
      latitude: '6.1375',
      longitude: '1.2123',
    })).toBe(false);
    expect(isTeacherControlGpsEnabled({
      isEnabled: true,
      latitude: null,
      longitude: '1.2123',
    })).toBe(false);
    expect(isTeacherControlGpsEnabled({
      isEnabled: true,
      latitude: 91,
      longitude: 1,
    })).toBe(false);
  });

  it('only replaces the restrictive policy for the enabled teacher document', () => {
    const gpsSettings = { isEnabled: true, latitude: '6.1375', longitude: '1.2123' };
    expect(getTeacherControlDocumentPermissionsPolicy({
      method: 'GET',
      path: TEACHER_CONTROL_TEACHER_DOCUMENT_PATH,
      role: 'teacher',
      gpsSettings,
    })).toBe(TEACHER_CONTROL_TEACHER_PERMISSIONS_POLICY);
    expect(getTeacherControlDocumentPermissionsPolicy({
      method: 'GET',
      path: TEACHER_CONTROL_TEACHER_DOCUMENT_PATH,
      role: 'surveillant',
      gpsSettings,
    })).toBeNull();
    expect(getTeacherControlDocumentPermissionsPolicy({
      method: 'GET',
      path: '/dashboard',
      role: 'teacher',
      gpsSettings,
    })).toBeNull();
    expect(getTeacherControlDocumentPermissionsPolicy({
      method: 'GET',
      path: TEACHER_CONTROL_TEACHER_DOCUMENT_PATH,
      role: 'teacher',
      gpsSettings: { ...gpsSettings, isEnabled: false },
    })).toBeNull();
  });
});
