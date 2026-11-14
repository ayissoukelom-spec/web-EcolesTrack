import { useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../lib/api.ts';
import type { Parent, School, Student } from '../types.ts';
import type {
  LocalTuitionProgressReminderTestConfiguration,
  LocalTuitionProgressReminderTestTarget,
} from '../lib/localTuitionProgressReminderTest.ts';

type Props = {
  schools: School[];
  students: Student[];
  parents: Parent[];
};

type TestResult = {
  simulatedAt: string;
  execution?: { outcomes?: Array<{ status: string }> };
  inAppNotifications?: { createdCount?: number; pushQueuedCount?: number };
  pushNotifications?: { outcomes?: Array<{ status: string }> };
  controlRetainedForSafeRetry?: boolean;
};

const getConfigurationReasonMessage = (reason: string | null | undefined): string => {
  switch (reason) {
    case 'development_mode_required':
      return 'Le serveur Web doit être lancé en mode développement (NODE_ENV=development).';
    case 'sql_host_not_local':
      return 'SQL_HOST doit désigner PostgreSQL local (localhost, 127.0.0.1 ou ::1).';
    case 'sql_database_name_missing':
      return 'SQL_DB_NAME est manquant.';
    case 'database_name_not_approved':
      return 'ECOLETRACK_LOCAL_TUITION_REMINDER_TEST_DATABASE_NAME doit correspondre exactement à SQL_DB_NAME.';
    case 'production_or_staging_database_name_rejected':
      return 'Le nom de base indique un environnement staging ou production; l’envoi local est refusé.';
    case 'api_url_not_loopback':
      return 'API_URL doit pointer vers le backend mobile en HTTP sur une adresse locale.';
    case 'global_reminder_runtime_enabled':
      return 'Désactivez le runtime global des rappels avant d’utiliser ce test local.';
    case 'local_test_not_enabled':
      return 'Activez ECOLETRACK_LOCAL_TUITION_REMINDER_TEST_ENABLED=true côté Web et backend mobile.';
    case 'internal_secret_missing':
      return 'INTERNAL_SECRET doit être configuré côté Web et backend mobile.';
    case 'test_targets_not_configured':
      return 'Action désactivée : configurez une cible autorisée (école, élève, parent et appareil) avant tout envoi.';
    case 'local_test_database_identity_unverified':
      return 'La vérification PostgreSQL a échoué : le nom réel de la base doit correspondre au nom approuvé et l’adresse du serveur doit être loopback.';
    default:
      return reason
        ? `Vérification locale échouée (${reason}); envoi désactivé.`
        : 'Configuration locale indisponible; envoi désactivé.';
  }
};

const getConfigurationRequestErrorMessage = (error: unknown): string => {
  const status = error && typeof error === 'object' && 'status' in error
    ? error.status
    : undefined;
  if (status === 401) return 'L’API a refusé la session (401); reconnectez-vous avec le compte Super Admin.';
  if (status === 403) return 'L’API a refusé l’accès (403); vérifiez que la session est Super Admin.';
  if (status === 404) return 'La route de vérification est introuvable; redémarrez le serveur Web local à jour.';
  if (typeof status === 'number') return `La vérification API a échoué (HTTP ${status}); envoi désactivé.`;
  return 'Impossible de joindre ou de vérifier l’API Web locale; envoi désactivé.';
};

const currentMonthStart = (): string => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
};

const LocalTuitionProgressReminderTestPanel = ({ schools, students, parents }: Props) => {
  const [configuration, setConfiguration] = useState<LocalTuitionProgressReminderTestConfiguration | null>(null);
  const [loadingConfiguration, setLoadingConfiguration] = useState(true);
  const [configurationError, setConfigurationError] = useState<string | null>(null);
  const [schoolSelection, setSchoolSelection] = useState('');
  const [studentSelection, setStudentSelection] = useState('');
  const [parentSelection, setParentSelection] = useState('');
  const [deviceSelection, setDeviceSelection] = useState('');
  const [month, setMonth] = useState(currentMonthStart);
  const [confirmed, setConfirmed] = useState(false);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState('');
  const [result, setResult] = useState<TestResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoadingConfiguration(true);
    setConfigurationError(null);
    apiFetch('/api/admin/tuition-progress-reminder-local-test')
      .then((response) => {
        if (!cancelled) setConfiguration(response as LocalTuitionProgressReminderTestConfiguration);
      }).catch((error: unknown) => {
        if (!cancelled) {
          setConfiguration(null);
          setConfigurationError(getConfigurationRequestErrorMessage(error));
        }
        console.error('Unable to load local tuition reminder test configuration.');
      })
      .finally(() => {
        if (!cancelled) setLoadingConfiguration(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const validTargets = useMemo(() => (configuration?.targets ?? []).filter((target) => {
    const student = students.find((item) => item.id === target.studentId);
    const parent = parents.find((item) =>
      item.userId === target.parentUserId
      && item.id === student?.parentId
      && item.schoolId === target.schoolId);
    return schools.some((school) => school.id === target.schoolId)
      && student?.schoolId === target.schoolId
      && student.isActive !== false
      && parent != null;
  }), [configuration?.targets, parents, schools, students]);

  const schoolIds = [...new Set(validTargets.map((target) => target.schoolId))];
  const activeSchoolId = schoolIds.includes(Number(schoolSelection))
    ? Number(schoolSelection)
    : schoolIds[0];
  const studentIds = [...new Set(validTargets
    .filter((target) => target.schoolId === activeSchoolId)
    .map((target) => target.studentId))];
  const activeStudentId = studentIds.includes(Number(studentSelection))
    ? Number(studentSelection)
    : studentIds[0];
  const parentIds = [...new Set(validTargets
    .filter((target) => target.schoolId === activeSchoolId && target.studentId === activeStudentId)
    .map((target) => target.parentUserId))];
  const activeParentId = parentIds.includes(Number(parentSelection))
    ? Number(parentSelection)
    : parentIds[0];
  const deviceIds = [...new Set(validTargets
    .filter((target) => target.schoolId === activeSchoolId
      && target.studentId === activeStudentId
      && target.parentUserId === activeParentId)
    .map((target) => target.deviceId))];
  const activeDeviceId = deviceIds.includes(deviceSelection) ? deviceSelection : deviceIds[0];
  const selectedTarget: LocalTuitionProgressReminderTestTarget | undefined = validTargets.find((target) =>
    target.schoolId === activeSchoolId
    && target.studentId === activeStudentId
    && target.parentUserId === activeParentId
    && target.deviceId === activeDeviceId);

  const selectedSchool = schools.find((school) => school.id === activeSchoolId);
  const selectedStudent = students.find((student) => student.id === activeStudentId);
  const selectedParent = parents.find((parent) =>
    parent.userId === activeParentId && parent.id === selectedStudent?.parentId);

  const runTest = async () => {
    if (!configuration?.availableLocally || !configuration.enabled || configurationError
      || !selectedTarget || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || !confirmed) return;
    setRunning(true);
    setRunError('');
    setResult(null);
    try {
      const response = await apiFetch('/api/admin/tuition-progress-reminder-local-test/run', {
        method: 'POST',
        body: JSON.stringify({
          ...selectedTarget,
          monthStart: `${month}-01`,
        }),
      });
      setResult(response as TestResult);
    } catch (error) {
      setRunError(error instanceof Error ? error.message : 'Le test local a échoué.');
    } finally {
      setRunning(false);
    }
  };

  const pushStatuses = result?.pushNotifications?.outcomes?.map((outcome) => outcome.status) ?? [];
  const executionStatuses = result?.execution?.outcomes?.map((outcome) => outcome.status) ?? [];
  const canRunTest = !loadingConfiguration
    && configurationError == null
    && configuration?.availableLocally === true
    && configuration.enabled
    && selectedTarget != null
    && confirmed
    && !running;

  return (
    <section className="mb-5 rounded-xl border border-amber-300 bg-amber-50 p-4" aria-labelledby="local-tuition-reminder-test-title">
      <div className="mb-3">
        <h3 id="local-tuition-reminder-test-title" className="font-bold text-amber-950">
          Tester le rappel automatique de scolarité
        </h3>
        <p className="mt-1 text-xs text-amber-900">
          Outil local réservé au Super Admin. La simulation utilise les services automatiques et peut soumettre un push
          réel à l’unique appareil de test configuré.
        </p>
      </div>

      {loadingConfiguration && (
        <p role="status" className="text-sm text-slate-700">
          Vérification des paramètres locaux en cours; l’envoi reste désactivé.
        </p>
      )}
      {configurationError && (
        <p role="alert" className="text-sm text-rose-700">{configurationError}</p>
      )}
      {!loadingConfiguration && configuration && !configuration.availableLocally && (
        <p role="alert" className="text-sm text-rose-700">
          {getConfigurationReasonMessage(configuration.reason)}
        </p>
      )}
      {!loadingConfiguration && configuration?.availableLocally && !configuration.enabled && (
        <p role="status" className="text-sm text-slate-700">
          {getConfigurationReasonMessage(configuration.reason)}
        </p>
      )}
      {!loadingConfiguration && configuration?.availableLocally && configuration.enabled && validTargets.length === 0 && (
        <p role="status" className="text-sm text-slate-700">
          Aucun élève, parent et appareil de test configuré n’est disponible dans les données chargées.
        </p>
      )}

      {!loadingConfiguration && configuration?.availableLocally && configuration.enabled && validTargets.length > 0 && (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs font-semibold text-slate-700">
              École
              <select
                aria-label="École de test"
                className="mt-1 block w-full rounded border border-slate-300 bg-white px-2 py-2"
                value={activeSchoolId ?? ''}
                onChange={(event) => {
                  setSchoolSelection(event.target.value);
                  setStudentSelection('');
                  setParentSelection('');
                  setDeviceSelection('');
                  setConfirmed(false);
                }}
              >
                {schoolIds.map((id) => (
                  <option key={id} value={id}>{schools.find((school) => school.id === id)?.name ?? `École ${id}`}</option>
                ))}
              </select>
            </label>
            <label className="text-xs font-semibold text-slate-700">
              Élève de test
              <select
                aria-label="Élève de test"
                className="mt-1 block w-full rounded border border-slate-300 bg-white px-2 py-2"
                value={activeStudentId ?? ''}
                onChange={(event) => {
                  setStudentSelection(event.target.value);
                  setParentSelection('');
                  setDeviceSelection('');
                  setConfirmed(false);
                }}
              >
                {studentIds.map((id) => {
                  const student = students.find((item) => item.id === id);
                  return <option key={id} value={id}>{[student?.firstName, student?.lastName].filter(Boolean).join(' ') || `Élève ${id}`}</option>;
                })}
              </select>
            </label>
            <label className="text-xs font-semibold text-slate-700">
              Destinataire parent de test
              <select
                aria-label="Destinataire parent de test"
                className="mt-1 block w-full rounded border border-slate-300 bg-white px-2 py-2"
                value={activeParentId ?? ''}
                onChange={(event) => {
                  setParentSelection(event.target.value);
                  setDeviceSelection('');
                  setConfirmed(false);
                }}
              >
                {parentIds.map((id) => {
                  const parent = parents.find((item) => item.userId === id && item.id === selectedStudent?.parentId);
                  return <option key={id} value={id}>{parent?.name || `Compte parent ${id}`}</option>;
                })}
              </select>
            </label>
            <label className="text-xs font-semibold text-slate-700">
              Appareil de test
              <select
                aria-label="Appareil de test"
                className="mt-1 block w-full rounded border border-slate-300 bg-white px-2 py-2"
                value={activeDeviceId ?? ''}
                onChange={(event) => {
                  setDeviceSelection(event.target.value);
                  setConfirmed(false);
                }}
              >
                {deviceIds.map((id) => <option key={id} value={id}>Appareil autorisé · ID {id}</option>)}
              </select>
            </label>
            <label className="text-xs font-semibold text-slate-700 sm:col-span-2">
              Mois simulé (déclenchement à 08:00, heure locale de l’école)
              <input
                aria-label="Mois simulé"
                type="month"
                className="mt-1 block w-full rounded border border-slate-300 bg-white px-2 py-2"
                value={month}
                onChange={(event) => {
                  setMonth(event.target.value);
                  setConfirmed(false);
                }}
              />
            </label>
          </div>

          <p className="text-xs text-slate-700">
            Cible : {selectedSchool?.name ?? '—'} · {[selectedStudent?.firstName, selectedStudent?.lastName].filter(Boolean).join(' ') || '—'}
            {' · '}{selectedParent?.name || `Compte ${activeParentId ?? '—'}`} · appareil {activeDeviceId ?? '—'}.
          </p>

          <label className="flex items-start gap-2 text-xs text-amber-950">
            <input
              aria-label="Confirmer l’envoi au seul appareil de test"
              type="checkbox"
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
            />
            <span>Je confirme que cette cible est synthétique et que le seul push possible sera soumis à l’appareil de test sélectionné.</span>
          </label>
        </div>
      )}

      <button
        type="button"
        className="mt-3 rounded-lg bg-amber-700 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
        disabled={!canRunTest}
        onClick={() => void runTest()}
      >
        {running ? 'Simulation en cours…' : 'Simuler et envoyer au seul appareil de test'}
      </button>

      {runError && <p role="alert" className="mt-3 text-sm text-rose-700">{runError}</p>}
      {result && (
        <div role="status" className="mt-3 rounded border border-slate-200 bg-white p-3 text-xs text-slate-700">
          <p>Instant simulé : {result.simulatedAt}</p>
          <p>Résultat du calcul : {executionStatuses.join(', ') || 'aucun contrôle exécuté'}.</p>
          <p>Notifications in-app créées : {result.inAppNotifications?.createdCount ?? 0} · pushes mis en file : {result.inAppNotifications?.pushQueuedCount ?? 0}.</p>
          <p>Résultat push : {pushStatuses.join(', ') || 'aucun push soumis'}.</p>
          <p className="mt-1 font-semibold">« fcm_accepted » signifie accepté par FCM, pas livré ou affiché sur l’appareil.</p>
          {result.controlRetainedForSafeRetry && <p>Le contrôle est conservé car le résultat push est incertain ou doit être repris.</p>}
        </div>
      )}
    </section>
  );
};

export default LocalTuitionProgressReminderTestPanel;
