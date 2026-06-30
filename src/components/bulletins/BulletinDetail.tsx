import React from 'react';
import { Download, Eye } from 'lucide-react';
import type { BulletinDetail as BulletinDetailType } from '../../types.ts';

interface BulletinDetailProps {
  detail: BulletinDetailType | null;
  loading: boolean;
  error: string | null;
  selectedId: number | null;
  pdfLoading: boolean;
  onDownloadPdf: () => void;
}

export default function BulletinDetail({
  detail,
  loading,
  error,
  selectedId,
  pdfLoading,
  onDownloadPdf,
}: BulletinDetailProps) {
  const [downloadInProgress, setDownloadInProgress] = React.useState(false);

  const handleDownloadClick = async () => {
    if (downloadInProgress) return;
    setDownloadInProgress(true);
    try {
      await onDownloadPdf();
    } finally {
      setDownloadInProgress(false);
    }
  };

  return (
    <section className="bg-white border border-slate-100 rounded-2xl p-4 space-y-3 min-h-[420px]">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-slate-800">Page detail bulletin</h3>
        <button
          type="button"
          disabled={!selectedId || pdfLoading || downloadInProgress}
          onClick={handleDownloadClick}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700 disabled:opacity-50"
        >
          <Download className="h-3.5 w-3.5" />
          {pdfLoading || downloadInProgress ? 'Chargement PDF...' : 'Telecharger PDF'}
        </button>
      </div>

      {loading && (
        <div className="text-sm text-slate-500 py-6 text-center">Chargement du detail...</div>
      )}

      {!loading && error && (
        <div className="text-sm text-rose-600 bg-rose-50 border border-rose-100 rounded-xl p-3">{error}</div>
      )}

      {!loading && !error && !detail && (
        <div className="text-sm text-slate-500 bg-slate-50 border border-slate-100 rounded-xl p-6 text-center flex flex-col items-center gap-2">
          <Eye className="h-4.5 w-4.5 text-slate-400" />
          Selectionnez un bulletin pour afficher son detail.
        </div>
      )}

      {!loading && !error && detail && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div className="bg-slate-50 rounded-xl p-3 border border-slate-100">
              <p className="text-slate-500">Eleve</p>
              <p className="font-semibold text-slate-800">{detail.studentName}</p>
            </div>
            <div className="bg-slate-50 rounded-xl p-3 border border-slate-100">
              <p className="text-slate-500">Classe</p>
              <p className="font-semibold text-slate-800">{detail.className}</p>
            </div>
            <div className="bg-slate-50 rounded-xl p-3 border border-slate-100">
              <p className="text-slate-500">Trimestre</p>
              <p className="font-semibold text-slate-800">{detail.termName}</p>
            </div>
            <div className="bg-slate-50 rounded-xl p-3 border border-slate-100">
              <p className="text-slate-500">Moyenne</p>
              <p className="font-semibold text-slate-800">{detail.average == null ? '-' : detail.average.toFixed(2)}</p>
            </div>
          </div>

          <div className="text-xs grid grid-cols-2 gap-3">
            <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-3">
              <p className="text-indigo-600">Rang</p>
              <p className="font-semibold text-indigo-900">{detail.rank ?? '-'}</p>
            </div>
            <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-3">
              <p className="text-emerald-600">Mention</p>
              <p className="font-semibold text-emerald-900">{detail.mention || '-'}</p>
            </div>
          </div>

          <div className="text-xs bg-slate-50 border border-slate-100 rounded-xl p-3">
            <p className="text-slate-500">Appreciation generale</p>
            <p className="font-medium text-slate-800 mt-1">{detail.appreciation || '-'}</p>
          </div>

          <div className="overflow-x-auto border border-slate-100 rounded-xl">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="text-left px-3 py-2">Matiere</th>
                  <th className="text-left px-3 py-2">Coef</th>
                  <th className="text-left px-3 py-2">Moyenne</th>
                  <th className="text-left px-3 py-2">Appreciation</th>
                </tr>
              </thead>
              <tbody>
                {detail.lines.map((line) => (
                  <tr key={line.id} className="border-t border-slate-100">
                    <td className="px-3 py-2">{line.subjectName}</td>
                    <td className="px-3 py-2">{line.coefficient}</td>
                    <td className="px-3 py-2">{line.average == null ? '-' : line.average.toFixed(2)}</td>
                    <td className="px-3 py-2">{line.teacherComment || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
