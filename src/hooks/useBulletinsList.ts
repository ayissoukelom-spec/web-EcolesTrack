import { useCallback, useEffect, useRef, useState } from 'react';
import type { BulletinListFilters, BulletinListItem } from '../types.ts';
import { fetchBulletinsList } from '../lib/api.ts';

interface UseBulletinsListOptions {
  enabled: boolean;
  filters: BulletinListFilters;
}

export function useBulletinsList({ enabled, filters }: UseBulletinsListOptions) {
  const [items, setItems] = useState<BulletinListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestSequenceRef = useRef(0);

  const refresh = useCallback(async (overrideFilters?: BulletinListFilters) => {
    if (!enabled) return;

    const requestId = ++requestSequenceRef.current;
    setLoading(true);
    setError(null);
    try {
      const payload = await fetchBulletinsList(overrideFilters ?? filters);
      if (requestId !== requestSequenceRef.current) return;
      setItems(Array.isArray(payload?.items) ? payload.items : []);
      setTotal(Number(payload?.total || 0));
    } catch (err: any) {
      if (requestId !== requestSequenceRef.current) return;
      setItems([]);
      setTotal(0);
      setError(err?.message || 'Impossible de charger la liste des bulletins.');
    } finally {
      if (requestId === requestSequenceRef.current) setLoading(false);
    }
  }, [enabled, filters]);

  useEffect(() => {
    if (!enabled) {
      requestSequenceRef.current += 1;
      setItems([]);
      setTotal(0);
      setLoading(false);
      return;
    }
    refresh();
  }, [enabled, refresh]);

  return {
    items,
    total,
    loading,
    error,
    setError,
    refresh,
  };
}
