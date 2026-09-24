import { useCallback, useState } from 'react';
import { apiFetch } from '../lib/api.ts';
import type { UserRole } from '../types.ts';

interface DashboardStats {
  totalStudents: number;
  totalAbsences: number;
  totalClasses: number;
  totalTeachers: number;
  attendanceRate: number;
  maleStudents?: number;
  femaleStudents?: number;
  unknownGenderStudents?: number;
}

export interface LoginStats {
  totalLogins: number;
  uniqueUsers: number;
  webLogins: number;
  androidLogins: number;
  loginsByDay: Array<{ date: string; total: number; web: number; android: number }>;
  loginsByRole: Array<{ role: string; total: number }>;
}

const emptyLoginStats: LoginStats = {
  totalLogins: 0,
  uniqueUsers: 0,
  webLogins: 0,
  androidLogins: 0,
  loginsByDay: [],
  loginsByRole: [],
};

export function useAdminDashboard() {
  const [stats, setStats] = useState<DashboardStats>({
    totalStudents: 0,
    totalAbsences: 0,
    totalClasses: 0,
    totalTeachers: 0,
    attendanceRate: 94.5,
  });
  const [recentGrades, setRecentGrades] = useState<any[]>([]);
  const [recentAbsences, setRecentAbsences] = useState<any[]>([]);
  const [loginStats, setLoginStats] = useState<LoginStats>(emptyLoginStats);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (userRole?: UserRole) => {
    setLoading(true);
    setError(null);
    try {
      const summary = await apiFetch('/api/dashboard/summary');
      console.log('Réponse API Dashboard :', summary);
      console.log('Statistiques reçues :', summary?.stats);
      setStats(summary?.stats || {
        totalStudents: 0,
        totalAbsences: 0,
        totalClasses: 0,
        totalTeachers: 0,
        attendanceRate: 94.5,
      });
      setRecentGrades(Array.isArray(summary?.recentGrades) ? summary.recentGrades : []);
      setRecentAbsences(Array.isArray(summary?.recentAbsences) ? summary.recentAbsences : []);

      if (userRole === 'super_admin') {
        try {
          const loginSummary = await apiFetch('/api/admin/login-stats');
          setLoginStats({
            totalLogins: Number(loginSummary?.totalLogins || 0),
            uniqueUsers: Number(loginSummary?.uniqueUsers || 0),
            webLogins: Number(loginSummary?.webLogins || 0),
            androidLogins: Number(loginSummary?.androidLogins || 0),
            loginsByDay: Array.isArray(loginSummary?.loginsByDay) ? loginSummary.loginsByDay : [],
            loginsByRole: Array.isArray(loginSummary?.loginsByRole) ? loginSummary.loginsByRole : [],
          });
        } catch {
          setLoginStats(emptyLoginStats);
        }
      } else {
        setLoginStats(emptyLoginStats);
      }
    } catch (err: any) {
      setError(err?.message || 'Impossible de charger le dashboard.');
      setRecentGrades([]);
      setRecentAbsences([]);
    } finally {
      setLoading(false);
    }
  }, []);

  return {
    stats,
    recentGrades,
    recentAbsences,
    loginStats,
    loading,
    error,
    setError,
    setRecentAbsences,
    refresh,
  };
}
