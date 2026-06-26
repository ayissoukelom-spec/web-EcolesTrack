import { useCallback, useEffect, useState } from 'react';
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

  const refresh = useCallback(async () => {
    if (!enabled) return;

    setLoading(true);
    setError(null);
    try {
      const payload = await fetchBulletinsList(filters);
      setItems(Array.isArray(payload?.items) ? payload.items : []);
      setTotal(Number(payload?.total || 0));
    } catch (err: any) {
      setItems([]);
      setTotal(0);
      setError(err?.message || 'Impossible de charger la liste des bulletins.');
    } finally {
      setLoading(false);
    }
  }, [enabled, filters]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return {
    items,
    total,
    loading,
    error,
    setError,
    refresh,
  };
}
