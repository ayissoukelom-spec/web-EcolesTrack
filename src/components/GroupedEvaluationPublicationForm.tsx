import { useEffect, useMemo, useRef, useState } from 'react';
import { CalendarDays, LoaderCircle } from 'lucide-react';
import {
  formatGroupedEvaluationParentMessage,
  validateGroupedEvaluationPublication,
  type GroupedEvaluationKind,
  type GroupedEvaluationPublicationRequest,
  type GroupedEvaluationPublicationResponse,
} from '../lib/groupedEvaluationPublication.ts';
import {
  getGroupedEvaluationPublicationAvailability,
  getGroupedEvaluationPublicationOptions,
  getGroupedEvaluationValidationContext,
  submitGroupedEvaluationPublication,
  type GroupedEvaluationPublicationOptions,
} from '../lib/groupedEvaluationPublicationApi.ts';

interface GroupedEvaluationPublicationFormProps {
  role: string;
  onPublished?: () => void | Promise<void>;
}

const randomIdempotencyKey = () => {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
};
const idempotencyStorageKey = 'ecoletrack:grouped-evaluation-publication-idempotency';

const describeApiError = (error: unknown): string => {
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
    return error.message;
  }
  return 'Une erreur réseau est survenue. Réessayez sans modifier le programme.';
};

export default function GroupedEvaluationPublicationForm({
  role,
  onPublished,
}: GroupedEvaluationPublicationFormProps) {
  const [publicationEnabled, setPublicationEnabled] = useState(false);
  const [isCheckingAvailability, setIsCheckingAvailability] = useState(true);
  const [options, setOptions] = useState<GroupedEvaluationPublicationOptions | null>(null);
  const [loadError, setLoadError] = useState('');
  const [availabilityError, setAvailabilityError] = useState('');
  const [kind, setKind] = useState<GroupedEvaluationKind>('devoir');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [classIds, setClassIds] = useState<number[]>([]);
  const [subjectIds, setSubjectIds] = useState<number[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const idempotencyRef = useRef<{ fingerprint: string; key: string } | null>(null);
  const [validationMessage, setValidationMessage] = useState('');
  const [success, setSuccess] = useState<GroupedEvaluationPublicationResponse | null>(null);

  useEffect(() => {
    if (role !== 'school_admin') return;
    let active = true;

    void (async () => {
      const [availabilityResult, optionsResult] = await Promise.allSettled([
        getGroupedEvaluationPublicationAvailability(),
        getGroupedEvaluationPublicationOptions(),
      ]);
      if (!active) return;
      if (availabilityResult.status === 'fulfilled') {
        setPublicationEnabled(availabilityResult.value.available);
      } else {
        setAvailabilityError(describeApiError(availabilityResult.reason));
      }
      if (optionsResult.status === 'fulfilled') {
        setOptions(optionsResult.value);
      } else {
        setLoadError(describeApiError(optionsResult.reason));
      }
      setIsCheckingAvailability(false);
    })();

    return () => { active = false; };
  }, [role]);

  const classes = options?.classes ?? [];
  const subjects = options?.subjects ?? [];
  const activePairs = useMemo(() => new Set(
    (options?.activeTeachingPairs ?? []).map(({ classId, subjectId }) => `${classId}:${subjectId}`),
  ), [options]);
  const eligibleSubjects = useMemo(() => subjects.filter((subject) =>
    classIds.length > 0 && classIds.some((classId) => activePairs.has(`${classId}:${subject.id}`)),
  ), [subjects, classIds, activePairs]);
  const invalidPairs = useMemo(() => classIds.flatMap((classId) =>
    subjectIds
      .filter((subjectId) => !activePairs.has(`${classId}:${subjectId}`))
      .map((subjectId) => ({
        className: classes.find((item) => item.id === classId)?.name ?? `Classe ${classId}`,
        subjectName: subjects.find((item) => item.id === subjectId)?.name ?? `Matière ${subjectId}`,
      })),
  ), [classIds, subjectIds, activePairs, classes, subjects]);
  const validation = useMemo(() => {
    if (!options) return null;
    const request: GroupedEvaluationPublicationRequest = {
      kind,
      startDate,
      endDate,
      classIds,
      subjectIds,
      idempotencyKey: 'grouped-publication-local-check',
    };
    return validateGroupedEvaluationPublication(request, getGroupedEvaluationValidationContext(options));
  }, [options, kind, startDate, endDate, classIds, subjectIds]);
  const previewSubjects = subjectIds.map((id) =>
    subjects.find((subject) => subject.id === id)?.name ?? '',
  );
  const previewMessage = startDate && endDate
    ? formatGroupedEvaluationParentMessage({ kind, startDate, endDate, subjects: previewSubjects })
    : '';
  const pushStatusLabel = success?.notification.push === 'pending'
    ? 'en attente de traitement, non confirmé envoyé'
    : success?.notification.push === 'sent'
      ? 'confirmé envoyé'
      : success?.notification.push === 'partial'
        ? 'partiellement envoyé'
        : success?.notification.push === 'failed'
          ? 'échec de livraison'
          : '';

  const toggleSelection = (selected: number[], value: number, update: (next: number[]) => void) => {
    update(selected.includes(value)
      ? selected.filter((item) => item !== value)
      : [...selected, value].sort((a, b) => a - b));
    setSuccess(null);
    setValidationMessage('');
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submittingRef.current || !options) return;
    if (!publicationEnabled || !options.available) {
      setValidationMessage('La publication réelle n’est pas autorisée actuellement. Le programme peut être préparé, mais il ne peut pas être confirmé.');
      return;
    }
    if (invalidPairs.length > 0) {
      setValidationMessage('Retirez les paires classe–matière sans affectation pédagogique active.');
      return;
    }
    if (!validation || 'error' in validation) {
      setValidationMessage(
        validation && 'error' in validation
          ? validation.error.message
          : 'Vérifiez les dates et les sélections avant de publier.',
      );
      return;
    }

    const fingerprint = JSON.stringify({
      kind,
      startDate,
      endDate,
      classIds: [...classIds].sort((a, b) => a - b),
      subjectIds: [...subjectIds].sort((a, b) => a - b),
    });
    if (!idempotencyRef.current || idempotencyRef.current.fingerprint !== fingerprint) {
      const stored = sessionStorage.getItem(idempotencyStorageKey);
      if (stored) {
        try {
          const parsed = JSON.parse(stored) as { fingerprint?: string; key?: string };
          if (parsed.fingerprint === fingerprint && typeof parsed.key === 'string') {
            idempotencyRef.current = { fingerprint, key: parsed.key };
          }
        } catch {
          sessionStorage.removeItem(idempotencyStorageKey);
        }
      }
      if (!idempotencyRef.current || idempotencyRef.current.fingerprint !== fingerprint) {
        idempotencyRef.current = { fingerprint, key: randomIdempotencyKey() };
      }
      sessionStorage.setItem(idempotencyStorageKey, JSON.stringify(idempotencyRef.current));
    }

    submittingRef.current = true;
    setIsSubmitting(true);
    setValidationMessage('');
    setSuccess(null);
    try {
      const result = await submitGroupedEvaluationPublication(
        {
          kind,
          startDate,
          endDate,
          classIds,
          subjectIds,
          idempotencyKey: idempotencyRef.current.key,
        },
        idempotencyRef.current.key,
      );
      setSuccess(result);
      idempotencyRef.current = null;
      sessionStorage.removeItem(idempotencyStorageKey);
      try {
        await onPublished?.();
      } catch {
        setValidationMessage('Le programme est enregistré, mais les données affichées n’ont pas pu être actualisées.');
      }
    } catch (error) {
      setValidationMessage(describeApiError(error));
    } finally {
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  };

  if (role !== 'school_admin') return null;

  return (
    <section
      aria-label="Publication groupée des évaluations"
      className="rounded-2xl border border-indigo-100 bg-white p-4 shadow-sm sm:p-6"
      data-testid="grouped-evaluation-publication-form"
    >
      <div className="mb-5 flex items-start gap-3">
        <div className="rounded-xl bg-indigo-50 p-2 text-indigo-700">
          <CalendarDays className="h-5 w-5" aria-hidden="true" />
        </div>
        <div>
          <h3 className="text-base font-bold text-slate-800">Programme groupé de devoirs ou d’examens</h3>
          <p className="mt-1 text-xs text-slate-500">
            Une évaluation sera créée pour chaque combinaison valide de classe et de matière.
          </p>
        </div>
      </div>

      {isCheckingAvailability && (
        <p role="status" className="flex items-center gap-2 text-sm text-slate-500">
          <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
          Chargement des options et vérification de la publication…
        </p>
      )}
      {!isCheckingAvailability && !publicationEnabled && (
        <p role="status" className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          {availabilityError
            ? `La disponibilité du serveur n’a pas pu être vérifiée : ${availabilityError} Le programme peut être préparé, mais sa confirmation est bloquée.`
            : 'La publication réelle est désactivée ou indisponible dans ce contexte. Vous pouvez préparer le programme, mais sa confirmation est bloquée.'}
        </p>
      )}
      {loadError && <p role="alert" className="mb-4 text-sm text-rose-700">{loadError}</p>}
      {options && !options.available && (
        <p role="alert" className="mb-4 text-sm text-amber-800">
          Aucune période trimestrielle compatible n’est actuellement disponible pour préparer cette publication.
        </p>
      )}

      <form className="space-y-5" onSubmit={handleSubmit}>
        <div>
          <span className="mb-2 block text-xs font-bold uppercase tracking-wide text-slate-500">Type</span>
          <div className="flex flex-wrap gap-3">
            {([
              ['devoir', 'Devoir'],
              ['examen', 'Examen'],
            ] as const).map(([value, label]) => (
              <label key={value} className="flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm">
                <input
                  type="radio"
                  name="grouped-evaluation-kind"
                  value={value}
                  checked={kind === value}
                  onChange={() => { setKind(value); setSuccess(null); }}
                />
                {label}
                {value === 'examen' && <span className="text-xs text-slate-500">(composition)</span>}
              </label>
            ))}
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-xs font-bold uppercase tracking-wide text-slate-500">
            Date de début
            <input
              type="date"
              required
              value={startDate}
              onChange={(event) => { setStartDate(event.target.value); setSuccess(null); }}
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-normal text-slate-800"
            />
          </label>
          <label className="block text-xs font-bold uppercase tracking-wide text-slate-500">
            Date de fin
            <input
              type="date"
              required
              min={startDate || undefined}
              value={endDate}
              onChange={(event) => { setEndDate(event.target.value); setSuccess(null); }}
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-normal text-slate-800"
            />
          </label>
        </div>

        <div className="grid gap-5 lg:grid-cols-2">
          <fieldset>
            <legend className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">Classes</legend>
            <div className="max-h-44 space-y-2 overflow-auto rounded-lg border border-slate-200 p-3">
              {classes.map((item) => (
                <label key={item.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={classIds.includes(item.id)}
                    onChange={() => toggleSelection(classIds, item.id, setClassIds)}
                  />
                  <span>
                    {item.name}
                    {(options?.termsByClass[item.id] ?? []).length > 0 && (
                      <span className="ml-1 text-xs text-slate-500">
                        ({[...new Set((options?.termsByClass[item.id] ?? []).map((term) =>
                          `${term.periodType === 'semester' ? 'Semestre' : 'Trimestre'} ${term.periodType === 'semester' ? 'S' : 'T'}${term.orderIndex ?? ''}`,
                        ))].join(', ')})
                      </span>
                    )}
                  </span>
                </label>
              ))}
              {classes.length === 0 && <p className="text-xs text-slate-500">Aucune classe avec affectation active.</p>}
            </div>
          </fieldset>

          <fieldset>
            <legend className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">Matières approuvées et affectées</legend>
            <div className="max-h-44 space-y-2 overflow-auto rounded-lg border border-slate-200 p-3">
              {eligibleSubjects.map((item) => (
                <label key={item.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={subjectIds.includes(item.id)}
                    onChange={() => toggleSelection(subjectIds, item.id, setSubjectIds)}
                  />
                  {item.name}
                </label>
              ))}
              {eligibleSubjects.length === 0 && (
                <p className="text-xs text-slate-500">Sélectionnez une classe pour afficher ses matières affectées.</p>
              )}
            </div>
          </fieldset>
        </div>

        {classIds.length > 0 && subjectIds.length > 0 && (
          <div className="rounded-xl bg-slate-50 p-4">
            <h4 className="mb-2 text-sm font-semibold text-slate-700">Combinaisons prévues</h4>
            <ul className="grid gap-1 text-xs sm:grid-cols-2">
              {classIds.flatMap((classId) => subjectIds.map((subjectId) => {
                const className = classes.find((item) => item.id === classId)?.name ?? `Classe ${classId}`;
                const subjectName = subjects.find((item) => item.id === subjectId)?.name ?? `Matière ${subjectId}`;
                const valid = activePairs.has(`${classId}:${subjectId}`);
                return (
                  <li
                    key={`${classId}:${subjectId}`}
                    className={valid ? 'text-emerald-700' : 'font-semibold text-rose-700'}
                  >
                    {className} — {subjectName}{valid ? '' : ' (affectation active manquante)'}
                  </li>
                );
              }))}
            </ul>
            {previewMessage && <p className="mt-3 text-xs text-slate-600">{previewMessage}</p>}
            {validation && 'error' in validation && (
              <p className="mt-2 text-xs text-rose-700">{validation.error.message}</p>
            )}
          </div>
        )}

        {validationMessage && <p role="alert" className="text-sm text-rose-700">{validationMessage}</p>}
        {success && (
          <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
            Programme enregistré : {success.evaluationCount} évaluation{success.evaluationCount === 1 ? '' : 's'} créée{success.evaluationCount === 1 ? '' : 's'}.
            {' '}Notifications locales : {success.notification.recipientCount}.
            {' '}Push : {pushStatusLabel}.
          </div>
        )}

        <button
          type="submit"
          disabled={isSubmitting || isCheckingAvailability || !publicationEnabled || !options?.available || classIds.length === 0 || subjectIds.length === 0 || invalidPairs.length > 0}
          className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isSubmitting && <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />}
          {isSubmitting ? 'Publication en cours…' : publicationEnabled ? 'Vérifier et publier le programme' : 'Publication réelle indisponible'}
        </button>
      </form>
    </section>
  );
}
