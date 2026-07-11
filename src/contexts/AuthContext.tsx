import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { UserRole } from '../types.ts';
import { getActiveSchoolId, getSimulatedRole, getSimulatedUser } from '../lib/api.ts';

const ACCESS_TOKEN_STORAGE_KEY = 'ecoletrack_jwt_access';
const SIMULATED_ROLE_KEY = 'ecoletrack_simulated_role';
const SIMULATED_USER_KEY = 'ecoletrack_simulated_user';

export interface AuthUser {
  id?: number;
  uid?: string;
  email?: string;
  name?: string;
  role?: UserRole;
  schoolId?: number;
  [key: string]: unknown;
}

export interface AuthContextValue {
  user: AuthUser | null;
  token: string | null;
  isAuthenticated: boolean;
  isSimulated: boolean;
  role: UserRole | '';
  activeSchoolId: number | null;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function readAuthToken(): string | null {
  if (typeof localStorage === 'undefined') return null;
  return localStorage.getItem(ACCESS_TOKEN_STORAGE_KEY) || null;
}

function readSimulatedUser(): AuthUser | null {
  if (typeof window === 'undefined') return null;
  return getSimulatedUser() || null;
}

function readIsSimulated(): boolean {
  if (typeof window === 'undefined') return false;
  return Boolean(getSimulatedRole());
}

function readRole(): UserRole | '' {
  if (typeof window === 'undefined') return '' as UserRole;
  const simulatedRole = getSimulatedRole();
  if (simulatedRole) return simulatedRole as UserRole;
  const user = getSimulatedUser();
  return (user?.role ?? '') as UserRole;
}

const ACTIVE_SCHOOL_ID_KEY = 'ecoletrack_active_school_id';

function readAuthState() {
  return {
    token: readAuthToken(),
    user: readSimulatedUser(),
    isSimulated: readIsSimulated(),
    role: readRole(),
    activeSchoolId: readActiveSchoolId(),
  };
}

function readActiveSchoolId(): number | null {
  if (typeof window === 'undefined') return null;
  return getActiveSchoolId();
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => readAuthToken());
  const [user, setUser] = useState<AuthUser | null>(() => readSimulatedUser());
  const [isSimulated, setIsSimulated] = useState<boolean>(() => readIsSimulated());
  const [role, setRole] = useState<UserRole | ''>(() => readRole());
  const [activeSchoolId, setActiveSchoolId] = useState<number | null>(() => readActiveSchoolId());

  useEffect(() => {
    const updateAuthState = () => {
      const authState = readAuthState();
      setToken(authState.token);
      setUser(authState.user);
      setIsSimulated(authState.isSimulated);
      setRole(authState.role);
      setActiveSchoolId(authState.activeSchoolId);
    };

    const onStorage = (event: StorageEvent) => {
      const shouldRefresh =
        event.key === ACCESS_TOKEN_STORAGE_KEY ||
        event.key === SIMULATED_ROLE_KEY ||
        event.key === SIMULATED_USER_KEY ||
        event.key === ACTIVE_SCHOOL_ID_KEY ||
        event.key === null;

      if (shouldRefresh) {
        updateAuthState();
      }
    };

    const onSimulatedUserChanged = () => {
      updateAuthState();
    };

    window.addEventListener('storage', onStorage);
    window.addEventListener('simulatedUserChanged', onSimulatedUserChanged as EventListener);

    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('simulatedUserChanged', onSimulatedUserChanged as EventListener);
    };
  }, []);

  const value = useMemo(
    () => ({
      user,
      token,
      isAuthenticated: Boolean(token),
      isSimulated,
      role,
      activeSchoolId,
    }),
    [token, user, isSimulated, role, activeSchoolId],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}
