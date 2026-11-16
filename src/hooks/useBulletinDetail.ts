import { useCallback, useRef, useState } from 'react';
import type { BulletinDetail } from '../types.ts';
import { fetchBulletinDetail } from '../lib/api.ts';

export function useBulletinDetail() {
  const [detail, setDetail] = useState<BulletinDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestSequenceRef = useRef(0);

  const loadDetail = async (id: number): Promise<BulletinDetail | null> => {
    const requestId = ++requestSequenceRef.current;
    setLoading(true);
    setError(null);
    try {
      const payload = await fetchBulletinDetail(id);
      if (requestId !== requestSequenceRef.current) return null;
      setDetail(payload);
      return payload;
    } catch (err: any) {
      if (requestId !== requestSequenceRef.current) return null;
      setDetail(null);
      setError(err?.message || 'Impossible de charger le detail du bulletin.');
      return null;
    } finally {
      if (requestId === requestSequenceRef.current) setLoading(false);
    }
  };

  const reset = useCallback(() => {
    requestSequenceRef.current += 1;
    setDetail(null);
    setLoading(false);
    setError(null);
  }, []);

  return {
    detail,
    loading,
    error,
    setError,
    loadDetail,
    reset,
  };
}
