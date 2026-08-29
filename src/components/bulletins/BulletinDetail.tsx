import React from 'react';
import { Download, Eye } from 'lucide-react';
import type { BulletinDetail as BulletinDetailType } from '../../types.ts';
import { getGradeBadgeClass, getGradeBand } from '../../lib/gradeColor';

interface BulletinDetailProps {
  detail: BulletinDetailType | null;
  loading: boolean;
  error: string | null;
  selectedId: number | null;
  liveNotes: Array<{ id: string; subject: string; title: string; score: string; maxScore: number | null; date: string | null }>;
  subjectBreakdown?: Record<string, { interrogation: number | null; devoir: number | null; composition: number | null; average: number | null; classAverage: number | null }>;
  pdfLoading: boolean;
  onDownloadPdf: () => void;
}

const formatValue = (value: number | null): string => value == null ? '—' : value.toFixed(2);

export default function BulletinDetail({
  detail,
  loading,
  error,
  selectedId,
  liveNotes,
  subjectBreakdown = {},
  pdfLoading,
  onDownloadPdf,
}: BulletinDetailProps) {
  return (
    <section className="bg-white border border-slate-100 rounded-2xl p-4 space-y-3 min-h-[420px]">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-slate-800">Page detail bulletin</h3>
        <button
          type="button"
          disabled={!selectedId || pdfLoading}
          onClick={onDownloadPdf}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700 disabled:opacity-50"
        >
          <Download className="h-3.5 w-3.5" />
          {pdfLoading ? 'Chargement PDF...' : 'Telecharger PDF'}
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
            <div className="px-3 py-2 text-xs font-semibold text-slate-700 bg-slate-50 border-b border-slate-100">
              Notes detaillees
            </div>
            <table className="w-full text-xs">
              <thead className="bg-white text-slate-600">
                <tr>
                  <th className="text-left px-3 py-2">Matiere</th>
                  <th className="text-left px-3 py-2">Evaluation</th>
                  <th className="text-left px-3 py-2">Date</th>
                  <th className="text-left px-3 py-2">Note</th>
                </tr>
              </thead>
              <tbody>
                {liveNotes.length === 0 && (
                  <tr className="border-t border-slate-100">
                    <td colSpan={4} className="px-3 py-3 text-slate-500">
                      Aucune note detaillee trouvee pour ce bulletin.
                    </td>
                  </tr>
                )}
                {liveNotes.map((note) => (
                  (() => {
                    const band = getGradeBand(note.score, note.maxScore ?? 20);
                    const gradeClass = getGradeBadgeClass(band);
                    return (
                      <tr key={note.id} className="border-t border-slate-100">
                        <td className="px-3 py-2">{note.subject}</td>
                        <td className="px-3 py-2">{note.title}</td>
                        <td className="px-3 py-2">{note.date || '-'}</td>
                        <td className="px-3 py-2">
                          <span className={`font-semibold px-2 py-0.5 rounded-lg ${gradeClass}`}>
                            {note.maxScore == null ? note.score : `${note.score} / ${note.maxScore}`}
                          </span>
                        </td>
                      </tr>
                    );
                  })()
                ))}
              </tbody>
            </table>
          </div>

          {detail.lines.length === 0 && liveNotes.length > 0 && (
            <div className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-xl p-3">
              Le snapshot du bulletin est vide, mais des notes existent. Regenerer le bulletin pour synchroniser le tableau des moyennes par matiere et le PDF.
            </div>
          )}

          <div className="overflow-x-auto border border-slate-100 rounded-xl">
            <table className="w-full text-xs min-w-[1000px]">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="text-left px-2 py-2 whitespace-nowrap">Matières</th>
                  <th className="text-center px-2 py-2">Inter.</th>
                  <th className="text-center px-2 py-2">Dev.</th>
                  <th className="text-center px-2 py-2"><span className="block">Moy.</span><span className="block">Clas</span></th>
                  <th className="text-center px-2 py-2">Compo.</th>
                  <th className="text-center px-2 py-2"><span className="block">Note</span><span className="block">/20</span></th>
                  <th className="text-center px-2 py-2">Coef.</th>
                  <th className="text-center px-2 py-2"><span className="block">Note</span><span className="block">coef.</span></th>
                  <th className="text-center px-2 py-2">Rang</th>
                  <th className="text-center px-2 py-2">Prof.</th>
                  <th className="text-left px-2 py-2">Appréciation</th>
                  <th className="text-center px-2 py-2">Signature</th>
                </tr>
              </thead>
              <tbody>
                {detail.lines.map((line) => {
                  const breakdown = subjectBreakdown[line.subjectName] ?? {
                    interrogation: null,
                    devoir: null,
                    composition: null,
                    average: line.average,
                    classAverage: null,
                  };
                  const studentAverage = breakdown.average ?? line.average;
                  const noteCoef = studentAverage != null && line.coefficient != null
                    ? (parseFloat(String(studentAverage)) * line.coefficient).toFixed(2)
                    : '-';
                  return (
                    <tr key={line.id} className="border-t border-slate-100 align-top">
                      <td className="px-2 py-2">{line.subjectName}</td>
                      <td className="px-2 py-2 text-center">{formatValue(breakdown.interrogation)}</td>
                      <td className="px-2 py-2 text-center">{formatValue(breakdown.devoir)}</td>
                      <td className="px-2 py-2 text-center">{formatValue(breakdown.devoir)}</td>
                      <td className="px-2 py-2 text-center">{formatValue(breakdown.classAverage)}</td>
                      <td className="px-2 py-2 text-center">{formatValue(breakdown.composition)}</td>
                      <td className="px-2 py-2 text-center font-semibold">{formatValue(studentAverage)}</td>
                      <td className="px-2 py-2 text-center">{line.coefficient}</td>
                      <td className="px-2 py-2 text-center font-semibold">{noteCoef}</td>
                      <td className="px-2 py-2 text-center">{line.rank ?? '-'}</td>
                      <td className="px-2 py-2 text-center text-slate-500">{line.teacherName || '—'}</td>
                      <td className="px-2 py-2 max-w-xs truncate">{line.teacherComment || '-'}</td>
                      <td className="px-2 py-2 text-center">—</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
