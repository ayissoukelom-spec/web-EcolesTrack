import { useState } from 'react';
import { downloadBulletinPdf } from '../lib/api.ts';

export function useDownloadBulletinPDF() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (id: number) => {
    setLoading(true);
    setError(null);
    try {
      const blob = await downloadBulletinPdf(id);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `bulletin-${id}.pdf`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      setError(err?.message || 'Impossible de telecharger le PDF.');
    } finally {
      setLoading(false);
    }
  };

  return {
    loading,
    error,
    setError,
    run,
  };
}
