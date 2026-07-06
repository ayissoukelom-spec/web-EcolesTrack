const BACKEND_URL = 'http://localhost:4174';

const LOCAL_STORAGE_ROLE_KEY = 'ecoletrack_simulated_role';
const LOCAL_STORAGE_USER_KEY = 'ecoletrack_simulated_user';
const LOCAL_STORAGE_ACTIVE_SCHOOL_KEY = 'ecoletrack_active_school_id';

function getSimulatedRole(): string | null {
  return typeof window !== 'undefined' ? localStorage.getItem(LOCAL_STORAGE_ROLE_KEY) || null : null;
}

function getSimulatedUser(): any | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

function getActiveSchoolId(): string | null {
  if (typeof window === 'undefined') return null;
  const v = localStorage.getItem(LOCAL_STORAGE_ACTIVE_SCHOOL_KEY);
  return v ?? null;
}

export function getSimulationHeaders(): Record<string, string> {
  const role = getSimulatedRole();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (!role) return headers;

  const simulatedUser = getSimulatedUser();
  const activeSchoolId = getActiveSchoolId();
  const uid = simulatedUser?.uid ?? `sim_${role}_123`;
  const email = simulatedUser?.email ?? `${role}@example.test`;
  const name = simulatedUser?.name ?? `Simulated ${role}`;
  const schoolId = activeSchoolId ?? (simulatedUser?.schoolId ? String(simulatedUser.schoolId) : null);

  headers['x-simulated-role'] = role;
  headers['x-simulated-uid'] = uid;
  headers['x-simulated-email'] = email;
  headers['x-simulated-name'] = name;
  if (schoolId) headers['x-simulated-school-id'] = schoolId;

  return headers;
}

export const fetchNotifications = async (role: string, schoolId: string) => {
  const res = await fetch(`${BACKEND_URL}/api/notifications?role=${role}&schoolId=${schoolId}`, {
    headers: getSimulationHeaders(),
  });
  return res.json();
};

export const fetchEvaluations = async (classId: string) => {
  const res = await fetch(`${BACKEND_URL}/api/evaluations?classId=${classId}`, {
    headers: getSimulationHeaders(),
  });
  return res.json();
};

export const fetchGrades = async (evaluationId: string) => {
  const res = await fetch(`${BACKEND_URL}/api/grades?evaluationId=${evaluationId}`, {
    headers: getSimulationHeaders(),
  });
  return res.json();
};

export const authenticateUser = async (role: string, schoolId: string) => {
  // If the web simulation is active, return simulated identity so mobile mirrors web behaviour
  const simulatedRole = getSimulatedRole();
  const simulatedUser = getSimulatedUser();
  const activeSchoolId = getActiveSchoolId();

  if (simulatedRole) {
    return {
      token: 'simulated-token',
      role: simulatedRole,
      schoolId: activeSchoolId ?? (simulatedUser?.schoolId ? String(simulatedUser.schoolId) : schoolId),
      user: simulatedUser ?? null,
    };
  }

  // fallback mock behaviour
  return { token: 'mock-token', role, schoolId };
};
