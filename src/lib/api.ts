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

// Global api fetcher that transparently injects simulation headers
export async function apiFetch(endpoint: string, options: RequestInit = {}): Promise<any> {
  const role = getSimulatedRole();

  // Resolve mock details based on seeded users in the DB only if a role is set
  let headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (role) {
    const simulatedUser = getSimulatedUser();
    let uid = simulatedUser?.uid ?? 'sim_superadmin_123';
    let email = simulatedUser?.email ?? 'superadmin@ecoletrack.fr';
    let name = simulatedUser?.name ?? 'M. Jean-Marc Super-Admin';
    let schoolId = simulatedUser?.schoolId ? String(simulatedUser.schoolId) : null;

    if (role === 'school_admin') {
      uid = simulatedUser?.uid ?? 'sim_schooladmin_123';
      email = simulatedUser?.email ?? 'valerie.admin@ecoletrack.fr';
      name = simulatedUser?.name ?? 'Directrice Valérie Bertrand';
      schoolId = simulatedUser?.schoolId ? String(simulatedUser.schoolId) : null;
    } else if (role === 'teacher') {
      uid = simulatedUser?.uid ?? 'sim_teacher_123';
      email = simulatedUser?.email ?? 'f.martin.prof@ecoletrack.fr';
      name = simulatedUser?.name ?? 'M. François Martin';
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
  }

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
