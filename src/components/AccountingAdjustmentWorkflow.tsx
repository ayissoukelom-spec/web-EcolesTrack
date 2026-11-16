import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { ReactNode } from 'react';
import type { UserRole } from '../types.ts';
import { apiFetch } from '../lib/api.ts';
import ModalSurface from './ModalSurface.tsx';

type PaymentRow = {
  id: number;
  schoolName: string;
  studentId: number;
  studentName: string;
  className: string | null;
  academicYearId: number;
  amount: number;
  method: string;
  paidAt: string;
  status: string;
  receiptId: number | null;
  receiptNumber: string | null;
};

type AdjustmentRequest = {
  id: number;
  schoolName: string;
  paymentId: number;
  paymentAmount: number;
  studentFirstName: string;
  studentLastName: string;
  className: string | null;
  kind: 'cancellation' | 'refund';
  amount: number | null;
  reason: string;
  status: 'pending' | 'approved' | 'rejected';
  requestedByUserId: number;
  requestedByName: string | null;
  requestedByEmail: string | null;
  requestedAt: string;
  decidedByName: string | null;
  decidedByEmail: string | null;
  decidedAt: string | null;
  decisionReason: string | null;
  resultingAdjustmentId: number | null;
  refundConfirmedByName: string | null;
  refundConfirmedByEmail: string | null;
  refundConfirmedAt: string | null;
};

interface AccountingAdjustmentWorkflowProps {
  userRole: UserRole;
  schoolId: number | null;
  currentUserId: number | null;
  refreshToken: number;
  onFinancialDataChanged: () => void;
  renderReceiptActions: (
    receiptId?: number | null,
    receiptNumber?: string | null,
    paymentStatus?: string,
  ) => ReactNode;
}

const formatMoney = (amount: number) => `${Number(amount || 0).toLocaleString('fr-FR')} FCFA`;

const formatDate = (value: string | null | undefined) => {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('fr-FR');
};

const normalizeSearchText = (value: string) => value
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLocaleLowerCase('fr');

const formatDateInputValue = (date: Date) => (
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
);

const getRequestStatusLabel = (request: AdjustmentRequest) => {
  if (request.status === 'pending') return 'En attente de validation';
  if (request.status === 'rejected') return 'Refusée';
  if (request.kind === 'cancellation') return 'Annulation effectuée';
  return request.refundConfirmedAt
    ? 'Remboursement effectué'
    : 'Remboursement autorisé — en attente de restitution';
};

const isRequestActive = (request: AdjustmentRequest) => request.status === 'pending'
  || (request.status === 'approved'
    && request.kind === 'refund'
    && request.resultingAdjustmentId == null);

export default function AccountingAdjustmentWorkflow({
  userRole,
  schoolId,
  currentUserId,
  refreshToken,
  onFinancialDataChanged,
  renderReceiptActions,
}: AccountingAdjustmentWorkflowProps) {
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [requests, setRequests] = useState<AdjustmentRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [selectedPayment, setSelectedPayment] = useState<PaymentRow | null>(null);
  const [requestKind, setRequestKind] = useState<'cancellation' | 'refund'>('cancellation');
  const [requestAmount, setRequestAmount] = useState('');
  const [requestReason, setRequestReason] = useState('');
  const [requestBusy, setRequestBusy] = useState(false);
  const requestSubmitLock = useRef(false);
  const requestAttempt = useRef<{ fingerprint: string; idempotencyKey: string } | null>(null);
  const [decisionReasons, setDecisionReasons] = useState<Record<number, string>>({});
  const [busyRequestId, setBusyRequestId] = useState<number | null>(null);
  const [directPayment, setDirectPayment] = useState<PaymentRow | null>(null);
  const [directKind, setDirectKind] = useState<'cancellation' | 'refund'>('cancellation');
  const [directAmount, setDirectAmount] = useState('');
  const [directReason, setDirectReason] = useState('');
  const [directBusy, setDirectBusy] = useState(false);
  const directAdjustmentAttempt = useRef<{ fingerprint: string; idempotencyKey: string } | null>(null);
  const [studentSearch, setStudentSearch] = useState('');
  const [classFilter, setClassFilter] = useState('');
  const [kindFilter, setKindFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [requestedFrom, setRequestedFrom] = useState('');
  const [requestedTo, setRequestedTo] = useState('');

  const canRequest = userRole === 'school_accountant';
  const canReview = userRole === 'school_admin';
  const canConfirmRefund = userRole === 'school_accountant';
  const isSuperAdmin = userRole === 'super_admin';
  const canDirectAdjust = isSuperAdmin && schoolId != null;

  const reload = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const paymentQuery = new URLSearchParams();
      const requestQuery = new URLSearchParams();
      if (schoolId != null) {
        paymentQuery.set('schoolId', String(schoolId));
        requestQuery.set('schoolId', String(schoolId));
      }
      const [paymentRows, requestRows] = await Promise.all([
        apiFetch(`/api/accounting/payments${paymentQuery.toString() ? `?${paymentQuery.toString()}` : ''}`),
        apiFetch(`/api/accounting/adjustment-requests${requestQuery.toString() ? `?${requestQuery.toString()}` : ''}`),
      ]);
      setPayments(Array.isArray(paymentRows) ? paymentRows : []);
      setRequests(Array.isArray(requestRows) ? requestRows : []);
    } catch (loadError) {
      setError(loadError instanceof Error
        ? loadError.message
        : 'Impossible de charger l’historique des paiements et des demandes.');
    } finally {
      setLoading(false);
    }
  }, [schoolId]);

  useEffect(() => {
    void reload();
  }, [reload, refreshToken]);

  useEffect(() => {
    setClassFilter('');
  }, [schoolId]);

  const activeRequestByPaymentId = useMemo(() => {
    const active = new Map<number, AdjustmentRequest>();
    for (const request of requests) {
      if (isRequestActive(request)) active.set(request.paymentId, request);
    }
    return active;
  }, [requests]);
  const requestClassOptions = useMemo(() => Array.from(new Set(
    requests.map((request) => request.className?.trim()).filter((name): name is string => Boolean(name)),
  )).sort((left, right) => left.localeCompare(right, 'fr')), [requests]);
  const filteredRequests = useMemo(() => {
    const searchTokens = normalizeSearchText(studentSearch).split(/\s+/).filter(Boolean);
    return requests.filter((request) => {
      const studentNames = normalizeSearchText(
        `${request.studentFirstName} ${request.studentLastName} ${request.studentLastName} ${request.studentFirstName}`,
      );
      const requestedDate = new Date(request.requestedAt);
      if (Number.isNaN(requestedDate.getTime())) return false;
      const requestedDateKey = formatDateInputValue(requestedDate);
      return searchTokens.every((token) => studentNames.includes(token))
        && (!classFilter || request.className === classFilter)
        && (!kindFilter || request.kind === kindFilter)
        && (!statusFilter || request.status === statusFilter)
        && (!requestedFrom || requestedDateKey >= requestedFrom)
        && (!requestedTo || requestedDateKey <= requestedTo);
    });
  }, [classFilter, kindFilter, requestedFrom, requestedTo, requests, statusFilter, studentSearch]);

  const openRequestForm = (payment: PaymentRow, kind: 'cancellation' | 'refund') => {
    setSelectedPayment(payment);
    setRequestKind(kind);
    setRequestAmount('');
    setRequestReason('');
    requestAttempt.current = null;
    requestSubmitLock.current = false;
    setError('');
    setNotice('');
  };

  const openDirectAdjustmentForm = (payment: PaymentRow, kind: 'cancellation' | 'refund') => {
    setDirectPayment(payment);
    setDirectKind(kind);
    setDirectAmount('');
    setDirectReason('');
    directAdjustmentAttempt.current = null;
    setError('');
    setNotice('');
  };

  const submitRequest = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedPayment || !canRequest || requestBusy || requestSubmitLock.current) return;
    const reason = requestReason.trim();
    const amount = requestKind === 'refund' ? Number(requestAmount) : null;
    if (!reason || reason.length > 500) {
      setError('Le motif est obligatoire et ne peut pas dépasser 500 caractères.');
      return;
    }
    if (requestKind === 'refund'
      && (!Number.isSafeInteger(amount) || amount == null || amount <= 0 || amount > selectedPayment.amount)) {
      setError('Saisissez un montant entier positif, inférieur ou égal au paiement.');
      return;
    }

    const fingerprint = JSON.stringify([selectedPayment.id, requestKind, amount, reason]);
    const previousAttempt = requestAttempt.current;
    const idempotencyKey = previousAttempt?.fingerprint === fingerprint
      ? previousAttempt.idempotencyKey
      : crypto.randomUUID();
    requestAttempt.current = { fingerprint, idempotencyKey };
    requestSubmitLock.current = true;
    setRequestBusy(true);
    setError('');
    setNotice('');
    try {
      await apiFetch(`/api/accounting/payments/${selectedPayment.id}/adjustment-requests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: requestKind,
          ...(requestKind === 'refund' ? { amount } : {}),
          reason,
          idempotencyKey,
        }),
      });
      setSelectedPayment(null);
      requestAttempt.current = null;
      setNotice('La demande a été transmise pour validation.');
      await reload();
      onFinancialDataChanged();
    } catch (requestError) {
      await reload();
      setError(requestError instanceof Error ? requestError.message : 'Impossible de transmettre la demande.');
    } finally {
      requestSubmitLock.current = false;
      setRequestBusy(false);
    }
  };

  const decideRequest = async (request: AdjustmentRequest, decision: 'approve' | 'reject') => {
    const reason = (decisionReasons[request.id] ?? '').trim();
    if (!canReview || !reason || busyRequestId != null) return;
    setBusyRequestId(request.id);
    setError('');
    setNotice('');
    try {
      await apiFetch(`/api/accounting/adjustment-requests/${request.id}/decision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision, reason }),
      });
      setNotice(decision === 'approve' ? 'La demande a été approuvée.' : 'La demande a été refusée.');
      await reload();
      onFinancialDataChanged();
    } catch (decisionError) {
      await reload();
      setError(decisionError instanceof Error ? decisionError.message : 'Impossible d’enregistrer la décision.');
    } finally {
      setBusyRequestId(null);
    }
  };

  const confirmRefund = async (request: AdjustmentRequest) => {
    if (!canConfirmRefund || busyRequestId != null) return;
    setBusyRequestId(request.id);
    setError('');
    setNotice('');
    try {
      await apiFetch(`/api/accounting/adjustment-requests/${request.id}/refund-confirmation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      setNotice('La restitution des fonds a été confirmée.');
      await reload();
      onFinancialDataChanged();
    } catch (confirmationError) {
      await reload();
      setError(confirmationError instanceof Error ? confirmationError.message : 'Impossible de confirmer la restitution.');
    } finally {
      setBusyRequestId(null);
    }
  };

  const submitDirectAdjustment = async (event: FormEvent) => {
    event.preventDefault();
    if (!isSuperAdmin || !directPayment || directBusy) return;
    const reason = directReason.trim();
    const amount = directKind === 'refund' ? Number(directAmount) : null;
    if (!reason || reason.length > 500) {
      setError('Le motif est obligatoire et ne peut pas dépasser 500 caractères.');
      return;
    }
    if (directKind === 'refund'
      && (!Number.isSafeInteger(amount) || amount == null || amount <= 0 || amount > directPayment.amount)) {
      setError('Saisissez un montant entier positif, inférieur ou égal au paiement.');
      return;
    }

    const fingerprint = JSON.stringify([directPayment.id, directKind, amount, reason]);
    const previousAttempt = directAdjustmentAttempt.current;
    const idempotencyKey = previousAttempt?.fingerprint === fingerprint
      ? previousAttempt.idempotencyKey
      : crypto.randomUUID();
    directAdjustmentAttempt.current = { fingerprint, idempotencyKey };
    setDirectBusy(true);
    setError('');
    setNotice('');
    try {
      await apiFetch(`/api/accounting/payments/${directPayment.id}/${directKind === 'cancellation' ? 'cancel' : 'refund'}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(directKind === 'refund' ? { amount } : {}),
          reason,
          idempotencyKey,
        }),
      });
      setDirectPayment(null);
      directAdjustmentAttempt.current = null;
      setNotice(directKind === 'cancellation'
        ? 'L’annulation directe du paiement a été effectuée.'
        : 'Le remboursement direct a été effectué.');
      await reload();
      onFinancialDataChanged();
    } catch (adjustmentError) {
      await reload();
      setError(adjustmentError instanceof Error
        ? adjustmentError.message
        : 'Impossible d’effectuer l’ajustement direct.');
    } finally {
      setDirectBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      {error && <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</div>}
      {notice && <div role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">{notice}</div>}

      {loading ? (
        <p role="status" className="text-sm text-slate-500">Chargement de l’historique comptable…</p>
      ) : (
        <>
          <section className="space-y-3" aria-label="Historique des paiements">
            <div>
              <h2 className="text-xl font-bold text-slate-900">Historique des paiements</h2>
              <p className="mt-1 text-sm text-slate-500">Les opérations historiques restent consultables indépendamment du rôle de leur auteur.</p>
              {isSuperAdmin && !schoolId && (
                <p className="mt-1 text-sm text-indigo-700">Consultation toutes écoles. Sélectionnez un établissement dans le filtre en haut pour limiter l’historique et accéder aux interventions directes.</p>
              )}
            </div>
            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="w-full min-w-[900px] text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Date</th>
                    <th className="px-3 py-2">Élève / classe / établissement</th>
                    <th className="px-3 py-2">Mode</th>
                    <th className="px-3 py-2">Montant</th>
                    <th className="px-3 py-2">État</th>
                    <th className="px-3 py-2">Reçu</th>
                    {(canRequest || canDirectAdjust) && <th className="px-3 py-2">Action</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {payments.map((payment) => {
                    const activeRequest = activeRequestByPaymentId.get(payment.id);
                    return (
                      <tr key={payment.id}>
                        <td className="whitespace-nowrap px-3 py-2">{formatDate(payment.paidAt)}</td>
                        <td className="px-3 py-2">
                          <span className="font-semibold">{payment.studentName}</span>
                          <span className="ml-2 text-xs text-slate-500">Paiement #{payment.id}</span>
                          <span className="mt-1 block text-xs text-slate-600">Classe : {payment.className || '—'}</span>
                          {isSuperAdmin && <span className="block text-xs text-slate-600">Établissement : {payment.schoolName}</span>}
                          {activeRequest && (
                            <span className="mt-1 block text-xs font-semibold text-amber-800">
                              Demande active : {getRequestStatusLabel(activeRequest)}
                            </span>
                          )}
                          {canDirectAdjust && activeRequest && (
                            <span className="mt-1 block text-xs text-rose-700">
                              Intervention directe bloquée jusqu’au traitement de cette demande.
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2">{payment.method}</td>
                        <td className="whitespace-nowrap px-3 py-2 font-semibold">{formatMoney(payment.amount)}</td>
                        <td className="px-3 py-2">{payment.status === 'posted' ? 'Enregistré' : payment.status === 'cancelled' ? 'Annulé' : payment.status}</td>
                        <td className="whitespace-nowrap px-3 py-2">
                          {renderReceiptActions(payment.receiptId, payment.receiptNumber, payment.status)}
                        </td>
                        {(canRequest || canDirectAdjust) && (
                          <td className="px-3 py-2">
                            {canRequest && payment.status === 'posted' && !activeRequest && (
                              <div className="flex flex-wrap gap-2">
                                <button type="button" className="rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs font-semibold text-amber-800" onClick={() => openRequestForm(payment, 'cancellation')}>
                                  Demander une annulation
                                </button>
                                <button type="button" className="rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 py-1.5 text-xs font-semibold text-indigo-800" onClick={() => openRequestForm(payment, 'refund')}>
                                  Demander un remboursement
                                </button>
                              </div>
                            )}
                            {canDirectAdjust && payment.status === 'posted' && !activeRequest && (
                              <div className="flex flex-wrap gap-2">
                                <button type="button" className="rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-xs font-semibold text-rose-800" onClick={() => openDirectAdjustmentForm(payment, 'cancellation')}>
                                  Annuler directement
                                </button>
                                <button type="button" className="rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 py-1.5 text-xs font-semibold text-indigo-800" onClick={() => openDirectAdjustmentForm(payment, 'refund')}>
                                  Rembourser directement
                                </button>
                              </div>
                            )}
                            {activeRequest ? (
                              <span className="text-xs text-slate-500">Une demande est déjà active</span>
                            ) : payment.status !== 'posted' ? '—' : null}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                  {!payments.length && (
                    <tr><td className="px-3 py-6 text-center text-slate-500" colSpan={canRequest || canDirectAdjust ? 7 : 6}>Aucun paiement trouvé pour cette sélection.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="space-y-3" aria-label="Demandes d’annulation et de remboursement">
            <div>
              <h2 className="text-xl font-bold text-slate-900">{canReview ? 'Demandes à traiter' : 'Demandes d’ajustement'}</h2>
              <p className="mt-1 text-sm text-slate-500">Une autorisation de remboursement ne confirme pas la restitution des fonds.</p>
            </div>
            <div className="grid gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 sm:grid-cols-2 lg:grid-cols-3">
              <input
                type="search"
                aria-label="Rechercher par nom ou prénom de l’élève"
                placeholder="Nom ou prénom de l’élève"
                value={studentSearch}
                onChange={(event) => setStudentSearch(event.target.value)}
                className="rounded-lg border border-slate-200 bg-white p-2 text-sm"
              />
              <select aria-label="Filtrer par classe" value={classFilter} onChange={(event) => setClassFilter(event.target.value)} className="rounded-lg border border-slate-200 bg-white p-2 text-sm">
                <option value="">Toutes les classes</option>
                {requestClassOptions.map((className) => <option key={className} value={className}>{className}</option>)}
              </select>
              <select aria-label="Filtrer par type de demande" value={kindFilter} onChange={(event) => setKindFilter(event.target.value)} className="rounded-lg border border-slate-200 bg-white p-2 text-sm">
                <option value="">Tous les types</option>
                <option value="cancellation">Annulation</option>
                <option value="refund">Remboursement</option>
              </select>
              <select aria-label="Filtrer par statut de demande" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="rounded-lg border border-slate-200 bg-white p-2 text-sm">
                <option value="">Tous les statuts</option>
                <option value="pending">En attente</option>
                <option value="approved">Approuvée</option>
                <option value="rejected">Refusée</option>
              </select>
              <label className="grid gap-1 text-xs font-semibold text-slate-600">
                Transmise à partir du
                <input type="date" aria-label="Demandes transmises à partir du" value={requestedFrom} onChange={(event) => setRequestedFrom(event.target.value)} className="rounded-lg border border-slate-200 bg-white p-2 text-sm font-normal" />
              </label>
              <label className="grid gap-1 text-xs font-semibold text-slate-600">
                Transmise jusqu’au
                <input type="date" aria-label="Demandes transmises jusqu’au" value={requestedTo} onChange={(event) => setRequestedTo(event.target.value)} className="rounded-lg border border-slate-200 bg-white p-2 text-sm font-normal" />
              </label>
              <div className="flex items-center justify-between gap-2 sm:col-span-2 lg:col-span-3">
                {isSuperAdmin
                  ? <span className="text-xs text-slate-600">Établissement : utilisez le sélecteur en haut (toutes les écoles ou une école).</span>
                  : <span className="text-xs text-slate-600">Historique limité à votre établissement actif.</span>}
                <button
                  type="button"
                  onClick={() => {
                    setStudentSearch('');
                    setClassFilter('');
                    setKindFilter('');
                    setStatusFilter('');
                    setRequestedFrom('');
                    setRequestedTo('');
                  }}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700"
                >
                  Réinitialiser les filtres
                </button>
              </div>
            </div>
            <div className="space-y-3">
              {filteredRequests.map((request) => {
                const canDecide = canReview && request.status === 'pending';
                const canConfirm = canConfirmRefund
                  && request.kind === 'refund'
                  && request.status === 'approved'
                  && request.resultingAdjustmentId == null;
                return (
                  <article key={request.id} className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <h3 className="font-bold text-slate-900">
                          {request.kind === 'cancellation' ? 'Demande d’annulation' : 'Demande de remboursement'}
                          <span className="ml-2 text-xs font-medium text-slate-500">#{request.id}</span>
                        </h3>
                        <p className="mt-1 text-sm text-slate-600">
                          Paiement #{request.paymentId}
                          {` · ${request.studentFirstName} ${request.studentLastName} · ${formatMoney(request.paymentAmount)}`}
                          {request.amount != null ? ` · Montant demandé : ${formatMoney(request.amount)}` : ' · Annulation totale'}
                        </p>
                        <p className="mt-1 text-sm text-slate-600">
                          Classe : {request.className || '—'}
                          {isSuperAdmin ? ` · Établissement : ${request.schoolName}` : ''}
                        </p>
                      </div>
                      <span className={`rounded-full px-3 py-1 text-xs font-bold ${
                        request.status === 'rejected'
                          ? 'bg-rose-100 text-rose-800'
                          : request.status === 'pending'
                            ? 'bg-amber-100 text-amber-800'
                            : request.refundConfirmedAt || request.kind === 'cancellation'
                              ? 'bg-emerald-100 text-emerald-800'
                              : 'bg-sky-100 text-sky-800'
                      }`}>
                        {getRequestStatusLabel(request)}
                      </span>
                    </div>
                    <dl className="grid gap-2 text-sm sm:grid-cols-2">
                      <div><dt className="font-semibold text-slate-500">Demandeur</dt><dd>{request.requestedByName || request.requestedByEmail || `Compte #${request.requestedByUserId}`}</dd></div>
                      <div><dt className="font-semibold text-slate-500">Demandée le</dt><dd>{formatDate(request.requestedAt)}</dd></div>
                      <div className="sm:col-span-2"><dt className="font-semibold text-slate-500">Motif</dt><dd className="whitespace-pre-wrap">{request.reason}</dd></div>
                      {request.decidedAt && (
                        <>
                          <div><dt className="font-semibold text-slate-500">Décision</dt><dd>{request.decidedByName || request.decidedByEmail || 'School Admin'} · {formatDate(request.decidedAt)}</dd></div>
                          <div className="sm:col-span-2"><dt className="font-semibold text-slate-500">Justification</dt><dd className="whitespace-pre-wrap">{request.decisionReason || '—'}</dd></div>
                        </>
                      )}
                      {request.refundConfirmedAt && (
                        <div className="sm:col-span-2">
                          <dt className="font-semibold text-slate-500">Restitution confirmée</dt>
                          <dd>{request.refundConfirmedByName || request.refundConfirmedByEmail || 'Secrétaire comptable'} · {formatDate(request.refundConfirmedAt)}</dd>
                        </div>
                      )}
                    </dl>
                    {canDecide && (
                      <div className="space-y-2 border-t border-slate-100 pt-3">
                        <label className="grid gap-1 text-sm font-semibold text-slate-700">
                          Justification obligatoire de la décision
                          <textarea
                            rows={2}
                            maxLength={500}
                            value={decisionReasons[request.id] ?? ''}
                            onChange={(event) => setDecisionReasons((current) => ({ ...current, [request.id]: event.target.value }))}
                            className="rounded-lg border border-slate-200 p-2 font-normal"
                          />
                        </label>
                        {request.requestedByUserId === currentUserId && (
                          <p className="text-xs text-rose-700">Vous ne pouvez pas approuver ou refuser votre propre demande.</p>
                        )}
                        <div className="flex flex-wrap gap-2">
                          <button type="button" disabled={request.requestedByUserId === currentUserId || !decisionReasons[request.id]?.trim() || busyRequestId != null} onClick={() => { void decideRequest(request, 'approve'); }} className="rounded-lg bg-emerald-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">
                            {busyRequestId === request.id ? 'Traitement…' : 'Approuver'}
                          </button>
                          <button type="button" disabled={request.requestedByUserId === currentUserId || !decisionReasons[request.id]?.trim() || busyRequestId != null} onClick={() => { void decideRequest(request, 'reject'); }} className="rounded-lg bg-rose-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">
                            {busyRequestId === request.id ? 'Traitement…' : 'Refuser'}
                          </button>
                        </div>
                      </div>
                    )}
                    {canConfirm && (
                      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3">
                        <p className="text-sm text-sky-900">
                          Montant autorisé : <strong>{request.amount == null ? '—' : formatMoney(request.amount)}</strong>. Ce montant ne peut pas être modifié.
                        </p>
                        <button type="button" disabled={busyRequestId != null} onClick={() => { void confirmRefund(request); }} className="rounded-lg bg-indigo-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">
                          {busyRequestId === request.id ? 'Confirmation…' : 'Confirmer la restitution'}
                        </button>
                      </div>
                    )}
                  </article>
                );
              })}
              {!requests.length && <p className="rounded-xl border border-dashed border-slate-300 p-5 text-center text-sm text-slate-500">Aucune demande d’annulation ou de remboursement.</p>}
              {requests.length > 0 && !filteredRequests.length && <p className="rounded-xl border border-dashed border-slate-300 p-5 text-center text-sm text-slate-500">Aucune demande ne correspond aux filtres sélectionnés.</p>}
            </div>
          </section>
        </>
      )}

      <ModalSurface
        isOpen={selectedPayment != null}
        onClose={() => {
          if (!requestBusy) {
            setSelectedPayment(null);
            requestAttempt.current = null;
          }
        }}
        contentClassName="max-w-xl"
        ariaLabel={requestKind === 'cancellation' ? 'Demande d’annulation' : 'Demande de remboursement'}
      >
        {selectedPayment && (
          <form onSubmit={submitRequest} className="space-y-4">
            <div>
              <h2 className="text-xl font-bold text-slate-900">
                {requestKind === 'cancellation' ? 'Demander une annulation totale' : 'Demander un remboursement'}
              </h2>
              <p className="mt-1 text-sm text-slate-600">
                Paiement #{selectedPayment.id} · {selectedPayment.studentName} · {formatMoney(selectedPayment.amount)}
              </p>
            </div>
            {requestKind === 'refund' && (
              <label className="grid gap-1 text-sm font-semibold text-slate-700">
                Montant demandé (FCFA)
                <input
                  required
                  type="number"
                  min={1}
                  max={selectedPayment.amount}
                  step={1}
                  value={requestAmount}
                  onChange={(event) => setRequestAmount(event.target.value)}
                  className="rounded-lg border border-slate-200 p-2"
                />
              </label>
            )}
            <label className="grid gap-1 text-sm font-semibold text-slate-700">
              Motif obligatoire
              <textarea required maxLength={500} rows={4} value={requestReason} onChange={(event) => setRequestReason(event.target.value)} className="rounded-lg border border-slate-200 p-2 font-normal" />
            </label>
            <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
              Cette demande ne modifie pas le paiement ni le solde. Une annulation ou un remboursement ne sera exécuté qu’après les étapes de validation prévues.
            </p>
            <div className="flex justify-end gap-2">
              <button type="button" disabled={requestBusy} onClick={() => setSelectedPayment(null)} className="rounded-lg bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700">Annuler</button>
              <button type="submit" disabled={requestBusy || !requestReason.trim() || (requestKind === 'refund' && !requestAmount)} className="rounded-lg bg-indigo-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
                {requestBusy ? 'Envoi…' : 'Transmettre la demande'}
              </button>
            </div>
          </form>
        )}
      </ModalSurface>
      <ModalSurface
        isOpen={directPayment != null}
        onClose={() => {
          if (!directBusy) setDirectPayment(null);
        }}
        contentClassName="max-w-xl"
        ariaLabel={directKind === 'cancellation' ? 'Annulation directe du paiement' : 'Remboursement direct du paiement'}
      >
        {directPayment && (
          <form onSubmit={submitDirectAdjustment} className="space-y-4">
            <div>
              <h2 className="text-xl font-bold text-slate-900">
                {directKind === 'cancellation' ? 'Annulation directe' : 'Remboursement direct'}
              </h2>
              <p className="mt-1 text-sm text-slate-600">
                Paiement #{directPayment.id} · {directPayment.studentName} · {formatMoney(directPayment.amount)}
              </p>
            </div>
            {directKind === 'refund' && (
              <label className="grid gap-1 text-sm font-semibold text-slate-700">
                Montant à rembourser (FCFA)
                <input
                  required
                  type="number"
                  min={1}
                  max={directPayment.amount}
                  step={1}
                  value={directAmount}
                  onChange={(event) => setDirectAmount(event.target.value)}
                  className="rounded-lg border border-slate-200 p-2"
                />
              </label>
            )}
            <label className="grid gap-1 text-sm font-semibold text-slate-700">
              Motif obligatoire
              <textarea required maxLength={500} rows={4} value={directReason} onChange={(event) => setDirectReason(event.target.value)} className="rounded-lg border border-slate-200 p-2 font-normal" />
            </label>
            <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
              Intervention exceptionnelle réservée au Super Admin. Le serveur vérifiera à nouveau le montant disponible et l’absence de demande active.
            </p>
            <div className="flex justify-end gap-2">
              <button type="button" disabled={directBusy} onClick={() => setDirectPayment(null)} className="rounded-lg bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700">Fermer</button>
              <button type="submit" disabled={directBusy || !directReason.trim() || (directKind === 'refund' && !directAmount)} className="rounded-lg bg-rose-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
                {directBusy ? 'Traitement…' : directKind === 'cancellation' ? 'Confirmer l’annulation' : 'Confirmer le remboursement'}
              </button>
            </div>
          </form>
        )}
      </ModalSurface>
    </div>
  );
}
