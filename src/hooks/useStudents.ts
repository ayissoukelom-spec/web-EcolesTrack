import { useCallback, useState } from 'react';
import { apiFetch } from '../lib/api.ts';
import type { Student } from '../types.ts';

export function useStudents() {
  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const payload = await apiFetch('/api/students');
      setStudents(Array.isArray(payload) ? payload : []);
    } catch (err: any) {
      setStudents([]);
      setError(err?.message || 'Impossible de charger les eleves.');
    } finally {
      setLoading(false);
    }
  }, []);

  const addStudent = useCallback(async (data: any) => {
    await apiFetch('/api/students', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    await refresh();
  }, [refresh]);

  const updateStudent = useCallback(async (id: number, data: any) => {
    await apiFetch(`/api/students/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
    await refresh();
  }, [refresh]);

  const batchCreateStudents = useCallback(async (records: any[]) => {
    return apiFetch('/api/students/batch', {
      method: 'POST',
      body: JSON.stringify(records),
    });
  }, []);

  return {
    students,
    loading,
    error,
    setStudents,
    setError,
    refresh,
    addStudent,
    updateStudent,
    batchCreateStudents,
  };
}
