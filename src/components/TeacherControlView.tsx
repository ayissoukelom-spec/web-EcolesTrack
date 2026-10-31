import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type FormEvent, type SetStateAction } from 'react';
import {
  AlertTriangle,
  Banknote,
  CalendarClock,
  Check,
  ClipboardCheck,
  Clock3,
  GraduationCap,
  MapPin,
  RefreshCw,
  Settings2,
  ShieldCheck,
  X,
} from 'lucide-react';
import { apiFetch } from '../lib/api.ts';
import { MAX_GPS_ACCURACY_METERS } from '../lib/teacherControl/domain.ts';
import type { School, Teacher, UserRole } from '../types.ts';

type Assignment = {
  classId: number;
  className: string;
  subjectId: number;
  subjectName: string;
};

type GpsStatus =
  | 'idle'
  | 'locating'
  | 'obtained'
  | 'verifying'
  | 'validated'
  | 'imprecise'
  | 'outside'
  | 'permissionDenied'
  | 'unavailable'
  | 'timeout'
  | 'serverError';
type TeacherAction = 'start' | 'end';
type UnrecordedRequestType = 'immediate_report' | 'late_declaration';
type IncidentType = 'gps_unavailable' | 'gps_accuracy' | 'permission_denied' | 'network' | 'application' | 'other';

type GpsFix = {
  latitude: number;
  longitude: number;
  accuracyMeters: number;
};

type PendingEndValidation = GpsFix & {
  sessionId: number;
  challenge: string;
  validatedAt: string;
};

type EndConfirmation = {
  session: Session;
  endedAt: string;
  fix: GpsFix;
};

type Session = {
  id: number;
  schoolId: number;
  schoolNameSnapshot: string;
  teacherId: number;
  teacherNameSnapshot: string;
  classId: number;
  classNameSnapshot: string;
  subjectId: number;
  subjectNameSnapshot: string;
  status: 'open' | 'completed' | 'closed_without_end' | string;
  startedAt: string;
  validatedEndedAt: string | null;
  endSource: 'gps' | 'regularization' | null;
  startDistanceMeters: number | null;
  startAccuracyMeters: number | null;
  startGeofenceRadiusMeters: number | null;
  startSource: 'gps' | 'regularization';
  regularizationOrigin: 'immediate_report' | 'late_declaration' | null;
  regularizationRequestId: number | null;
  endDistanceMeters: number | null;
  endAccuracyMeters: number | null;
  endGeofenceRadiusMeters: number | null;
  closeReason: string | null;
  hourlyRateXofSnapshot: number | null;
  durationMilliseconds: number | null;
  estimatedAmountXof: number | null;
};

type Decision = {
  id: number;
  decision: 'accepted' | 'rejected' | 'modified_accepted';
  previousProposedEndedAt: string | null;
  previousProposedStartedAt: string | null;
  decidedStartedAt: string | null;
  decidedEndedAt: string | null;
  reason: string | null;
  actorNameSnapshot: string;
  createdAt: string;
};

type Regularization = {
  request: {
    id: number;
    sessionId: number | null;
    requestType: 'incomplete_session' | 'immediate_report' | 'late_declaration';
    schoolNameSnapshot: string;
    classId: number | null;
    classNameSnapshot: string | null;
    subjectId: number | null;
    subjectNameSnapshot: string | null;
    referenceStartedAt: string | null;
    declaredStartedAt: string | null;
    teacherNameSnapshot: string;
    proposedEndedAt: string | null;
    reason: string;
    description: string | null;
    incidentType: string | null;
    technicalDetails: Record<string, unknown> | null;
    gpsLatitude: string | null;
    gpsLongitude: string | null;
    gpsAccuracyMeters: string | null;
    status: 'pending' | 'accepted' | 'rejected' | 'modified_accepted' | string;
    createdAt: string;
  };
  decisions: Decision[];
};

type Statistics = {
  totalSessions: number;
  openSessions: number;
  completedSessions: number;
  incompleteSessions: number;
  regularizedSessions: number;
  gpsCompletedSessions: number;
  incompleteSessionRegularizations: number;
  immediateRegularizedSessions: number;
  lateRegularizedSessions: number;
  gpsDurationMilliseconds: number;
  incompleteRegularizedDurationMilliseconds: number;
  immediateRegularizedDurationMilliseconds: number;
  lateRegularizedDurationMilliseconds: number;
  pendingRegularizations: number;
  validatedDurationMilliseconds: number;
  estimatedCompensationXof: number;
};

type SchoolStatistics = Statistics & { schoolId: number; schoolName: string };
type GlobalStatistics = Statistics & { scope: 'global'; schools: SchoolStatistics[] };
type SessionPage = { items: Session[]; nextCursor: string | null; hasMore: boolean; limit: number; totalCount: number };
type SessionAuditEvent = {
  id: number;
  actorRole: string;
  actorNameSnapshot: string;
  actorEmailSnapshot: string | null;
  action: string;
  resourceType: string;
  reason: string | null;
  beforeValues: unknown;
  afterValues: unknown;
  createdAt: string;
};

type GpsSettings = {
  schoolId: number;
  schoolName: string;
  isEnabled: boolean;
  latitude: number | string | null;
  longitude: number | string | null;
  geofenceRadiusMeters: number;
  updatedAt: string | null;
};

type BrowserGeolocationPolicy = {
  allowsFeature?: (feature: string) => boolean;
};

type ViewTab = 'sessions' | 'requests' | 'gps' | 'rates';
type SessionFilterOption = { id: number; name: string };
type SessionFilterOptions = {
  teachers: SessionFilterOption[];
  classes: SessionFilterOption[];
  subjects: SessionFilterOption[];
};
type SessionFilters = {
  period: 'all' | 'day' | 'week' | 'month' | 'year' | 'custom';
  from: string;
  to: string;
  teacherId: string;
  classId: string;
  subjectId: string;
  status: string;
  regularizationState: string;
};

const EMPTY_SESSION_FILTERS: SessionFilters = {
  period: 'all',
  from: '',
  to: '',
  teacherId: '',
  classId: '',
  subjectId: '',
  status: '',
  regularizationState: '',
};

interface TeacherControlViewProps {
  userRole: UserRole;
  activeSchoolId: number | null;
  schoolsList: School[];
  teachersList: Teacher[];
  superAdminSchoolFilterId: number | null;
  onSuperAdminSchoolFilterChange: (schoolId: number | null) => void;
}

const timeZone = 'Africa/Lome';
const inputClass = 'w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100';
const buttonClass = 'inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50';
const secondaryButtonClass = 'inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50';

function formatLomeDate(value: string | null | undefined, includeTime = true): string {
  if (!value) return '—';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '—';
  return new Intl.DateTimeFormat('fr-FR', {
    timeZone,
    dateStyle: 'medium',
    ...(includeTime ? { timeStyle: 'short' as const } : {}),
  }).format(date);
}

function formatLomeTime(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '—';
  return new Intl.DateTimeFormat('fr-FR', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function formatLomeInput(value = new Date()): string {
  const parts = new Intl.DateTimeFormat('sv-SE', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(value);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}

function parseLomeInput(value: string): string | null {
  if (!value) return null;
  const date = new Date(`${value}:00Z`);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function formatAmount(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(Number(value))) return 'Non estimé';
  return `${new Intl.NumberFormat('fr-FR').format(Number(value))} XOF`;
}

function formatDuration(milliseconds: number | null | undefined): string {
  if (milliseconds == null || !Number.isFinite(milliseconds)) return 'Non validée';
  const totalMinutes = Math.floor(milliseconds / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours} h ${String(minutes).padStart(2, '0')} min`;
}

function sessionStatusLabel(status: Session['status']): string {
  if (status === 'open') return 'En cours';
  if (status === 'completed') return 'Terminée et validée';
  if (status === 'closed_without_end') return 'Clôturée sans heure de fin';
  return status;
}

function requestStatusLabel(status: Regularization['request']['status']): string {
  if (status === 'pending') return 'En attente';
  if (status === 'accepted') return 'Acceptée';
  if (status === 'rejected') return 'Refusée';
  if (status === 'modified_accepted') return 'Acceptée après modification';
  return status;
}

function regularizationTypeLabel(requestType: Regularization['request']['requestType']): string {
  if (requestType === 'immediate_report') return 'SIGNALEMENT IMMÉDIAT';
  if (requestType === 'late_declaration') return 'DÉCLARATION TARDIVE';
  return 'RÉGULARISATION DE SÉANCE INCOMPLÈTE';
}

function incidentTypeLabel(incidentType: string | null): string {
  switch (incidentType) {
    case 'gps_unavailable': return 'GPS indisponible';
    case 'gps_accuracy': return 'Précision GPS insuffisante';
    case 'permission_denied': return 'Permission de géolocalisation refusée';
    case 'network': return 'Connexion Internet indisponible';
    case 'application': return 'Erreur technique de l’application';
    case 'other': return 'Autre problème';
    default: return '—';
  }
}

class GeolocationRequestError extends Error {
  constructor(
    message: string,
    readonly category: 'permissionDenied' | 'unavailable' | 'timeout' | 'imprecise',
    readonly accuracyMeters?: number,
  ) {
    super(message);
  }
}

function requestPosition(onReading: (fix: GpsFix) => void): Promise<GpsFix> {
  if (!navigator.geolocation?.getCurrentPosition) {
    return Promise.reject(new GeolocationRequestError(
      'La géolocalisation n’est pas disponible sur cet appareil.',
      'unavailable',
    ));
  }
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition((position) => {
      const fix = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracyMeters: position.coords.accuracy,
      };
      if (!Number.isFinite(fix.accuracyMeters) || fix.accuracyMeters < 0) {
        reject(new GeolocationRequestError(
          'La position obtenue ne contient pas une précision GPS valide. Réessayez.',
          'unavailable',
        ));
        return;
      }
      onReading(fix);
      if (fix.accuracyMeters > MAX_GPS_ACCURACY_METERS) {
        reject(new GeolocationRequestError(
          `Précision GPS insuffisante : ${Math.ceil(fix.accuracyMeters)} m (maximum autorisé : ${MAX_GPS_ACCURACY_METERS} m). Restez immobile et réessayez.`,
          'imprecise',
          fix.accuracyMeters,
        ));
      } else {
        resolve(fix);
      }
    }, (error) => {
      if (error.code === error.PERMISSION_DENIED) {
        reject(new GeolocationRequestError(
          'Autorisez la géolocalisation dans votre navigateur pour continuer.',
          'permissionDenied',
        ));
      } else if (error.code === error.TIMEOUT) {
        reject(new GeolocationRequestError(
          'La position GPS n’a pas été obtenue à temps. Réessayez.',
          'timeout',
        ));
      } else {
        reject(new GeolocationRequestError(
          'Position GPS indisponible. Vérifiez que le GPS de votre appareil est activé.',
          'unavailable',
        ));
      }
    }, {
      enableHighAccuracy: true,
      maximumAge: 0,
      timeout: 45_000,
    });
  });
}

function gpsFailureMessage(error: unknown): { message: string; status: GpsStatus } {
  if (!(error instanceof Error)) return { message: 'La vérification GPS a échoué. Réessayez.', status: 'serverError' };
  if (error instanceof GeolocationRequestError) return { message: error.message, status: error.category };
  const reason = error.message.match(/^GPS validation failed: (.+)$/)?.[1];
  if (reason === 'outside_geofence') {
    return { message: 'Position refusée : vous êtes hors du périmètre autorisé de l’école.', status: 'outside' };
  }
  if (reason === 'accuracy_too_low' || reason === 'invalid_accuracy') {
    return { message: 'La précision GPS est insuffisante. Restez immobile et réessayez.', status: 'imprecise' };
  }
  if (reason === 'invalid_position') {
    return { message: 'La position obtenue est invalide. Vérifiez les réglages de localisation puis réessayez.', status: 'unavailable' };
  }
  if (reason === 'invalid_geofence') {
    return { message: 'Le périmètre GPS de l’école n’est pas correctement configuré.', status: 'serverError' };
  }
  if (error.message.includes('GPS challenge is invalid, expired or already used')) {
    return { message: 'La validation GPS a expiré ou a déjà été utilisée. Obtenez une nouvelle position.', status: 'serverError' };
  }
  return { message: error.message, status: 'serverError' };
}

function gpsStatusLabel(status: GpsStatus, reading: GpsFix | null): string {
  if (status === 'locating') {
    return reading
      ? `Position reçue : précision ${Math.ceil(reading.accuracyMeters)} m — recherche d’une meilleure mesure…`
      : 'Acquisition de votre position GPS…';
  }
  if (status === 'obtained') return `Position obtenue · précision ${Math.ceil(reading?.accuracyMeters ?? 0)} m`;
  if (status === 'verifying') return 'Position obtenue · validation par le serveur…';
  if (status === 'validated') return 'Position validée par le serveur';
  if (status === 'imprecise') return `Position trop imprécise${reading ? ` (${Math.ceil(reading.accuracyMeters)} m)` : ''}`;
  if (status === 'outside') return 'Position hors du périmètre autorisé';
  if (status === 'permissionDenied') return 'Permission de localisation refusée';
  if (status === 'unavailable') return 'GPS indisponible';
  if (status === 'timeout') return 'Délai de localisation dépassé';
  if (status === 'serverError') return 'Erreur de validation ou du serveur';
  return 'En attente de votre position';
}

function gpsStatusClass(status: GpsStatus): string {
  if (status === 'validated') return 'text-emerald-700';
  if (status === 'outside' || status === 'imprecise' || status === 'permissionDenied'
    || status === 'unavailable' || status === 'timeout' || status === 'serverError') return 'text-rose-700';
  return 'text-slate-600';
}

function isGpsRetryStatus(status: GpsStatus): boolean {
  return status === 'imprecise'
    || status === 'outside'
    || status === 'permissionDenied'
    || status === 'unavailable'
    || status === 'timeout'
    || status === 'serverError';
}

function gpsReadingValue(fix: GpsFix | null): number | string {
  return fix ? Math.ceil(fix.accuracyMeters) : 'En attente';
}

function currentDocumentAllowsGeolocation(): boolean | null {
  const documentWithPolicy = document as Document & {
    permissionsPolicy?: BrowserGeolocationPolicy;
    featurePolicy?: BrowserGeolocationPolicy;
  };
  const policy = documentWithPolicy.permissionsPolicy ?? documentWithPolicy.featurePolicy;
  if (typeof policy?.allowsFeature !== 'function') return null;
  return policy.allowsFeature('geolocation');
}

function initialTeacherAction(): TeacherAction | null {
  if (!isGpsDocument()) return null;
  const action = sessionStorage.getItem('teacher-control-action');
  sessionStorage.removeItem('teacher-control-action');
  return action === 'end' ? 'end' : 'start';
}

function isGpsDocument(): boolean {
  return window.location.pathname === '/teacher-control/teacher' && window.location.search === '';
}

async function postJson<T>(url: string, payload: Record<string, unknown>): Promise<T> {
  return apiFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }) as Promise<T>;
}

async function putJson<T>(url: string, payload: Record<string, unknown>): Promise<T> {
  return apiFetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }) as Promise<T>;
}

function ErrorNotice({ message }: { message: string }) {
  return (
    <div role="alert" className="flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
      <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
      <p>{message}</p>
    </div>
  );
}

function EmptyState({ children }: { children: string }) {
  return <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">{children}</p>;
}

function StatCard({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <article className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-bold text-slate-900">{value}</p>
      {detail && <p className="mt-1 text-xs text-slate-500">{detail}</p>}
    </article>
  );
}

export default function TeacherControlView({
  userRole,
  activeSchoolId,
  schoolsList,
  teachersList,
  superAdminSchoolFilterId,
  onSuperAdminSchoolFilterChange,
}: TeacherControlViewProps) {
  const isTeacher = userRole === 'teacher';
  const isSchoolAdmin = userRole === 'school_admin';
  const isSuperAdmin = userRole === 'super_admin';
  const canManage = isSchoolAdmin;
  const canManageGps = isSchoolAdmin || isSuperAdmin;
  const schoolId = isSuperAdmin ? superAdminSchoolFilterId : activeSchoolId;
  const selectedSchool = schoolsList.find((school) => school.id === schoolId);
  const schoolQuery = isSuperAdmin && schoolId != null ? `?schoolId=${schoolId}` : '';

  const [activeTab, setActiveTab] = useState<ViewTab>('sessions');
  const [loading, setLoading] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [assignments, setAssignments] = useState<Assignment[] | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [teacherOpenSessions, setTeacherOpenSessions] = useState<Session[]>([]);
  const [statistics, setStatistics] = useState<Statistics | null>(null);
  const [globalStatistics, setGlobalStatistics] = useState<GlobalStatistics | null>(null);
  const [regularizations, setRegularizations] = useState<Regularization[]>([]);
  const [gpsSettings, setGpsSettings] = useState<GpsSettings | null>(null);
  const [gpsHistory, setGpsHistory] = useState<Array<Record<string, unknown>>>([]);
  const [gpsLocationLoading, setGpsLocationLoading] = useState(false);
  const [gpsLocationMessage, setGpsLocationMessage] = useState('');
  const [selectedSessionId, setSelectedSessionId] = useState<number | null>(null);
  const [selectedClassId, setSelectedClassId] = useState('');
  const [selectedSubjectId, setSelectedSubjectId] = useState('');
  const [gpsStatus, setGpsStatus] = useState<GpsStatus>('idle');
  const [teacherAction, setTeacherAction] = useState<TeacherAction | null>(initialTeacherAction);
  const [selectedOpenSessionId, setSelectedOpenSessionId] = useState<number | null>(null);
  const [gpsReading, setGpsReading] = useState<GpsFix | null>(null);
  const [validatedGps, setValidatedGps] = useState<{ fix: GpsFix; timestamp: string } | null>(null);
  const [pendingEndValidation, setPendingEndValidation] = useState<PendingEndValidation | null>(null);
  const [startedSession, setStartedSession] = useState<Session | null>(null);
  const [endConfirmation, setEndConfirmation] = useState<EndConfirmation | null>(null);
  const actionInFlight = useRef(false);
  const [selectedTeacherId, setSelectedTeacherId] = useState('');
  const [hourlyRate, setHourlyRate] = useState('');
  const [rateLoaded, setRateLoaded] = useState(false);
  const [filterDraft, setFilterDraft] = useState<SessionFilters>(EMPTY_SESSION_FILTERS);
  const filtersRef = useRef(EMPTY_SESSION_FILTERS);
  const [filterResultsLoading, setFilterResultsLoading] = useState(false);
  const filterRequestInFlightRef = useRef(false);
  const filterRequestTokenRef = useRef(0);
  const skipNextDataLoadRef = useRef(false);
  const [sessionFilterOptions, setSessionFilterOptions] = useState<SessionFilterOptions | null>(null);
  const [sessionFilterOptionsLoading, setSessionFilterOptionsLoading] = useState(false);
  const [sessionFilterOptionsError, setSessionFilterOptionsError] = useState<string | null>(null);
  const [sessionCursors, setSessionCursors] = useState<Array<string | null>>([null]);
  const [sessionNextCursor, setSessionNextCursor] = useState<string | null>(null);
  const [sessionTotalCount, setSessionTotalCount] = useState(0);
  const [filterRevision, setFilterRevision] = useState(0);
  const [sessionAudit, setSessionAudit] = useState<Record<number, SessionAuditEvent[]>>({});
  const [auditLoadingSessionId, setAuditLoadingSessionId] = useState<number | null>(null);
  const [requestEndTimes, setRequestEndTimes] = useState<Record<number, string>>({});
  const [requestReasons, setRequestReasons] = useState<Record<number, string>>({});
  const [regularizationEndTimes, setRegularizationEndTimes] = useState<Record<number, string>>({});
  const [regularizationStartTimes, setRegularizationStartTimes] = useState<Record<number, string>>({});
  const [regularizationReasons, setRegularizationReasons] = useState<Record<number, string>>({});
  const [unrecordedRequestOpen, setUnrecordedRequestOpen] = useState(false);
  const [unrecordedRequestType, setUnrecordedRequestType] = useState<UnrecordedRequestType>('late_declaration');
  const [unrecordedClassId, setUnrecordedClassId] = useState('');
  const [unrecordedSubjectId, setUnrecordedSubjectId] = useState('');
  const [unrecordedReason, setUnrecordedReason] = useState('');
  const [unrecordedDescription, setUnrecordedDescription] = useState('');
  const [unrecordedIncidentType, setUnrecordedIncidentType] = useState<IncidentType>('gps_unavailable');
  const [unrecordedStartedAt, setUnrecordedStartedAt] = useState('');
  const [unrecordedEndedAt, setUnrecordedEndedAt] = useState('');
  const [unrecordedCompletionDescription, setUnrecordedCompletionDescription] = useState<Record<number, string>>({});
  const [closeReasons, setCloseReasons] = useState<Record<number, string>>({});
  const [gpsForm, setGpsForm] = useState({ isEnabled: false, latitude: '', longitude: '', geofenceRadiusMeters: '200' });

  const currentCursor = sessionCursors[sessionCursors.length - 1] ?? null;
  const makeFilterParams = useCallback((includeSchool: boolean, selectedFilters = filtersRef.current) => {
    const params = new URLSearchParams();
    if (includeSchool && isSuperAdmin && schoolId != null) params.set('schoolId', String(schoolId));
    if (selectedFilters.period !== 'all') params.set('period', selectedFilters.period);
    if (selectedFilters.from) params.set('from', `${selectedFilters.from}T00:00:00.000Z`);
    if (selectedFilters.to) params.set('to', `${selectedFilters.to}T23:59:59.999Z`);
    if (selectedFilters.teacherId) params.set('teacherId', selectedFilters.teacherId);
    if (selectedFilters.classId) params.set('classId', selectedFilters.classId);
    if (selectedFilters.subjectId) params.set('subjectId', selectedFilters.subjectId);
    if (selectedFilters.status) params.set('status', selectedFilters.status);
    if (selectedFilters.regularizationState) params.set('regularizationState', selectedFilters.regularizationState);
    return params;
  }, [isSuperAdmin, schoolId]);

  const loadData = useCallback(async () => {
    void filterRevision;
    const globalOverview = isSuperAdmin && schoolId == null;
    if (schoolId == null && !globalOverview) return;
    setLoading(true);
    setError(null);
    if (isTeacher) setAssignments(null);
    try {
      const filterParams = makeFilterParams(true);
      const filterQuery = filterParams.toString();
      if (globalOverview) {
        const summary = await apiFetch(`/api/teacher-control/statistics/global${filterQuery ? `?${filterQuery}` : ''}`) as GlobalStatistics;
        setGlobalStatistics(summary);
        setStatistics(summary);
        setSessions([]);
        setSessionTotalCount(summary.totalSessions);
        setSessionNextCursor(null);
        setRegularizations([]);
        setGpsHistory([]);
        setGpsSettings(null);
        return;
      }

      const sessionParams = makeFilterParams(false);
      sessionParams.set('limit', '50');
      if (currentCursor) sessionParams.set('cursor', currentCursor);
      if (isSuperAdmin && schoolId != null) sessionParams.set('schoolId', String(schoolId));
      const scopedQuery = schoolQuery;
      const [sessionPage, summary, requestRows, openSessionResponse] = await Promise.all([
        apiFetch(`/api/teacher-control/sessions?${sessionParams.toString()}`) as Promise<SessionPage>,
        apiFetch(`/api/teacher-control/statistics${filterQuery ? `?${filterQuery}` : ''}`) as Promise<Statistics>,
        apiFetch(`/api/teacher-control/regularizations${scopedQuery}`) as Promise<Regularization[]>,
        isTeacher
          ? apiFetch('/api/teacher-control/sessions?status=open&limit=100') as Promise<SessionPage>
          : Promise.resolve(null),
      ]);
      const pageItems = Array.isArray(sessionPage) ? sessionPage : sessionPage?.items;
      setSessions(Array.isArray(pageItems) ? pageItems : []);
      const openItems = Array.isArray(openSessionResponse)
        ? openSessionResponse
        : openSessionResponse?.items;
      setTeacherOpenSessions(Array.isArray(openItems) ? openItems.filter((session) => session.status === 'open') : []);
      setSessionTotalCount(sessionPage?.totalCount ?? (Array.isArray(pageItems) ? pageItems.length : 0));
      setSessionNextCursor(sessionPage?.nextCursor ?? null);
      setStatistics(summary);
      setGlobalStatistics(null);
      setRegularizations(Array.isArray(requestRows) ? requestRows : []);

      if (isTeacher) {
        const assignmentRows = await apiFetch('/api/teacher-control/assignments') as Assignment[];
        if (!Array.isArray(assignmentRows)) {
          throw new Error('La réponse des associations pédagogiques est invalide.');
        }
        setAssignments(assignmentRows);
      } else {
        const [settings, history] = await Promise.all([
          apiFetch(`/api/teacher-control/gps-settings${schoolQuery}`) as Promise<GpsSettings>,
          apiFetch(`/api/teacher-control/gps-settings/history${schoolQuery ? `${schoolQuery}&limit=50` : '?limit=50'}`) as Promise<Array<Record<string, unknown>>>,
        ]);
        setGpsSettings(settings);
        setGpsHistory(Array.isArray(history) ? history : []);
        setGpsForm({
          isEnabled: settings.isEnabled,
          latitude: settings.latitude == null ? '' : String(settings.latitude),
          longitude: settings.longitude == null ? '' : String(settings.longitude),
          geofenceRadiusMeters: String(settings.geofenceRadiusMeters ?? 200),
        });
      }
    } catch (loadError) {
      if (isTeacher) {
        setAssignments(null);
        setTeacherOpenSessions([]);
      }
      setError(loadError instanceof Error ? loadError.message : 'Impossible de charger le module Contrôle des enseignants.');
    } finally {
      setLoading(false);
    }
  }, [currentCursor, filterRevision, isSuperAdmin, isTeacher, makeFilterParams, schoolId, schoolQuery]);

  useEffect(() => {
    setSessions([]);
    setTeacherOpenSessions([]);
    setStatistics(null);
    setGlobalStatistics(null);
    setRegularizations([]);
    setGpsHistory([]);
    setGpsSettings(null);
    setError(null);
    setSessionCursors([null]);
    setSessionAudit({});
    setSelectedSessionId(null);
    setAssignments(null);
    setSelectedClassId('');
    setSelectedSubjectId('');
    setGpsStatus('idle');
    setSelectedOpenSessionId(null);
    setValidatedGps(null);
    setPendingEndValidation(null);
    setStartedSession(null);
    setEndConfirmation(null);
  }, [isSuperAdmin, schoolId]);

  useEffect(() => {
    if (skipNextDataLoadRef.current) {
      skipNextDataLoadRef.current = false;
      return;
    }
    if (schoolId != null || isSuperAdmin) void loadData();
  }, [loadData, schoolId, isSuperAdmin]);

  useEffect(() => {
    if (isTeacher) {
      setSessionFilterOptions(null);
      setSessionFilterOptionsLoading(false);
      setSessionFilterOptionsError(null);
      return;
    }

    let active = true;
    setSessionFilterOptions(null);
    setSessionFilterOptionsLoading(true);
    setSessionFilterOptionsError(null);
    const query = isSuperAdmin && schoolId != null ? `?schoolId=${schoolId}` : '';
    void apiFetch(`/api/teacher-control/filter-options${query}`)
      .then((response) => {
        if (!active) return;
        if (!response
          || !Array.isArray(response.teachers)
          || !Array.isArray(response.classes)
          || !Array.isArray(response.subjects)) {
          throw new Error('La réponse des options de filtres est invalide.');
        }
        setSessionFilterOptions(response as SessionFilterOptions);
      })
      .catch((optionsError) => {
        if (active) {
          setSessionFilterOptionsError(optionsError instanceof Error
            ? optionsError.message
            : 'Impossible de charger les options des filtres.');
        }
      })
      .finally(() => {
        if (active) setSessionFilterOptionsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [isSuperAdmin, isTeacher, schoolId]);

  useEffect(() => {
    if (isTeacher || schoolId == null) return;
    const available = teachersList.filter((teacher) => teacher.schoolId === schoolId && !teacher.isDeleted);
    if (!available.some((teacher) => String(teacher.id) === selectedTeacherId)) {
      setSelectedTeacherId(available[0] ? String(available[0].id) : '');
    }
    setRateLoaded(false);
  }, [isTeacher, schoolId, selectedTeacherId, teachersList]);

  useEffect(() => {
    if (isTeacher || schoolId == null || !selectedTeacherId || activeTab !== 'rates') return;
    let active = true;
    setRateLoaded(false);
    apiFetch(`/api/teacher-control/teachers/${selectedTeacherId}/hourly-rate${schoolQuery}`)
      .then((rate: { hourlyRateXof?: number } | null) => {
        if (active) setHourlyRate(rate?.hourlyRateXof == null ? '' : String(rate.hourlyRateXof));
      })
      .catch((rateError: unknown) => {
        if (active) setError(rateError instanceof Error ? rateError.message : 'Impossible de charger le taux horaire.');
      })
      .finally(() => {
        if (active) setRateLoaded(true);
      });
    return () => { active = false; };
  }, [activeTab, isTeacher, schoolId, schoolQuery, selectedTeacherId]);

  const selectedOpenSession = useMemo(
    () => teacherOpenSessions.find((session) => session.id === selectedOpenSessionId) ?? null,
    [selectedOpenSessionId, teacherOpenSessions],
  );

  useEffect(() => {
    if (!isTeacher) return;
    if (!teacherOpenSessions.some((session) => session.id === selectedOpenSessionId)) {
      setSelectedOpenSessionId(teacherOpenSessions[0]?.id ?? null);
    }
  }, [isTeacher, selectedOpenSessionId, teacherOpenSessions]);

  const availableClasses = useMemo(() => {
    if (!assignments) return [];
    return Array.from(new Map(assignments.map((assignment) => [
      String(assignment.classId),
      { id: assignment.classId, name: assignment.className },
    ])).values());
  }, [assignments]);
  const availableSubjects = useMemo(() => assignments?.filter(
    (assignment) => String(assignment.classId) === selectedClassId,
  ) ?? [], [assignments, selectedClassId]);
  const selectedAssignment = assignments?.find((assignment) => (
    String(assignment.classId) === selectedClassId
    && String(assignment.subjectId) === selectedSubjectId
  )) ?? null;
  const filteredSessions = sessions;
  const selectedSession = sessions.find((session) => session.id === selectedSessionId) ?? null;
  const visibleTeachers = teachersList.filter((teacher) => teacher.schoolId === schoolId && !teacher.isDeleted);

  const showError = (actionError: unknown, fallback: string) => {
    setError(actionError instanceof Error ? actionError.message : fallback);
    setSuccess(null);
  };

  const refreshAfterAction = async (message: string) => {
    setSuccess(message);
    setError(null);
    await loadData();
  };

  const resetGpsAttempt = () => {
    setValidatedGps(null);
    setPendingEndValidation(null);
    setGpsReading(null);
    setGpsStatus('idle');
    setError(null);
    setSuccess(null);
  };

  const selectTeacherAction = (action: TeacherAction) => {
    if (actionInFlight.current) return;
    setTeacherAction(action);
    setStartedSession(null);
    setEndConfirmation(null);
    resetGpsAttempt();
  };

  const startSession = async () => {
    if (!selectedAssignment) {
      setError('Choisissez une classe et une matière parmi vos associations pédagogiques.');
      return;
    }
    if (teacherOpenSessions.length > 0) {
      setError('Une séance est déjà en cours. Sélectionnez « Fin » pour la clôturer.');
      return;
    }
    if (actionInFlight.current) return;
    actionInFlight.current = true;
    setBusyAction('start');
    setError(null);
    setSuccess(null);
    setStartedSession(null);
    setValidatedGps(null);
    setGpsReading(null);
    setGpsStatus('locating');
    try {
      const fix = await requestPosition((reading) => setGpsReading(reading));
      setGpsReading(fix);
      setGpsStatus('obtained');
      const { challenge } = await postJson<{ challenge: string }>('/api/teacher-control/gps-challenges', { action: 'start_session' });
      setGpsStatus('verifying');
      const started = await postJson<Session>('/api/teacher-control/sessions/start', {
        classId: selectedAssignment.classId,
        subjectId: selectedAssignment.subjectId,
        ...fix,
        gpsChallenge: challenge,
      });
      if (!started?.startedAt || !Number.isFinite(Date.parse(started.startedAt))) {
        throw new Error('Le serveur n’a pas retourné l’heure officielle de début.');
      }
      setStartedSession(started);
      setValidatedGps({ fix, timestamp: started.startedAt });
      setGpsStatus('validated');
      await refreshAfterAction('La séance a été démarrée et le contrôle GPS a été validé.');
    } catch (actionError) {
      const failure = gpsFailureMessage(actionError);
      setGpsStatus(failure.status);
      showError(new Error(failure.message), 'Erreur de communication ou de vérification du serveur.');
    } finally {
      actionInFlight.current = false;
      setBusyAction(null);
    }
  };

  const validateEndSession = async () => {
    if (!selectedOpenSession) {
      setError('Sélectionnez une séance en cours à clôturer.');
      return;
    }
    if (actionInFlight.current) return;
    actionInFlight.current = true;
    const session = selectedOpenSession;
    setBusyAction(`end-${session.id}`);
    setError(null);
    setSuccess(null);
    setPendingEndValidation(null);
    setValidatedGps(null);
    setGpsReading(null);
    setGpsStatus('locating');
    try {
      const fix = await requestPosition((reading) => setGpsReading(reading));
      setGpsReading(fix);
      setGpsStatus('obtained');
      const { challenge } = await postJson<{ challenge: string }>('/api/teacher-control/gps-challenges', {
        action: 'end_session',
        sessionId: session.id,
      });
      setGpsStatus('verifying');
      const validation = await postJson<{ sessionId: number; latitude: number; longitude: number; validatedAt: string }>(
        `/api/teacher-control/sessions/${session.id}/validate-end`,
        {
          ...fix,
          gpsChallenge: challenge,
        },
      );
      if (!validation?.validatedAt
        || !Number.isFinite(Date.parse(validation.validatedAt))
        || validation.sessionId !== session.id
        || validation.latitude !== fix.latitude
        || validation.longitude !== fix.longitude) {
        throw new Error('Le serveur n’a pas confirmé la validation GPS de clôture.');
      }
      const pending: PendingEndValidation = {
        ...fix,
        sessionId: session.id,
        challenge,
        validatedAt: validation.validatedAt,
      };
      setPendingEndValidation(pending);
      setValidatedGps({ fix, timestamp: validation.validatedAt });
      setGpsStatus('validated');
    } catch (actionError) {
      setPendingEndValidation(null);
      setValidatedGps(null);
      const failure = gpsFailureMessage(actionError);
      setGpsStatus(failure.status);
      showError(new Error(failure.message), 'Erreur de communication ou de vérification du serveur.');
    } finally {
      actionInFlight.current = false;
      setBusyAction(null);
    }
  };

  const completeEndSession = async () => {
    if (!pendingEndValidation || actionInFlight.current) return;
    const pending = pendingEndValidation;
    const session = teacherOpenSessions.find((item) => item.id === pending.sessionId);
    if (!session) {
      setPendingEndValidation(null);
      setValidatedGps(null);
      setError('Cette séance n’est plus en cours. Actualisez la liste avant de continuer.');
      return;
    }
    actionInFlight.current = true;
    setBusyAction(`end-${session.id}`);
    setError(null);
    setSuccess(null);
    setGpsStatus('verifying');
    try {
      const ended = await postJson<Session>(`/api/teacher-control/sessions/${session.id}/end`, {
        latitude: pending.latitude,
        longitude: pending.longitude,
        accuracyMeters: pending.accuracyMeters,
        gpsChallenge: pending.challenge,
      });
      if (!ended?.validatedEndedAt || !Number.isFinite(Date.parse(ended.validatedEndedAt))) {
        throw new Error('Le serveur n’a pas retourné l’heure officielle de fin.');
      }
      setEndConfirmation({
        session,
        endedAt: ended.validatedEndedAt,
        fix: pending,
      });
      setPendingEndValidation(null);
      setValidatedGps(null);
      setGpsStatus('validated');
      await refreshAfterAction('La séance est clôturée avec une heure de fin validée.');
    } catch (actionError) {
      setPendingEndValidation(null);
      setValidatedGps(null);
      setGpsReading(pending);
      const failure = gpsFailureMessage(actionError);
      setGpsStatus(failure.status);
      showError(new Error(failure.message), 'Erreur de communication ou de vérification du serveur.');
    } finally {
      actionInFlight.current = false;
      setBusyAction(null);
    }
  };

  const submitRegularization = async (session: Session) => {
    const proposedEndedAt = parseLomeInput(requestEndTimes[session.id] ?? '');
    const reason = requestReasons[session.id]?.trim() ?? '';
    if (!proposedEndedAt || !reason) {
      setError('Indiquez une heure de fin proposée et un motif.');
      return;
    }
    setBusyAction(`regularize-${session.id}`);
    setError(null);
    try {
      await postJson(`/api/teacher-control/sessions/${session.id}/regularizations`, { proposedEndedAt, reason });
      await refreshAfterAction('Votre demande de régularisation a été transmise.');
      setRequestReasons((previous) => ({ ...previous, [session.id]: '' }));
    } catch (actionError) {
      showError(actionError, 'Impossible de transmettre la demande de régularisation.');
    } finally {
      setBusyAction(null);
    }
  };

  const submitUnrecordedRegularization = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (actionInFlight.current || !assignments) return;
    const classId = Number(unrecordedClassId);
    const subjectId = Number(unrecordedSubjectId);
    const assignment = assignments.find((item) => item.classId === classId && item.subjectId === subjectId);
    if (!assignment || !unrecordedReason.trim()) {
      setError('Sélectionnez une classe, une matière autorisée et indiquez le motif.');
      return;
    }

    const declaredStartedAt = unrecordedRequestType === 'late_declaration'
      ? parseLomeInput(unrecordedStartedAt)
      : null;
    const proposedEndedAt = unrecordedRequestType === 'late_declaration'
      ? parseLomeInput(unrecordedEndedAt)
      : null;
    if (unrecordedRequestType === 'late_declaration'
      && (!declaredStartedAt || !proposedEndedAt || declaredStartedAt >= proposedEndedAt || proposedEndedAt > new Date().toISOString())) {
      setError('Pour une déclaration tardive, indiquez une date/heure de début et de fin cohérentes, non futures.');
      return;
    }
    actionInFlight.current = true;
    setBusyAction('unrecorded-regularization');
    setError(null);
    const gpsEvidence = unrecordedRequestType === 'immediate_report' ? gpsReading : null;
    try {
      await postJson('/api/teacher-control/regularizations/unrecorded', {
        requestType: unrecordedRequestType,
        classId,
        subjectId,
        reason: unrecordedReason.trim(),
        description: unrecordedDescription.trim() || null,
        ...(unrecordedRequestType === 'immediate_report'
          ? {
            incidentType: unrecordedIncidentType,
            ...(gpsEvidence ? {
              latitude: gpsEvidence.latitude,
              longitude: gpsEvidence.longitude,
              accuracyMeters: gpsEvidence.accuracyMeters,
            } : {}),
            technicalDetails: {
              gpsErrorCode: gpsStatus,
              gpsErrorMessage: error,
              networkOnline: navigator.onLine,
              ...(gpsEvidence ? { gpsAccuracyMeters: gpsEvidence.accuracyMeters } : {}),
            },
          }
          : { declaredStartedAt, proposedEndedAt }),
      });
      await refreshAfterAction(unrecordedRequestType === 'immediate_report'
        ? 'Le signalement immédiat a été transmis. Son heure serveur constitue l’heure de début de référence, sans certifier la présence ni le début effectif du cours.'
        : 'La déclaration tardive a été transmise pour examen administratif.');
      setUnrecordedRequestOpen(false);
      setUnrecordedReason('');
      setUnrecordedDescription('');
      setUnrecordedStartedAt('');
      setUnrecordedEndedAt('');
    } catch (requestError) {
      showError(requestError, 'Impossible de transmettre la demande de régularisation.');
    } finally {
      actionInFlight.current = false;
      setBusyAction(null);
    }
  };

  const completeImmediateRegularization = async (request: Regularization['request']) => {
    const proposedEndedAt = parseLomeInput(requestEndTimes[request.id] ?? '');
    if (!proposedEndedAt) {
      setError('Indiquez une heure de fin déclarée valide.');
      return;
    }
    if (actionInFlight.current) return;
    actionInFlight.current = true;
    setBusyAction(`complete-report-${request.id}`);
    setError(null);
    try {
      await postJson(`/api/teacher-control/regularizations/${request.id}/complete`, {
        proposedEndedAt,
        description: unrecordedCompletionDescription[request.id]?.trim() || null,
      });
      await refreshAfterAction('L’heure de fin déclarée a été ajoutée à votre signalement.');
      setRequestEndTimes((current) => ({ ...current, [request.id]: '' }));
      setUnrecordedCompletionDescription((current) => ({ ...current, [request.id]: '' }));
    } catch (requestError) {
      showError(requestError, 'Impossible de compléter le signalement.');
    } finally {
      actionInFlight.current = false;
      setBusyAction(null);
    }
  };

  const decideRegularization = async (
    request: Regularization['request'],
    decision: 'accepted' | 'rejected' | 'modified_accepted',
  ) => {
    const reason = regularizationReasons[request.id]?.trim() ?? '';
    const proposedEndedAt = decision === 'modified_accepted'
      ? parseLomeInput(regularizationEndTimes[request.id] ?? '')
      : null;
    const proposedStartedAt = decision === 'modified_accepted' && request.requestType !== 'incomplete_session'
      ? parseLomeInput(regularizationStartTimes[request.id] ?? '')
      : null;
    if ((decision === 'rejected' || decision === 'modified_accepted') && !reason) {
      setError('Un motif est obligatoire pour cette décision.');
      return;
    }
    if (decision === 'modified_accepted' && !proposedEndedAt) {
      setError('Indiquez une nouvelle heure de fin valide.');
      return;
    }
    if (decision === 'modified_accepted' && request.requestType !== 'incomplete_session' && !proposedStartedAt) {
      setError('Indiquez une nouvelle heure de début valide.');
      return;
    }
    setBusyAction(`decision-${request.id}`);
    setError(null);
    try {
      await postJson(`/api/teacher-control/regularizations/${request.id}/decision`, {
        decision,
        ...(reason ? { reason } : {}),
        ...(proposedEndedAt ? { proposedEndedAt } : {}),
        ...(proposedStartedAt ? { proposedStartedAt } : {}),
        ...(isSuperAdmin ? { schoolId } : {}),
      });
      await refreshAfterAction('La décision a été enregistrée et auditée.');
    } catch (actionError) {
      showError(actionError, 'Impossible d’enregistrer la décision.');
    } finally {
      setBusyAction(null);
    }
  };

  const closeIncompleteSession = async (session: Session, rawReason: string) => {
    const reason = rawReason.trim();
    if (!reason) {
      setError('La clôture administrative nécessite un motif.');
      return;
    }
    setBusyAction(`close-${session.id}`);
    setError(null);
    try {
      await postJson(`/api/teacher-control/sessions/${session.id}/close-incomplete`, { reason });
      await refreshAfterAction('La séance a été clôturée sans heure de fin ni durée inventée.');
    } catch (actionError) {
      showError(actionError, 'Impossible de clôturer la séance.');
    } finally {
      setBusyAction(null);
    }
  };

  const saveGpsSettings = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const latitude = gpsForm.latitude.trim() ? Number(gpsForm.latitude) : null;
    const longitude = gpsForm.longitude.trim() ? Number(gpsForm.longitude) : null;
    const radius = Number(gpsForm.geofenceRadiusMeters);
    if (!Number.isSafeInteger(radius) || radius <= 0) {
      setError('Le rayon doit être un nombre entier positif.');
      return;
    }
    if (gpsForm.isEnabled && (latitude == null || longitude == null)) {
      setError('Renseignez les coordonnées de l’établissement avant d’activer le contrôle GPS.');
      return;
    }
    setBusyAction('gps-settings');
    setError(null);
    try {
      await putJson('/api/teacher-control/gps-settings', {
        ...(isSuperAdmin ? { schoolId } : {}),
        isEnabled: gpsForm.isEnabled,
        latitude,
        longitude,
        geofenceRadiusMeters: radius,
      });
      await refreshAfterAction('La configuration GPS a été mise à jour et auditée.');
    } catch (actionError) {
      showError(actionError, 'Impossible d’enregistrer la configuration GPS.');
    } finally {
      setBusyAction(null);
    }
  };

  const getSchoolLocation = () => {
    if (!canManageGps || gpsLocationLoading) return;
    if (window.isSecureContext === false) {
      setGpsLocationMessage('La géolocalisation nécessite une connexion sécurisée (HTTPS ou localhost).');
      return;
    }
    if (currentDocumentAllowsGeolocation() === false) {
      setGpsLocationMessage('La géolocalisation est bloquée par la politique de sécurité de cette page. Ouvrez EcoleTrack depuis sa page principale sur la même origine.');
      return;
    }
    if (!navigator.geolocation?.getCurrentPosition) {
      setGpsLocationMessage('La géolocalisation n’est pas disponible sur cet appareil.');
      return;
    }

    setGpsLocationLoading(true);
    setGpsLocationMessage('');
    navigator.geolocation.getCurrentPosition((position) => {
      setGpsForm((current) => ({
        ...current,
        latitude: String(position.coords.latitude),
        longitude: String(position.coords.longitude),
      }));
      setGpsLocationMessage(`Position obtenue (précision indiquée par l’appareil : ${Math.ceil(position.coords.accuracy)} m). Vérifiez les coordonnées avant l’enregistrement.`);
      setGpsLocationLoading(false);
    }, (geoError) => {
      if (geoError.code === geoError.PERMISSION_DENIED) {
        setGpsLocationMessage(currentDocumentAllowsGeolocation() === false
          ? 'La géolocalisation a été bloquée par la politique de sécurité de cette page.'
          : 'Le navigateur a refusé la géolocalisation. Vérifiez l’autorisation du site dans les paramètres du navigateur puis réessayez.');
      } else if (geoError.code === geoError.POSITION_UNAVAILABLE) {
        setGpsLocationMessage('Position indisponible. Vérifiez que la localisation de l’appareil est activée puis réessayez.');
      } else if (geoError.code === geoError.TIMEOUT) {
        setGpsLocationMessage('Délai dépassé lors de la récupération de la position. Réessayez.');
      } else {
        setGpsLocationMessage('Erreur inattendue lors de la récupération de la position. Réessayez.');
      }
      setGpsLocationLoading(false);
    }, {
      enableHighAccuracy: true,
      maximumAge: 0,
      timeout: 45_000,
    });
  };

  const saveRate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const parsedRate = hourlyRate.trim() === '' ? null : Number(hourlyRate);
    if (parsedRate != null && (!Number.isSafeInteger(parsedRate) || parsedRate < 0)) {
      setError('Le taux doit être un montant entier positif ou nul en XOF.');
      return;
    }
    if (!selectedTeacherId) {
      setError('Sélectionnez un enseignant.');
      return;
    }
    setBusyAction('hourly-rate');
    setError(null);
    try {
      await putJson(`/api/teacher-control/teachers/${selectedTeacherId}/hourly-rate`, {
        ...(isSuperAdmin ? { schoolId } : {}),
        hourlyRateXof: parsedRate,
      });
      await refreshAfterAction(parsedRate == null ? 'Le taux horaire a été supprimé.' : 'Le taux horaire a été enregistré.');
      setRateLoaded(true);
    } catch (actionError) {
      showError(actionError, 'Impossible d’enregistrer le taux horaire.');
    } finally {
      setBusyAction(null);
    }
  };

  const applySessionFilters = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (filterRequestInFlightRef.current || loading || sessionFilterOptionsLoading) return;
    if (filterDraft.period === 'custom' && (!filterDraft.from || !filterDraft.to)) {
      setError('Une période personnalisée exige une date de début et une date de fin.');
      return;
    }
    if (filterDraft.from && filterDraft.to && filterDraft.from > filterDraft.to) {
      setError('La date de début doit précéder la date de fin.');
      return;
    }
    const nextFilters = { ...filterDraft };
    const requestToken = ++filterRequestTokenRef.current;
    filterRequestInFlightRef.current = true;
    setFilterResultsLoading(true);
    setError(null);
    try {
      if (isSuperAdmin && schoolId == null) {
        const params = makeFilterParams(true, nextFilters);
        const summary = await apiFetch(`/api/teacher-control/statistics/global${params.size ? `?${params}` : ''}`) as GlobalStatistics;
        if (requestToken !== filterRequestTokenRef.current) return;
        setGlobalStatistics(summary);
        setStatistics(summary);
        setSessions([]);
        setSessionTotalCount(summary.totalSessions);
        setSessionNextCursor(null);
      } else {
        const sessionParams = makeFilterParams(false, nextFilters);
        sessionParams.set('limit', '50');
        if (isSuperAdmin && schoolId != null) sessionParams.set('schoolId', String(schoolId));
        const statisticsParams = makeFilterParams(true, nextFilters);
        const [sessionPage, summary] = await Promise.all([
          apiFetch(`/api/teacher-control/sessions?${sessionParams.toString()}`) as Promise<SessionPage>,
          apiFetch(`/api/teacher-control/statistics${statisticsParams.size ? `?${statisticsParams}` : ''}`) as Promise<Statistics>,
        ]);
        if (requestToken !== filterRequestTokenRef.current) return;
        const pageItems = Array.isArray(sessionPage) ? sessionPage : sessionPage?.items;
        setSessions(Array.isArray(pageItems) ? pageItems : []);
        setSessionTotalCount(sessionPage?.totalCount ?? (Array.isArray(pageItems) ? pageItems.length : 0));
        setSessionNextCursor(sessionPage?.nextCursor ?? null);
        setStatistics(summary);
        setGlobalStatistics(null);
      }

      filtersRef.current = nextFilters;
      if (currentCursor) skipNextDataLoadRef.current = true;
      setSessionCursors([null]);
      setSelectedSessionId(null);
      setSessionAudit({});
    } catch (loadError) {
      if (requestToken === filterRequestTokenRef.current) {
        setError(loadError instanceof Error ? loadError.message : 'Impossible d’appliquer les filtres.');
      }
    } finally {
      if (requestToken === filterRequestTokenRef.current) {
        filterRequestInFlightRef.current = false;
        setFilterResultsLoading(false);
      }
    }
  };

  const handleSuperAdminSchoolChange = (nextSchoolId: number | null) => {
    filterRequestTokenRef.current += 1;
    filterRequestInFlightRef.current = false;
    setFilterResultsLoading(false);
    filtersRef.current = EMPTY_SESSION_FILTERS;
    setFilterDraft(EMPTY_SESSION_FILTERS);
    setSessionCursors([null]);
    setSelectedSessionId(null);
    setSessionAudit({});
    onSuperAdminSchoolFilterChange(nextSchoolId);
    setFilterRevision((revision) => revision + 1);
    setError(null);
  };

  const toggleSessionDetails = async (session: Session) => {
    if (selectedSessionId === session.id) {
      setSelectedSessionId(null);
      return;
    }
    setSelectedSessionId(session.id);
    if (isTeacher) return;
    if (sessionAudit[session.id]) return;
    setAuditLoadingSessionId(session.id);
    try {
      const response = await apiFetch(`/api/teacher-control/sessions/${session.id}/audit${schoolQuery}`) as SessionAuditEvent[];
      setSessionAudit((current) => ({ ...current, [session.id]: Array.isArray(response) ? response : [] }));
    } catch (auditError) {
      setError(auditError instanceof Error ? auditError.message : 'Impossible de charger le journal de cette séance.');
    } finally {
      setAuditLoadingSessionId(null);
    }
  };

  const goToNextSessionPage = () => {
    if (!sessionNextCursor) return;
    setSessionCursors((current) => [...current, sessionNextCursor]);
  };

  const goToPreviousSessionPage = () => {
    if (sessionCursors.length <= 1) return;
    setSessionCursors((current) => current.slice(0, -1));
  };

  const tabs: Array<{ id: ViewTab; label: string; icon: typeof ClipboardCheck }> = [
    { id: 'sessions', label: 'Séances', icon: CalendarClock },
    { id: 'requests', label: 'Régularisations', icon: ClipboardCheck },
    ...(!isTeacher ? [
      { id: 'gps' as const, label: 'Configuration GPS', icon: MapPin },
      { id: 'rates' as const, label: 'Taux horaires', icon: Banknote },
    ] : []),
  ];

  if (isSuperAdmin && !schoolId) {
    return (
      <section className="space-y-5" aria-labelledby="teacher-control-title">
        <ModuleHeading role={userRole} onRefresh={() => void loadData()} loading={loading} />
        {error && <ErrorNotice message={error} />}
        {loading && <p role="status" className="text-sm text-slate-500">Chargement des statistiques globales…</p>}
        {globalStatistics && (
          <>
            <form className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-100 bg-slate-50 p-3" onSubmit={applySessionFilters}>
                <SessionFilterControls
                  filters={filterDraft}
                  setFilters={setFilterDraft}
                  options={sessionFilterOptions}
                  optionsLoading={sessionFilterOptionsLoading}
                  resultsLoading={filterResultsLoading}
                  optionsError={sessionFilterOptionsError}
                  isSuperAdmin={isSuperAdmin}
                  showAdministrativeFilters={!isTeacher}
                  schoolsList={schoolsList}
                  selectedSchoolId={schoolId}
                  onSchoolChange={handleSuperAdminSchoolChange}
                />
                <button type="submit" className={secondaryButtonClass} disabled={loading || filterResultsLoading || sessionFilterOptionsLoading}>Appliquer les filtres</button>
                <span className="text-xs text-slate-500">Périodes calculées en UTC (Africa/Lome).</span>
                {filterResultsLoading && <span className="text-xs text-slate-500" role="status" aria-live="polite">Actualisation des statistiques…</span>}
              </form>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <StatCard label="Séances" value={String(globalStatistics.totalSessions)} detail={`${globalStatistics.openSessions} en cours · ${globalStatistics.incompleteSessions} sans fin validée`} />
              <StatCard label="Séances terminées" value={String(globalStatistics.completedSessions)} detail={`${globalStatistics.regularizedSessions} régularisée(s)`} />
              <StatCard label="Durée validée" value={formatDuration(globalStatistics.validatedDurationMilliseconds)} />
              <StatCard label="Rémunération validée" value={formatAmount(globalStatistics.estimatedCompensationXof)} detail={`${globalStatistics.pendingRegularizations} demande(s) en attente`} />
            </div>
            <p className="rounded-xl bg-slate-50 px-4 py-3 text-xs text-slate-600">
              Durées comptabilisées : GPS {formatDuration(globalStatistics.gpsDurationMilliseconds ?? 0)} ({globalStatistics.gpsCompletedSessions ?? 0} séances) · régularisation après séance incomplète {formatDuration(globalStatistics.incompleteRegularizedDurationMilliseconds ?? 0)} ({globalStatistics.incompleteSessionRegularizations ?? 0}) · signalements immédiats {formatDuration(globalStatistics.immediateRegularizedDurationMilliseconds ?? 0)} ({globalStatistics.immediateRegularizedSessions ?? 0}) · déclarations tardives {formatDuration(globalStatistics.lateRegularizedDurationMilliseconds ?? 0)} ({globalStatistics.lateRegularizedSessions ?? 0}).
            </p>
            <div className="overflow-hidden rounded-2xl border border-slate-200">
              <div className="border-b border-slate-200 bg-slate-50 px-4 py-3">
                <h2 className="font-bold text-slate-900">Statistiques par établissement</h2>
                <p className="mt-1 text-xs text-slate-500">Sélectionnez un établissement pour consulter ses séances et son historique détaillé.</p>
              </div>
              <div className="divide-y divide-slate-100">
                {globalStatistics.schools.map((school) => (
                  <button
                    type="button"
                    key={school.schoolId}
                    className="grid w-full gap-2 p-4 text-left hover:bg-slate-50 sm:grid-cols-2 xl:grid-cols-5"
                    onClick={() => handleSuperAdminSchoolChange(school.schoolId)}
                  >
                    <span className="font-semibold text-slate-900">{school.schoolName}</span>
                    <span className="text-sm text-slate-600">{school.totalSessions} séance(s) · {school.openSessions} en cours</span>
                    <span className="text-sm text-slate-600">{school.completedSessions} terminée(s) · {school.incompleteSessions} sans fin validée</span>
                    <span className="text-sm text-slate-600">{formatDuration(school.validatedDurationMilliseconds)}</span>
                    <span className="text-sm font-semibold text-slate-800">
                      {formatAmount(school.estimatedCompensationXof)} · {school.pendingRegularizations} attente(s)
                      <span className="mt-1 block text-xs font-normal text-slate-500">
                        GPS {formatDuration(school.gpsDurationMilliseconds ?? 0)} · incomplètes {formatDuration(school.incompleteRegularizedDurationMilliseconds ?? 0)} · immédiates {formatDuration(school.immediateRegularizedDurationMilliseconds ?? 0)} · tardives {formatDuration(school.lateRegularizedDurationMilliseconds ?? 0)}
                      </span>
                    </span>
                  </button>
                ))}
                {globalStatistics.schools.length === 0 && <p className="p-4 text-sm text-slate-500">Aucun établissement disponible.</p>}
              </div>
            </div>
          </>
        )}
        {!loading && !globalStatistics && <EmptyState>Les statistiques globales ne sont pas disponibles.</EmptyState>}
      </section>
    );
  }

  if (schoolId == null) {
    return <ErrorNotice message="Aucun établissement actif n’est disponible pour votre compte." />;
  }

  return (
    <section className="space-y-6" aria-labelledby="teacher-control-title">
      <ModuleHeading role={userRole} schoolName={selectedSchool?.name} onRefresh={() => void loadData()} loading={loading} />

      {error && <ErrorNotice message={error} />}
      {success && <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{success}</p>}

      {loading && (
        <p role="status" className="flex items-center gap-2 text-sm text-slate-500">
          <RefreshCw className="h-4 w-4 animate-spin" /> Chargement des données du module…
        </p>
      )}

      {!loading && statistics && (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Séances" value={String(statistics.totalSessions)} detail={`${statistics.openSessions} en cours`} />
            <StatCard label="Séances terminées" value={String(statistics.completedSessions)} detail={`${statistics.incompleteSessions} sans fin validée · ${statistics.regularizedSessions} régularisée(s)`} />
            <StatCard label="Durée validée" value={formatDuration(statistics.validatedDurationMilliseconds)} />
            <StatCard label="Montant validé" value={formatAmount(statistics.estimatedCompensationXof)} detail={`${statistics.pendingRegularizations} demande(s) en attente · fins validées uniquement`} />
          </div>
          <p className="rounded-xl bg-slate-50 px-4 py-3 text-xs text-slate-600">
            Durées comptabilisées : GPS {formatDuration(statistics.gpsDurationMilliseconds ?? 0)} ({statistics.gpsCompletedSessions ?? 0} séances) · régularisation après séance incomplète {formatDuration(statistics.incompleteRegularizedDurationMilliseconds ?? 0)} ({statistics.incompleteSessionRegularizations ?? 0}) · signalements immédiats {formatDuration(statistics.immediateRegularizedDurationMilliseconds ?? 0)} ({statistics.immediateRegularizedSessions ?? 0}) · déclarations tardives {formatDuration(statistics.lateRegularizedDurationMilliseconds ?? 0)} ({statistics.lateRegularizedSessions ?? 0}).
          </p>
        </div>
      )}

      <div className="flex gap-2 overflow-x-auto border-b border-slate-200 pb-2" role="tablist" aria-label="Sections du contrôle des enseignants">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={activeTab === id}
            onClick={() => setActiveTab(id)}
            className={`inline-flex shrink-0 items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold transition ${
              activeTab === id ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <Icon className="h-4 w-4" /> {label}
          </button>
        ))}
      </div>

      {activeTab === 'sessions' && (
        <div className="space-y-5">
          {isTeacher && (
            <div className="rounded-2xl border border-indigo-100 bg-indigo-50/60 p-4 sm:p-5">
              <div className="mb-4 flex items-start gap-3">
                <div className="rounded-xl bg-white p-2 text-indigo-600"><GraduationCap className="h-5 w-5" /></div>
                <div>
                  <h2 className="font-bold text-slate-900">{teacherAction == null
                    ? 'Contrôle de présence des enseignants'
                    : teacherAction === 'start' ? 'Début — nouvelle séance' : 'Fin — clôturer une séance'}</h2>
                  <p className="mt-1 text-sm text-slate-600">Le GPS est demandé uniquement après votre clic. L’heure officielle est fournie par le serveur et affichée à l’heure de Lomé.</p>
                  <p className="mt-2 text-xs text-amber-800">Le GPS du navigateur reste falsifiable ; le challenge à usage unique limite le rejeu, mais ne prouve pas une position physique.</p>
                </div>
              </div>

              <div className="mb-4 flex gap-2" role="group" aria-label="Action de séance">
                <button
                  type="button"
                  className={teacherAction === 'start' ? buttonClass : secondaryButtonClass}
                  aria-pressed={teacherAction === 'start'}
                  disabled={busyAction != null}
                  onClick={() => selectTeacherAction('start')}
                >Début</button>
                <button
                  type="button"
                  className={teacherAction === 'end' ? buttonClass : secondaryButtonClass}
                  aria-pressed={teacherAction === 'end'}
                  disabled={busyAction != null}
                  onClick={() => selectTeacherAction('end')}
                >Fin</button>
              </div>

              {teacherAction === 'start' && (
                <div className="space-y-4">
                  {startedSession ? (
                    <div className="space-y-3 rounded-xl border border-emerald-200 bg-white p-4">
                      <p role="status" className="font-semibold text-emerald-800">Séance en cours : {startedSession.classNameSnapshot} · {startedSession.subjectNameSnapshot}</p>
                    </div>
                  ) : teacherOpenSessions.length > 0 ? (
                    <p role="status" className="rounded-xl border border-amber-200 bg-white p-4 text-sm text-amber-900">
                      Une séance est déjà en cours. Sélectionnez « Fin » pour la clôturer avant d’en démarrer une autre.
                    </p>
                  ) : assignments === null ? (
                    <p role="status" className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
                      {loading ? 'Chargement de vos associations pédagogiques…' : 'Vos associations pédagogiques n’ont pas pu être vérifiées. Consultez le message d’erreur avant de réessayer.'}
                    </p>
                  ) : assignments.length === 0 ? (
                    <EmptyState>Aucune association classe-matière active n’est disponible pour votre compte dans cette école. Vérifiez vos associations pédagogiques existantes.</EmptyState>
                  ) : (
                    <>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <label>
                          <span className="mb-1.5 block text-sm font-semibold text-slate-700">Classe</span>
                          <select
                            className={inputClass}
                            aria-label="Classe"
                            value={selectedClassId}
                            disabled={busyAction != null}
                            onChange={(event) => {
                              setSelectedClassId(event.target.value);
                              setSelectedSubjectId('');
                              resetGpsAttempt();
                            }}
                          >
                            <option value="">Sélectionner une classe</option>
                            {availableClasses.map((classOption) => (
                              <option key={classOption.id} value={classOption.id}>{classOption.name}</option>
                            ))}
                          </select>
                        </label>
                        <label>
                          <span className="mb-1.5 block text-sm font-semibold text-slate-700">Matière</span>
                          <select
                            className={inputClass}
                            aria-label="Matière"
                            value={selectedSubjectId}
                            disabled={!selectedClassId || busyAction != null}
                            onChange={(event) => {
                              setSelectedSubjectId(event.target.value);
                              resetGpsAttempt();
                            }}
                          >
                            <option value="">Sélectionner une matière</option>
                            {availableSubjects.map((assignment) => (
                              <option key={assignment.subjectId} value={assignment.subjectId}>{assignment.subjectName}</option>
                            ))}
                          </select>
                        </label>
                      </div>
                    </>
                  )}
                  <div className="grid gap-3 rounded-xl border border-white bg-white p-4 sm:grid-cols-2 lg:grid-cols-5">
                    <label className="flex min-w-0 flex-col text-sm font-semibold text-slate-700">Latitude
                      <input className={`${inputClass} mt-1`} aria-label="Latitude de début" readOnly value={(validatedGps?.fix ?? gpsReading)?.latitude ?? 'En attente'} />
                    </label>
                    <label className="flex min-w-0 flex-col text-sm font-semibold text-slate-700">Longitude
                      <input className={`${inputClass} mt-1`} aria-label="Longitude de début" readOnly value={(validatedGps?.fix ?? gpsReading)?.longitude ?? 'En attente'} />
                    </label>
                    <label className="flex min-w-0 flex-col text-sm font-semibold text-slate-700">Précision GPS (m)
                      <input className={`${inputClass} mt-1`} aria-label="Précision GPS de début" readOnly value={gpsReadingValue(validatedGps?.fix ?? gpsReading)} />
                    </label>
                    <label className="flex min-w-0 flex-col text-sm font-semibold text-slate-700">Date du début
                      <input className={`${inputClass} mt-1`} aria-label="Date du début" readOnly value={validatedGps ? formatLomeDate(validatedGps.timestamp, false) : 'En attente du serveur'} />
                    </label>
                    <label className="flex min-w-0 flex-col text-sm font-semibold text-slate-700">Heure du début
                      <input className={`${inputClass} mt-1`} aria-label="Heure du début" readOnly value={validatedGps ? formatLomeTime(validatedGps.timestamp) : 'En attente du serveur'} />
                    </label>
                  </div>
                  <p role="status" aria-live="polite" className={`text-sm ${gpsStatusClass(gpsStatus)}`}>
                    {gpsStatusLabel(gpsStatus, gpsReading)}
                  </p>
                  {!startedSession && teacherOpenSessions.length === 0 && assignments?.length !== 0 && (
                    <button type="button" className={buttonClass} onClick={() => void startSession()} disabled={!selectedAssignment || busyAction != null}>
                      {busyAction === 'start' ? <RefreshCw className="h-4 w-4 animate-spin" /> : <MapPin className="h-4 w-4" />}
                      {isGpsRetryStatus(gpsStatus) ? 'Réessayer' : 'Obtenir ma position'}
                    </button>
                  )}
                </div>
              )}

              {teacherAction === 'end' && (
                <div className="space-y-4">
                  {endConfirmation ? (
                    <div role="status" className="space-y-2 rounded-xl border border-emerald-200 bg-white p-4 text-sm text-emerald-800">
                      <p className="font-semibold">Séance clôturée : {endConfirmation.session.classNameSnapshot} · {endConfirmation.session.subjectNameSnapshot}</p>
                      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                        <label className="flex min-w-0 flex-col text-sm font-semibold">Latitude de fin
                          <input className={`${inputClass} mt-1`} aria-label="Latitude de fin" readOnly value={endConfirmation.fix.latitude} />
                        </label>
                        <label className="flex min-w-0 flex-col text-sm font-semibold">Longitude de fin
                          <input className={`${inputClass} mt-1`} aria-label="Longitude de fin" readOnly value={endConfirmation.fix.longitude} />
                        </label>
                        <label className="flex min-w-0 flex-col text-sm font-semibold">Précision GPS (m)
                          <input className={`${inputClass} mt-1`} aria-label="Précision GPS de fin" readOnly value={Math.ceil(endConfirmation.fix.accuracyMeters)} />
                        </label>
                        <label className="flex min-w-0 flex-col text-sm font-semibold">Date de fin
                          <input className={`${inputClass} mt-1`} aria-label="Date de fin" readOnly value={formatLomeDate(endConfirmation.endedAt, false)} />
                        </label>
                        <label className="flex min-w-0 flex-col text-sm font-semibold">Heure de fin
                          <input className={`${inputClass} mt-1`} aria-label="Heure de fin" readOnly value={formatLomeTime(endConfirmation.endedAt)} />
                        </label>
                      </div>
                    </div>
                  ) : teacherOpenSessions.length === 0 ? (
                    <EmptyState>Aucune séance en cours à clôturer.</EmptyState>
                  ) : (
                    <>
                      <div className="space-y-2" role="radiogroup" aria-label="Séances en cours">
                        {teacherOpenSessions.map((session) => (
                          <button
                            type="button"
                            key={session.id}
                            role="radio"
                            aria-checked={selectedOpenSessionId === session.id}
                            disabled={busyAction != null}
                            className={`w-full rounded-xl border p-4 text-left transition ${
                              selectedOpenSessionId === session.id ? 'border-indigo-400 bg-white ring-2 ring-indigo-100' : 'border-white bg-white/70'
                            }`}
                            onClick={() => {
                              setSelectedOpenSessionId(session.id);
                              setPendingEndValidation(null);
                              setValidatedGps(null);
                              setGpsReading(null);
                              setEndConfirmation(null);
                              setGpsStatus('idle');
                              setError(null);
                            }}
                          >
                            <span className="block font-semibold text-slate-900">{session.classNameSnapshot} · {session.subjectNameSnapshot}</span>
                            <span className="mt-1 block text-sm text-slate-600">Début : {formatLomeDate(session.startedAt)}</span>
                          </button>
                        ))}
                      </div>
                      {selectedOpenSession && (
                        <div className="space-y-3 rounded-xl border border-white bg-white p-4">
                          <p className="font-semibold text-slate-900">{selectedOpenSession.classNameSnapshot} · {selectedOpenSession.subjectNameSnapshot}</p>
                          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                            <label className="flex min-w-0 flex-col text-sm font-semibold text-slate-700">Latitude de fin
                              <input className={`${inputClass} mt-1`} aria-label="Latitude de fin" readOnly value={(validatedGps?.fix ?? gpsReading)?.latitude ?? endConfirmation?.fix.latitude ?? 'En attente'} />
                            </label>
                            <label className="flex min-w-0 flex-col text-sm font-semibold text-slate-700">Longitude de fin
                              <input className={`${inputClass} mt-1`} aria-label="Longitude de fin" readOnly value={(validatedGps?.fix ?? gpsReading)?.longitude ?? endConfirmation?.fix.longitude ?? 'En attente'} />
                            </label>
                            <label className="flex min-w-0 flex-col text-sm font-semibold text-slate-700">Précision GPS (m)
                              <input className={`${inputClass} mt-1`} aria-label="Précision GPS de fin" readOnly value={gpsReadingValue(validatedGps?.fix ?? gpsReading)} />
                            </label>
                            <label className="flex min-w-0 flex-col text-sm font-semibold text-slate-700">Date de fin
                              <input className={`${inputClass} mt-1`} aria-label="Date de fin" readOnly value={endConfirmation ? formatLomeDate(endConfirmation.endedAt, false) : 'En attente de clôture'} />
                            </label>
                            <label className="flex min-w-0 flex-col text-sm font-semibold text-slate-700">Heure de fin
                              <input className={`${inputClass} mt-1`} aria-label="Heure de fin" readOnly value={endConfirmation ? formatLomeTime(endConfirmation.endedAt) : 'En attente de clôture'} />
                            </label>
                          </div>
                          <p role="status" aria-live="polite" className={`text-sm ${
                            gpsStatusClass(gpsStatus)
                          }`}>{gpsStatusLabel(gpsStatus, gpsReading)}</p>
                          {pendingEndValidation ? (
                            <button type="button" className={buttonClass} onClick={() => void completeEndSession()} disabled={busyAction != null}>
                              {busyAction === `end-${selectedOpenSession.id}` ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                              Terminer maintenant
                            </button>
                          ) : (
                            <button type="button" className={buttonClass} onClick={() => void validateEndSession()} disabled={busyAction != null}>
                              {busyAction === `end-${selectedOpenSession.id}` ? <RefreshCw className="h-4 w-4 animate-spin" /> : <MapPin className="h-4 w-4" />}
                              {isGpsRetryStatus(gpsStatus) ? 'Réessayer' : 'Obtenir ma position'}
                            </button>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          )}

          {isTeacher && assignments && assignments.length > 0 && (
            <section className="space-y-3 rounded-2xl border border-amber-200 bg-amber-50/50 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="font-bold text-slate-900">Séance non enregistrée</h2>
                  <p className="mt-1 text-sm text-slate-600">Signalez immédiatement un problème empêchant le démarrage, ou déclarez ultérieurement un cours oublié.</p>
                </div>
                <button
                  type="button"
                  className={secondaryButtonClass}
                  aria-expanded={unrecordedRequestOpen}
                  onClick={() => setUnrecordedRequestOpen((open) => !open)}
                >{unrecordedRequestOpen ? 'Fermer' : 'Demander la régularisation d’une séance non enregistrée'}</button>
              </div>
              {unrecordedRequestOpen && (
                <form className="grid gap-3 rounded-xl border border-amber-100 bg-white p-4 sm:grid-cols-2" onSubmit={(event) => void submitUnrecordedRegularization(event)}>
                  <label className="text-sm font-semibold text-slate-700">
                    Circonstance
                    <select
                      className={`${inputClass} mt-1`}
                      aria-label="Circonstance de la demande"
                      value={unrecordedRequestType}
                      disabled={busyAction != null}
                      onChange={(event) => setUnrecordedRequestType(event.target.value as UnrecordedRequestType)}
                    >
                      <option value="late_declaration">Déclaration tardive d’un cours oublié</option>
                      <option value="immediate_report">Signalement immédiat d’un problème de démarrage</option>
                    </select>
                  </label>
                  <label className="text-sm font-semibold text-slate-700">
                    Classe
                    <select className={`${inputClass} mt-1`} aria-label="Classe de la demande" value={unrecordedClassId} disabled={busyAction != null} onChange={(event) => {
                      setUnrecordedClassId(event.target.value);
                      setUnrecordedSubjectId('');
                    }}>
                      <option value="">Sélectionner une classe</option>
                      {availableClasses.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
                    </select>
                  </label>
                  <label className="text-sm font-semibold text-slate-700">
                    Matière
                    <select className={`${inputClass} mt-1`} aria-label="Matière de la demande" value={unrecordedSubjectId} disabled={!unrecordedClassId || busyAction != null} onChange={(event) => setUnrecordedSubjectId(event.target.value)}>
                      <option value="">Sélectionner une matière</option>
                      {assignments.filter((item) => String(item.classId) === unrecordedClassId).map((item) => (
                        <option key={item.subjectId} value={item.subjectId}>{item.subjectName}</option>
                      ))}
                    </select>
                  </label>
                  {unrecordedRequestType === 'immediate_report' ? (
                    <>
                      <label className="text-sm font-semibold text-slate-700">
                        Motif du problème
                        <select className={`${inputClass} mt-1`} aria-label="Motif du problème" value={unrecordedIncidentType} onChange={(event) => setUnrecordedIncidentType(event.target.value as IncidentType)}>
                          <option value="gps_unavailable">GPS indisponible</option>
                          <option value="gps_accuracy">Précision GPS insuffisante</option>
                          <option value="permission_denied">Permission de géolocalisation refusée</option>
                          <option value="network">Connexion Internet indisponible</option>
                          <option value="application">Erreur technique de l’application</option>
                          <option value="other">Autre problème</option>
                        </select>
                      </label>
                      <p className="rounded-lg bg-indigo-50 p-3 text-sm text-indigo-900 sm:col-span-2">
                        L’heure de soumission enregistrée par le serveur sera l’heure de début de référence. Elle ne prouve pas à elle seule que le cours a commencé. Vous pourrez déclarer l’heure de fin après le cours.
                      </p>
                      {gpsReading && (
                        <p className="text-xs text-slate-500 sm:col-span-2">
                          Position éventuellement obtenue lors de la tentative (non validée) : {gpsReading.latitude}, {gpsReading.longitude} · précision {Math.ceil(gpsReading.accuracyMeters)} m.
                        </p>
                      )}
                    </>
                  ) : (
                    <>
                      <label className="text-sm font-semibold text-slate-700">
                        Début déclaré · heure de Lomé
                        <input className={`${inputClass} mt-1`} type="datetime-local" aria-label="Début déclaré" value={unrecordedStartedAt} max={formatLomeInput()} onChange={(event) => setUnrecordedStartedAt(event.target.value)} required />
                      </label>
                      <label className="text-sm font-semibold text-slate-700">
                        Fin déclarée · heure de Lomé
                        <input className={`${inputClass} mt-1`} type="datetime-local" aria-label="Fin déclarée" value={unrecordedEndedAt} min={unrecordedStartedAt || undefined} max={formatLomeInput()} onChange={(event) => setUnrecordedEndedAt(event.target.value)} required />
                      </label>
                    </>
                  )}
                  <label className="text-sm font-semibold text-slate-700 sm:col-span-2">
                    Motif / explication
                    <textarea className={`${inputClass} mt-1 min-h-20`} value={unrecordedReason} onChange={(event) => setUnrecordedReason(event.target.value)} required maxLength={1000} />
                  </label>
                  <label className="text-sm font-semibold text-slate-700 sm:col-span-2">
                    Précisions facultatives
                    <textarea className={`${inputClass} mt-1 min-h-16`} value={unrecordedDescription} onChange={(event) => setUnrecordedDescription(event.target.value)} maxLength={2000} />
                  </label>
                  <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
                    <button className={buttonClass} type="submit" disabled={busyAction != null}>
                      {busyAction === 'unrecorded-regularization' && <RefreshCw className="h-4 w-4 animate-spin" />}
                      Transmettre à l’administration
                    </button>
                  </div>
                </form>
              )}
            </section>
          )}

          <form className="space-y-4 rounded-2xl border border-slate-100 bg-slate-50 p-4" onSubmit={applySessionFilters}>
            <h2 className="font-bold text-slate-900">Filtres des séances</h2>
            <SessionFilterControls
              filters={filterDraft}
              setFilters={setFilterDraft}
              options={sessionFilterOptions}
              optionsLoading={sessionFilterOptionsLoading}
              resultsLoading={filterResultsLoading}
              optionsError={sessionFilterOptionsError}
              isSuperAdmin={isSuperAdmin}
              showAdministrativeFilters={!isTeacher}
              schoolsList={schoolsList}
              selectedSchoolId={schoolId}
              onSchoolChange={handleSuperAdminSchoolChange}
            />
            <div className="flex flex-wrap items-center gap-3">
              <button type="submit" className={secondaryButtonClass} disabled={loading || filterResultsLoading || sessionFilterOptionsLoading}>Appliquer les filtres</button>
              <span className="text-xs text-slate-500">Filtres appliqués côté serveur · {sessionTotalCount} résultat(s) au total</span>
              {filterResultsLoading && <span className="text-xs text-slate-500" role="status" aria-live="polite">Actualisation des séances et statistiques…</span>}
            </div>
          </form>

          {isTeacher && sessions.some((session) => session.status === 'open' && !regularizations.some((entry) => entry.request.sessionId === session.id && entry.request.status === 'pending')) && (
            <TeacherRegularizationForms
              sessions={sessions.filter((session) => session.status === 'open')}
              regularizations={regularizations}
              requestEndTimes={requestEndTimes}
              requestReasons={requestReasons}
              busyAction={busyAction}
              onEndTimeChange={(id, value) => setRequestEndTimes((previous) => ({ ...previous, [id]: value }))}
              onReasonChange={(id, value) => setRequestReasons((previous) => ({ ...previous, [id]: value }))}
              onSubmit={(session) => void submitRegularization(session)}
            />
          )}

          {isTeacher && regularizations.length > 0 && (
            <RegularizationHistory requests={regularizations} />
          )}

          {sessions.length === 0 && !loading ? (
            <EmptyState>{sessionTotalCount === 0 ? 'Aucune séance ne correspond aux filtres sélectionnés.' : 'Aucune séance sur cette page.'}</EmptyState>
          ) : filteredSessions.length === 0 && !loading ? (
            <EmptyState>Aucune séance ne correspond aux filtres sélectionnés.</EmptyState>
          ) : (
            <div className="overflow-hidden rounded-2xl border border-slate-200">
              <div className="flex items-center gap-2 border-b border-slate-200 bg-slate-50 px-4 py-3">
                <CalendarClock className="h-4 w-4 text-indigo-600" />
                <h2 className="font-bold text-slate-900">Historique des séances</h2>
                <span className="ml-auto text-xs text-slate-500">{filteredSessions.length} affichée(s)</span>
              </div>
              <div className="divide-y divide-slate-100">
                {filteredSessions.map((session) => (
                  <SessionCard
                    key={session.id}
                    session={session}
                    isTeacher={isTeacher}
                    isSchoolAdmin={isSchoolAdmin}
                    isSuperAdmin={isSuperAdmin}
                    busyAction={busyAction}
                    selected={session.id === selectedSessionId}
                    onSelect={() => void toggleSessionDetails(session)}
                    onClose={(reason) => void closeIncompleteSession(session, reason)}
                    closeReason={closeReasons[session.id] ?? ''}
                    onCloseReasonChange={(reason) => setCloseReasons((previous) => ({ ...previous, [session.id]: reason }))}
                    hasPendingRequest={regularizations.some((entry) => entry.request.sessionId === session.id && entry.request.status === 'pending')}
                  />
                ))}
              </div>
            </div>
          )}

          {selectedSession && !isTeacher && (
            <section className="space-y-3 rounded-2xl border border-slate-200 p-4" aria-label={`Journal de la séance ${selectedSession.id}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-bold text-slate-900">Journal détaillé · séance #{selectedSession.id}</h2>
                {auditLoadingSessionId === selectedSession.id && <span role="status" className="text-xs text-slate-500">Chargement…</span>}
              </div>
              {!auditLoadingSessionId && (sessionAudit[selectedSession.id]?.length ?? 0) === 0 && (
                <p className="text-sm text-slate-500">Aucun événement d’audit associé à cette séance.</p>
              )}
              {sessionAudit[selectedSession.id]?.map((event) => (
                <article key={`${event.resourceType}-${event.id}`} className="rounded-xl bg-slate-50 p-3 text-sm">
                  <div className="flex flex-wrap justify-between gap-2">
                    <p className="font-semibold text-slate-900">{event.action} · {event.actorNameSnapshot} ({event.actorRole})</p>
                    <time className="text-xs text-slate-500">{formatLomeDate(event.createdAt)}</time>
                  </div>
                  {event.reason && <p className="mt-1 text-slate-700">Motif : {event.reason}</p>}
                  <p className="mt-1 text-xs text-slate-500">Ressource : {event.resourceType} · acteur {event.actorEmailSnapshot || '—'}</p>
                  {(event.beforeValues != null || event.afterValues != null) && (
                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                      {event.beforeValues != null && (
                        <div>
                          <p className="text-xs font-semibold text-slate-600">Avant</p>
                          <pre className="mt-1 overflow-x-auto rounded-lg bg-white p-2 text-xs">{JSON.stringify(event.beforeValues, null, 2)}</pre>
                        </div>
                      )}
                      {event.afterValues != null && (
                        <div>
                          <p className="text-xs font-semibold text-slate-600">Après</p>
                          <pre className="mt-1 overflow-x-auto rounded-lg bg-white p-2 text-xs">{JSON.stringify(event.afterValues, null, 2)}</pre>
                        </div>
                      )}
                    </div>
                  )}
                </article>
              ))}
            </section>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-sm text-slate-500">Page {sessionCursors.length} · {sessionTotalCount} séance(s)</span>
            <div className="flex gap-2">
              <button type="button" className={secondaryButtonClass} onClick={goToPreviousSessionPage} disabled={loading || sessionCursors.length <= 1}>
                Page précédente
              </button>
              <button type="button" className={secondaryButtonClass} onClick={goToNextSessionPage} disabled={loading || !sessionNextCursor}>
                Page suivante
              </button>
            </div>
          </div>

          {selectedSession && !isTeacher && (
            <SessionDetails session={selectedSession} />
          )}

        </div>
      )}

      {activeTab === 'requests' && (
        <div className="space-y-4">
          <h2 className="font-bold text-slate-900">Demandes et décisions de régularisation</h2>
          {regularizations.length === 0 ? (
            <EmptyState>Aucune demande de régularisation.</EmptyState>
          ) : regularizations.map((entry) => (
            <article key={entry.request.id} className="rounded-2xl border border-slate-200 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-bold text-slate-900">
                    {regularizationTypeLabel(entry.request.requestType)} · {entry.request.teacherNameSnapshot} · Demande #{entry.request.id}
                  </p>
                  {entry.request.requestType === 'incomplete_session' ? (
                    <p className="mt-1 text-sm text-slate-600">
                      Séance #{entry.request.sessionId} · fin proposée {formatLomeDate(entry.request.proposedEndedAt)}
                    </p>
                  ) : (
                    <div className="mt-1 space-y-1 text-sm text-slate-600">
                      <p>{entry.request.schoolNameSnapshot} · {entry.request.classNameSnapshot} · {entry.request.subjectNameSnapshot}</p>
                      {entry.request.requestType === 'immediate_report' ? (
                        <p>Heure de signalement serveur et début de référence : {formatLomeDate(entry.request.referenceStartedAt)}</p>
                      ) : (
                        <p>Début déclaré : {formatLomeDate(entry.request.declaredStartedAt)}</p>
                      )}
                      <p>Fin déclarée : {formatLomeDate(entry.request.proposedEndedAt)} · Soumise le {formatLomeDate(entry.request.createdAt)}</p>
                      {entry.request.incidentType && <p>Origine : {incidentTypeLabel(entry.request.incidentType)}</p>}
                      {(entry.request.gpsLatitude != null || entry.request.gpsLongitude != null) && (
                        <p className="text-xs text-amber-800">
                          Position fournie lors de la tentative, non vérifiée par le contrôle GPS : {entry.request.gpsLatitude ?? '—'}, {entry.request.gpsLongitude ?? '—'} · précision déclarée {entry.request.gpsAccuracyMeters ?? '—'} m.
                        </p>
                      )}
                    </div>
                  )}
                  <p className="mt-2 text-sm text-slate-700">{entry.request.reason}</p>
                  {entry.request.description && <p className="mt-1 whitespace-pre-wrap text-sm text-slate-600">{entry.request.description}</p>}
                </div>
                <StatusBadge status={entry.request.status} />
              </div>
              {entry.decisions?.map((decision) => (
                <div key={decision.id} className="mt-4 rounded-xl bg-slate-50 p-3 text-sm">
                  <p className="font-semibold text-slate-800">{requestStatusLabel(decision.decision)} — {decision.actorNameSnapshot}</p>
                  <p className="mt-1 text-slate-600">
                    {decision.decidedStartedAt ? `Début retenu : ${formatLomeDate(decision.decidedStartedAt)} · ` : ''}
                    {decision.decidedEndedAt ? `Fin validée : ${formatLomeDate(decision.decidedEndedAt)} · ` : ''}
                    {decision.reason || 'Aucun motif saisi'} · {formatLomeDate(decision.createdAt)}
                  </p>
                </div>
              ))}
              {isTeacher && entry.request.requestType === 'immediate_report'
                && entry.request.status === 'pending' && entry.request.proposedEndedAt == null && (
                  <div className="mt-4 grid gap-3 rounded-xl border border-amber-200 bg-amber-50/50 p-3 sm:grid-cols-2">
                    <p className="text-sm text-slate-700 sm:col-span-2">Après le cours, complétez le signalement avec l’heure de fin déclarée. Cette heure restera une déclaration à examiner, sans validation GPS fictive.</p>
                    <label className="text-xs font-semibold text-slate-700">
                      Heure de fin déclarée · heure de Lomé
                      <input
                        type="datetime-local"
                        className={`${inputClass} mt-1`}
                        aria-label={`Heure de fin déclarée demande ${entry.request.id}`}
                        min={entry.request.referenceStartedAt ? formatLomeInput(new Date(entry.request.referenceStartedAt)) : undefined}
                        max={formatLomeInput()}
                        value={requestEndTimes[entry.request.id] ?? ''}
                        onChange={(event) => setRequestEndTimes((current) => ({ ...current, [entry.request.id]: event.target.value }))}
                      />
                    </label>
                    <label className="text-xs font-semibold text-slate-700">
                      Précision facultative
                      <textarea
                        className={`${inputClass} mt-1 min-h-16`}
                        value={unrecordedCompletionDescription[entry.request.id] ?? ''}
                        maxLength={2000}
                        onChange={(event) => setUnrecordedCompletionDescription((current) => ({ ...current, [entry.request.id]: event.target.value }))}
                      />
                    </label>
                    <button className={buttonClass} type="button" disabled={busyAction != null} onClick={() => void completeImmediateRegularization(entry.request)}>
                      {busyAction === `complete-report-${entry.request.id}` && <RefreshCw className="h-4 w-4 animate-spin" />}
                      Ajouter l’heure de fin déclarée
                    </button>
                  </div>
                )}
              {(isSchoolAdmin || isSuperAdmin) && entry.request.status === 'pending' && (
                <div className="mt-4 grid gap-3 rounded-xl border border-indigo-100 bg-indigo-50/50 p-3">
                  {entry.request.requestType !== 'incomplete_session' && (
                    <label className="text-xs font-semibold text-slate-700">
                      Heure de début retenue · heure de Lomé
                      <input
                        type="datetime-local"
                        className={`${inputClass} mt-1`}
                        value={regularizationStartTimes[entry.request.id]
                          ?? formatLomeInput(new Date(entry.request.referenceStartedAt ?? entry.request.declaredStartedAt ?? entry.request.createdAt))}
                        max={formatLomeInput()}
                        onChange={(event) => setRegularizationStartTimes((current) => ({ ...current, [entry.request.id]: event.target.value }))}
                      />
                    </label>
                  )}
                  <label className="text-xs font-semibold text-slate-700">
                    Heure de fin modifiée (facultative sauf acceptation après modification)
                    <input
                      type="datetime-local"
                      className={`${inputClass} mt-1`}
                      value={regularizationEndTimes[entry.request.id] ?? (entry.request.proposedEndedAt ? formatLomeInput(new Date(entry.request.proposedEndedAt)) : '')}
                      min={formatLomeInput(new Date(entry.request.requestType === 'incomplete_session'
                        ? sessions.find((session) => session.id === entry.request.sessionId)?.startedAt ?? entry.request.createdAt
                        : entry.request.referenceStartedAt ?? entry.request.declaredStartedAt ?? entry.request.createdAt))}
                      max={formatLomeInput()}
                      onChange={(event) => setRegularizationEndTimes((current) => ({ ...current, [entry.request.id]: event.target.value }))}
                    />
                  </label>
                  <label className="text-xs font-semibold text-slate-700">
                    Motif (obligatoire pour refus ou modification)
                    <textarea
                      className={`${inputClass} mt-1 min-h-20`}
                      value={regularizationReasons[entry.request.id] ?? ''}
                      onChange={(event) => setRegularizationReasons({ ...regularizationReasons, [entry.request.id]: event.target.value })}
                    />
                  </label>
                  <div className="flex flex-wrap gap-2">
                    <button className={buttonClass} type="button" disabled={busyAction != null} onClick={() => void decideRegularization(entry.request, 'accepted')}>
                      <Check className="h-4 w-4" /> {entry.request.requestType === 'incomplete_session' ? 'Accepter l’heure proposée' : 'Confirmer les heures proposées'}
                    </button>
                    <button className={secondaryButtonClass} type="button" disabled={busyAction != null} onClick={() => void decideRegularization(entry.request, 'modified_accepted')}>
                      <CalendarClock className="h-4 w-4" /> Modifier et accepter
                    </button>
                    <button className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-rose-200 bg-white px-4 py-2 text-sm font-semibold text-rose-700 disabled:opacity-50" type="button" disabled={busyAction != null} onClick={() => void decideRegularization(entry.request, 'rejected')}>
                      <X className="h-4 w-4" /> Refuser
                    </button>
                  </div>
                </div>
              )}
            </article>
          ))}
        </div>
      )}

      {activeTab === 'gps' && !isTeacher && (
        <div className="space-y-6">
          <div className="flex items-start gap-3">
            <div className="rounded-xl bg-indigo-50 p-2 text-indigo-600"><Settings2 className="h-5 w-5" /></div>
            <div>
              <h2 className="font-bold text-slate-900">Paramètres de contrôle GPS</h2>
              <p className="mt-1 text-sm text-slate-600">Le rayon est indépendant de la précision maximale acceptée (100 m). Aucun rayon n’est augmenté automatiquement.</p>
            </div>
          </div>
          {gpsSettings && (
            <form className="grid gap-4 rounded-2xl border border-slate-200 p-4 sm:grid-cols-2" onSubmit={(event) => void saveGpsSettings(event)}>
              <label className="flex items-center gap-3 rounded-xl bg-slate-50 p-3 text-sm font-semibold text-slate-800 sm:col-span-2">
                <input type="checkbox" checked={gpsForm.isEnabled} onChange={(event) => setGpsForm({ ...gpsForm, isEnabled: event.target.checked })} disabled={!canManage} />
                Contrôle GPS activé
              </label>
              <label className="flex min-w-0 flex-col text-sm font-semibold text-slate-700">Latitude de l’établissement
                <input className={`${inputClass} mt-1`} type="number" step="any" min="-90" max="90" value={gpsForm.latitude} onChange={(event) => setGpsForm({ ...gpsForm, latitude: event.target.value })} disabled={!canManage} />
              </label>
              <label className="flex min-w-0 flex-col text-sm font-semibold text-slate-700">Longitude de l’établissement
                <input className={`${inputClass} mt-1`} type="number" step="any" min="-180" max="180" value={gpsForm.longitude} onChange={(event) => setGpsForm({ ...gpsForm, longitude: event.target.value })} disabled={!canManage} />
              </label>
              {canManageGps && (
                <div className="space-y-2 sm:col-span-2">
                  <button className={secondaryButtonClass} type="button" onClick={getSchoolLocation} disabled={gpsLocationLoading || busyAction != null}>
                    {gpsLocationLoading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <MapPin className="h-4 w-4" />}
                    {gpsLocationLoading ? 'Récupération de la position…' : 'Obtenir ma position automatiquement'}
                  </button>
                  {gpsLocationMessage && (
                    <p role="status" aria-live="polite" className="text-sm text-slate-600">{gpsLocationMessage}</p>
                  )}
                  <p className="text-xs text-slate-500">Effectuez cette action depuis l’établissement, puis vérifiez ou corrigez les coordonnées avant de les enregistrer.</p>
                </div>
              )}
              <label className="text-sm font-semibold text-slate-700 sm:col-span-2">Rayon de présence (mètres)
                <input className={`${inputClass} mt-1 max-w-xs`} type="number" step="1" min="1" value={gpsForm.geofenceRadiusMeters} onChange={(event) => setGpsForm({ ...gpsForm, geofenceRadiusMeters: event.target.value })} disabled={!canManage} />
                <span className="mt-1 block text-xs font-normal text-slate-500">Valeur initiale prévue : 200 m. Précision GPS maximale : 100 m.</span>
              </label>
              {canManageGps && (
                <div className="sm:col-span-2">
                  <button className={buttonClass} type="submit" disabled={busyAction != null}>
                    {busyAction === 'gps-settings' ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                    Enregistrer la configuration
                  </button>
                </div>
              )}
              {isSuperAdmin && <p className="text-xs text-slate-500 sm:col-span-2">Toute modification autorisée est auditée côté serveur.</p>}
            </form>
          )}

          <div className="space-y-3">
            <h3 className="font-bold text-slate-900">Historique des modifications GPS</h3>
            {gpsHistory.length === 0 ? <EmptyState>Aucune modification de configuration GPS n’a été journalisée.</EmptyState> : (
              <div className="divide-y divide-slate-100 rounded-2xl border border-slate-200">
                {gpsHistory.map((event) => (
                  <article key={String(event.id)} className="grid gap-2 p-4 text-sm sm:grid-cols-[1fr_auto]">
                    <div>
                      <p className="font-semibold text-slate-900">{String(event.actorNameSnapshot ?? 'Utilisateur')} · {String(event.action ?? 'Modification GPS')}</p>
                      <p className="mt-1 text-xs text-slate-500">{formatLomeDate(String(event.createdAt ?? ''))} · {String(event.reason ?? 'Modification des paramètres GPS')}</p>
                      {event.beforeValues != null && event.afterValues != null && (
                        <p className="mt-2 break-words text-xs text-slate-600">
                          Avant : {JSON.stringify(event.beforeValues)} · Après : {JSON.stringify(event.afterValues)}
                        </p>
                      )}
                    </div>
                    <span className="h-fit rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">Audité</span>
                  </article>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'rates' && !isTeacher && (
        <div className="space-y-5">
          <div>
            <h2 className="font-bold text-slate-900">Taux horaires des enseignants</h2>
            <p className="mt-1 text-sm text-slate-600">Le taux est enregistré par enseignant et établissement. Chaque séance conserve son taux instantané au démarrage.</p>
          </div>
          <label className="block max-w-xl text-sm font-semibold text-slate-700">
            Enseignant
            <select className={`${inputClass} mt-1`} aria-label="Enseignant pour le taux" value={selectedTeacherId} onChange={(event) => setSelectedTeacherId(event.target.value)}>
              {visibleTeachers.length === 0 && <option value="">Aucun enseignant disponible</option>}
              {visibleTeachers.map((teacher) => <option key={teacher.id} value={teacher.id}>{teacher.name || teacher.email}</option>)}
            </select>
          </label>
          {selectedTeacherId && rateLoaded && canManage && (
            <form className="max-w-xl space-y-4 rounded-2xl border border-slate-200 p-4" onSubmit={(event) => void saveRate(event)}>
              <label className="block text-sm font-semibold text-slate-700">
                Taux horaire en XOF
                <input className={`${inputClass} mt-1`} type="number" step="1" min="0" value={hourlyRate} onChange={(event) => setHourlyRate(event.target.value)} placeholder="Laisser vide pour supprimer le taux" />
              </label>
              <button type="submit" className={buttonClass} disabled={busyAction != null}>
                {busyAction === 'hourly-rate' ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                Enregistrer le taux
              </button>
            </form>
          )}
          {selectedTeacherId && rateLoaded && isSuperAdmin && (
            <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-700">
              Taux enregistré : {hourlyRate === '' ? 'aucun taux' : formatAmount(Number(hourlyRate))}. Le Super Administrateur dispose ici d’un accès consultatif.
            </p>
          )}
          {visibleTeachers.length === 0 && <EmptyState>Aucun enseignant actif connu dans la liste de l’application pour cet établissement.</EmptyState>}
        </div>
      )}
    </section>
  );
}

function ModuleHeading({
  role,
  schoolName,
  onRefresh,
  loading,
}: {
  role: UserRole;
  schoolName?: string;
  onRefresh?: () => void;
  loading?: boolean;
}) {
  const roleTitle = role === 'teacher' ? 'Espace enseignant'
    : role === 'school_admin' ? 'Administration de l’établissement'
      : 'Super Administrateur · consultation par établissement';
  return (
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-indigo-600">EcoleTrack · Suivi des séances</p>
        <h1 id="teacher-control-title" className="mt-1 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">Contrôle des enseignants</h1>
        <p className="mt-1 text-sm text-slate-600">{roleTitle}{schoolName ? ` · ${schoolName}` : ''}</p>
      </div>
      {onRefresh && (
        <button type="button" className={secondaryButtonClass} onClick={onRefresh} disabled={loading}>
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Actualiser
        </button>
      )}
    </header>
  );
}

function SessionFilterControls({
  filters,
  setFilters,
  options,
  optionsLoading,
  resultsLoading,
  optionsError,
  isSuperAdmin,
  showAdministrativeFilters,
  schoolsList,
  selectedSchoolId,
  onSchoolChange,
}: {
  filters: SessionFilters;
  setFilters: Dispatch<SetStateAction<SessionFilters>>;
  options: SessionFilterOptions | null;
  optionsLoading: boolean;
  resultsLoading: boolean;
  optionsError: string | null;
  isSuperAdmin: boolean;
  showAdministrativeFilters: boolean;
  schoolsList: School[];
  selectedSchoolId: number | null;
  onSchoolChange: (schoolId: number | null) => void;
}) {
  const update = (key: keyof SessionFilters, value: string) => {
    setFilters((current) => ({ ...current, [key]: value }));
  };
  const selectPeriod = (period: SessionFilters['period']) => {
    setFilters((current) => ({
      ...current,
      period,
      ...(period === 'custom' ? {} : { from: '', to: '' }),
    }));
  };

  return (
    <div className="grid w-full gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {isSuperAdmin && (
        <label className="text-xs font-semibold text-slate-600">
          Établissement
          <select
            className={`${inputClass} mt-1`}
            aria-label="Établissement"
            value={selectedSchoolId ?? ''}
            disabled={resultsLoading}
            onChange={(event) => onSchoolChange(event.target.value ? Number(event.target.value) : null)}
          >
            <option value="">Tous les établissements</option>
            {schoolsList.map((school) => <option key={school.id} value={school.id}>{school.name}</option>)}
          </select>
        </label>
      )}
      <label className="text-xs font-semibold text-slate-600">
        Période
        <select className={`${inputClass} mt-1`} value={filters.period} onChange={(event) => selectPeriod(event.target.value as SessionFilters['period'])} disabled={resultsLoading}>
          <option value="all">Toute période</option>
          <option value="day">Aujourd’hui</option>
          <option value="week">Cette semaine</option>
          <option value="month">Ce mois</option>
          <option value="year">Cette année</option>
          <option value="custom">Personnalisée</option>
        </select>
      </label>
      {showAdministrativeFilters && (
        <>
          <label className="text-xs font-semibold text-slate-600">
            Enseignant
            <select className={`${inputClass} mt-1`} aria-label="Enseignant" value={filters.teacherId} onChange={(event) => update('teacherId', event.target.value)} disabled={optionsLoading || resultsLoading}>
              <option value="">Tous</option>
              {options?.teachers.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
              {!optionsLoading && options?.teachers.length === 0 && <option value="" disabled>Aucun enseignant disponible</option>}
            </select>
          </label>
          <label className="text-xs font-semibold text-slate-600">
            Classe
            <select className={`${inputClass} mt-1`} aria-label="Classe" value={filters.classId} onChange={(event) => update('classId', event.target.value)} disabled={optionsLoading || resultsLoading}>
              <option value="">Toutes</option>
              {options?.classes.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
              {!optionsLoading && options?.classes.length === 0 && <option value="" disabled>Aucune classe disponible</option>}
            </select>
          </label>
          <label className="text-xs font-semibold text-slate-600">
            Matière
            <select className={`${inputClass} mt-1`} aria-label="Matière" value={filters.subjectId} onChange={(event) => update('subjectId', event.target.value)} disabled={optionsLoading || resultsLoading}>
              <option value="">Toutes</option>
              {options?.subjects.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
              {!optionsLoading && options?.subjects.length === 0 && <option value="" disabled>Aucune matière disponible</option>}
            </select>
          </label>
        </>
      )}
      <label className="text-xs font-semibold text-slate-600">
        Statut de séance
        <select className={`${inputClass} mt-1`} value={filters.status} onChange={(event) => update('status', event.target.value)} disabled={resultsLoading}>
          <option value="">Tous</option>
          <option value="open">En cours</option>
          <option value="completed">Terminée</option>
          <option value="closed_without_end">Clôturée sans fin validée</option>
        </select>
      </label>
      <label className="text-xs font-semibold text-slate-600">
        Régularisation
        <select className={`${inputClass} mt-1`} value={filters.regularizationState} onChange={(event) => update('regularizationState', event.target.value)} disabled={resultsLoading}>
          <option value="">Toutes</option>
          <option value="pending">En attente</option>
          <option value="resolved">Résolue</option>
          <option value="none">Aucune demande</option>
        </select>
      </label>
      {filters.period === 'custom' && (
        <>
          <label className="text-xs font-semibold text-slate-600">
            Du
            <input className={`${inputClass} mt-1`} type="date" value={filters.from} onChange={(event) => update('from', event.target.value)} disabled={resultsLoading} />
          </label>
          <label className="text-xs font-semibold text-slate-600">
            Au
            <input className={`${inputClass} mt-1`} type="date" value={filters.to} onChange={(event) => update('to', event.target.value)} disabled={resultsLoading} />
          </label>
        </>
      )}
      {optionsLoading && <p role="status" className="text-xs font-normal text-slate-500 sm:col-span-2 xl:col-span-4">Chargement des enseignants, classes et matières…</p>}
      {!optionsLoading && optionsError && <p role="alert" className="text-xs font-normal text-rose-700 sm:col-span-2 xl:col-span-4">{optionsError}</p>}
      {!optionsLoading && !optionsError && options
        && options.teachers.length === 0 && options.classes.length === 0 && options.subjects.length === 0 && (
          <p role="status" className="text-xs font-normal text-slate-500 sm:col-span-2 xl:col-span-4">Aucune option disponible : aucune séance ne correspond au périmètre sélectionné.</p>
        )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const isPending = status === 'pending';
  const isRejected = status === 'rejected';
  return (
    <span className={`inline-flex h-fit rounded-full px-3 py-1 text-xs font-bold ${
      isPending ? 'bg-amber-100 text-amber-800'
        : isRejected ? 'bg-rose-100 text-rose-700'
          : 'bg-emerald-100 text-emerald-700'
    }`}>
      {requestStatusLabel(status)}
    </span>
  );
}

function SessionCard({
  session,
  isTeacher,
  isSchoolAdmin,
  isSuperAdmin,
  busyAction,
  selected,
  onSelect,
  onClose,
  closeReason,
  onCloseReasonChange,
  hasPendingRequest,
}: {
  session: Session;
  isTeacher: boolean;
  isSchoolAdmin: boolean;
  isSuperAdmin: boolean;
  busyAction: string | null;
  selected: boolean;
  onSelect: () => void;
  onClose: (reason: string) => void;
  closeReason: string;
  onCloseReasonChange: (reason: string) => void;
  hasPendingRequest: boolean;
}) {
  return (
    <article className="p-4 sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <button type="button" onClick={onSelect} className="min-w-0 text-left">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-bold text-slate-900">{session.classNameSnapshot} · {session.subjectNameSnapshot}</h3>
            <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${
              session.status === 'open' ? 'bg-sky-100 text-sky-800'
                : session.status === 'completed' ? 'bg-emerald-100 text-emerald-800'
                  : 'bg-slate-200 text-slate-700'
            }`}>{sessionStatusLabel(session.status)}</span>
          </div>
          {!isTeacher && <p className="mt-1 text-sm text-slate-600">{session.teacherNameSnapshot} · {session.schoolNameSnapshot}</p>}
          <p className="mt-1 text-sm text-slate-500">Début : {formatLomeDate(session.startedAt)} · Fin validée : {formatLomeDate(session.validatedEndedAt)}</p>
        </button>
        {!isTeacher && <span className="text-sm font-semibold text-slate-800">{formatAmount(session.estimatedAmountXof)}</span>}
      </div>

      <div className="mt-3 grid gap-2 text-xs text-slate-600 sm:grid-cols-2 xl:grid-cols-4">
        <p>{session.startSource === 'regularization'
          ? `Début retenu administrativement · ${session.regularizationOrigin ? regularizationTypeLabel(session.regularizationOrigin) : 'régularisation'}`
          : `GPS départ : ${session.startDistanceMeters ?? '—'} m · précision ${session.startAccuracyMeters ?? '—'} m / rayon ${session.startGeofenceRadiusMeters ?? '—'} m`}
        </p>
        <p>Durée : {formatDuration(session.durationMilliseconds)}</p>
        <p>Taux instantané : {formatAmount(session.hourlyRateXofSnapshot)}</p>
        <p>Fin : {session.endSource === 'gps' ? 'contrôle GPS validé' : session.endSource === 'regularization' ? 'régularisation validée' : session.status === 'closed_without_end' ? 'sans heure réelle' : '—'}</p>
      </div>
      {session.status === 'closed_without_end' && session.closeReason && (
        <p className="mt-2 rounded-lg bg-slate-50 p-2 text-xs text-slate-600">Motif de clôture : {session.closeReason}</p>
      )}
      {selected && (
        <div className="mt-4 rounded-xl border border-indigo-100 bg-indigo-50/50 p-3 text-sm text-slate-700">
          <p className="font-semibold text-slate-900">Détails de la séance #{session.id}</p>
          <p className="mt-1">Matière : {session.subjectNameSnapshot} · Affectation archivée : #{session.classId}/{session.subjectId}</p>
          {session.regularizationRequestId != null && <p className="mt-1">Demande de régularisation source : #{session.regularizationRequestId}</p>}
          <p className="mt-1">Contrôle de fin : {session.endDistanceMeters == null ? 'Aucune fin GPS enregistrée' : `${session.endDistanceMeters} m · précision ${session.endAccuracyMeters} m / rayon ${session.endGeofenceRadiusMeters} m`}</p>
          <p className="mt-1">Montant estimé : {formatAmount(session.estimatedAmountXof)}. Une clôture administrative sans heure validée ne produit ni durée ni rémunération.</p>
        </div>
      )}

      {isTeacher && session.status === 'open' && (
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" className={secondaryButtonClass} onClick={onSelect}>
            <CalendarClock className="h-4 w-4" /> Voir le détail
          </button>
          {hasPendingRequest && <span className="self-center text-xs font-semibold text-amber-700">Demande en attente de décision</span>}
        </div>
      )}
      {isSchoolAdmin && session.status === 'open' && !hasPendingRequest && (
        <form className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]" onSubmit={(event) => { event.preventDefault(); onClose(closeReason); }}>
          <label className="text-xs font-semibold text-slate-700">
            Motif obligatoire de clôture administrative
            <input className={`${inputClass} mt-1`} value={closeReason} onChange={(event) => onCloseReasonChange(event.target.value)} />
          </label>
          <div className="flex items-end">
            <button type="submit" className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900 hover:bg-amber-100 disabled:opacity-50" disabled={busyAction != null}>
            <X className="h-4 w-4" /> Clôturer sans heure de fin
            </button>
          </div>
        </form>
      )}
      {isSuperAdmin && session.status === 'open' && (
        <p className="mt-3 flex items-center gap-2 text-xs text-slate-500"><ShieldCheck className="h-4 w-4" /> Accès consultatif, aucune modification disponible.</p>
      )}
    </article>
  );
}

function TeacherRegularizationForms({
  sessions,
  regularizations,
  requestEndTimes,
  requestReasons,
  busyAction,
  onEndTimeChange,
  onReasonChange,
  onSubmit,
}: {
  sessions: Session[];
  regularizations: Regularization[];
  requestEndTimes: Record<number, string>;
  requestReasons: Record<number, string>;
  busyAction: string | null;
  onEndTimeChange: (sessionId: number, value: string) => void;
  onReasonChange: (sessionId: number, value: string) => void;
  onSubmit: (session: Session) => void;
}) {
  const openSessionsWithoutPending = sessions.filter((session) => !regularizations.some((entry) => (
    entry.request.sessionId === session.id && entry.request.status === 'pending'
  )));
  if (openSessionsWithoutPending.length === 0) return null;
  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50/60 p-4">
      <h2 className="font-bold text-slate-900">Demander une régularisation</h2>
      <p className="mt-1 text-sm text-slate-600">Une demande exige l’heure de fin proposée et un motif. L’acceptation doit encore être décidée par l’administrateur d’école.</p>
      <div className="mt-4 grid gap-4">
        {openSessionsWithoutPending.map((session) => (
          <form key={session.id} className="grid gap-3 rounded-xl border border-white bg-white p-3 sm:grid-cols-[1fr_1fr_auto]" onSubmit={(event) => { event.preventDefault(); onSubmit(session); }}>
            <div className="text-sm">
              <p className="font-semibold text-slate-900">{session.classNameSnapshot} · {session.subjectNameSnapshot}</p>
              <p className="text-xs text-slate-500">Début : {formatLomeDate(session.startedAt)}</p>
            </div>
            <label className="text-xs font-semibold text-slate-700">
              Fin proposée · heure de Lomé
              <input
                type="datetime-local"
                className={`${inputClass} mt-1`}
                min={formatLomeInput(new Date(session.startedAt))}
                max={formatLomeInput()}
                value={requestEndTimes[session.id] ?? ''}
                onChange={(event) => onEndTimeChange(session.id, event.target.value)}
                required
              />
            </label>
            <div className="flex items-end">
              <button type="submit" className={buttonClass} disabled={busyAction != null}>
                {busyAction === `regularize-${session.id}` ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                Envoyer
              </button>
            </div>
            <label className="text-xs font-semibold text-slate-700 sm:col-span-3">
              Motif obligatoire
              <textarea className={`${inputClass} mt-1 min-h-16`} required value={requestReasons[session.id] ?? ''} onChange={(event) => onReasonChange(session.id, event.target.value)} />
            </label>
          </form>
        ))}
      </div>
    </div>
  );
}

function RegularizationHistory({ requests }: { requests: Regularization[] }) {
  return (
    <section className="space-y-3">
      <h2 className="font-bold text-slate-900">Suivi de mes demandes</h2>
      {requests.map((entry) => (
        <article key={entry.request.id} className="rounded-xl border border-slate-200 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-semibold text-slate-900">
              {regularizationTypeLabel(entry.request.requestType)}
              {entry.request.requestType === 'incomplete_session'
                ? ` · Séance #${entry.request.sessionId}`
                : ` · ${entry.request.classNameSnapshot ?? 'Classe'} · ${entry.request.subjectNameSnapshot ?? 'Matière'}`}
            </p>
            <StatusBadge status={entry.request.status} />
          </div>
          <p className="mt-1 text-xs text-slate-500">
            {entry.request.requestType === 'immediate_report'
              ? `Début de référence fixé au signalement serveur : ${formatLomeDate(entry.request.referenceStartedAt)}`
              : entry.request.requestType === 'late_declaration'
                ? `Début déclaré : ${formatLomeDate(entry.request.declaredStartedAt)}`
                : `Fin proposée : ${formatLomeDate(entry.request.proposedEndedAt)}`}
            {entry.request.proposedEndedAt ? ` · Fin déclarée/proposée : ${formatLomeDate(entry.request.proposedEndedAt)}` : ''}
            {` · Soumise le ${formatLomeDate(entry.request.createdAt)}`}
          </p>
          <p className="mt-2 text-sm text-slate-600">{entry.request.reason}</p>
          {entry.request.description && <p className="mt-1 whitespace-pre-wrap text-sm text-slate-600">{entry.request.description}</p>}
          {entry.decisions.map((decision) => (
            <p key={decision.id} className="mt-2 rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
              {requestStatusLabel(decision.decision)} par {decision.actorNameSnapshot}
              {decision.decidedStartedAt ? ` · Début retenu ${formatLomeDate(decision.decidedStartedAt)}` : ''}
              {decision.decidedEndedAt ? ` · Fin retenue ${formatLomeDate(decision.decidedEndedAt)}` : ''}
              {` · ${decision.reason || 'Sans motif'} · ${formatLomeDate(decision.createdAt)}`}
            </p>
          ))}
        </article>
      ))}
    </section>
  );
}

function SessionDetails({ session }: { session: Session }) {
  return (
    <section className="rounded-2xl border border-indigo-100 bg-indigo-50/50 p-4">
      <h2 className="font-bold text-slate-900">Détails · séance #{session.id}</h2>
      <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
        <Detail label="Enseignant" value={session.teacherNameSnapshot} />
        <Detail label="Classe / matière" value={`${session.classNameSnapshot} · ${session.subjectNameSnapshot}`} />
        <Detail label="Début UTC affiché à Lomé" value={formatLomeDate(session.startedAt)} />
        <Detail label="Fin validée" value={formatLomeDate(session.validatedEndedAt)} />
        <Detail label="Source de fin" value={session.endSource === 'gps' ? 'GPS' : session.endSource === 'regularization' ? 'Régularisation acceptée' : 'Aucune'} />
        <Detail label="Durée validée" value={formatDuration(session.durationMilliseconds)} />
        <Detail label="Rémunération estimée" value={formatAmount(session.estimatedAmountXof)} />
        <Detail label="Contrôle GPS départ" value={`${session.startDistanceMeters} m · précision ${session.startAccuracyMeters} m · rayon ${session.startGeofenceRadiusMeters} m`} />
      </dl>
      <p className="mt-4 flex items-start gap-2 rounded-xl bg-white p-3 text-xs text-slate-600">
        <Clock3 className="mt-0.5 h-4 w-4 shrink-0 text-indigo-600" />
        L’API actuelle ne fournit pas de route d’historique d’audit détaillé par séance. Les décisions de régularisation disponibles sont consultables dans la section correspondante.
      </p>
    </section>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return <div><dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</dt><dd className="mt-1 break-words font-medium text-slate-800">{value}</dd></div>;
}
