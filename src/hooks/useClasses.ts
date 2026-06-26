import { useCallback, useState } from 'react';
import { apiFetch } from '../lib/api.ts';
import type { Class } from '../types.ts';

export function useClasses() {
  const [classes, setClasses] = useState<Class[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const payload = await apiFetch('/api/classes');
      setClasses(Array.isArray(payload) ? payload : []);
    } catch (err: any) {
      setClasses([]);
      setError(err?.message || 'Impossible de charger les classes.');
    } finally {
      setLoading(false);
    }
  }, []);

  const addClass = useCallback(async (data: any) => {
    await apiFetch('/api/classes', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    await refresh();
  }, [refresh]);

  const deleteClass = useCallback(async (id: number) => {
    await apiFetch(`/api/classes/${id}`, { method: 'DELETE' });
    await refresh();
  }, [refresh]);

  return {
    classes,
    loading,
    error,
    setClasses,
    setError,
    refresh,
    addClass,
    deleteClass,
  };
}
