import { useCallback, useState } from 'react';
import { apiFetch } from '../lib/api.ts';

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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
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
    loading,
    error,
    setError,
    setRecentAbsences,
    refresh,
  };
}
