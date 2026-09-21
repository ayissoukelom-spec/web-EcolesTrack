import { useCallback, useState } from 'react';
import { apiFetch } from '../lib/api.ts';
import type { LateArrival } from '../types.ts';

export interface LateArrivalInput {
  studentId: number;
  classId: number;
  date: string;
  period: 'morning' | 'afternoon' | 'all_day';
  subjectId?: number;
  expectedStartTime: string;
  arrivalTime: string;
  reason?: string | null;
}

export function useLateArrivals() {
  const [lateArrivals, setLateArrivals] = useState<LateArrival[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const payload = await apiFetch('/api/late-arrivals');
      setLateArrivals(Array.isArray(payload) ? payload : []);
    } catch (err: any) {
      setLateArrivals([]);
      setError(err?.message || 'Impossible de charger les retards.');
    } finally {
      setLoading(false);
    }
  }, []);

  const addLateArrival = useCallback(async (data: LateArrivalInput) => {
    await apiFetch('/api/late-arrivals', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    await refresh();
  }, [refresh]);

  const updateLateArrival = useCallback(async (id: number, data: Partial<Pick<LateArrivalInput, 'expectedStartTime' | 'arrivalTime' | 'reason'>>) => {
    await apiFetch(`/api/late-arrivals/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
    await refresh();
  }, [refresh]);

  const deleteLateArrival = useCallback(async (id: number) => {
    await apiFetch(`/api/late-arrivals/${id}`, {
      method: 'DELETE',
    });
    await refresh();
  }, [refresh]);

  return {
    lateArrivals,
    loading,
    error,
    setLateArrivals,
    setError,
    refresh,
    addLateArrival,
    updateLateArrival,
    deleteLateArrival,
  };
}
