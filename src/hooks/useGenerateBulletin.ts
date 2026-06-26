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

  return {
    loading,
    error,
    success,
    setError,
    setSuccess,
    run,
  };
}
