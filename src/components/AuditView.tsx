import React from 'react';
import { AuditEvent } from '../types.ts';
import { Clock3, UserCheck, RefreshCw } from 'lucide-react';

interface AuditViewProps {
  auditEvents: AuditEvent[];
  isLoading?: boolean;
  onReload?: () => void;
}

export default function AuditView({ auditEvents, isLoading = false, onReload }: AuditViewProps) {
  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">Journal des actions</h2>
          <p className="text-sm text-slate-500">Historique des modifications et créations réalisées par les administrateurs écoles.</p>
        </div>
        <div className="flex flex-col sm:flex-row items-center gap-2">
          <div className="inline-flex items-center gap-2 rounded-2xl bg-slate-100 px-4 py-2 text-sm text-slate-600">
            <UserCheck className="h-4.5 w-4.5" />
            {auditEvents.length} événement{auditEvents.length > 1 ? 's' : ''}
          </div>
          <button
            type="button"
            onClick={onReload}
            disabled={isLoading}
            className="inline-flex items-center gap-2 rounded-2xl bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            <RefreshCw className={`h-4.5 w-4.5 ${isLoading ? 'animate-spin' : ''}`} />
            {isLoading ? 'Chargement...' : 'Recharger'}
          </button>
        </div>
      </div>

      <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="grid grid-cols-[1fr_auto_1fr] gap-4 p-4 bg-slate-50 text-slate-500 text-xs uppercase tracking-[0.18em] font-semibold">
          <span>Description</span>
          <span className="text-right">Ressource</span>
          <span className="text-right">Date</span>
        </div>
        <div className="divide-y divide-slate-100">
          {auditEvents.length === 0 ? (
            <div className="p-8 text-center text-slate-500">Aucun événement enregistré pour le moment.</div>
          ) : (
            auditEvents.map((event) => (
              <div key={event.id} className="grid grid-cols-[1fr_auto_1fr] gap-4 p-4 hover:bg-slate-50 transition-colors">
                <div>
                  <p className="text-sm font-semibold text-slate-900">{event.description}</p>
                  <p className="text-xs text-slate-500 mt-1">{event.actorEmail || event.actorName || 'Système'} · {event.actorRole}</p>
                </div>
                <div className="text-right text-sm text-slate-700">
                  <p>{event.resourceType}</p>
                  <p className="text-xs text-slate-500">ID {event.resourceId ?? '—'}</p>
                </div>
                <div className="text-right text-slate-500 text-xs font-medium">
                  <div className="flex items-center justify-end gap-2">
                    <Clock3 className="h-3.5 w-3.5" />
                    <span>{(() => {
                      const timestamp = event.createdAt ? new Date(event.createdAt) : null;
                      return timestamp && !Number.isNaN(timestamp.getTime())
                        ? timestamp.toLocaleString('fr-FR', { hour12: false })
                        : 'Date inconnue';
                    })()}</span>
                  </div>
                  {event.schoolId != null && <p className="text-xs text-slate-400 mt-1">École #{event.schoolId}</p>}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
