import { useCallback, useState } from 'react';
import { apiFetch } from '../lib/api.ts';

export function useAbsences() {
  const [absences, setAbsences] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const payload = await apiFetch('/api/absences');
      setAbsences(Array.isArray(payload) ? payload : []);
    } catch (err: any) {
      setAbsences([]);
      setError(err?.message || 'Impossible de charger les absences.');
    } finally {
      setLoading(false);
    }
  }, []);

  const addAbsence = useCallback(async (data: any) => {
    await apiFetch('/api/absences', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    await refresh();
  }, [refresh]);

  const justifyAbsence = useCallback(async (id: number, reason: string) => {
    await apiFetch(`/api/absences/${id}/justify`, {
      method: 'PUT',
      body: JSON.stringify({ justificationReason: reason }),
    });
    await refresh();
  }, [refresh]);

  return {
    absences,
    loading,
    error,
    setAbsences,
    setError,
    refresh,
    addAbsence,
    justifyAbsence,
  };
}
