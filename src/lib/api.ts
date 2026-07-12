import type { BulletinDetail, BulletinListFilters, BulletinListResponse } from '../types.ts';

// Client-side name validation utils
const NAME_CHARACTERS_REGEX = /^[\p{L}\p{N} '’().&/\-]+$/u;

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
    if (!NAME_CHARACTERS_REGEX.test(trimmed)) {
      const err: any = new Error(`Le champ '${field}' contient des caractères invalides. Seules les lettres, les chiffres et les espaces sont autorisés.`);
      err.field = field;
      throw err;
    }
  }
  return null;
}

// helper to communicate with the full-stack backend
const LOCAL_STORAGE_ROLE_KEY = 'ecoletrack_simulated_role';
const LOCAL_STORAGE_USER_KEY = 'ecoletrack_simulated_user';
const LOCAL_STORAGE_ACTIVE_SCHOOL_KEY = 'ecoletrack_active_school_id';
const LOCAL_STORAGE_ACCESS_TOKEN_KEY = 'ecoletrack_jwt_access';
const API_BASE_URL = typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_BASE_URL
  ? String(import.meta.env.VITE_API_BASE_URL)
  : '';

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

export function isUnauthorizedError(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === 'object' &&
    ((error as any).status === 401 || (error as any).isUnauthorized === true)
  );
}

export function getSimulatedRole(): string | null {
  if (typeof localStorage === 'undefined') return null;
  return localStorage.getItem(LOCAL_STORAGE_ROLE_KEY) || null;
}

export function setSimulatedRole(role: string) {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(LOCAL_STORAGE_ROLE_KEY, role);
}

export function clearSimulatedRole() {
  if (typeof localStorage === 'undefined') return;
  localStorage.removeItem(LOCAL_STORAGE_ROLE_KEY);
}

export function getSimulatedUser() {
  if (typeof localStorage === 'undefined') return null;
  try {
    const user = localStorage.getItem(LOCAL_STORAGE_USER_KEY);
    return user ? JSON.parse(user) : null;
  } catch {
    return null;
  }
}

export function setSimulatedUser(user: any) {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(LOCAL_STORAGE_USER_KEY, JSON.stringify(user));
  // Emit custom event so all components can sync without props drilling
  try {
    window.dispatchEvent(new CustomEvent('simulatedUserChanged', { detail: user }));
  } catch (e) {
    console.warn('Failed to dispatch simulatedUserChanged event:', e);
  }
}

export function clearSimulatedUser() {
  if (typeof localStorage === 'undefined') return;
  localStorage.removeItem(LOCAL_STORAGE_USER_KEY);
  localStorage.removeItem(LOCAL_STORAGE_ACTIVE_SCHOOL_KEY);
}

export function getActiveSchoolId(): number | null {
  if (typeof localStorage === 'undefined') return null;
  const value = localStorage.getItem(LOCAL_STORAGE_ACTIVE_SCHOOL_KEY);
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function setActiveSchoolId(schoolId: number | null) {
  if (typeof localStorage === 'undefined') return;
  if (schoolId == null) {
    localStorage.removeItem(LOCAL_STORAGE_ACTIVE_SCHOOL_KEY);
    return;
  }
  localStorage.setItem(LOCAL_STORAGE_ACTIVE_SCHOOL_KEY, String(schoolId));
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
  const currentSchoolId = getActiveSchoolId() ?? (simulatedUser?.schoolId != null ? Number(simulatedUser.schoolId) : null);
  const sameSchoolTeachers = currentSchoolId == null
    ? teachersList
    : teachersList.filter((teacher) => {
        const teacherSchoolId = teacher?.schoolId != null ? Number(teacher.schoolId) : null;
        return teacherSchoolId == null || teacherSchoolId === currentSchoolId;
      });
  const candidates = sameSchoolTeachers.length > 0 ? sameSchoolTeachers : teachersList;

  if (simUid) {
    const byUid = candidates.find((teacher) => teacher.uid && String(teacher.uid) === simUid);
    if (byUid) return byUid;
  }

  if (simEmail) {
    const byEmail = candidates.find((teacher) => teacher.email && teacher.email.toLowerCase() === simEmail);
    if (byEmail) return byEmail;
  }

  const userIdFromUid = simUid?.startsWith('teacher_')
    ? Number(simUid.split('_')[1])
    : NaN;
  if (!Number.isNaN(userIdFromUid)) {
    const byUserId = candidates.find((teacher) => String(teacher.userId) === String(userIdFromUid));
    if (byUserId) return byUserId;
  }

  if (usersList?.length) {
    const matchedUser = usersList.find((user) => {
      const matchUid = simUid && String(user.uid) === simUid;
      const matchEmail = simEmail && user.email && user.email.toLowerCase() === simEmail;
      return Boolean(matchUid || matchEmail);
    });
    if (matchedUser) {
      const byUserId = candidates.find((teacher) => teacher.userId === matchedUser.id);
      if (byUserId) return byUserId;
    }
  }

  return undefined;
}

export function getSimulationHeaders(): Record<string, string> {
  const role = getSimulatedRole();

  let headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (!role) return headers;

  const simulatedUser = getSimulatedUser();
  const activeSchoolId = getActiveSchoolId();
  let uid = simulatedUser?.uid ?? 'sim_superadmin_123';
  let email = simulatedUser?.email ?? 'superadmin@ecoletrack.fr';
  let name = simulatedUser?.name ?? 'M. Jean-Marc Super-Admin';
  let schoolId = activeSchoolId != null ? String(activeSchoolId) : (simulatedUser?.schoolId ? String(simulatedUser.schoolId) : null);

  if (role === 'school_admin') {
    uid = simulatedUser?.uid ?? 'sim_schooladmin_123';
    email = simulatedUser?.email ?? 'valerie.admin@ecoletrack.fr';
    name = simulatedUser?.name ?? 'Directrice Valerie Bertrand';
    schoolId = activeSchoolId != null ? String(activeSchoolId) : (simulatedUser?.schoolId ? String(simulatedUser.schoolId) : null);
  } else if (role === 'teacher') {
    uid = simulatedUser?.uid ?? 'sim_teacher_123';
    email = simulatedUser?.email ?? 'f.martin.prof@ecoletrack.fr';
    name = simulatedUser?.name ?? 'M. Francois Martin';
    schoolId = activeSchoolId != null ? String(activeSchoolId) : (simulatedUser?.schoolId ? String(simulatedUser.schoolId) : null);
  } else if (role === 'parent') {
    uid = simulatedUser?.uid ?? 'sim_parent_123';
    email = simulatedUser?.email ?? 'marianne.dubois@gmail.com';
    name = simulatedUser?.name ?? 'Mme. Marianne Dubois';
    schoolId = activeSchoolId != null ? String(activeSchoolId) : (simulatedUser?.schoolId ? String(simulatedUser.schoolId) : null);
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
  const storedAccessToken = localStorage.getItem(LOCAL_STORAGE_ACCESS_TOKEN_KEY);
  if (storedAccessToken) {
    headers.Authorization = `Bearer ${storedAccessToken}`;
  }

  const normalizedEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  const apiUrl = API_BASE_URL ? `${API_BASE_URL}${normalizedEndpoint}` : normalizedEndpoint;
  const mergedOptions = {
    ...options,
    headers: {
      ...headers,
      ...(options.headers || {}),
    },
  };

  // Client-side validation: if sending JSON body for create/update, validate name fields.
  try {
    const method = (mergedOptions.method || 'GET').toString().toUpperCase();
    const contentType = (mergedOptions.headers as any)?.['Content-Type'] || (mergedOptions.headers as any)?.['content-type'] || '';
    const isClassEndpoint = normalizedEndpoint === '/api/classes' || normalizedEndpoint.startsWith('/api/classes/');
    const isSchoolTermsEndpoint = normalizedEndpoint === '/api/school-terms' || normalizedEndpoint.startsWith('/api/school-terms/');
    const isAcademicYearsEndpoint = normalizedEndpoint === '/api/academic-years' || normalizedEndpoint.startsWith('/api/academic-years/');

    const isJsonBody = ['POST', 'PUT', 'PATCH'].includes(method) && contentType.includes('application/json') && mergedOptions.body && typeof mergedOptions.body === 'string';
    if (isJsonBody) {
      try {
        const parsed = JSON.parse(mergedOptions.body as string);
        if (!isClassEndpoint && !isSchoolTermsEndpoint && !isAcademicYearsEndpoint) {
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

  const response = await fetch(apiUrl, mergedOptions);
  
  if (!response.ok) {
    const errBody = await response.json().catch(() => ({}));
    const error = new Error(errBody.error || `HTTP error! status: ${response.status}`);
    (error as any).status = response.status;
    if (response.status === 401) {
      (error as any).isUnauthorized = true;
    }
    throw error;
  }

  return response.json();
}

export async function apiFetchBlob(endpoint: string, options: RequestInit = {}): Promise<Blob> {
  const headers = getSimulationHeaders();
  const normalizedEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  const apiUrl = API_BASE_URL ? `${API_BASE_URL}${normalizedEndpoint}` : normalizedEndpoint;
  const mergedHeaders = {
    ...headers,
    ...(options.headers || {}),
  } as Record<string, string>;

  if (mergedHeaders['Content-Type']) {
    delete mergedHeaders['Content-Type'];
  }

  const response = await fetch(apiUrl, {
    ...options,
    headers: mergedHeaders,
  });

  if (!response.ok) {
    const errBody = await response.json().catch(() => ({}));
    const error = new Error(errBody.error || `HTTP error! status: ${response.status}`);
    (error as any).status = response.status;
    if (response.status === 401) {
      (error as any).isUnauthorized = true;
    }
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

export async function downloadBulletinsPdfBatch(ids: number[]): Promise<Blob> {
  const uniqueIds = Array.from(new Set(ids.filter((id) => Number.isInteger(id) && id > 0)));
  if (uniqueIds.length === 0) throw new Error('Aucun bulletin sélectionné');
  const params = new URLSearchParams();
  params.set('ids', uniqueIds.join(','));
  return apiFetchBlob(`/api/bulletins/pdf/batch?${params.toString()}`);
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
