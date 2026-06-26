import React from 'react';
import { Filter, RefreshCw } from 'lucide-react';
import type { BulletinListItem, BulletinTermOption, Class, Student } from '../../types.ts';

interface BulletinsListProps {
  canList: boolean;
  loading: boolean;
  error: string | null;
  items: BulletinListItem[];
  total: number;
  page: number;
  totalPages: number;
  selectedId: number | null;
  visibleClasses: Class[];
  visibleStudents: Student[];
  termOptions: BulletinTermOption[];
  filters: { classId?: number; studentId?: number; termId?: number };
  onRefresh: () => void;
  onSelect: (id: number) => void;
  onPrevPage: () => void;
  onNextPage: () => void;
  onResetFilters: () => void;
  onFilterClassChange: (value: string) => void;
  onFilterStudentChange: (value: string) => void;
  onFilterTermChange: (value: string) => void;
}

export default function BulletinsList({
  canList,
  loading,
  error,
  items,
  total,
  page,
  totalPages,
  selectedId,
  visibleClasses,
  visibleStudents,
  termOptions,
  filters,
  onRefresh,
  onSelect,
  onPrevPage,
  onNextPage,
  onResetFilters,
  onFilterClassChange,
  onFilterStudentChange,
  onFilterTermChange,
}: BulletinsListProps) {
  return (
    <section className="bg-white border border-slate-100 rounded-2xl p-4 space-y-3 min-h-[420px]">
      {canList && (
        <div className="bg-white border border-slate-100 rounded-2xl p-4 space-y-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
            <Filter className="h-4.5 w-4.5 text-indigo-600" />
            Filtres de recherche
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <select
              value={filters.classId || ''}
              onChange={(e) => onFilterClassChange(e.target.value)}
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
            >
              <option value="">Toutes les classes</option>
              {visibleClasses.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>

            <select
              value={filters.studentId || ''}
              onChange={(e) => onFilterStudentChange(e.target.value)}
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
            >
              <option value="">Tous les eleves</option>
              {visibleStudents.map((s) => (
                <option key={s.id} value={s.id}>{s.firstName} {s.lastName}</option>
              ))}
            </select>

            <select
              value={filters.termId || ''}
              onChange={(e) => onFilterTermChange(e.target.value)}
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
            >
              <option value="">Tous les trimestres</option>
              {termOptions.map((term) => (
                <option key={term.id} value={term.id}>{term.name}</option>
              ))}
            </select>

            <button
              type="button"
              onClick={onResetFilters}
              className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50"
            >
              Reinitialiser
            </button>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-slate-800">Page liste bulletins</h3>
        <button
          type="button"
          onClick={onRefresh}
          disabled={!canList || loading}
          className="text-xs px-2.5 py-1.5 border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50 disabled:opacity-50"
        >
          <span className="inline-flex items-center gap-1"><RefreshCw className="h-3.5 w-3.5" /> Actualiser</span>
        </button>
      </div>

      {loading && (
        <div className="text-sm text-slate-500 py-6 text-center">Chargement des bulletins...</div>
      )}

      {!loading && error && (
        <div className="text-sm text-rose-600 bg-rose-50 border border-rose-100 rounded-xl p-3">{error}</div>
      )}

      {!loading && !error && items.length === 0 && (
        <div className="text-sm text-slate-500 bg-slate-50 border border-slate-100 rounded-xl p-6 text-center">
          Aucun bulletin disponible pour ces filtres.
        </div>
      )}

      {!loading && !error && items.length > 0 && (
        <div className="space-y-2 max-h-[460px] overflow-y-auto pr-1">
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelect(item.id)}
              className={`w-full text-left border rounded-xl p-3 transition-all ${
                selectedId === item.id
                  ? 'border-indigo-300 bg-indigo-50/50'
                  : 'border-slate-100 hover:border-slate-200 hover:bg-slate-50/60'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-slate-800">{item.studentName}</p>
                  <p className="text-xs text-slate-500">{item.className} • {item.termName}</p>
                </div>
                <span className="text-[11px] px-2 py-1 rounded-full bg-slate-100 text-slate-600">ID {item.id}</span>
              </div>
              <div className="mt-2 text-xs text-slate-500 flex items-center justify-between">
                <span>Moyenne: {item.average == null ? '-' : item.average.toFixed(2)}</span>
                <span>Mention: {item.mention || '-'}</span>
              </div>
            </button>
          ))}
        </div>
      )}

      {canList && totalPages > 1 && (
        <div className="pt-1 flex items-center justify-between text-xs">
          <span className="text-slate-500">Page {page} / {totalPages} • {total} resultats</span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={page <= 1}
              onClick={onPrevPage}
              className="px-2.5 py-1.5 border border-slate-200 rounded-lg disabled:opacity-50"
            >
              Precedent
            </button>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={onNextPage}
              className="px-2.5 py-1.5 border border-slate-200 rounded-lg disabled:opacity-50"
            >
              Suivant
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
