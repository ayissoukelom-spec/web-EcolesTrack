import { useState } from 'react';
import { downloadBulletinPdf, downloadBulletinsPdfBatch } from '../lib/api.ts';

export function useDownloadBulletinPDF() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const downloadOne = async (id: number) => {
    const blob = await downloadBulletinPdf(id);
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `bulletin-${id}.pdf`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  };

  const run = async (id: number) => {
    setLoading(true);
    setError(null);
    try {
      await downloadOne(id);
    } catch (err: any) {
      setError(err?.message || 'Impossible de telecharger le PDF.');
    } finally {
      setLoading(false);
    }
  };

  const runMany = async (ids: number[]) => {
    const uniqueIds = Array.from(new Set(ids.filter((id) => Number.isInteger(id) && id > 0)));
    if (uniqueIds.length === 0) return;

    setLoading(true);
    setError(null);
    try {
      const blob = await downloadBulletinsPdfBatch(uniqueIds);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `bulletins-batch-${Date.now()}.pdf`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      setError(err?.message || 'Impossible de telecharger les PDF selectionnes.');
    } finally {
      setLoading(false);
    }
  };

  return {
    loading,
    error,
    setError,
    run,
    runMany,
  };
}
