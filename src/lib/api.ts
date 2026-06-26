import type { BulletinDetail, BulletinListFilters, BulletinListResponse } from '../types.ts';

// helper to communicate with the full-stack backend
const LOCAL_STORAGE_ROLE_KEY = 'ecoletrack_simulated_role';
const LOCAL_STORAGE_USER_KEY = 'ecoletrack_simulated_user';

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
  const mergedOptions = {
    ...options,
    headers: {
      ...headers,
      ...(options.headers || {}),
    },
  };

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
  const headers = getSimulationHeaders();
  const normalizedEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  const mergedHeaders = {
    ...headers,
    ...(options.headers || {}),
  } as Record<string, string>;

  if (mergedHeaders['Content-Type']) {
    delete mergedHeaders['Content-Type'];
  }

  const response = await fetch(normalizedEndpoint, {
    ...options,
    headers: mergedHeaders,
  });

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
