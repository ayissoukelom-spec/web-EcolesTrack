import { useState } from 'react';
import type { BulletinDetail } from '../types.ts';
import { fetchBulletinDetail } from '../lib/api.ts';

export function useBulletinDetail() {
  const [detail, setDetail] = useState<BulletinDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadDetail = async (id: number): Promise<BulletinDetail | null> => {
    setLoading(true);
    setError(null);
    try {
      const payload = await fetchBulletinDetail(id);
      setDetail(payload);
      return payload;
    } catch (err: any) {
      setDetail(null);
      setError(err?.message || 'Impossible de charger le detail du bulletin.');
      return null;
    } finally {
      setLoading(false);
    }
  };

  return {
    detail,
    loading,
    error,
    setError,
    loadDetail,
  };
}
