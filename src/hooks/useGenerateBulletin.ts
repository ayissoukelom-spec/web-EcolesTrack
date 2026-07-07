import { useState } from 'react';
import { generateBulletin } from '../lib/api.ts';

export function useGenerateBulletin() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const run = async (studentId: number, termId: number): Promise<{ id?: number } | null> => {
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const created = await generateBulletin(studentId, termId);
      setSuccess('Bulletin genere avec succes.');
      return created;
    } catch (err: any) {
      setError(err?.message || 'Generation impossible.');
      return null;
    } finally {
      setLoading(false);
    }
  };

  const runMany = async (studentIds: number[], termId: number): Promise<Array<{ id?: number; studentId: number }>> => {
    const uniqueStudentIds = Array.from(new Set(studentIds.filter((id) => Number.isInteger(id) && id > 0)));
    if (uniqueStudentIds.length === 0) return [];

    setLoading(true);
    setError(null);
    setSuccess(null);
    const created: Array<{ id?: number; studentId: number }> = [];
    const failedStudentIds: number[] = [];

    try {
      for (const studentId of uniqueStudentIds) {
        try {
        const generated = await generateBulletin(studentId, termId);
        created.push({ id: generated?.id, studentId });
        } catch {
          failedStudentIds.push(studentId);
        }
      }

      if (created.length > 0) {
        setSuccess(`${created.length} bulletin(s) generes avec succes.`);
      }
      if (failedStudentIds.length > 0) {
        setError(`${failedStudentIds.length} eleve(s) n'ont pas pu etre generes.`);
      }
      return created;
    } catch (err: any) {
      setError(err?.message || 'Generation en lot impossible.');
      return created;
    } finally {
      setLoading(false);
    }
  };

  return {
    loading,
    error,
    success,
    setError,
    setSuccess,
    run,
    runMany,
  };
}
