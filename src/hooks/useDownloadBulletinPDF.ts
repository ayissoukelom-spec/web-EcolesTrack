import { useRef, useState } from 'react';
import { downloadBulletinPdf, downloadBulletinsPdfBatch } from '../lib/api.ts';

export function useDownloadBulletinPDF() {
  const [downloadingIds, setDownloadingIds] = useState<Set<number>>(() => new Set());
  const downloadingIdsRef = useRef(new Set<number>());
  const [batchLoading, setBatchLoading] = useState(false);
  const batchLoadingRef = useRef(false);
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
    if (downloadingIdsRef.current.has(id)) return;
    downloadingIdsRef.current.add(id);
    setDownloadingIds(new Set(downloadingIdsRef.current));
    setError(null);
    try {
      await downloadOne(id);
    } catch (err: any) {
      setError(err?.message || 'Impossible de telecharger le PDF.');
    } finally {
      downloadingIdsRef.current.delete(id);
      setDownloadingIds(new Set(downloadingIdsRef.current));
    }
  };

  const runMany = async (ids: number[]) => {
    const uniqueIds = Array.from(new Set(ids.filter((id) => Number.isInteger(id) && id > 0)));
    if (uniqueIds.length === 0 || batchLoadingRef.current) return;

    batchLoadingRef.current = true;
    setBatchLoading(true);
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
      batchLoadingRef.current = false;
      setBatchLoading(false);
    }
  };

  return {
    batchLoading,
    isDownloading: (id: number) => downloadingIds.has(id),
    error,
    setError,
    run,
    runMany,
  };
}
