export const TEACHER_CONTROL_TEACHER_DOCUMENT_PATH = '/teacher-control/teacher';
export const TEACHER_CONTROL_DOCUMENT_AUTH_COOKIE = 'ecoletrack_teacher_document_auth';
export const TEACHER_CONTROL_DOCUMENT_AUTH_COOKIE_MAX_AGE_SECONDS = 60;
export const TEACHER_CONTROL_DEFAULT_PERMISSIONS_POLICY = 'geolocation=(), microphone=(), camera=()';
export const TEACHER_CONTROL_APP_PERMISSIONS_POLICY = 'geolocation=(self), microphone=(), camera=()';
export const TEACHER_CONTROL_TEACHER_PERMISSIONS_POLICY = 'geolocation=(self), microphone=(), camera=()';

export function isTeacherControlTeacherDocumentRequest(method: string, path: string): boolean {
  return method.toUpperCase() === 'GET' && path === TEACHER_CONTROL_TEACHER_DOCUMENT_PATH;
}

export function isTeacherControlGpsEnabled(settings: {
  isEnabled: boolean;
  latitude: string | number | null;
  longitude: string | number | null;
} | null | undefined): boolean {
  if (!settings?.isEnabled || settings.latitude == null || settings.longitude == null) return false;
  const latitude = Number(settings.latitude);
  const longitude = Number(settings.longitude);
  return Number.isFinite(latitude) && latitude >= -90 && latitude <= 90
    && Number.isFinite(longitude) && longitude >= -180 && longitude <= 180;
}

export function getTeacherControlDocumentPermissionsPolicy(input: {
  method: string;
  path: string;
  role: string;
  gpsSettings: Parameters<typeof isTeacherControlGpsEnabled>[0];
}): string | null {
  if (!isTeacherControlTeacherDocumentRequest(input.method, input.path)
    || input.role !== 'teacher'
    || !isTeacherControlGpsEnabled(input.gpsSettings)) {
    return null;
  }
  return TEACHER_CONTROL_TEACHER_PERMISSIONS_POLICY;
}
