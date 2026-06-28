import { useCallback, useState } from 'react';
import { apiFetch } from '../lib/api.ts';
import type { Student } from '../types.ts';

function normalizeStudentsPayload(payload: unknown): Student[] {
  if (Array.isArray(payload)) return payload as Student[];

  if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>;
    const maybeStudents = record.students;
    if (Array.isArray(maybeStudents)) return maybeStudents as Student[];

    const maybeData = record.data;
    if (Array.isArray(maybeData)) return maybeData as Student[];
    if (maybeData && typeof maybeData === 'object') {
      const nestedStudents = (maybeData as Record<string, unknown>).students;
      if (Array.isArray(nestedStudents)) return nestedStudents as Student[];
    }
  }

  return [];
}

export function useStudents() {
  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const payload = await apiFetch('/api/students');
      const normalizedStudents = normalizeStudentsPayload(payload);
      setStudents(normalizedStudents);
    } catch (err: any) {
      const message = err?.message || 'Impossible de charger les eleves.';
      console.warn('[useStudents] keeping existing student list after refresh failure', err);
      setError(message);
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
