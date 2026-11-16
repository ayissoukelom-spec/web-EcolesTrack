import { useState } from 'react';
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Clock3,
  FileSpreadsheet,
  FileText,
  Filter,
  RefreshCw,
  Search,
  ShieldAlert,
  UserRound,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import type { AuditEvent, AuditEventFilters, AuditEventsPage, School } from '../types.ts';
import { apiFetchBlob } from '../lib/api.ts';
import { translateAuditFieldName, translateAuditLabel } from '../lib/auditEventLabels.ts';

interface AuditViewProps {
  page: AuditEventsPage | null;
  isLoading?: boolean;
  onReload: (filters: AuditEventFilters) => void | Promise<void>;
  schoolsList: School[];
}

const initialFilters: AuditEventFilters = { page: 1 };
const inputClassName = 'w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100';

function displayValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return 'Non renseigné';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value, null, 2) ?? String(value);
}

function eventDate(event: AuditEvent): string {
  const rawTimestamp = event.occurredAt ?? event.createdAt;
  if (!rawTimestamp) return 'Date inconnue';
  const date = new Date(rawTimestamp);
  return Number.isNaN(date.getTime())
    ? 'Date inconnue'
    : date.toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short', hour12: false });
}

function actorIdentity(event: AuditEvent): string {
  const identity = [event.actorName, event.actorEmail].filter(Boolean).join(' · ');
  return identity || 'Identité historique inconnue';
}

function schoolLabel(name: string | null | undefined, id: number | null | undefined): string {
  if (name) return name;
  return id == null ? 'Non renseigné' : `Établissement #${id}`;
}

function resultLabel(result: string | null | undefined): string {
  return translateAuditLabel('result', result?.trim() ? result : 'unknown');
}

function AuditSummaryCard({
  label,
  value,
  icon: Icon,
  accent,
}: {
  label: string;
  value: number;
  icon: LucideIcon;
  accent: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
          <p className="mt-2 text-2xl font-bold text-slate-900">{value.toLocaleString('fr-FR')}</p>
        </div>
        <span className={`rounded-xl p-2 ${accent}`}>
          <Icon className="h-5 w-5" />
        </span>
      </div>
    </div>
  );
}

function AuditEventDetails({ event }: { event: AuditEvent }) {
  const before = event.beforeValues ?? {};
  const after = event.afterValues ?? {};
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
  const actorActiveSchool = event.auditContext
    ? schoolLabel(event.auditContext.actorActiveSchoolName, event.auditContext.actorActiveSchoolId)
    : 'Non renseigné';
  const targetSchoolId = event.schoolId ?? (event.resourceType === 'school' ? event.resourceId : null);

  return (
    <div className="border-t border-slate-200 bg-slate-50/80 px-4 py-5 sm:px-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <DetailField label="Identifiant de l’auteur" value={event.actorUserId == null ? 'Non renseigné' : String(event.actorUserId)} />
        <DetailField label="Identité historique" value={actorIdentity(event)} />
        <DetailField label="Rôle effectif" value={translateAuditLabel('role', event.actorRole)} />
        <DetailField label="Fonction active" value={event.activeFunctionName || event.activeFunctionId || 'Non renseignée'} />
        <DetailField label="Établissement actif de l’auteur" value={actorActiveSchool} />
        <DetailField label="Établissement concerné" value={schoolLabel(event.schoolNameSnapshot, targetSchoolId)} />
        <DetailField label="Date et heure" value={eventDate(event)} />
        <DetailField label="Module" value={translateAuditLabel('module', event.module)} />
        <DetailField label="Opération" value={translateAuditLabel('action', event.action)} />
        <DetailField
          label="Ressource"
          value={`${translateAuditLabel('resource', event.resourceType)}${event.resourceId == null ? '' : ` #${event.resourceId}`}`}
        />
        <DetailField label="Résultat" value={resultLabel(event.result)} />
        <DetailField label="Source" value={translateAuditLabel('source', event.source)} />
        <DetailField label="Adresse IP" value={event.ipAddress || 'Non renseignée'} />
        <DetailField label="Identifiant de corrélation" value={event.correlationId || 'Non renseigné'} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <h4 className="text-sm font-semibold text-slate-800">Différences des valeurs métier</h4>
          {keys.length === 0 ? (
            <p className="mt-2 text-sm text-slate-500">Aucune ancienne ou nouvelle valeur disponible pour cet événement.</p>
          ) : (
            <div className="mt-3 space-y-3">
              {keys.map((key) => {
                const hasBefore = Object.prototype.hasOwnProperty.call(before, key);
                const hasAfter = Object.prototype.hasOwnProperty.call(after, key);
                const oldValue = hasBefore ? displayValue(before[key]) : '—';
                const newValue = hasAfter ? displayValue(after[key]) : '—';
                const changed = oldValue !== newValue;
                return (
                  <div key={key} className="grid gap-2 rounded-lg bg-slate-50 p-3 sm:grid-cols-[minmax(90px,0.5fr)_1fr_1fr]">
                    <p className="break-words text-xs font-semibold text-slate-600">{translateAuditFieldName(key)}</p>
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Avant</p>
                      <pre className="mt-1 whitespace-pre-wrap break-words font-sans text-xs text-slate-700">{oldValue}</pre>
                    </div>
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Après</p>
                      <pre className={`mt-1 whitespace-pre-wrap break-words font-sans text-xs ${changed ? 'font-semibold text-indigo-800' : 'text-slate-700'}`}>{newValue}</pre>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        <div className="space-y-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <h4 className="text-sm font-semibold text-slate-800">Description</h4>
            <p className="mt-2 whitespace-pre-wrap break-words text-sm text-slate-600">{event.description || 'Non renseignée'}</p>
            <h4 className="mt-4 text-sm font-semibold text-slate-800">Motif</h4>
            <p className="mt-2 whitespace-pre-wrap break-words text-sm text-slate-600">{event.reason || 'Aucun motif renseigné.'}</p>
          </div>
          {event.auditContext && (
            <div className="rounded-xl border border-indigo-100 bg-indigo-50/70 p-4">
              <h4 className="text-sm font-semibold text-indigo-900">Contexte de l’auteur</h4>
              <p className="mt-1 text-xs text-indigo-800">
                L’établissement actif de l’auteur est une métadonnée de contexte; il ne constitue pas une valeur métier modifiée.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-1 break-words text-sm font-medium text-slate-700">{value}</p>
    </div>
  );
}

export default function AuditView({ page, isLoading = false, onReload, schoolsList }: AuditViewProps) {
  const [draftFilters, setDraftFilters] = useState<AuditEventFilters>(initialFilters);
  const [appliedFilters, setAppliedFilters] = useState<AuditEventFilters>(initialFilters);
  const [expandedEventIds, setExpandedEventIds] = useState<Set<number>>(new Set());
  const [exporting, setExporting] = useState<'xlsx' | 'pdf' | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const summary = page?.summary ?? {
    total: 0,
    distinctUsers: 0,
    successful: 0,
    denied: 0,
    failed: 0,
    unknown: 0,
  };
  const events = page?.events ?? [];
  const pagination = page?.pagination;

  const updateDraft = (
    key: 'schoolId' | 'user' | 'function' | 'module' | 'action' | 'result' | 'from' | 'to' | 'resource' | 'search',
    value: string,
  ) => {
    if (key === 'schoolId') {
      setDraftFilters((current) => ({ ...current, schoolId: value ? Number(value) : '', page: 1 }));
      return;
    }
    setDraftFilters((current) => ({ ...current, [key]: value, page: 1 }));
  };

  const applyFilters = (filters: AuditEventFilters) => {
    setAppliedFilters(filters);
    setExpandedEventIds(new Set());
    void onReload(filters);
  };

  const handleExport = async (format: 'xlsx' | 'pdf') => {
    setExporting(format);
    setExportError(null);
    try {
      const params = new URLSearchParams();
      Object.entries(appliedFilters).forEach(([key, value]) => {
        if (key !== 'page' && value !== undefined && value !== null && value !== '') {
          params.set(key, String(value));
        }
      });
      const blob = await apiFetchBlob(`/api/audit/events/export.${format}?${params.toString()}`);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `journal-audit-ecoletrack.${format}`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      const requestError = error as Error & { status?: number };
      setExportError(requestError.status === 413
        ? 'L’export est limité à 10 000 événements. Affinez les filtres.'
        : error instanceof Error ? error.message : 'L’export a échoué.');
    } finally {
      setExporting(null);
    }
  };

  const toggleEvent = (id: number) => {
    setExpandedEventIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 rounded-3xl bg-gradient-to-br from-slate-900 via-indigo-950 to-indigo-800 p-6 text-white shadow-sm sm:flex-row sm:items-center sm:justify-between sm:p-8">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-indigo-200">Espace Super Admin</p>
          <h2 className="mt-2 text-2xl font-bold sm:text-3xl">Journal des historiques</h2>
          <p className="mt-2 max-w-2xl text-sm text-indigo-100">
            Consultation en lecture seule des opérations, avec filtres et détails issus des données réellement enregistrées.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void handleExport('xlsx')}
            disabled={exporting !== null}
            className="inline-flex items-center gap-2 rounded-xl border border-white/20 bg-white/10 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <FileSpreadsheet className="h-4 w-4" />
            {exporting === 'xlsx' ? 'Export…' : 'Excel'}
          </button>
          <button
            type="button"
            onClick={() => void handleExport('pdf')}
            disabled={exporting !== null}
            className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-indigo-950 transition hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <FileText className="h-4 w-4" />
            {exporting === 'pdf' ? 'Export…' : 'PDF'}
          </button>
        </div>
      </header>

      {exportError && (
        <div role="alert" className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{exportError}</span>
        </div>
      )}
      <p className="text-xs text-slate-500">
        Un export contenant plus de 10&nbsp;000 événements doit être resserré à l’aide des filtres.
      </p>

      <section aria-label="Synthèse des événements" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <AuditSummaryCard label="Opérations au total" value={summary.total} icon={Clock3} accent="bg-indigo-50 text-indigo-700" />
        <AuditSummaryCard label="Utilisateurs distincts" value={summary.distinctUsers} icon={UserRound} accent="bg-sky-50 text-sky-700" />
        <AuditSummaryCard label="Réussies" value={summary.successful} icon={CheckCircle2} accent="bg-emerald-50 text-emerald-700" />
        <AuditSummaryCard label="Refusées" value={summary.denied} icon={ShieldAlert} accent="bg-amber-50 text-amber-700" />
        <AuditSummaryCard label="Échouées" value={summary.failed} icon={XCircle} accent="bg-rose-50 text-rose-700" />
        <AuditSummaryCard label="Résultat inconnu (historique)" value={summary.unknown} icon={AlertCircle} accent="bg-slate-100 text-slate-700" />
      </section>

      <form
        className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6"
        onSubmit={(event) => {
          event.preventDefault();
          applyFilters({ ...draftFilters, page: 1 });
        }}
      >
        <div className="mb-4 flex items-center gap-2">
          <Filter className="h-4 w-4 text-indigo-600" />
          <h3 className="text-base font-semibold text-slate-900">Recherche et filtres</h3>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="text-xs font-semibold text-slate-600">
            Établissement
            <select
              className={`${inputClassName} mt-1`}
              value={draftFilters.schoolId ?? ''}
              onChange={(event) => updateDraft('schoolId', event.target.value)}
            >
              <option value="">Tous les établissements</option>
              {schoolsList.map((school) => <option key={school.id} value={school.id}>{school.name}</option>)}
            </select>
          </label>
          <label className="text-xs font-semibold text-slate-600">
            Utilisateur (nom, courriel ou ID)
            <input className={`${inputClassName} mt-1`} value={draftFilters.user ?? ''} onChange={(event) => updateDraft('user', event.target.value)} />
          </label>
          <label className="text-xs font-semibold text-slate-600">
            Fonction
            <input className={`${inputClassName} mt-1`} value={draftFilters.function ?? ''} onChange={(event) => updateDraft('function', event.target.value)} />
          </label>
          <label className="text-xs font-semibold text-slate-600">
            Module
            <input className={`${inputClassName} mt-1`} value={draftFilters.module ?? ''} onChange={(event) => updateDraft('module', event.target.value)} />
          </label>
          <label className="text-xs font-semibold text-slate-600">
            Type d’opération
            <input className={`${inputClassName} mt-1`} value={draftFilters.action ?? ''} onChange={(event) => updateDraft('action', event.target.value)} />
          </label>
          <label className="text-xs font-semibold text-slate-600">
            Résultat
            <select
              className={`${inputClassName} mt-1`}
              value={draftFilters.result ?? ''}
              onChange={(event) => updateDraft('result', event.target.value)}
            >
              <option value="">Tous les résultats</option>
              <option value="success">Réussie</option>
              <option value="denied">Refusée</option>
              <option value="failure">Échouée</option>
              <option value="unknown">Inconnu (historique)</option>
            </select>
          </label>
          <label className="text-xs font-semibold text-slate-600">
            Date de début
            <input type="date" className={`${inputClassName} mt-1`} value={draftFilters.from ?? ''} onChange={(event) => updateDraft('from', event.target.value)} />
          </label>
          <label className="text-xs font-semibold text-slate-600">
            Date de fin
            <input type="date" className={`${inputClassName} mt-1`} value={draftFilters.to ?? ''} onChange={(event) => updateDraft('to', event.target.value)} />
          </label>
          <label className="text-xs font-semibold text-slate-600">
            Ressource concernée
            <input className={`${inputClassName} mt-1`} value={draftFilters.resource ?? ''} onChange={(event) => updateDraft('resource', event.target.value)} />
          </label>
          <label className="text-xs font-semibold text-slate-600 sm:col-span-2 lg:col-span-3">
            Recherche textuelle
            <input className={`${inputClassName} mt-1`} value={draftFilters.search ?? ''} onChange={(event) => updateDraft('search', event.target.value)} placeholder="Description, auteur, module, opération…" />
          </label>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button type="submit" disabled={isLoading} className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-50">
            <Search className="h-4 w-4" />
            Appliquer les filtres
          </button>
          <button
            type="button"
            disabled={isLoading}
            onClick={() => {
              setDraftFilters(initialFilters);
              applyFilters(initialFilters);
            }}
            className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
          >
            Réinitialiser
          </button>
          <button
            type="button"
            disabled={isLoading}
            onClick={() => void onReload(appliedFilters)}
            className="ml-auto inline-flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
            Actualiser
          </button>
        </div>
      </form>

      <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-4 sm:px-6">
          <div>
            <h3 className="font-semibold text-slate-900">Événements</h3>
            <p className="mt-1 text-xs text-slate-500">
              {pagination ? `${pagination.total.toLocaleString('fr-FR')} résultat${pagination.total > 1 ? 's' : ''}` : 'Chargement des résultats'}
              {pagination && pagination.total > 0 ? ` · page ${pagination.page} sur ${pagination.totalPages}` : ''}
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <span className="h-2 w-2 rounded-full bg-emerald-500" />
            Consultation en lecture seule
          </div>
        </div>

        {isLoading ? (
          <div className="p-10 text-center text-sm text-slate-500">Chargement de la page d’historiques…</div>
        ) : events.length === 0 ? (
          <div className="p-10 text-center text-sm text-slate-500">Aucun événement ne correspond à ces filtres.</div>
        ) : (
          <div className="divide-y divide-slate-100">
            {events.map((event) => {
              const expanded = expandedEventIds.has(event.id);
              const success = event.result === 'success';
              const denied = event.result === 'denied';
              const actor = actorIdentity(event);
              const targetSchoolId = event.schoolId ?? (event.resourceType === 'school' ? event.resourceId : null);
              return (
                <article key={event.id} className="transition-colors hover:bg-slate-50/70">
                  <button
                    type="button"
                    aria-expanded={expanded}
                    onClick={() => toggleEvent(event.id)}
                    className="grid w-full gap-3 px-4 py-4 text-left sm:grid-cols-[minmax(0,1.3fr)_minmax(130px,0.7fr)_minmax(130px,0.7fr)_auto] sm:items-center sm:px-6"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-slate-900">{event.description || 'Description non renseignée'}</span>
                      <span className="mt-1 block truncate text-xs text-slate-500">{actor} · {translateAuditLabel('role', event.actorRole)}</span>
                    </span>
                    <span className="text-sm text-slate-700">
                      <span className="block">{translateAuditLabel('module', event.module)}</span>
                      <span className="mt-1 block text-xs text-slate-500">{translateAuditLabel('action', event.action)}</span>
                    </span>
                    <span className="text-sm text-slate-700">
                      <span className="block">{translateAuditLabel('resource', event.resourceType)}{event.resourceId == null ? '' : ` #${event.resourceId}`}</span>
                      <span className="mt-1 block text-xs text-slate-500">{schoolLabel(event.schoolNameSnapshot, targetSchoolId)}</span>
                    </span>
                    <span className="flex items-center justify-between gap-3 sm:justify-end">
                      <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${
                        success ? 'bg-emerald-50 text-emerald-700'
                          : denied ? 'bg-amber-50 text-amber-700'
                            : event.result === 'failure' ? 'bg-rose-50 text-rose-700'
                              : 'bg-slate-100 text-slate-600'
                      }`}>
                        {resultLabel(event.result)}
                      </span>
                      <span className="inline-flex items-center gap-1 text-xs text-slate-500">
                        <Clock3 className="h-3.5 w-3.5" />
                        {eventDate(event)}
                      </span>
                      {expanded ? <ArrowUp className="h-4 w-4 text-slate-400" /> : <ArrowDown className="h-4 w-4 text-slate-400" />}
                    </span>
                  </button>
                  {expanded && <AuditEventDetails event={event} />}
                </article>
              );
            })}
          </div>
        )}

        <footer className="flex items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-4 py-3 sm:px-6">
          <span className="text-xs text-slate-500">25 événements par page</span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={isLoading || !pagination || pagination.page <= 1}
              onClick={() => applyFilters({ ...appliedFilters, page: Math.max(1, (pagination?.page ?? 1) - 1) })}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ArrowDown className="h-3.5 w-3.5 rotate-90" />
              Précédent
            </button>
            <button
              type="button"
              disabled={isLoading || !pagination || pagination.page >= pagination.totalPages}
              onClick={() => applyFilters({ ...appliedFilters, page: (pagination?.page ?? 1) + 1 })}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Suivant
              <ArrowDown className="h-3.5 w-3.5 -rotate-90" />
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
