import React, { useState } from 'react';
import { Check, X } from 'lucide-react';
import type { AbsenceDeclaration } from '../types.ts';

interface AbsenceDeclarationValidationsViewProps {
  declarations: AbsenceDeclaration[];
  onReview: (id: number, status: 'ACCEPTED' | 'REFUSED', rejectionReason?: string) => Promise<void>;
}

const formatDate = (value: string | null | undefined, includeTime = false) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('fr-FR', includeTime
    ? { dateStyle: 'short', timeStyle: 'short' }
    : { dateStyle: 'short' });
};

export default function AbsenceDeclarationValidationsView({
  declarations,
  onReview,
}: AbsenceDeclarationValidationsViewProps) {
  const [processingId, setProcessingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const receivedDeclarations = declarations.filter((declaration) => declaration.status === 'RECEIVED');

  const reviewDeclaration = async (declaration: AbsenceDeclaration, status: 'ACCEPTED' | 'REFUSED') => {
    const rejectionReason = status === 'REFUSED' ? window.prompt('Motif du refus :')?.trim() : undefined;
    if (status === 'REFUSED' && rejectionReason === undefined) return;
    if (status === 'REFUSED' && !rejectionReason) {
      setError('Le motif du refus est obligatoire.');
      return;
    }

    setProcessingId(declaration.id);
    setError(null);
    try {
      await onReview(declaration.id, status, rejectionReason);
    } catch (reviewError: any) {
      setError(reviewError?.message || 'Impossible de traiter la déclaration.');
    } finally {
      setProcessingId(null);
    }
  };

  return (
    <section className="space-y-4" aria-labelledby="absence-declaration-validations-title">
      <header>
        <h2 id="absence-declaration-validations-title" className="text-xl font-bold text-slate-800">Déclarations d'absence à traiter</h2>
      </header>

      {error && <p role="alert" className="text-sm font-medium text-rose-700">{error}</p>}

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full min-w-[900px] text-left text-sm">
          <thead className="bg-slate-50 text-xs font-semibold uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3">Élève</th>
              <th className="px-4 py-3">Classe</th>
              <th className="px-4 py-3">Date</th>
              <th className="px-4 py-3">Horaire</th>
              <th className="px-4 py-3">Motif</th>
              <th className="px-4 py-3">Parent</th>
              <th className="px-4 py-3">Créée le</th>
              <th className="px-4 py-3">Statut</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {receivedDeclarations.map((declaration) => (
              <tr key={declaration.id} data-testid={`absence-declaration-${declaration.id}`}>
                <td className="px-4 py-3 font-semibold text-slate-800">{declaration.studentName}</td>
                <td className="px-4 py-3 text-slate-600">{declaration.className || '—'}</td>
                <td className="px-4 py-3 text-slate-600">{formatDate(declaration.date)}</td>
                <td className="px-4 py-3 whitespace-nowrap text-slate-600">{declaration.startTime}–{declaration.endTime}</td>
                <td className="max-w-56 px-4 py-3 text-slate-600">{declaration.reason || '—'}</td>
                <td className="px-4 py-3 text-slate-600">{declaration.parentName || '—'}</td>
                <td className="px-4 py-3 whitespace-nowrap text-slate-600">{formatDate(declaration.createdAt, true)}</td>
                <td className="px-4 py-3 font-semibold text-amber-700">Reçue</td>
                <td className="px-4 py-3">
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      disabled={processingId !== null}
                      onClick={() => void reviewDeclaration(declaration, 'ACCEPTED')}
                      className="inline-flex items-center gap-1 rounded-md bg-emerald-700 px-2.5 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                    >
                      <Check className="h-3.5 w-3.5" /> Accepter
                    </button>
                    <button
                      type="button"
                      disabled={processingId !== null}
                      onClick={() => void reviewDeclaration(declaration, 'REFUSED')}
                      className="inline-flex items-center gap-1 rounded-md bg-rose-700 px-2.5 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                    >
                      <X className="h-3.5 w-3.5" /> Refuser
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {receivedDeclarations.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center text-sm text-slate-500">Aucune déclaration à traiter.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}