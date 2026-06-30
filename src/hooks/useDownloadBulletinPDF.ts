import { useRef, useState } from 'react';
import { downloadBulletinPdf } from '../lib/api.ts';

export function useDownloadBulletinPDF() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pendingDownloadsRef = useRef<Set<number>>(new Set());

  const run = async (id: number) => {
    console.log('🎬 [useDownloadBulletinPDF.run] START - id:', id);
    
    // Prevent duplicate downloads for the same bulletin
    if (pendingDownloadsRef.current.has(id)) {
      console.log('⚠️  [useDownloadBulletinPDF.run] Download already pending for id:', id);
      return;
    }

    pendingDownloadsRef.current.add(id);
    setLoading(true);
    setError(null);
    try {
      console.log('🎯 [useDownloadBulletinPDF.run] Calling downloadBulletinPdf(', id, ')');
      const blob = await downloadBulletinPdf(id);
      console.log('✅ [useDownloadBulletinPDF.run] Blob received, size:', blob.size);
      const url = URL.createObjectURL(blob);
      console.log('📄 [useDownloadBulletinPDF.run] ObjectURL created:', url);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `bulletin-${id}.pdf`;
      document.body.appendChild(anchor);
      console.log('🖱️  [useDownloadBulletinPDF.run] Clicking anchor element');
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      console.log('🧹 [useDownloadBulletinPDF.run] Cleanup complete');
    } catch (err: any) {
      setError(err?.message || 'Impossible de telecharger le PDF.');
    } finally {
      setLoading(false);
      pendingDownloadsRef.current.delete(id);
    }
  };

  return {
    loading,
    error,
    setError,
    run,
  };
}
