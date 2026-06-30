import type { BulletinDetail, BulletinListFilters, BulletinListResponse } from '../types.ts';

// Client-side name validation utils
const LETTERS_AND_SPACES_REGEX = /^[\p{L} ]+$/u;
const GENERIC_NAME_REGEX = /^[\p{L}0-9 \-_'\/]+$/u;
const DIGITS_REGEX = /\d+/g;

export function validateClientNames(payload: any) {
  if (!payload || typeof payload !== 'object') return null;
  const fields = ['name', 'firstName', 'lastName'];
  for (const field of fields) {
    if (!(field in payload)) continue;
    const v = payload[field];
    if (v == null) continue;
    if (typeof v !== 'string') continue;
    const trimmed = v.trim();
    if (trimmed.length === 0) continue;

    if (field === 'name') {
      if (!GENERIC_NAME_REGEX.test(trimmed)) {
        const err: any = new Error(`Le champ '${field}' contient des caractères invalides. Seules les lettres, chiffres, espaces, tirets, apostrophes et slashs sont autorisés.`);
        err.field = field;
        throw err;
      }
      continue;
    }

    const digits = trimmed.match(DIGITS_REGEX);
    if (digits && digits.length > 0) {
      const unique = Array.from(new Set(digits.join('').split(''))).slice(0, 10).join('');
      const err: any = new Error(`Le champ '${field}' contient des chiffres (${unique}). Seules les lettres et espaces sont autorisés.`);
      err.field = field;
      err.foundDigits = unique;
      throw err;
    }
    if (!LETTERS_AND_SPACES_REGEX.test(trimmed)) {
      const err: any = new Error(`Le champ '${field}' contient des caractères invalides. Seules les lettres et les espaces sont autorisés.`);
      err.field = field;
      throw err;
    }
  }
  return null;
}

// helper to communicate with the full-stack backend
const LOCAL_STORAGE_ROLE_KEY = 'ecoletrack_simulated_role';
const LOCAL_STORAGE_USER_KEY = 'ecoletrack_simulated_user';

function isSuppressedSystemError(message: string): boolean {
  return /Unauthorized:\s*Missing token/i.test(message);
}

export function getUiErrorMessage(error: unknown, fallback?: string): string | null {
  if (error == null) return fallback ?? null;

  if (typeof error === 'string') {
    const message = error.trim();
    if (!message) return fallback ?? null;
    return isSuppressedSystemError(message) ? null : message;
  }

  if (error instanceof Error) {
    const message = error.message?.trim();
    if (!message) return fallback ?? null;
    return isSuppressedSystemError(message) ? null : message;
  }

  if (typeof error === 'object' && 'message' in error) {
    const message = String((error as { message?: unknown }).message ?? '').trim();
    if (!message) return fallback ?? null;
    return isSuppressedSystemError(message) ? null : message;
  }

  return fallback ?? null;
}

export function getSimulatedRole(): string | null {
  return localStorage.getItem(LOCAL_STORAGE_ROLE_KEY) || null;
}

export function setSimulatedRole(role: string) {
  localStorage.setItem(LOCAL_STORAGE_ROLE_KEY, role);
}

export function clearSimulatedRole() {
  localStorage.removeItem(LOCAL_STORAGE_ROLE_KEY);
}

export function getSimulatedUser() {
  try {
    const user = localStorage.getItem(LOCAL_STORAGE_USER_KEY);
    return user ? JSON.parse(user) : null;
  } catch {
    return null;
  }
}

export function setSimulatedUser(user: any) {
  localStorage.setItem(LOCAL_STORAGE_USER_KEY, JSON.stringify(user));
}

export function clearSimulatedUser() {
  localStorage.removeItem(LOCAL_STORAGE_USER_KEY);
}

export function findTeacherProfileFromSimulatedUser(
  currentRole: string,
  simulatedUser: any,
  teachersList: any[],
  usersList: any[] = [],
) {
  if (currentRole !== 'teacher' || !simulatedUser || !teachersList?.length) {
    return undefined;
  }

  const simEmail = typeof simulatedUser.email === 'string'
    ? simulatedUser.email.toLowerCase()
    : null;
  const simUid = simulatedUser.uid ? String(simulatedUser.uid) : null;

  if (simUid) {
    const byUid = teachersList.find((teacher) => teacher.uid && String(teacher.uid) === simUid);
    if (byUid) return byUid;
  }

  if (simEmail) {
    const byEmail = teachersList.find((teacher) => teacher.email && teacher.email.toLowerCase() === simEmail);
    if (byEmail) return byEmail;
  }

  const userIdFromUid = simUid?.startsWith('teacher_')
    ? Number(simUid.split('_')[1])
    : NaN;
  if (!Number.isNaN(userIdFromUid)) {
    const byUserId = teachersList.find((teacher) => String(teacher.userId) === String(userIdFromUid));
    if (byUserId) return byUserId;
  }

  if (usersList?.length) {
    const matchedUser = usersList.find((user) => {
      const matchUid = simUid && String(user.uid) === simUid;
      const matchEmail = simEmail && user.email && user.email.toLowerCase() === simEmail;
      return Boolean(matchUid || matchEmail);
    });
    if (matchedUser) {
      const byUserId = teachersList.find((teacher) => teacher.userId === matchedUser.id);
      if (byUserId) return byUserId;
    }
  }

  return undefined;
}

function getSimulationHeaders(): Record<string, string> {
  const role = getSimulatedRole();

  let headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (!role) return headers;

  const simulatedUser = getSimulatedUser();
  let uid = simulatedUser?.uid ?? 'sim_superadmin_123';
  let email = simulatedUser?.email ?? 'superadmin@ecoletrack.fr';
  let name = simulatedUser?.name ?? 'M. Jean-Marc Super-Admin';
  let schoolId = simulatedUser?.schoolId ? String(simulatedUser.schoolId) : null;

  if (role === 'school_admin') {
    uid = simulatedUser?.uid ?? 'sim_schooladmin_123';
    email = simulatedUser?.email ?? 'valerie.admin@ecoletrack.fr';
    name = simulatedUser?.name ?? 'Directrice Valerie Bertrand';
    schoolId = simulatedUser?.schoolId ? String(simulatedUser.schoolId) : null;
  } else if (role === 'teacher') {
    uid = simulatedUser?.uid ?? 'sim_teacher_123';
    email = simulatedUser?.email ?? 'f.martin.prof@ecoletrack.fr';
    name = simulatedUser?.name ?? 'M. Francois Martin';
    schoolId = simulatedUser?.schoolId ? String(simulatedUser.schoolId) : null;
  } else if (role === 'parent') {
    uid = simulatedUser?.uid ?? 'sim_parent_123';
    email = simulatedUser?.email ?? 'marianne.dubois@gmail.com';
    name = simulatedUser?.name ?? 'Mme. Marianne Dubois';
    schoolId = simulatedUser?.schoolId ? String(simulatedUser.schoolId) : null;
  }

  headers = {
    ...headers,
    'x-simulated-role': role,
    'x-simulated-uid': uid,
    'x-simulated-email': email,
    'x-simulated-name': name,
  };

  if (schoolId) {
    headers['x-simulated-school-id'] = schoolId;
  }

  return headers;
}

// Global api fetcher that transparently injects simulation headers
export async function apiFetch(endpoint: string, options: RequestInit = {}): Promise<any> {
  const headers = getSimulationHeaders();

  const normalizedEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  const baseHeaders = {
    ...headers,
    ...(options.headers || {}),
  } as Record<string, string>;

  const bodyIsString = typeof options.body === 'string';
  if (bodyIsString && !Object.keys(baseHeaders).some((key) => key.toLowerCase() === 'content-type')) {
    baseHeaders['Content-Type'] = 'application/json';
  }

  const mergedOptions = {
    ...options,
    headers: baseHeaders,
  };

  // Client-side validation: if sending JSON body for create/update, validate name fields.
  try {
    const method = (mergedOptions.method || 'GET').toString().toUpperCase();
    const contentType = (mergedOptions.headers as any)?.['Content-Type'] || (mergedOptions.headers as any)?.['content-type'] || '';
    const isClassEndpoint = normalizedEndpoint === '/api/classes' || normalizedEndpoint.startsWith('/api/classes/');

    const isJsonBody = ['POST', 'PUT', 'PATCH'].includes(method) && contentType.includes('application/json') && mergedOptions.body && typeof mergedOptions.body === 'string';
    if (isJsonBody) {
      try {
        const parsed = JSON.parse(mergedOptions.body as string);
        if (!isClassEndpoint) {
          validateClientNames(parsed);
        }

        if (isClassEndpoint && method === 'POST' && parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          parsed.schoolId = parsed.schoolId ?? null;
          mergedOptions.body = JSON.stringify(parsed);
          console.log('🚀 FINAL REQUEST SENT =', parsed);
        }
      } catch (e) {
        if ((e as any).message && (e as any).field) throw e;
        // if JSON parse failed, let the request proceed (server will validate)
      }
    }
  } catch (e) {
    throw e;
  }

  const response = await fetch(normalizedEndpoint, mergedOptions);
  
  if (!response.ok) {
    const errBody = await response.json().catch(() => ({}));
    const error = new Error(errBody.error || `HTTP error! status: ${response.status}`);
    (error as any).status = response.status;
    throw error;
  }

  return response.json();
}

export async function apiFetchBlob(endpoint: string, options: RequestInit = {}): Promise<Blob> {
  console.log('🌐 [apiFetchBlob] Called with endpoint:', endpoint, 'Stack:', new Error().stack);
  const headers = getSimulationHeaders();
  console.log('🔑 [apiFetchBlob] Headers prepared:', Object.keys(headers));

  const normalizedEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  const mergedHeaders = {
    ...headers,
    ...(options.headers || {}),
  } as Record<string, string>;

  // Keep all headers including Content-Type to preserve authentication headers
  // (getSimulationHeaders() may be the only source of auth in development)
  const mergedOptions = {
    ...options,
    headers: mergedHeaders,
  };

  console.log('📡 [apiFetchBlob] Sending fetch to:', normalizedEndpoint);
  const response = await fetch(normalizedEndpoint, mergedOptions);
  console.log('📨 [apiFetchBlob] Response status:', response.status);

  if (!response.ok) {
    const errBody = await response.json().catch(() => ({}));
    const error = new Error(errBody.error || `HTTP error! status: ${response.status}`);
    (error as any).status = response.status;
    throw error;
  }

  return response.blob();
}

export async function fetchBulletinsList(filters: BulletinListFilters): Promise<BulletinListResponse> {
  const params = new URLSearchParams();
  params.set('page', String(filters.page));
  params.set('pageSize', String(filters.pageSize));
  if (filters.classId) params.set('classId', String(filters.classId));
  if (filters.studentId) params.set('studentId', String(filters.studentId));
  if (filters.termId) params.set('termId', String(filters.termId));

  return apiFetch(`/api/bulletins?${params.toString()}`);
}

export async function fetchBulletinDetail(id: number): Promise<BulletinDetail> {
  return apiFetch(`/api/bulletins/${id}`);
}

export async function generateBulletin(studentId: number, termId: number): Promise<{ id?: number }> {
  return apiFetch('/api/bulletins/generate', {
    method: 'POST',
    body: JSON.stringify({ studentId, termId }),
  });
}

export async function downloadBulletinPdf(id: number): Promise<Blob> {
  return apiFetchBlob(`/api/bulletins/${id}/pdf`);
}

// Expose a small helper so UI components can read the simulated school id
// (used in the sandbox to default selects for school_admin/teacher/parent)
export function getSimulatedSchoolId(): number | null {
  const user = getSimulatedUser();
  if (!user) return null;
  // accept numeric or string schoolId
  const sid = user.schoolId ?? user.school?.id ?? null;
  if (!sid) return null;
  return typeof sid === 'number' ? sid : parseInt(sid, 10);
}
