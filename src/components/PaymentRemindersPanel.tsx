import { useEffect, useMemo, useState } from 'react';
import type { Class } from '../types.ts';
import { apiFetch } from '../lib/api.ts';
import type {
  AccountingReminderStatus,
  AccountingReminderStatusFilter,
  AmbiguousAccountingReminderInstallment,
  AccountingReminderInstallmentLine,
} from '../lib/accountingPaymentReminders.ts';

type PaymentReminderCandidate = {
  studentId: number;
  firstName: string;
  lastName: string;
  className: string | null;
  obligationClassNames: string[];
  installments: AccountingReminderInstallmentLine[];
  ambiguousInstallments: AmbiguousAccountingReminderInstallment[];
  matchedInstallmentCount: number;
  settledInstallmentCount: number;
  totalRemaining: number;
  earliestDueDate: string | null;
  status: AccountingReminderStatus | 'mixed' | 'undetermined' | 'settled' | 'none';
  canSend: boolean;
  alreadyNotified: boolean;
  reason: string | null;
  message: string | null;
  dedupeKey: string | null;
};

type ReminderPreview = {
  previewFingerprint: string;
  candidates: PaymentReminderCandidate[];
  deliveryChannel: 'in_app';
};

type ReminderOperationResult = {
  selectedStudentCount: number;
  createdNotifications: number;
  duplicateCount: number;
  excludedZeroBalance: number;
  excludedAmbiguous: number;
  excludedNoRecipient: number;
  excludedNoMatchingInstallments: number;
  studentsWithAmbiguousInstallments: number;
  ambiguousInstallmentCount: number;
  failedCount: number;
  deliveryChannel: 'in_app';
};

interface PaymentRemindersPanelProps {
  schoolId: number;
  schoolName: string;
  yearId: number | null;
  yearName: string;
  classes: Class[];
}

const formatMoney = (amount: number) => `${Number(amount || 0).toLocaleString('fr-FR')} FCFA`;

const formatDate = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return 'Date indéterminée';
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) return 'Date indéterminée';
  return new Intl.DateTimeFormat('fr-FR', { timeZone: 'UTC' }).format(date);
};

const normalizeSearch = (value: string) => value
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .trim()
  .replace(/\s+/g, ' ')
  .toLocaleLowerCase('fr');

const statusLabels: Record<PaymentReminderCandidate['status'], string> = {
  upcoming: 'À venir',
  today: 'À régler aujourd’hui',
  overdue: 'En retard',
  mixed: 'Situations mixtes',
  undetermined: 'Solde indéterminé',
  settled: 'Soldé',
  none: 'Aucune échéance correspondante',
};

const installmentStatusLabels: Record<AccountingReminderStatus, string> = {
  upcoming: 'À venir',
  today: 'À régler aujourd’hui',
  overdue: 'En retard',
};

export default function PaymentRemindersPanel({
  schoolId,
  schoolName,
  yearId,
  yearName,
  classes,
}: PaymentRemindersPanelProps) {
  const [classId, setClassId] = useState<number | null>(null);
  const [status, setStatus] = useState<AccountingReminderStatusFilter>('all');
  const [search, setSearch] = useState('');
  const [candidates, setCandidates] = useState<PaymentReminderCandidate[]>([]);
  const [selectedStudentIds, setSelectedStudentIds] = useState<number[]>([]);
  const [preview, setPreview] = useState<ReminderPreview | null>(null);
  const [previewStudentIds, setPreviewStudentIds] = useState<number[]>([]);
  const [result, setResult] = useState<ReminderOperationResult | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refreshVersion, setRefreshVersion] = useState(0);

  useEffect(() => {
    if (!schoolId || !yearId) {
      setCandidates([]);
      setLoading(false);
      return;
    }

    let cancelled = false;
    const params = new URLSearchParams({
      schoolId: String(schoolId),
      academicYearId: String(yearId),
      status,
    });
    if (classId != null) params.set('classId', String(classId));
    setLoading(true);
    setError('');
    apiFetch(`/api/accounting/reminders/candidates?${params.toString()}`)
      .then((response) => {
        if (!cancelled) setCandidates((response.candidates ?? []) as PaymentReminderCandidate[]);
      })
      .catch((loadError) => {
        if (!cancelled) {
          setCandidates([]);
          setError(loadError instanceof Error
            ? loadError.message
            : 'Impossible de charger les élèves concernés par les rappels.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [classId, refreshVersion, schoolId, status, yearId]);

  const visibleCandidates = useMemo(() => {
    const normalizedSearch = normalizeSearch(search);
    if (!normalizedSearch) return candidates;
    return candidates.filter((candidate) => normalizeSearch(
      `${candidate.firstName} ${candidate.lastName} ${candidate.lastName} ${candidate.firstName}`,
    ).includes(normalizedSearch));
  }, [candidates, search]);

  const selectableVisibleIds = visibleCandidates
    .filter((candidate) => candidate.canSend)
    .map((candidate) => candidate.studentId);
  const sendablePreviewCount = preview?.candidates.filter((candidate) => candidate.canSend).length ?? 0;

  const updateScope = (next: { classId?: number | null; status?: AccountingReminderStatusFilter }) => {
    setClassId(next.classId === undefined ? classId : next.classId);
    setStatus(next.status ?? status);
    setSelectedStudentIds([]);
    setPreview(null);
    setPreviewStudentIds([]);
    setResult(null);
  };

  const getRequestBody = (studentIds: number[]) => ({
    schoolId,
    academicYearId: yearId,
    classId,
    status,
    studentIds,
  });

  const requestPreview = async (studentIds: number[]) => {
    const response = await apiFetch('/api/accounting/reminders/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(getRequestBody(studentIds)),
    });
    setPreview(response as ReminderPreview);
    setPreviewStudentIds(studentIds);
    setResult(null);
  };

  const confirmReminders = async () => {
    if (!preview || !previewStudentIds.length) return;
    setBusy(true);
    setError('');
    try {
      const response = await apiFetch('/api/accounting/reminders/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...getRequestBody(previewStudentIds),
          previewFingerprint: preview.previewFingerprint,
        }),
      });
      setResult(response as ReminderOperationResult);
      setPreview(null);
      setPreviewStudentIds([]);
      setSelectedStudentIds([]);
      setRefreshVersion((current) => current + 1);
    } catch (confirmError) {
      if (confirmError && typeof confirmError === 'object'
        && 'code' in confirmError
        && confirmError.code === 'ACCOUNTING_REMINDER_PREVIEW_STALE') {
        setError('Les soldes ou les destinataires ont changé. Le nouvel aperçu doit être vérifié avant toute confirmation.');
        try {
          await requestPreview(previewStudentIds);
        } catch (previewError) {
          setError(previewError instanceof Error
            ? previewError.message
            : 'Le nouvel aperçu n’a pas pu être chargé. Aucun rappel n’a été créé.');
        }
      } else {
        setError(confirmError instanceof Error
          ? confirmError.message
          : 'La confirmation a échoué. Vérifiez le résultat avant de réessayer.');
      }
    } finally {
      setBusy(false);
    }
  };

  if (!yearId) {
    return (
      <section className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900" aria-label="Rappels de paiement">
        Sélectionnez une année scolaire pour consulter les échéances rappelables.
      </section>
    );
  }

  return (
    <section className="space-y-5" aria-label="Rappels de paiement">
      <header>
        <h2 className="text-xl font-bold text-slate-900">Rappels de paiement</h2>
        <p className="mt-1 text-sm text-slate-600">{schoolName} · {yearName}</p>
        <p className="mt-2 rounded-lg border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900">
          Les rappels sont créés uniquement dans le fil interne du compte parent, après votre confirmation.
          Aucun push, SMS ou email n’est envoyé. EcoleTrack ne fournit pas de préférence de rappel par canal.
        </p>
      </header>

      <div className="flex flex-wrap items-end gap-3">
        <label className="grid gap-1 text-xs font-semibold text-slate-600">
          Classe de l’obligation
          <select
            aria-label="Classe des rappels"
            className="min-w-52 rounded-lg border border-slate-200 p-2 text-sm font-normal"
            value={classId ?? ''}
            disabled={Boolean(preview) || busy}
            onChange={(event) => updateScope({ classId: Number(event.target.value) || null })}
          >
            <option value="">Toutes les classes</option>
            {classes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-xs font-semibold text-slate-600">
          Situation des échéances
          <select
            aria-label="Situation des rappels"
            className="min-w-52 rounded-lg border border-slate-200 p-2 text-sm font-normal"
            value={status}
            disabled={Boolean(preview) || busy}
            onChange={(event) => updateScope({
              status: (event.target.value || 'all') as AccountingReminderStatusFilter,
            })}
          >
            <option value="all">Toutes les échéances éligibles</option>
            <option value="upcoming">À venir (7 jours, hors aujourd’hui)</option>
            <option value="today">À régler aujourd’hui</option>
            <option value="overdue">En retard</option>
          </select>
        </label>
        <label className="grid gap-1 text-xs font-semibold text-slate-600">
          Rechercher un élève
          <input
            aria-label="Rechercher un élève dans les rappels"
            className="min-w-56 rounded-lg border border-slate-200 p-2 text-sm font-normal"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Nom ou prénom"
            disabled={Boolean(preview) || busy}
          />
        </label>
        {search && (
          <button
            type="button"
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-600"
            onClick={() => setSearch('')}
            disabled={Boolean(preview) || busy}
          >
            Effacer la recherche
          </button>
        )}
        <button
          type="button"
          className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700"
          onClick={() => setRefreshVersion((current) => current + 1)}
          disabled={loading || busy || Boolean(preview)}
        >
          Actualiser les soldes
        </button>
      </div>

      {error && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
      {result && (
        <div role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
          <p className="font-bold">Résultat de l’opération — notifications internes enregistrées</p>
          <p className="mt-1">
            Élèves sélectionnés : {result.selectedStudentCount} · Notifications créées : {result.createdNotifications}
            {' · '}Doublons évités : {result.duplicateCount}
          </p>
          <p>
            Soldes nuls : {result.excludedZeroBalance} · Élèves exclus pour solde ambigu : {result.excludedAmbiguous}
            {' · '}Sans parent actif : {result.excludedNoRecipient}
            {' · '}Sans échéance correspondante : {result.excludedNoMatchingInstallments}
          </p>
          <p>
            Élèves avec échéances ambiguës : {result.studentsWithAmbiguousInstallments}
            {' · '}Échéances ambiguës : {result.ambiguousInstallmentCount}
            {' · '}Échecs : {result.failedCount}
          </p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <button
          type="button"
          className="rounded-lg border border-indigo-200 px-3 py-2 font-semibold text-indigo-700 disabled:opacity-50"
          disabled={loading || busy || Boolean(preview) || selectableVisibleIds.length === 0}
          onClick={() => setSelectedStudentIds((current) => [
            ...new Set([...current, ...selectableVisibleIds]),
          ])}
        >
          Sélectionner les élèves affichés
        </button>
        <button
          type="button"
          className="rounded-lg border border-slate-200 px-3 py-2 font-semibold text-slate-700 disabled:opacity-50"
          disabled={loading || busy || Boolean(preview) || selectableVisibleIds.length === 0}
          onClick={() => setSelectedStudentIds((current) =>
            current.filter((studentId) => !selectableVisibleIds.includes(studentId)))}
        >
          Désélectionner les élèves affichés
        </button>
        <button
          type="button"
          className="rounded-lg border border-slate-200 px-3 py-2 font-semibold text-slate-700 disabled:opacity-50"
          disabled={loading || busy || Boolean(preview) || selectedStudentIds.length === 0}
          onClick={() => {
            setSelectedStudentIds([]);
            setPreview(null);
            setPreviewStudentIds([]);
          }}
        >
          Effacer toute la sélection
        </button>
        <span className="text-slate-600">{selectedStudentIds.length} élève(s) sélectionné(s)</span>
        <span className="text-xs text-slate-500">Les actions de sélection portent uniquement sur les élèves affichés.</span>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200">
        <table className="w-full min-w-[980px] text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-3">Sélection</th>
              <th className="px-3 py-3">Élève</th>
              <th className="px-3 py-3">Classe</th>
              <th className="px-3 py-3 text-right">Échéances</th>
              <th className="px-3 py-3 text-right">Total rappelable</th>
              <th className="px-3 py-3">Échéance la plus proche</th>
              <th className="px-3 py-3">Situation</th>
              <th className="px-3 py-3">Détail</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {visibleCandidates.map((candidate) => (
              <tr key={candidate.studentId}>
                <td className="px-3 py-3">
                  <input
                    type="checkbox"
                    aria-label={`Sélectionner ${candidate.firstName} ${candidate.lastName}`}
                    checked={selectedStudentIds.includes(candidate.studentId)}
                    disabled={!candidate.canSend || loading || busy || Boolean(preview)}
                    onChange={(event) => {
                      setSelectedStudentIds((current) => event.target.checked
                        ? [...new Set([...current, candidate.studentId])]
                        : current.filter((id) => id !== candidate.studentId));
                      setPreview(null);
                      setPreviewStudentIds([]);
                    }}
                  />
                </td>
                <td className="px-3 py-3 font-semibold">{candidate.lastName} {candidate.firstName}</td>
                <td className="px-3 py-3">
                  {candidate.className ?? 'Sans classe'}
                  {candidate.obligationClassNames.length > 0 && (
                    <span className="block text-xs text-slate-500">
                      Obligations : {candidate.obligationClassNames.join(', ')}
                    </span>
                  )}
                </td>
                <td className="px-3 py-3 text-right">{candidate.installments.length}</td>
                <td className="px-3 py-3 text-right font-semibold">{formatMoney(candidate.totalRemaining)}</td>
                <td className="px-3 py-3">{candidate.earliestDueDate ? formatDate(candidate.earliestDueDate) : '—'}</td>
                <td className="px-3 py-3">
                  <span>{statusLabels[candidate.status]}</span>
                  {candidate.reason && <span className="mt-1 block max-w-xs text-xs text-amber-800">{candidate.reason}</span>}
                  {candidate.ambiguousInstallments.length > 0 && (
                    <span className="mt-1 block text-xs text-amber-800">
                      {candidate.ambiguousInstallments.length} échéance(s) exclue(s) du montant rappelable.
                    </span>
                  )}
                </td>
                <td className="px-3 py-3">
                  <details>
                    <summary className="cursor-pointer font-semibold text-indigo-700">
                      Voir les échéances ({candidate.installments.length + candidate.ambiguousInstallments.length})
                    </summary>
                    <ul className="mt-2 min-w-72 space-y-2 text-xs">
                      {candidate.installments.map((installment) => (
                        <li key={installment.id} className="rounded-md bg-slate-50 p-2">
                          <span className="font-semibold">
                            {installment.categoryLabel} — {installment.feeLabel} — {installment.label}
                          </span>
                          <span className="block">
                            {installmentStatusLabels[installment.status]} · {formatDate(installment.dueDate)}
                          </span>
                          <span className="block">
                            Montant initial : {formatMoney(installment.amount)} · Payé net : {formatMoney(installment.paid)}
                            {' · '}Reste : {formatMoney(installment.remaining)}
                          </span>
                        </li>
                      ))}
                      {candidate.ambiguousInstallments.map((installment) => (
                        <li key={`ambiguous-${installment.id}`} className="rounded-md bg-amber-50 p-2 text-amber-900">
                          <span className="font-semibold">
                            {installment.categoryLabel} — {installment.feeLabel} — {installment.label}
                          </span>
                          <span className="block">
                            {installment.status ? installmentStatusLabels[installment.status] : 'Situation indéterminée'}
                            {' · '}{formatDate(installment.dueDate)}
                          </span>
                          <span className="block">{installment.reason} Aucun montant restant n’est présenté comme certain.</span>
                        </li>
                      ))}
                    </ul>
                  </details>
                </td>
              </tr>
            ))}
            {!visibleCandidates.length && (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-slate-500">
                  {loading
                    ? 'Chargement des échéances…'
                    : search
                      ? 'Aucun élève ne correspond à cette recherche.'
                      : 'Aucune échéance rappelable ou ambiguë pour ces filtres.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {loading && <p role="status" className="text-sm text-slate-500">Recalcul des échéances et des soldes…</p>}
      <button
        type="button"
        className="rounded-lg bg-indigo-700 px-4 py-2.5 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"
        disabled={busy || loading || Boolean(preview) || selectedStudentIds.length === 0}
        onClick={async () => {
          setBusy(true);
          setError('');
          try {
            await requestPreview(selectedStudentIds);
          } catch (previewError) {
            setError(previewError instanceof Error
              ? previewError.message
              : 'Impossible de prévisualiser les rappels.');
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy && !preview ? 'Préparation…' : `Prévisualiser ${selectedStudentIds.length} élève(s)`}
      </button>

      {preview && (
        <section className="space-y-4 rounded-xl border-2 border-indigo-200 bg-indigo-50/40 p-4" aria-label="Prévisualisation des rappels">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-lg font-bold text-slate-900">Prévisualisation avant confirmation</h3>
              <p className="text-sm text-slate-600">
                Un message interne distinct par élève. Les montants sont recalculés côté serveur.
              </p>
            </div>
            <button
              type="button"
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold"
              disabled={busy}
              onClick={() => {
                setPreview(null);
                setPreviewStudentIds([]);
              }}
            >
              Annuler l’aperçu
            </button>
          </div>
          <div className="space-y-3">
            {preview.candidates.map((candidate) => (
              <article key={candidate.studentId} className="rounded-lg border border-slate-200 bg-white p-3">
                <h4 className="font-bold">{candidate.lastName} {candidate.firstName}</h4>
                {candidate.message ? (
                  <pre className="mt-2 whitespace-pre-wrap break-words rounded-md bg-slate-50 p-3 text-xs leading-relaxed">
                    {candidate.message}
                  </pre>
                ) : (
                  <p className="mt-2 rounded-md bg-amber-50 p-3 text-sm text-amber-900">
                    {candidate.reason ?? 'Aucun rappel ne peut être créé pour cet élève.'}
                  </p>
                )}
                {candidate.ambiguousInstallments.length > 0 && (
                  <p className="mt-2 text-xs text-amber-800">
                    {candidate.ambiguousInstallments.length} échéance(s) restent indéterminées et ne figurent pas dans le message.
                  </p>
                )}
                {candidate.alreadyNotified && (
                  <p className="mt-2 text-xs font-semibold text-amber-800">
                    Un rappel pour cet ensemble d’échéances existe déjà ; aucun doublon ne sera créé.
                  </p>
                )}
              </article>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              className="rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"
              disabled={busy || sendablePreviewCount === 0}
              onClick={confirmReminders}
            >
              {busy ? 'Confirmation…' : `Confirmer la création de ${sendablePreviewCount} notification(s) interne(s)`}
            </button>
            {sendablePreviewCount === 0 && (
              <span className="text-sm text-slate-600">Aucune notification ne peut être créée avec cet aperçu.</span>
            )}
          </div>
        </section>
      )}
    </section>
  );
}
