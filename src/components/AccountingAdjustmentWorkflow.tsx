import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { ReactNode } from 'react';
import type { UserRole } from '../types.ts';
import { apiFetch } from '../lib/api.ts';
import ModalSurface from './ModalSurface.tsx';

type PaymentRow = {
  id: number;
  studentId: number;
  studentName: string;
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
  paymentId: number;
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
  schoolId: number;
  academicYearId: number | null;
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
  academicYearId,
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
  const [decisionReasons, setDecisionReasons] = useState<Record<number, string>>({});
  const [busyRequestId, setBusyRequestId] = useState<number | null>(null);
  const [directPayment, setDirectPayment] = useState<PaymentRow | null>(null);
  const [directKind, setDirectKind] = useState<'cancellation' | 'refund'>('cancellation');
  const [directAmount, setDirectAmount] = useState('');
  const [directReason, setDirectReason] = useState('');
  const [directBusy, setDirectBusy] = useState(false);
  const directAdjustmentAttempt = useRef<{ fingerprint: string; idempotencyKey: string } | null>(null);

  const canRequest = userRole === 'school_accountant';
  const canReview = userRole === 'school_admin';
  const canConfirmRefund = userRole === 'school_accountant';
  const isSuperAdmin = userRole === 'super_admin';

  const reload = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const paymentQuery = new URLSearchParams({ schoolId: String(schoolId) });
      if (academicYearId != null) paymentQuery.set('academicYearId', String(academicYearId));
      const requestQuery = new URLSearchParams({ schoolId: String(schoolId) });
      const [paymentRows, requestRows] = await Promise.all([
        apiFetch(`/api/accounting/payments?${paymentQuery.toString()}`),
        apiFetch(`/api/accounting/adjustment-requests?${requestQuery.toString()}`),
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
  }, [academicYearId, schoolId]);

  useEffect(() => {
    void reload();
  }, [reload, refreshToken]);

  const paymentById = useMemo(() => new Map(payments.map((payment) => [payment.id, payment])), [payments]);
  const activeRequestByPaymentId = useMemo(() => {
    const active = new Map<number, AdjustmentRequest>();
    for (const request of requests) {
      if (isRequestActive(request)) active.set(request.paymentId, request);
    }
    return active;
  }, [requests]);

  const openRequestForm = (payment: PaymentRow, kind: 'cancellation' | 'refund') => {
    setSelectedPayment(payment);
    setRequestKind(kind);
    setRequestAmount('');
    setRequestReason('');
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
    if (!selectedPayment || !canRequest || requestBusy) return;
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

    setRequestBusy(true);
    setError('');
    setNotice('');
    try {
      await apiFetch(`/api/accounting/payments/${selectedPayment.id}/adjustment-requests`, {
        method: 'POST',
        body: {
          kind: requestKind,
          ...(requestKind === 'refund' ? { amount } : {}),
          reason,
          idempotencyKey: crypto.randomUUID(),
        },
      });
      setSelectedPayment(null);
      setNotice('La demande a été transmise pour validation.');
      await reload();
      onFinancialDataChanged();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Impossible de transmettre la demande.');
      await reload();
    } finally {
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
        body: { decision, reason },
      });
      setNotice(decision === 'approve' ? 'La demande a été approuvée.' : 'La demande a été refusée.');
      await reload();
      onFinancialDataChanged();
    } catch (decisionError) {
      setError(decisionError instanceof Error ? decisionError.message : 'Impossible d’enregistrer la décision.');
      await reload();
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
        body: {},
      });
      setNotice('La restitution des fonds a été confirmée.');
      await reload();
      onFinancialDataChanged();
    } catch (confirmationError) {
      setError(confirmationError instanceof Error ? confirmationError.message : 'Impossible de confirmer la restitution.');
      await reload();
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
        body: {
          ...(directKind === 'refund' ? { amount } : {}),
          reason,
          idempotencyKey,
        },
      });
      setDirectPayment(null);
      directAdjustmentAttempt.current = null;
      setNotice(directKind === 'cancellation'
        ? 'L’annulation directe du paiement a été effectuée.'
        : 'Le remboursement direct a été effectué.');
      await reload();
      onFinancialDataChanged();
    } catch (adjustmentError) {
      setError(adjustmentError instanceof Error
        ? adjustmentError.message
        : 'Impossible d’effectuer l’ajustement direct.');
      await reload();
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
            </div>
            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="w-full min-w-[900px] text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Date</th>
                    <th className="px-3 py-2">Élève / paiement</th>
                    <th className="px-3 py-2">Mode</th>
                    <th className="px-3 py-2">Montant</th>
                    <th className="px-3 py-2">État</th>
                    <th className="px-3 py-2">Reçu</th>
                    {(canRequest || isSuperAdmin) && <th className="px-3 py-2">Action</th>}
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
                          {activeRequest && (
                            <span className="mt-1 block text-xs font-semibold text-amber-800">
                              Demande active : {getRequestStatusLabel(activeRequest)}
                            </span>
                          )}
                          {isSuperAdmin && activeRequest && (
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
                        {(canRequest || isSuperAdmin) && (
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
                            {isSuperAdmin && payment.status === 'posted' && !activeRequest && (
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
                    <tr><td className="px-3 py-6 text-center text-slate-500" colSpan={canRequest || isSuperAdmin ? 7 : 6}>Aucun paiement trouvé pour cette sélection.</td></tr>
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
            <div className="space-y-3">
              {requests.map((request) => {
                const payment = paymentById.get(request.paymentId);
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
                          {payment ? ` · ${payment.studentName} · ${formatMoney(payment.amount)}` : ''}
                          {request.amount != null ? ` · Montant demandé : ${formatMoney(request.amount)}` : ' · Annulation totale'}
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
            </div>
          </section>
        </>
      )}

      <ModalSurface
        isOpen={selectedPayment != null}
        onClose={() => {
          if (!requestBusy) setSelectedPayment(null);
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
