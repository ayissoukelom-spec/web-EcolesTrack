import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type FormEvent, type SetStateAction } from 'react';
import {
  AlertTriangle,
  Banknote,
  CalendarClock,
  Check,
  ClipboardCheck,
  Clock3,
  FileSpreadsheet,
  FileText,
  GraduationCap,
  MapPin,
  RefreshCw,
  Settings2,
  ShieldCheck,
  X,
} from 'lucide-react';
import { apiFetch } from '../lib/api.ts';
import {
  calculateDistanceMeters,
  MAX_CONFIGURABLE_GPS_ACCURACY_METERS,
  MAX_GEOFENCE_RADIUS_METERS,
  MAX_GPS_ACCURACY_METERS,
} from '../lib/teacherControl/domain.ts';
import TeacherControlGpsMapPreview from './TeacherControlGpsMapPreview.tsx';
import {
  buildTeacherHoursReport,
  createTeacherHoursExcel,
  createTeacherHoursPdf,
  type TeacherHoursReportIdentity,
} from '../lib/teacherControl/hoursReport.ts';
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
  | 'improving'
  | 'obtained'
  | 'verifying'
  | 'validated'
  | 'imprecise'
  | 'inconsistent'
  | 'outside'
  | 'permissionDenied'
  | 'unavailable'
  | 'timeout'
  | 'cancelled'
  | 'serverError';
type TeacherAction = 'start' | 'end';
type UnrecordedRequestType = 'immediate_report' | 'late_declaration';
type IncidentType = 'gps_unavailable' | 'gps_accuracy' | 'permission_denied' | 'network' | 'application' | 'other';
type TeacherGpsDiagnostic = {
  reason: string;
  accuracyMeters?: number;
  distanceMeters?: number;
  geofenceRadiusMeters?: number;
};

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
    schoolId: number;
    sessionId: number | null;
    linkedSessionStartedAt?: string | null;
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
  maxGpsAccuracyMeters: number;
  updatedAt: string | null;
};

type GpsAcquisitionSample = {
  latitude: number;
  longitude: number;
  accuracyMeters: number;
  timestamp: number;
};

type GpsDebugFix = {
  latitude: string;
  longitude: string;
  accuracyMeters: string;
  timestamp: string;
};

type GpsDebugReading = GpsDebugFix & {
  acquisitionNumber: number;
  readingNumber: number;
  batchNumber: number;
  receivedAt: string;
  ageMilliseconds: string;
  decision: string;
};

type GpsDebugSnapshot = {
  runId: number;
  pathway: 'school-admin' | 'teacher';
  action: string;
  readings: GpsDebugReading[];
  selected: GpsDebugFix | null;
  used: { endpoint: string; fix: GpsDebugFix } | null;
};

type GpsCoordinateCandidate = {
  mapKey: number;
  source: 'automatic' | 'manual' | 'google_maps';
  latitude: string;
  longitude: string;
  confirmed: boolean;
  samples: GpsAcquisitionSample[];
  maxSpreadMeters: number | null;
};

type GpsMapAvailability = 'loading' | 'ready' | 'error';

type ActiveGpsAcquisition = {
  generation: number;
  batchNumber: number;
  samples: GpsAcquisitionSample[];
  watchId: number | null;
  timeoutId: number | null;
};

type BrowserGeolocationPolicy = {
  allowsFeature?: (feature: string) => boolean;
};

const GPS_ADMIN_SAMPLE_COUNT = 3;
const GPS_ADMIN_MAX_SAMPLE_AGE_MS = 10_000;
const GPS_ADMIN_MAX_SPREAD_METERS = 100;
const GPS_ADMIN_BATCH_TIMEOUT_MS = 45_000;
const GPS_ADMIN_MAX_BATCHES = 2;
const TEACHER_GPS_MAX_ACQUISITION_MS = 45_000;
const TEACHER_GPS_MAX_SAMPLE_AGE_MS = 10_000;
const TEACHER_GPS_SAMPLE_COUNT = 3;
const TEACHER_GPS_MAX_SPREAD_METERS = 100;
const TEACHER_GPS_MAX_BATCHES = 2;
const GPS_DIAGNOSTICS_ENABLED = import.meta.env.DEV;

function parseGpsCoordinatePair(latitudeText: string, longitudeText: string) {
  if (!latitudeText.trim() || !longitudeText.trim()) return null;
  const latitude = Number(latitudeText);
  const longitude = Number(longitudeText);
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90
    || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    return null;
  }
  return { latitude, longitude };
}

type ParsedCoordinatePair = {
  latitude: number;
  longitude: number;
};

type GoogleMapsCoordinateParseResult =
  | { coordinates: ParsedCoordinatePair; error: null }
  | { coordinates: null; error: string };

function parseCoordinatePairText(value: string): ParsedCoordinatePair | null {
  const match = value.trim().match(/^([+-]?(?:\d+(?:\.\d*)?|\.\d+))(?:\s*,\s*|\s+)([+-]?(?:\d+(?:\.\d*)?|\.\d+))$/);
  if (!match) return null;
  const latitude = Number(match[1]);
  const longitude = Number(match[2]);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return { latitude, longitude };
}

function validateImportedCoordinates(coordinates: ParsedCoordinatePair): string | null {
  if (coordinates.latitude < -90 || coordinates.latitude > 90
    || coordinates.longitude < -180 || coordinates.longitude > 180) {
    return 'Latitude entre -90 et 90 et longitude entre -180 et 180 sont requises.';
  }
  return null;
}

function parseGoogleMapsCoordinateInput(value: string): GoogleMapsCoordinateParseResult {
  const input = value.trim();
  const formatError = 'Format invalide ou non reconnu. Saisissez latitude, longitude ou un lien Google Maps contenant des coordonnées explicites.';
  if (!input) return { coordinates: null, error: formatError };

  const directCoordinates = parseCoordinatePairText(input);
  if (directCoordinates) {
    const boundsError = validateImportedCoordinates(directCoordinates);
    return boundsError
      ? { coordinates: null, error: boundsError }
      : { coordinates: directCoordinates, error: null };
  }

  if (!/^https?:\/\//i.test(input)) return { coordinates: null, error: formatError };

  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return { coordinates: null, error: formatError };
  }

  const hostname = url.hostname.toLowerCase();
  if (hostname === 'maps.app.goo.gl' || (hostname === 'goo.gl' && /^\/maps(?:\/|$)/i.test(url.pathname))) {
    return {
      coordinates: null,
      error: 'Les liens Google Maps raccourcis ne sont pas résolus automatiquement. Ouvrez le lien, puis copiez les coordonnées exactes depuis Google Maps.',
    };
  }

  const isMapsHost = hostname === 'maps.google.com';
  const isGoogleMapsPath = (hostname === 'google.com' || hostname === 'www.google.com')
    && /^\/maps(?:\/|$)/i.test(url.pathname);
  if (url.protocol !== 'https:' || url.username || url.password
    || (url.port && url.port !== '443')
    || (!isMapsHost && !isGoogleMapsPath)) {
    return { coordinates: null, error: formatError };
  }

  const candidates: ParsedCoordinatePair[] = [];
  const invalidCoordinates: ParsedCoordinatePair[] = [];
  const addCandidate = (coordinates: ParsedCoordinatePair | null) => {
    if (!coordinates) return;
    if (validateImportedCoordinates(coordinates)) invalidCoordinates.push(coordinates);
    else candidates.push(coordinates);
  };

  for (const parameter of ['q', 'query']) {
    for (const parameterValue of url.searchParams.getAll(parameter)) {
      addCandidate(parseCoordinatePairText(parameterValue));
    }
  }

  const atCoordinates = url.pathname.match(/@([+-]?(?:\d+(?:\.\d*)?|\.\d+)),([+-]?(?:\d+(?:\.\d*)?|\.\d+))(?:,[^/]+)?/);
  if (atCoordinates) {
    addCandidate({ latitude: Number(atCoordinates[1]), longitude: Number(atCoordinates[2]) });
  }

  const labeledLatitudeLongitude = url.href.match(/!3d([+-]?(?:\d+(?:\.\d*)?|\.\d+))!4d([+-]?(?:\d+(?:\.\d*)?|\.\d+))/);
  if (labeledLatitudeLongitude) {
    addCandidate({ latitude: Number(labeledLatitudeLongitude[1]), longitude: Number(labeledLatitudeLongitude[2]) });
  }
  const labeledLongitudeLatitude = url.href.match(/!2d([+-]?(?:\d+(?:\.\d*)?|\.\d+))!3d([+-]?(?:\d+(?:\.\d*)?|\.\d+))/);
  if (labeledLongitudeLatitude) {
    addCandidate({ latitude: Number(labeledLongitudeLatitude[2]), longitude: Number(labeledLongitudeLatitude[1]) });
  }

  if (invalidCoordinates.length > 0) {
    return { coordinates: null, error: 'Les coordonnées du lien dépassent les limites géographiques autorisées.' };
  }
  if (candidates.length === 0) return { coordinates: null, error: formatError };
  const firstCandidate = candidates[0];
  if (candidates.some((coordinates) => coordinates.latitude !== firstCandidate.latitude
    || coordinates.longitude !== firstCandidate.longitude)) {
    return { coordinates: null, error: 'Le lien contient plusieurs positions différentes; copiez un lien ou une paire de coordonnées non ambigus.' };
  }
  return { coordinates: firstCandidate, error: null };
}

function normalizeGpsCoordinate(value: string | number | null | undefined): number | null | undefined {
  if (value == null || (typeof value === 'string' && value.trim() === '')) return null;
  const coordinate = Number(value);
  return Number.isFinite(coordinate) ? Number(coordinate.toFixed(6)) : undefined;
}

function gpsCoordinatesMatch(
  firstLatitude: string | number | null | undefined,
  firstLongitude: string | number | null | undefined,
  secondLatitude: string | number | null | undefined,
  secondLongitude: string | number | null | undefined,
): boolean {
  const normalized = [
    normalizeGpsCoordinate(firstLatitude),
    normalizeGpsCoordinate(firstLongitude),
    normalizeGpsCoordinate(secondLatitude),
    normalizeGpsCoordinate(secondLongitude),
  ];
  if (normalized.some((coordinate) => coordinate === undefined)) return false;
  return normalized[0] === normalized[2] && normalized[1] === normalized[3];
}

function maximumGpsSampleSpreadMeters(samples: GpsAcquisitionSample[]): number {
  let maximumDistance = 0;
  for (let firstIndex = 0; firstIndex < samples.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < samples.length; secondIndex += 1) {
      maximumDistance = Math.max(
        maximumDistance,
        calculateDistanceMeters(samples[firstIndex], samples[secondIndex]),
      );
    }
  }
  return Math.ceil(maximumDistance);
}

function clearGpsAcquisitionResources(acquisition: ActiveGpsAcquisition): void {
  if (acquisition.watchId != null) navigator.geolocation?.clearWatch(acquisition.watchId);
  if (acquisition.timeoutId != null) window.clearTimeout(acquisition.timeoutId);
  acquisition.watchId = null;
  acquisition.timeoutId = null;
}

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
  viewMode?: 'full' | 'regularizations';
  activeSchoolId: number | null;
  schoolsList: School[];
  teachersList: Teacher[];
  superAdminSchoolFilterId: number | null;
  onSuperAdminSchoolFilterChange: (schoolId: number | null) => void;
  initialTab?: ViewTab;
  onTabChange?: (tab: ViewTab) => void;
  onPendingRegularizationsCountChange?: (count: number) => void;
  onInitialViewSettled?: () => void;
  currentTeacherId?: number;
  currentTeacherName?: string;
}

type ReportTeacherOption = TeacherHoursReportIdentity;

type ReportSelection = {
  teacherId: string;
  from: string;
  to: string;
};

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
    readonly category: 'permissionDenied' | 'unavailable' | 'timeout' | 'imprecise' | 'inconsistent' | 'cancelled',
    readonly accuracyMeters?: number,
  ) {
    super(message);
  }
}

function requestPosition(
  onReading: (fix: GpsFix) => void,
  maxGpsAccuracyMeters = MAX_GPS_ACCURACY_METERS,
  signal?: AbortSignal,
  onProgress: (message: string) => void = () => undefined,
  onDiagnosticReading?: (reading: GpsDebugReading) => void,
  onDiagnosticSelected?: (sample: GpsAcquisitionSample) => void,
): Promise<GpsFix> {
  const geolocation = navigator.geolocation;
  if (!geolocation?.watchPosition) {
    return Promise.reject(new GeolocationRequestError(
      'La géolocalisation n’est pas disponible sur cet appareil.',
      'unavailable',
    ));
  }
  return new Promise((resolve, reject) => {
    type ActiveRequest = { watchId: number | null; active: boolean };
    let activeRequest: ActiveRequest | null = null;
    let acquisitionTimeoutId: number | null = null;
    let settled = false;
    let batchNumber = 0;
    let sampleRequestSequence = 0;
    let readingSequence = 0;
    let sawInsufficientAccuracy = false;
    let latestAccuracyMeters: number | undefined;
    let samples: GpsAcquisitionSample[] = [];
    const acquisitionStartedAt = Date.now();
    const clearTimer = () => {
      if (acquisitionTimeoutId != null) window.clearTimeout(acquisitionTimeoutId);
      acquisitionTimeoutId = null;
    };
    const stopRequest = (request: ActiveRequest) => {
      if (!request.active) return;
      request.active = false;
      if (request.watchId != null) geolocation.clearWatch(request.watchId);
      request.watchId = null;
      if (activeRequest === request) activeRequest = null;
    };
    const stopActiveRequest = () => {
      if (activeRequest) stopRequest(activeRequest);
    };
    const onAbort = () => {
      finishWithError(new GeolocationRequestError(
        'Acquisition annulée. Vous pouvez réessayer.',
        'cancelled',
      ));
    };
    const cleanup = () => {
      clearTimer();
      stopActiveRequest();
      signal?.removeEventListener('abort', onAbort);
    };
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    };
    const finishWithTimeout = () => {
      const message = sawInsufficientAccuracy
        ? 'Impossible d’obtenir une position suffisamment précise dans le délai. Activez la localisation précise de l’appareil ou du navigateur, puis réessayez.'
        : 'Aucune position GPS fraîche n’a été obtenue dans le délai imparti. Vérifiez la localisation de l’appareil puis réessayez.';
      finish(() => reject(new GeolocationRequestError(
        message,
        sawInsufficientAccuracy ? 'imprecise' : 'timeout',
        latestAccuracyMeters,
      )));
    };

    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener('abort', onAbort, { once: true });
    acquisitionTimeoutId = window.setTimeout(
      finishWithTimeout,
      TEACHER_GPS_MAX_ACQUISITION_MS,
    );

    const requestNextSample = () => {
      if (settled || signal?.aborted) return;
      const timeoutRemaining = TEACHER_GPS_MAX_ACQUISITION_MS - (Date.now() - acquisitionStartedAt);
      if (timeoutRemaining <= 0) {
        finishWithTimeout();
        return;
      }

      const request: ActiveRequest = { watchId: null, active: true };
      activeRequest = request;
      const requestSequence = ++sampleRequestSequence;
      onProgress(batchNumber === 0
        ? `Série 1/${TEACHER_GPS_MAX_BATCHES} · mesure ${samples.length + 1}/${TEACHER_GPS_SAMPLE_COUNT}…`
        : `Nouvelle série · mesure ${samples.length + 1}/${TEACHER_GPS_SAMPLE_COUNT}…`);
      try {
        const watchId = geolocation.watchPosition((position) => {
          if (settled || !request.active || activeRequest !== request || requestSequence !== sampleRequestSequence) return;
          const { latitude, longitude, accuracy: accuracyMeters } = position.coords;
          const timestamp = position.timestamp;
          const ageMilliseconds = Date.now() - timestamp;
          const debugBase = onDiagnosticReading ? {
            acquisitionNumber: requestSequence,
            readingNumber: ++readingSequence,
            batchNumber: batchNumber + 1,
            receivedAt: new Date().toISOString(),
            latitude: String(latitude),
            longitude: String(longitude),
            accuracyMeters: String(accuracyMeters),
            timestamp: String(timestamp),
            ageMilliseconds: String(ageMilliseconds),
          } : null;
          const recordDiagnostic = (decision: string) => {
            if (debugBase) onDiagnosticReading?.({ ...debugBase, decision });
          };
          if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90
            || !Number.isFinite(longitude) || longitude < -180 || longitude > 180
            || !Number.isFinite(accuracyMeters) || accuracyMeters < 0
            || !Number.isFinite(timestamp) || ageMilliseconds < 0 || ageMilliseconds > TEACHER_GPS_MAX_SAMPLE_AGE_MS) {
            recordDiagnostic('Rejeté : coordonnées, précision ou horodatage invalide/périmé.');
            onProgress('Mesure GPS ignorée : coordonnées invalides ou horodatage de plus de 10 secondes.');
            return;
          }

          latestAccuracyMeters = accuracyMeters;
          const fix = { latitude, longitude, accuracyMeters };
          onReading(fix);
          if (accuracyMeters > maxGpsAccuracyMeters) {
            recordDiagnostic(`Rejeté : précision supérieure au seuil configuré de ${maxGpsAccuracyMeters} m.`);
            sawInsufficientAccuracy = true;
            onProgress(`Précision reçue ${Math.ceil(accuracyMeters)} m; seuil configuré ${maxGpsAccuracyMeters} m. Recherche d’une mesure admissible…`);
            return;
          }

          stopRequest(request);
          samples.push({ ...fix, timestamp });
          recordDiagnostic(`Admissible dans la série ${batchNumber + 1}; cohérence à vérifier.`);
          onProgress(`Mesure ${samples.length}/${TEACHER_GPS_SAMPLE_COUNT} reçue · précision ${Math.ceil(accuracyMeters)} m.`);
          if (samples.length < TEACHER_GPS_SAMPLE_COUNT) {
            void Promise.resolve().then(requestNextSample);
            return;
          }

          const now = Date.now();
          if (samples.some((sample) => {
            const sampleAgeMilliseconds = now - sample.timestamp;
            return sampleAgeMilliseconds < 0 || sampleAgeMilliseconds > TEACHER_GPS_MAX_SAMPLE_AGE_MS;
          })) {
            finishWithError(new GeolocationRequestError(
              'Une mesure GPS a dépassé la limite de fraîcheur de 10 secondes. Aucune position n’a été retenue; réessayez.',
              'timeout',
              latestAccuracyMeters,
            ));
            return;
          }

          const maxSpreadMeters = maximumGpsSampleSpreadMeters(samples);
          if (maxSpreadMeters > TEACHER_GPS_MAX_SPREAD_METERS) {
            if (batchNumber + 1 < TEACHER_GPS_MAX_BATCHES) {
              batchNumber += 1;
              samples = [];
              onProgress(`Mesures contradictoires : écart ${maxSpreadMeters} m (maximum ${TEACHER_GPS_MAX_SPREAD_METERS} m). Nouvelle tentative courte…`);
              void Promise.resolve().then(requestNextSample);
              return;
            }
            finishWithError(new GeolocationRequestError(
              `Les mesures GPS restent contradictoires après une nouvelle tentative (écart ${maxSpreadMeters} m, maximum ${TEACHER_GPS_MAX_SPREAD_METERS} m). Aucune position n’a été retenue.`,
              'inconsistent',
              latestAccuracyMeters,
            ));
            return;
          }

          const bestSample = samples.reduce((best, sample) => (
            sample.accuracyMeters < best.accuracyMeters ? sample : best
          ));
          onDiagnosticSelected?.(bestSample);
          onProgress(`Trois mesures cohérentes (écart maximal ${maxSpreadMeters} m). Vérification du périmètre par le serveur…`);
          finish(() => resolve({
            latitude: bestSample.latitude,
            longitude: bestSample.longitude,
            accuracyMeters: bestSample.accuracyMeters,
          }));
        }, (error) => {
          if (settled || !request.active || activeRequest !== request || requestSequence !== sampleRequestSequence) return;
          const failure = error.code === error.PERMISSION_DENIED
            ? new GeolocationRequestError(
              'Autorisez la géolocalisation dans votre navigateur pour continuer.',
              'permissionDenied',
              latestAccuracyMeters,
            )
            : error.code === error.POSITION_UNAVAILABLE
              ? new GeolocationRequestError(
                'Position GPS indisponible. Vérifiez que la localisation de l’appareil est activée.',
                'unavailable',
                latestAccuracyMeters,
              )
              : new GeolocationRequestError(
                'La position GPS n’a pas été obtenue à temps. Activez la localisation précise de l’appareil ou du navigateur, puis réessayez.',
                'timeout',
                latestAccuracyMeters,
              );
          finishWithError(failure);
        }, {
          enableHighAccuracy: true,
          maximumAge: 0,
          timeout: timeoutRemaining,
        });
        request.watchId = watchId;
        if (settled || !request.active) {
          geolocation.clearWatch(watchId);
          request.watchId = null;
        }
      } catch (error) {
        finishWithError(new GeolocationRequestError(
          error instanceof Error
            ? `Impossible de démarrer l’acquisition GPS : ${error.message}`
            : 'Impossible de démarrer l’acquisition GPS. Réessayez.',
          'unavailable',
          latestAccuracyMeters,
        ));
      }
    };

    requestNextSample();

    function finishWithError(error: GeolocationRequestError) {
      finish(() => reject(error));
    }
  });
}

async function getTeacherGpsAccuracyThreshold(signal?: AbortSignal): Promise<number> {
  const settings = await apiFetch('/api/teacher-control/gps-settings', signal ? { signal } : undefined) as {
    maxGpsAccuracyMeters?: number;
  };
  const maxGpsAccuracyMeters = settings.maxGpsAccuracyMeters ?? MAX_GPS_ACCURACY_METERS;
  if (!Number.isSafeInteger(maxGpsAccuracyMeters)
    || maxGpsAccuracyMeters < 1
    || maxGpsAccuracyMeters > MAX_CONFIGURABLE_GPS_ACCURACY_METERS) {
    throw new Error('La configuration de précision GPS de l’établissement est invalide.');
  }
  return maxGpsAccuracyMeters;
}

function getTeacherGpsDiagnostic(error: unknown): TeacherGpsDiagnostic | null {
  if (!(error instanceof Error)) return null;
  const diagnostic = (error as Error & { gpsDiagnostic?: unknown }).gpsDiagnostic;
  if (diagnostic == null || typeof diagnostic !== 'object' || Array.isArray(diagnostic)) return null;
  const fields = diagnostic as Record<string, unknown>;
  if (typeof fields.reason !== 'string') return null;
  return {
    reason: fields.reason,
    ...(typeof fields.accuracyMeters === 'number' && Number.isFinite(fields.accuracyMeters)
      ? { accuracyMeters: fields.accuracyMeters }
      : {}),
    ...(typeof fields.distanceMeters === 'number' && Number.isFinite(fields.distanceMeters)
      ? { distanceMeters: fields.distanceMeters }
      : {}),
    ...(typeof fields.geofenceRadiusMeters === 'number' && Number.isFinite(fields.geofenceRadiusMeters)
      ? { geofenceRadiusMeters: fields.geofenceRadiusMeters }
      : {}),
  };
}

function gpsFailureMessage(error: unknown): {
  message: string;
  status: GpsStatus;
  diagnostic: TeacherGpsDiagnostic | null;
} {
  if (!(error instanceof Error)) {
    return { message: 'La vérification GPS a échoué. Réessayez.', status: 'serverError', diagnostic: null };
  }
  const diagnostic = getTeacherGpsDiagnostic(error)
    ?? (error instanceof GeolocationRequestError && error.accuracyMeters != null
      ? { reason: error.category, accuracyMeters: Math.ceil(error.accuracyMeters) }
      : null);
  if (error instanceof GeolocationRequestError) {
    return { message: error.message, status: error.category, diagnostic };
  }
  const reason = error.message.match(/^GPS validation failed: (.+)$/)?.[1];
  if (reason === 'outside_geofence') {
    return { message: 'Position refusée : vous êtes hors du périmètre autorisé de l’école.', status: 'outside', diagnostic };
  }
  if (reason === 'accuracy_too_low' || reason === 'invalid_accuracy') {
    return { message: 'La précision GPS est insuffisante. Activez la localisation précise de l’appareil ou du navigateur, puis réessayez.', status: 'imprecise', diagnostic };
  }
  if (reason === 'invalid_position') {
    return { message: 'La position obtenue est invalide. Vérifiez les réglages de localisation puis réessayez.', status: 'unavailable', diagnostic };
  }
  if (reason === 'invalid_geofence') {
    return { message: 'Le périmètre GPS de l’école n’est pas correctement configuré.', status: 'serverError', diagnostic };
  }
  if (error.message.includes('GPS challenge is invalid, expired or already used')) {
    return { message: 'La validation GPS a expiré ou a déjà été utilisée. Obtenez une nouvelle position.', status: 'serverError', diagnostic };
  }
  return { message: error.message, status: 'serverError', diagnostic };
}

function gpsStatusLabel(status: GpsStatus, reading: GpsFix | null, detail = ''): string {
  if (status === 'locating') return detail || 'Recherche de votre position GPS…';
  if (status === 'improving') return detail || 'Amélioration de la précision GPS…';
  if (status === 'obtained') return `Position obtenue · précision ${Math.ceil(reading?.accuracyMeters ?? 0)} m`;
  if (status === 'verifying') return 'Position obtenue · validation par le serveur…';
  if (status === 'validated') return 'Position validée par le serveur';
  if (status === 'imprecise') return `Position trop imprécise${reading ? ` (${Math.ceil(reading.accuracyMeters)} m)` : ''}. Nouvelle tentative possible.`;
  if (status === 'inconsistent') return 'Mesures GPS contradictoires. Aucune position n’a été retenue.';
  if (status === 'outside') return 'Position hors du périmètre autorisé.';
  if (status === 'permissionDenied') return 'Permission de localisation refusée';
  if (status === 'unavailable') return 'GPS indisponible';
  if (status === 'timeout') return 'Délai de localisation dépassé';
  if (status === 'cancelled') return 'Recherche GPS annulée. Vous pouvez réessayer.';
  if (status === 'serverError') return 'Erreur de validation ou du serveur';
  return 'En attente de votre position';
}

function teacherGpsDiagnosticLabel(
  diagnostic: TeacherGpsDiagnostic,
  fix: GpsFix | null,
): string {
  const reason = diagnostic.reason === 'outside_geofence'
    ? 'hors du périmètre autorisé'
    : diagnostic.reason === 'accuracy_too_low' || diagnostic.reason === 'imprecise'
      ? 'précision supérieure au seuil configuré'
      : diagnostic.reason === 'inconsistent'
        ? 'mesures contradictoires'
        : diagnostic.reason === 'invalid_position'
          ? 'coordonnées invalides'
          : diagnostic.reason === 'invalid_accuracy'
            ? 'précision GPS invalide'
            : diagnostic.reason;
  const accuracyMeters = diagnostic.accuracyMeters
    ?? (fix ? Math.ceil(fix.accuracyMeters) : null);
  const accuracy = accuracyMeters == null ? 'Précision reçue indisponible' : `Précision reçue : ${accuracyMeters} m`;
  const distance = diagnostic.distanceMeters == null
    ? 'Distance approximative à l’établissement indisponible (la mesure n’a pas été transmise au serveur).'
    : `Distance approximative à l’établissement : ${diagnostic.distanceMeters} m${diagnostic.geofenceRadiusMeters == null
      ? ''
      : ` · rayon autorisé : ${diagnostic.geofenceRadiusMeters} m`}`;
  return `${accuracy} · ${distance} · Motif du refus : ${reason}.`;
}

function gpsStatusClass(status: GpsStatus): string {
  if (status === 'validated') return 'text-emerald-700';
  if (status === 'outside' || status === 'imprecise' || status === 'inconsistent' || status === 'permissionDenied'
    || status === 'unavailable' || status === 'timeout' || status === 'serverError') return 'text-rose-700';
  return 'text-slate-600';
}

function isGpsRetryStatus(status: GpsStatus): boolean {
  return status === 'imprecise'
    || status === 'outside'
    || status === 'permissionDenied'
    || status === 'inconsistent'
    || status === 'unavailable'
    || status === 'timeout'
    || status === 'cancelled'
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

function StatCard({
  label,
  value,
  detail,
  tone,
  icon: Icon,
}: {
  label: string;
  value: string;
  detail?: string;
  tone: 'indigo' | 'emerald' | 'sky' | 'amber';
  icon: typeof CalendarClock;
}) {
  const styles = {
    indigo: {
      card: 'border-indigo-200/80 bg-gradient-to-br from-indigo-600 via-indigo-500 to-blue-500 shadow-[0_18px_35px_rgba(79,70,229,0.20)] hover:shadow-[0_22px_40px_rgba(79,70,229,0.28)]',
      glow: 'bg-white/10',
      label: 'text-indigo-100',
      detail: 'text-indigo-100/90',
    },
    emerald: {
      card: 'border-emerald-200/80 bg-gradient-to-br from-emerald-400 via-emerald-500 to-teal-500 shadow-[0_18px_35px_rgba(16,185,129,0.18)] hover:shadow-[0_22px_40px_rgba(16,185,129,0.24)]',
      glow: 'bg-white/10',
      label: 'text-emerald-50',
      detail: 'text-emerald-50/90',
    },
    sky: {
      card: 'border-sky-200/80 bg-gradient-to-br from-sky-500 via-cyan-500 to-teal-500 shadow-[0_18px_35px_rgba(14,116,144,0.20)] hover:shadow-[0_22px_40px_rgba(14,116,144,0.27)]',
      glow: 'bg-white/10',
      label: 'text-sky-100',
      detail: 'text-sky-50/90',
    },
    amber: {
      card: 'border-amber-200/80 bg-gradient-to-br from-orange-400 via-amber-400 to-yellow-300 shadow-[0_18px_35px_rgba(251,146,60,0.18)] hover:shadow-[0_22px_40px_rgba(251,146,60,0.26)]',
      glow: 'bg-white/10',
      label: 'text-amber-50',
      detail: 'text-amber-50/90',
    },
  }[tone];

  return (
    <article className={`group relative min-w-0 overflow-hidden rounded-3xl border p-5 text-white transition-all duration-200 hover:-translate-y-1 ${styles.card}`}>
      <div className={`pointer-events-none absolute -right-6 -top-7 h-24 w-24 rounded-full blur-2xl ${styles.glow}`} />
      <div className="relative flex min-w-0 items-center justify-between gap-4">
        <div className="min-w-0 space-y-2">
          <span className={`text-[0.68rem] font-semibold uppercase tracking-[0.18em] sm:tracking-[0.22em] ${styles.label}`}>{label}</span>
          <p className="break-words text-3xl font-black leading-none sm:text-4xl">{value}</p>
          {detail && <p className={`break-words text-xs font-semibold tracking-tight ${styles.detail}`}>{detail}</p>}
        </div>
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-white/25 bg-white/10 text-white shadow-inner">
          <Icon className="h-6 w-6" aria-hidden="true" />
        </div>
      </div>
    </article>
  );
}

export default function TeacherControlView({
  userRole,
  viewMode = 'full',
  activeSchoolId,
  schoolsList,
  teachersList,
  superAdminSchoolFilterId,
  onSuperAdminSchoolFilterChange,
  initialTab = 'sessions',
  onTabChange,
  onPendingRegularizationsCountChange,
  onInitialViewSettled,
  currentTeacherId,
  currentTeacherName,
}: TeacherControlViewProps) {
  const isTeacher = userRole === 'teacher';
  const canManageSchoolControl = userRole === 'school_admin' || userRole === 'school_accountant';
  const isSuperAdmin = userRole === 'super_admin';
  const canManage = canManageSchoolControl;
  const canManageGps = canManageSchoolControl || isSuperAdmin;
  const schoolId = isSuperAdmin ? superAdminSchoolFilterId : activeSchoolId;
  const selectedSchool = schoolsList.find((school) => school.id === schoolId);
  const schoolQuery = isSuperAdmin && schoolId != null ? `?schoolId=${schoolId}` : '';
  const viewScopeKey = `${userRole}:${schoolId ?? 'global'}`;

  const [activeTab, setActiveTab] = useState<ViewTab>(initialTab);
  const [loading, setLoading] = useState(false);
  const [loadedScopeKey, setLoadedScopeKey] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [exportingReport, setExportingReport] = useState<'excel' | 'pdf' | null>(null);
  const [reportSelection, setReportSelection] = useState<ReportSelection>({ teacherId: '', from: '', to: '' });
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
  const [gpsCoordinateCandidate, setGpsCoordinateCandidate] = useState<GpsCoordinateCandidate | null>(null);
  const [gpsCoordinateImportInput, setGpsCoordinateImportInput] = useState('');
  const [gpsCoordinateImportError, setGpsCoordinateImportError] = useState('');
  const [gpsMapAvailability, setGpsMapAvailability] = useState<{
    candidateKey: number | null;
    status: GpsMapAvailability;
  }>({ candidateKey: null, status: 'loading' });
  const gpsAcquisitionRef = useRef<ActiveGpsAcquisition | null>(null);
  const gpsAcquisitionGenerationRef = useRef(0);
  const gpsDebugRunSequenceRef = useRef(0);
  const gpsAdminDebugRunIdRef = useRef<number | null>(null);
  const teacherGpsAbortControllerRef = useRef<AbortController | null>(null);
  const gpsLocationScopeRef = useRef(viewScopeKey);
  const gpsMapCandidateKeyRef = useRef<number | null>(null);
  const gpsMapCandidateKeySequenceRef = useRef(0);
  const gpsCandidateBlockRef = useRef<HTMLDivElement>(null);
  const [selectedSessionId, setSelectedSessionId] = useState<number | null>(null);
  const [selectedClassId, setSelectedClassId] = useState('');
  const [selectedSubjectId, setSelectedSubjectId] = useState('');
  const [gpsStatus, setGpsStatus] = useState<GpsStatus>('idle');
  const [gpsStatusDetail, setGpsStatusDetail] = useState('');
  const [gpsDiagnostic, setGpsDiagnostic] = useState<TeacherGpsDiagnostic | null>(null);
  const [teacherAction, setTeacherAction] = useState<TeacherAction | null>(initialTeacherAction);
  const [gpsDebugSnapshot, setGpsDebugSnapshot] = useState<GpsDebugSnapshot | null>(null);
  const [selectedOpenSessionId, setSelectedOpenSessionId] = useState<number | null>(null);
  const [gpsReading, setGpsReading] = useState<GpsFix | null>(null);
  const [validatedGps, setValidatedGps] = useState<{ fix: GpsFix; timestamp: string } | null>(null);
  const [pendingEndValidation, setPendingEndValidation] = useState<PendingEndValidation | null>(null);
  const [startedSession, setStartedSession] = useState<Session | null>(null);
  const [endConfirmation, setEndConfirmation] = useState<EndConfirmation | null>(null);
  const initialTabRef = useRef(initialTab);
  const actionInFlight = useRef(false);
  const reportExportInFlight = useRef(false);
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
  const [requestReasons, setRequestReasons] = useState<Record<number, string>>({});
  const [completionReasons, setCompletionReasons] = useState<Record<number, string>>({});
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
  const [gpsForm, setGpsForm] = useState({ isEnabled: false });
  const [gpsRadius, setGpsRadius] = useState('200');
  const [gpsAccuracyThreshold, setGpsAccuracyThreshold] = useState(String(MAX_GPS_ACCURACY_METERS));

  const beginGpsDebugRun = (
    pathway: GpsDebugSnapshot['pathway'],
    action: string,
  ): number | null => {
    if (!GPS_DIAGNOSTICS_ENABLED) return null;
    const runId = gpsDebugRunSequenceRef.current + 1;
    gpsDebugRunSequenceRef.current = runId;
    setGpsDebugSnapshot({ runId, pathway, action, readings: [], selected: null, used: null });
    return runId;
  };
  const appendGpsDebugReading = (runId: number | null, reading: GpsDebugReading) => {
    if (runId == null || !GPS_DIAGNOSTICS_ENABLED) return;
    setGpsDebugSnapshot((current) => current?.runId === runId
      ? { ...current, readings: [...current.readings, reading] }
      : current);
  };
  const selectGpsDebugFix = (runId: number | null, fix: GpsDebugFix) => {
    if (runId == null || !GPS_DIAGNOSTICS_ENABLED) return;
    setGpsDebugSnapshot((current) => current?.runId === runId ? { ...current, selected: fix } : current);
  };
  const markGpsDebugFixUsed = (runId: number | null, endpoint: string, fix: GpsDebugFix) => {
    if (runId == null || !GPS_DIAGNOSTICS_ENABLED) return;
    setGpsDebugSnapshot((current) => current?.runId === runId
      ? { ...current, used: { endpoint, fix } }
      : current);
  };

  useEffect(() => {
    if (gpsLocationScopeRef.current === viewScopeKey) return;
    gpsLocationScopeRef.current = viewScopeKey;
    gpsAcquisitionGenerationRef.current += 1;
    teacherGpsAbortControllerRef.current?.abort();
    teacherGpsAbortControllerRef.current = null;
    const activeAcquisition = gpsAcquisitionRef.current;
    if (activeAcquisition) {
      clearGpsAcquisitionResources(activeAcquisition);
      gpsAcquisitionRef.current = null;
    }
    setGpsLocationLoading(false);
    setGpsLocationMessage('');
    setGpsCoordinateCandidate(null);
    setGpsCoordinateImportInput('');
    setGpsCoordinateImportError('');
    setGpsStatus('idle');
    setGpsStatusDetail('');
    setGpsDiagnostic(null);
    setError(null);
    gpsMapCandidateKeyRef.current = null;
    setGpsMapAvailability({ candidateKey: null, status: 'loading' });
  }, [viewScopeKey]);

  useEffect(() => () => {
    gpsAcquisitionGenerationRef.current += 1;
    teacherGpsAbortControllerRef.current?.abort();
    teacherGpsAbortControllerRef.current = null;
    const activeAcquisition = gpsAcquisitionRef.current;
    if (activeAcquisition) {
      clearGpsAcquisitionResources(activeAcquisition);
      gpsAcquisitionRef.current = null;
    }
  }, []);

  const reportTeacherOptions = useMemo<ReportTeacherOption[]>(() => {
    const options = new Map<string, ReportTeacherOption>();
    for (const teacher of teachersList) {
      if (teacher.isDeleted) continue;
      const teacherSchoolIds = teacher.schoolIds?.length ? teacher.schoolIds : [teacher.schoolId];
      for (const teacherSchoolId of teacherSchoolIds) {
        if (schoolId != null && teacherSchoolId !== schoolId) continue;
        const schoolName = schoolsList.find((school) => school.id === teacherSchoolId)?.name
          ?? `Établissement #${teacherSchoolId}`;
        options.set(`${teacherSchoolId}:${teacher.id}`, {
          schoolId: teacherSchoolId,
          schoolName,
          teacherId: teacher.id,
          teacherName: teacher.name,
        });
      }
    }
    for (const teacher of sessionFilterOptions?.teachers ?? []) {
      const [teacherName, optionSchoolName] = teacher.name.split(' · ');
      const optionSchoolId = schoolId
        ?? schoolsList.find((school) => school.name === optionSchoolName)?.id
        ?? activeSchoolId
        ?? 0;
      const key = `${optionSchoolId}:${teacher.id}`;
      if (!options.has(key)) {
        options.set(key, {
          schoolId: optionSchoolId,
          schoolName: optionSchoolName ?? selectedSchool?.name ?? `Établissement #${optionSchoolId}`,
          teacherId: teacher.id,
          teacherName,
        });
      }
    }
    return [...options.values()].sort((left, right) => left.schoolName.localeCompare(right.schoolName, 'fr')
      || left.teacherName.localeCompare(right.teacherName, 'fr'));
  }, [activeSchoolId, schoolId, schoolsList, selectedSchool?.name, sessionFilterOptions?.teachers, teachersList]);

  const savedGpsLatitude = gpsSettings?.latitude == null ? '' : String(gpsSettings.latitude);
  const savedGpsLongitude = gpsSettings?.longitude == null ? '' : String(gpsSettings.longitude);
  const gpsCandidateLatitude = gpsCoordinateCandidate?.latitude ?? savedGpsLatitude;
  const gpsCandidateLongitude = gpsCoordinateCandidate?.longitude ?? savedGpsLongitude;
  const gpsCandidateCoordinates = gpsCoordinateCandidate
    ? parseGpsCoordinatePair(gpsCoordinateCandidate.latitude, gpsCoordinateCandidate.longitude)
    : null;
  const googleMapsCandidateUrl = gpsCandidateCoordinates
    ? `https://www.google.com/maps/search/?${new URLSearchParams({
      api: '1',
      query: `${gpsCandidateCoordinates.latitude},${gpsCandidateCoordinates.longitude}`,
    }).toString()}`
    : null;
  const gpsCandidateChangesLocation = gpsCoordinateCandidate != null && !gpsCoordinatesMatch(
    gpsCoordinateCandidate.latitude,
    gpsCoordinateCandidate.longitude,
    gpsSettings?.latitude,
    gpsSettings?.longitude,
  );
  const gpsCandidateMapReady = gpsCoordinateCandidate != null
    && gpsMapAvailability.candidateKey === gpsCoordinateCandidate.mapKey
    && gpsMapAvailability.status === 'ready';

  useEffect(() => {
    if (!gpsCoordinateCandidate || gpsCoordinateCandidate.source === 'manual') return;
    const candidateBlock = gpsCandidateBlockRef.current;
    if (typeof candidateBlock?.scrollIntoView !== 'function') return;
    candidateBlock.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [gpsCoordinateCandidate?.mapKey, gpsCoordinateCandidate?.source]);

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
    let loadSucceeded = false;
    try {
      if (viewMode === 'regularizations') {
        if (globalOverview) {
          const [summary, requestRows] = await Promise.all([
            apiFetch('/api/teacher-control/statistics/global') as Promise<GlobalStatistics>,
            apiFetch('/api/teacher-control/regularizations', { cache: 'no-store' }) as Promise<Regularization[]>,
          ]);
          setGlobalStatistics(summary);
          setStatistics(summary);
          setRegularizations(Array.isArray(requestRows) ? requestRows : []);
          onPendingRegularizationsCountChange?.(summary.pendingRegularizations);
          loadSucceeded = true;
          return;
        }

        const [summary, requestRows] = await Promise.all([
          apiFetch(`/api/teacher-control/statistics${schoolQuery}`, { cache: 'no-store' }) as Promise<Statistics>,
          apiFetch(`/api/teacher-control/regularizations${schoolQuery}`, { cache: 'no-store' }) as Promise<Regularization[]>,
        ]);
        setStatistics(summary);
        setGlobalStatistics(null);
        setRegularizations(Array.isArray(requestRows) ? requestRows : []);
        onPendingRegularizationsCountChange?.(summary.pendingRegularizations);
        loadSucceeded = true;
        return;
      }

      const filterParams = makeFilterParams(true);
      const filterQuery = filterParams.toString();
      if (globalOverview) {
        const summary = await apiFetch(`/api/teacher-control/statistics/global${filterQuery ? `?${filterQuery}` : ''}`) as GlobalStatistics;
        setGlobalStatistics(summary);
        setStatistics(summary);
        setSessions([]);
        setSessionTotalCount(summary.totalSessions);
        setSessionNextCursor(null);
        setGpsHistory([]);
        setGpsSettings(null);
        onPendingRegularizationsCountChange?.(summary.pendingRegularizations);
        loadSucceeded = true;
        return;
      }

      const sessionParams = makeFilterParams(false);
      sessionParams.set('limit', '50');
      if (currentCursor) sessionParams.set('cursor', currentCursor);
      if (isSuperAdmin && schoolId != null) sessionParams.set('schoolId', String(schoolId));
      const scopedQuery = schoolQuery;
      const gpsHistoryEndpoint = `/api/teacher-control/gps-settings/history${scopedQuery ? `${scopedQuery}&limit=50` : '?limit=50'}`;
      const [sessionPage, summary, requestRows, openSessionResponse, assignmentRows, settings, history] = await Promise.all([
        apiFetch(`/api/teacher-control/sessions?${sessionParams.toString()}`) as Promise<SessionPage>,
        apiFetch(`/api/teacher-control/statistics${filterQuery ? `?${filterQuery}` : ''}`) as Promise<Statistics>,
        apiFetch(`/api/teacher-control/regularizations${scopedQuery}`) as Promise<Regularization[]>,
        isTeacher
          ? apiFetch('/api/teacher-control/sessions?status=open&limit=100') as Promise<SessionPage>
          : Promise.resolve(null),
        isTeacher
          ? apiFetch('/api/teacher-control/assignments') as Promise<Assignment[]>
          : Promise.resolve(null),
        !isTeacher
          ? apiFetch(`/api/teacher-control/gps-settings${scopedQuery}`, { cache: 'no-store' }) as Promise<GpsSettings>
          : Promise.resolve(null),
        !isTeacher
          ? apiFetch(gpsHistoryEndpoint) as Promise<Array<Record<string, unknown>>>
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
      if (!isSuperAdmin) onPendingRegularizationsCountChange?.(summary.pendingRegularizations);

      if (isTeacher) {
        if (!Array.isArray(assignmentRows)) {
          throw new Error('La réponse des associations pédagogiques est invalide.');
        }
        setAssignments(assignmentRows);
      } else {
        if (!settings) throw new Error('La réponse de la configuration GPS est invalide.');
        setGpsSettings(settings);
        setGpsHistory(Array.isArray(history) ? history : []);
        setGpsForm({
          isEnabled: settings.isEnabled,
        });
        setGpsRadius(String(settings.geofenceRadiusMeters ?? 200));
        setGpsAccuracyThreshold(String(settings.maxGpsAccuracyMeters ?? MAX_GPS_ACCURACY_METERS));
      }
      loadSucceeded = true;
    } catch (loadError) {
      if (isTeacher) {
        setAssignments(null);
        setTeacherOpenSessions([]);
      }
      setError(loadError instanceof Error
        ? loadError.message
        : `Impossible de charger le module ${isTeacher ? 'Déclaration de présence' : 'Contrôle des enseignants'}.`);
    } finally {
      setLoading(false);
      if (loadSucceeded) setLoadedScopeKey(viewScopeKey);
      if (viewMode === 'full') onInitialViewSettled?.();
    }
  }, [currentCursor, filterRevision, isSuperAdmin, isTeacher, makeFilterParams, onInitialViewSettled, onPendingRegularizationsCountChange, schoolId, schoolQuery, viewMode, viewScopeKey]);

  const refreshRegularizations = useCallback(async () => {
    try {
      const rows = await apiFetch(`/api/teacher-control/regularizations${schoolQuery}`, { cache: 'no-store' }) as Regularization[];
      if (!Array.isArray(rows)) throw new Error('La réponse des régularisations est invalide.');
      setRegularizations(rows);
    } catch (refreshError) {
      setError(refreshError instanceof Error
        ? refreshError.message
        : 'Impossible d’actualiser les demandes de régularisation.');
    }
  }, [onPendingRegularizationsCountChange, schoolQuery]);

  useEffect(() => {
    if (initialTabRef.current !== initialTab) {
      initialTabRef.current = initialTab;
      setActiveTab(initialTab);
    }
  }, [initialTab]);

  useEffect(() => {
    if (viewMode !== 'regularizations' && activeTab !== 'requests') return;
    if (viewMode !== 'regularizations' && isSuperAdmin && schoolId == null) void refreshRegularizations();
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') void refreshRegularizations();
    };
    const intervalId = window.setInterval(refreshWhenVisible, 30_000);
    window.addEventListener('focus', refreshRegularizations);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('focus', refreshRegularizations);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, [activeTab, isSuperAdmin, refreshRegularizations, schoolId, viewMode]);

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
    setLoadedScopeKey(null);
  }, [isSuperAdmin, schoolId]);

  useEffect(() => {
    if (skipNextDataLoadRef.current) {
      skipNextDataLoadRef.current = false;
      return;
    }
    if (schoolId != null || isSuperAdmin) void loadData();
  }, [loadData, schoolId, isSuperAdmin]);

  useEffect(() => {
    if (isTeacher || viewMode === 'regularizations') {
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
  }, [isSuperAdmin, isTeacher, schoolId, viewMode]);

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
  const visibleRegularizations = regularizations.filter((entry) => entry.request.status === 'pending');
  const assignmentLoadErrorMessage = 'Vos associations pédagogiques n’ont pas pu être vérifiées. Consultez le message d’erreur avant de réessayer.';

  if (viewMode === 'full'
    && loadedScopeKey !== viewScopeKey
    && (schoolId != null || isSuperAdmin)) {
    return (
      <section className="space-y-5" aria-busy={loading}>
        <ModuleHeading role={userRole} schoolName={selectedSchool?.name} onRefresh={() => void loadData()} loading />
        {error ? (
          <div className="space-y-3">
            <ErrorNotice message={error} />
            {isTeacher && assignments === null && <p role="status">{assignmentLoadErrorMessage}</p>}
            <button type="button" onClick={() => void loadData()} className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700">
              Réessayer
            </button>
          </div>
        ) : (
          <div className="space-y-4 bg-[radial-gradient(circle_at_top_left,_rgba(99,102,241,0.10),_transparent_28%),radial-gradient(circle_at_bottom_right,_rgba(56,189,248,0.12),_transparent_30%)] p-1 md:p-2">
            <div
              className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
              data-testid="teacher-control-statistics-loading-grid"
              aria-hidden="true"
            >
              {[0, 1, 2, 3].map((item) => (
                <div key={item} className="flex min-h-32 items-center justify-between gap-4 rounded-3xl border border-slate-200/80 bg-white/80 p-5 shadow-[0_16px_35px_rgba(15,23,42,0.06)]">
                  <div className="space-y-3">
                    <div className="h-3 w-28 rounded bg-slate-200" />
                    <div className="h-8 w-24 rounded bg-slate-200" />
                    <div className="h-3 w-36 max-w-full rounded bg-slate-100" />
                  </div>
                  <div className="h-12 w-12 shrink-0 rounded-2xl bg-slate-100" />
                </div>
              ))}
            </div>
            <p role="status" className="text-center text-sm text-slate-500">
              Chargement des statistiques et des informations du module…
            </p>
          </div>
        )}
      </section>
    );
  }

  const showError = (actionError: unknown, fallback: string) => {
    setError(actionError instanceof Error ? actionError.message : fallback);
    setSuccess(null);
  };

  const cancelTeacherGpsAcquisition = () => {
    teacherGpsAbortControllerRef.current?.abort();
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
    setGpsStatusDetail('');
    setGpsDiagnostic(null);
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
    setGpsDiagnostic(null);
    setGpsStatusDetail('');
    setGpsStatus('locating');
    const acquisitionController = new AbortController();
    teacherGpsAbortControllerRef.current = acquisitionController;
    const gpsDebugRunId = beginGpsDebugRun('teacher', 'Démarrage de séance');
    try {
      const maxGpsAccuracyMeters = await getTeacherGpsAccuracyThreshold(acquisitionController.signal);
      const fix = await requestPosition((reading) => {
        setGpsReading(reading);
        setGpsStatus('improving');
      }, maxGpsAccuracyMeters, acquisitionController.signal, setGpsStatusDetail,
      GPS_DIAGNOSTICS_ENABLED ? (reading) => appendGpsDebugReading(gpsDebugRunId, reading) : undefined,
      GPS_DIAGNOSTICS_ENABLED ? (sample) => selectGpsDebugFix(gpsDebugRunId, {
        latitude: String(sample.latitude),
        longitude: String(sample.longitude),
        accuracyMeters: String(sample.accuracyMeters),
        timestamp: String(sample.timestamp),
      }) : undefined);
      setGpsReading(fix);
      setGpsStatus('obtained');
      const { challenge } = await postJson<{ challenge: string }>('/api/teacher-control/gps-challenges', { action: 'start_session' });
      setGpsStatus('verifying');
      markGpsDebugFixUsed(gpsDebugRunId, '/api/teacher-control/sessions/start', {
        latitude: String(fix.latitude),
        longitude: String(fix.longitude),
        accuracyMeters: String(fix.accuracyMeters),
        timestamp: 'non transmis à l’API',
      });
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
      if (gpsLocationScopeRef.current !== viewScopeKey
        || teacherGpsAbortControllerRef.current !== acquisitionController) return;
      const reportedError = acquisitionController.signal.aborted
        ? new GeolocationRequestError('Acquisition annulée. Vous pouvez réessayer.', 'cancelled')
        : actionError;
      const failure = gpsFailureMessage(reportedError);
      setGpsStatus(failure.status);
      setGpsDiagnostic(failure.diagnostic);
      showError(new Error(failure.message), 'Erreur de communication ou de vérification du serveur.');
    } finally {
      if (teacherGpsAbortControllerRef.current === acquisitionController) {
        teacherGpsAbortControllerRef.current = null;
      }
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
    setGpsDiagnostic(null);
    setGpsStatusDetail('');
    setGpsStatus('locating');
    const acquisitionController = new AbortController();
    teacherGpsAbortControllerRef.current = acquisitionController;
    const gpsDebugRunId = beginGpsDebugRun('teacher', 'Validation GPS de clôture');
    try {
      const maxGpsAccuracyMeters = await getTeacherGpsAccuracyThreshold(acquisitionController.signal);
      const fix = await requestPosition((reading) => {
        setGpsReading(reading);
        setGpsStatus('improving');
      }, maxGpsAccuracyMeters, acquisitionController.signal, setGpsStatusDetail,
      GPS_DIAGNOSTICS_ENABLED ? (reading) => appendGpsDebugReading(gpsDebugRunId, reading) : undefined,
      GPS_DIAGNOSTICS_ENABLED ? (sample) => selectGpsDebugFix(gpsDebugRunId, {
        latitude: String(sample.latitude),
        longitude: String(sample.longitude),
        accuracyMeters: String(sample.accuracyMeters),
        timestamp: String(sample.timestamp),
      }) : undefined);
      setGpsReading(fix);
      setGpsStatus('obtained');
      const { challenge } = await postJson<{ challenge: string }>('/api/teacher-control/gps-challenges', {
        action: 'end_session',
        sessionId: session.id,
      });
      setGpsStatus('verifying');
      markGpsDebugFixUsed(gpsDebugRunId, `/api/teacher-control/sessions/${session.id}/validate-end`, {
        latitude: String(fix.latitude),
        longitude: String(fix.longitude),
        accuracyMeters: String(fix.accuracyMeters),
        timestamp: 'non transmis à l’API',
      });
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
      if (gpsLocationScopeRef.current !== viewScopeKey
        || teacherGpsAbortControllerRef.current !== acquisitionController) return;
      setPendingEndValidation(null);
      setValidatedGps(null);
      const reportedError = acquisitionController.signal.aborted
        ? new GeolocationRequestError('Acquisition annulée. Vous pouvez réessayer.', 'cancelled')
        : actionError;
      const failure = gpsFailureMessage(reportedError);
      setGpsStatus(failure.status);
      setGpsDiagnostic(failure.diagnostic);
      showError(new Error(failure.message), 'Erreur de communication ou de vérification du serveur.');
    } finally {
      if (teacherGpsAbortControllerRef.current === acquisitionController) {
        teacherGpsAbortControllerRef.current = null;
      }
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
      setGpsDiagnostic(failure.diagnostic);
      showError(new Error(failure.message), 'Erreur de communication ou de vérification du serveur.');
    } finally {
      actionInFlight.current = false;
      setBusyAction(null);
    }
  };

  const submitRegularization = async (session: Session) => {
    const reason = requestReasons[session.id]?.trim() ?? '';
    if (!reason) {
      setError('Indiquez le motif de la demande de régularisation.');
      return;
    }
    setBusyAction(`regularize-${session.id}`);
    setError(null);
    try {
      await postJson(`/api/teacher-control/sessions/${session.id}/regularizations`, { reason });
      await refreshAfterAction('Votre demande a été transmise. L’heure de soumission du serveur est proposée comme heure de fin.');
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

  const completeImmediateRegularization = async (
    request: Regularization['request'],
    mode: 'gps' | 'regularization',
  ) => {
    const reason = completionReasons[request.id]?.trim() ?? '';
    if (!reason) {
      setError('Indiquez le motif de la fin de séance.');
      return;
    }
    if (actionInFlight.current) return;
    actionInFlight.current = true;
    setBusyAction(`complete-report-${request.id}`);
    setError(null);
    const acquisitionController = mode === 'gps' ? new AbortController() : null;
    if (acquisitionController) teacherGpsAbortControllerRef.current = acquisitionController;
    const gpsDebugRunId = mode === 'gps'
      ? beginGpsDebugRun('teacher', 'Régularisation GPS immédiate')
      : null;
    if (mode === 'gps') {
      setGpsDiagnostic(null);
      setGpsStatusDetail('');
    }
    try {
      let gpsPayload: Record<string, unknown> = {};
      if (mode === 'gps') {
        setGpsStatus('locating');
        const maxGpsAccuracyMeters = await getTeacherGpsAccuracyThreshold(acquisitionController?.signal);
        const fix = await requestPosition((reading) => {
          setGpsReading(reading);
          setGpsStatus('improving');
        }, maxGpsAccuracyMeters, acquisitionController?.signal, setGpsStatusDetail,
        GPS_DIAGNOSTICS_ENABLED ? (reading) => appendGpsDebugReading(gpsDebugRunId, reading) : undefined,
        GPS_DIAGNOSTICS_ENABLED ? (sample) => selectGpsDebugFix(gpsDebugRunId, {
          latitude: String(sample.latitude),
          longitude: String(sample.longitude),
          accuracyMeters: String(sample.accuracyMeters),
          timestamp: String(sample.timestamp),
        }) : undefined);
        setGpsReading(fix);
        setGpsStatus('obtained');
        const { challenge } = await postJson<{ challenge: string }>('/api/teacher-control/gps-challenges', {
          action: 'end_session',
          regularizationRequestId: request.id,
        });
        setGpsStatus('verifying');
        gpsPayload = { ...fix, gpsChallenge: challenge };
        markGpsDebugFixUsed(gpsDebugRunId, `/api/teacher-control/regularizations/${request.id}/complete`, {
          latitude: String(fix.latitude),
          longitude: String(fix.longitude),
          accuracyMeters: String(fix.accuracyMeters),
          timestamp: 'non transmis à l’API',
        });
      }
      await postJson(`/api/teacher-control/regularizations/${request.id}/complete`, {
        mode,
        reason,
        description: unrecordedCompletionDescription[request.id]?.trim() || null,
        ...gpsPayload,
      });
      setGpsStatus(mode === 'gps' ? 'validated' : 'idle');
      await refreshAfterAction(mode === 'gps'
        ? 'La fin GPS a été validée et transmise à l’administration.'
        : 'La fin a été horodatée par le serveur et transmise à l’administration.');
      setCompletionReasons((current) => ({ ...current, [request.id]: '' }));
      setUnrecordedCompletionDescription((current) => ({ ...current, [request.id]: '' }));
    } catch (requestError) {
      if (gpsLocationScopeRef.current !== viewScopeKey
        || (acquisitionController && teacherGpsAbortControllerRef.current !== acquisitionController)) return;
      const reportedError = acquisitionController?.signal.aborted
        ? new GeolocationRequestError('Acquisition annulée. Vous pouvez réessayer.', 'cancelled')
        : requestError;
      const failure = gpsFailureMessage(reportedError);
      if (mode === 'gps') {
        setGpsStatus(failure.status);
        setGpsDiagnostic(failure.diagnostic);
      }
      showError(reportedError, 'Impossible de compléter le signalement.');
    } finally {
      if (teacherGpsAbortControllerRef.current === acquisitionController) {
        teacherGpsAbortControllerRef.current = null;
      }
      actionInFlight.current = false;
      setBusyAction(null);
    }
  };

  const decideRegularization = async (
    request: Regularization['request'],
    decision: 'accepted' | 'rejected' | 'modified_accepted',
  ) => {
    if (!canManageSchoolControl) return;
    const reason = regularizationReasons[request.id]?.trim() ?? '';
    const proposedEndedAt = decision === 'modified_accepted'
      ? parseLomeInput(regularizationEndTimes[request.id]
        ?? (request.proposedEndedAt ? formatLomeInput(new Date(request.proposedEndedAt)) : ''))
      : null;
    const linkedSessionStart = request.linkedSessionStartedAt
      ?? (request.sessionId == null ? null : sessions.find((session) => session.id === request.sessionId)?.startedAt ?? null);
    const startTimeWasEdited = Object.prototype.hasOwnProperty.call(regularizationStartTimes, request.id);
    const proposedStartedAt = decision === 'modified_accepted'
      && startTimeWasEdited
      ? parseLomeInput(regularizationStartTimes[request.id]
        ?? formatLomeInput(new Date(linkedSessionStart ?? request.referenceStartedAt ?? request.declaredStartedAt ?? request.createdAt)))
      : null;
    if ((decision === 'rejected' || decision === 'modified_accepted') && !reason) {
      setError('Un motif est obligatoire pour cette décision.');
      return;
    }
    if (decision === 'modified_accepted' && !proposedEndedAt) {
      setError('Indiquez une nouvelle heure de fin valide.');
      return;
    }
    if (decision === 'modified_accepted' && startTimeWasEdited && !proposedStartedAt) {
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
        ...(isSuperAdmin && schoolId != null ? { schoolId } : {}),
      });
      await refreshAfterAction('La décision a été enregistrée et auditée.');
    } catch (actionError) {
      showError(actionError, 'Impossible d’enregistrer la décision.');
    } finally {
      setBusyAction(null);
    }
  };

  const correctCompletedSession = async (
    session: Session,
    correction: { startedAt?: string; endedAt?: string; reason: string },
  ) => {
    if (!canManageSchoolControl) return;
    setBusyAction(`correct-session-${session.id}`);
    setError(null);
    try {
      await postJson(`/api/teacher-control/sessions/${session.id}/correction`, {
        ...correction,
        expectedStartedAt: session.startedAt,
        expectedEndedAt: session.validatedEndedAt,
      });
      await refreshAfterAction('Les heures de la séance ont été corrigées et auditées.');
      const events = await apiFetch(`/api/teacher-control/sessions/${session.id}/audit${schoolQuery}`) as SessionAuditEvent[];
      setSessionAudit((current) => ({ ...current, [session.id]: events }));
    } catch (correctionError) {
      showError(correctionError, 'Impossible de corriger les heures de la séance.');
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
    if (gpsLocationLoading) {
      setError('Attendez la fin ou annulez l’acquisition GPS avant d’enregistrer.');
      return;
    }
    const savedLatitude = gpsSettings?.latitude == null ? null : Number(gpsSettings.latitude);
    const savedLongitude = gpsSettings?.longitude == null ? null : Number(gpsSettings.longitude);
    const candidateCoordinates = gpsCoordinateCandidate
      ? parseGpsCoordinatePair(gpsCoordinateCandidate.latitude, gpsCoordinateCandidate.longitude)
      : null;
    const locationChanged = gpsCoordinateCandidate != null && !gpsCoordinatesMatch(
      gpsCoordinateCandidate.latitude,
      gpsCoordinateCandidate.longitude,
      gpsSettings?.latitude,
      gpsSettings?.longitude,
    );
    if (locationChanged && !candidateCoordinates) {
      setError('La position candidate doit contenir une latitude et une longitude valides.');
      return;
    }
    if (locationChanged && !gpsCoordinateCandidate?.confirmed) {
      setError('Confirmez explicitement le nouvel emplacement avant de l’enregistrer.');
      return;
    }
    if (locationChanged && !gpsCandidateMapReady) {
      setError('La carte doit être chargée avant de confirmer le nouvel emplacement.');
      return;
    }
    const latitude = locationChanged ? candidateCoordinates?.latitude ?? null : savedLatitude;
    const longitude = locationChanged ? candidateCoordinates?.longitude ?? null : savedLongitude;
    if (gpsForm.isEnabled && (latitude == null || longitude == null)) {
      setError('Renseignez les coordonnées de l’établissement avant d’activer le contrôle GPS.');
      return;
    }
    setBusyAction('gps-settings');
    setError(null);
    try {
      markGpsDebugFixUsed(gpsAdminDebugRunIdRef.current, '/api/teacher-control/gps-settings', {
        latitude: latitude == null ? 'null' : String(latitude),
        longitude: longitude == null ? 'null' : String(longitude),
        accuracyMeters: 'non transmis à l’API',
        timestamp: 'non transmis à l’API',
      });
      await putJson('/api/teacher-control/gps-settings', {
        ...(isSuperAdmin ? { schoolId } : {}),
        isEnabled: gpsForm.isEnabled,
        latitude,
        longitude,
        locationConfirmed: locationChanged && gpsCoordinateCandidate?.confirmed === true,
        geofenceRadiusMeters: gpsSettings?.geofenceRadiusMeters ?? 200,
        maxGpsAccuracyMeters: gpsSettings?.maxGpsAccuracyMeters ?? MAX_GPS_ACCURACY_METERS,
      });
      setGpsCoordinateCandidate(null);
      gpsMapCandidateKeyRef.current = null;
      setGpsMapAvailability({ candidateKey: null, status: 'loading' });
      setGpsLocationMessage('');
      await refreshAfterAction('La configuration GPS a été mise à jour et auditée.');
    } catch (actionError) {
      showError(actionError, 'Impossible d’enregistrer la configuration GPS.');
    } finally {
      setBusyAction(null);
    }
  };

  const saveGeofenceRadius = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const radius = Number(gpsRadius);
    if (!Number.isSafeInteger(radius) || radius < 1 || radius > MAX_GEOFENCE_RADIUS_METERS) {
      setError(`Le rayon doit être un entier compris entre 1 et ${MAX_GEOFENCE_RADIUS_METERS} mètres.`);
      return;
    }
    if (!gpsSettings) {
      setError('La configuration GPS de l’établissement n’est pas disponible.');
      return;
    }
    setBusyAction('gps-radius');
    setError(null);
    try {
      await putJson('/api/teacher-control/gps-settings', {
        ...(isSuperAdmin ? { schoolId } : {}),
        isEnabled: gpsSettings.isEnabled,
        latitude: gpsSettings.latitude == null ? null : Number(gpsSettings.latitude),
        longitude: gpsSettings.longitude == null ? null : Number(gpsSettings.longitude),
        geofenceRadiusMeters: radius,
        maxGpsAccuracyMeters: gpsSettings.maxGpsAccuracyMeters ?? MAX_GPS_ACCURACY_METERS,
      });
      await refreshAfterAction('Le rayon de présence a été enregistré.');
    } catch (actionError) {
      showError(actionError, 'Impossible d’enregistrer le rayon de présence.');
    } finally {
      setBusyAction(null);
    }
  };

  const saveGpsAccuracyThreshold = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const maxGpsAccuracyMeters = Number(gpsAccuracyThreshold);
    if (!Number.isSafeInteger(maxGpsAccuracyMeters)
      || maxGpsAccuracyMeters < 1
      || maxGpsAccuracyMeters > MAX_CONFIGURABLE_GPS_ACCURACY_METERS) {
      setError(`La précision maximale doit être un entier compris entre 1 et ${MAX_CONFIGURABLE_GPS_ACCURACY_METERS} mètres.`);
      return;
    }
    if (!gpsSettings) {
      setError('La configuration GPS de l’établissement n’est pas disponible.');
      return;
    }
    setBusyAction('gps-accuracy');
    setError(null);
    try {
      const saved = await putJson<{ maxGpsAccuracyMeters: number }>('/api/teacher-control/gps-settings', {
        ...(isSuperAdmin ? { schoolId } : {}),
        isEnabled: gpsSettings.isEnabled,
        latitude: gpsSettings.latitude == null ? null : Number(gpsSettings.latitude),
        longitude: gpsSettings.longitude == null ? null : Number(gpsSettings.longitude),
        geofenceRadiusMeters: gpsSettings.geofenceRadiusMeters,
        maxGpsAccuracyMeters,
      });
      if (saved.maxGpsAccuracyMeters !== maxGpsAccuracyMeters) {
        throw new Error('Le serveur n’a pas confirmé la valeur de précision GPS enregistrée.');
      }
      setGpsAccuracyThreshold(String(saved.maxGpsAccuracyMeters));
      setGpsSettings((current) => current
        ? { ...current, maxGpsAccuracyMeters: saved.maxGpsAccuracyMeters }
        : current);
      await refreshAfterAction('La précision GPS maximale a été enregistrée.');
    } catch (actionError) {
      showError(actionError, 'Impossible d’enregistrer la précision GPS maximale.');
    } finally {
      setBusyAction(null);
    }
  };

  const cancelGpsAcquisition = (message: string) => {
    gpsAcquisitionGenerationRef.current += 1;
    const activeAcquisition = gpsAcquisitionRef.current;
    if (activeAcquisition) clearGpsAcquisitionResources(activeAcquisition);
    gpsAcquisitionRef.current = null;
    setGpsLocationLoading(false);
    setGpsLocationMessage(message);
  };

  const updateManualGpsCoordinate = (coordinate: 'latitude' | 'longitude', value: string) => {
    if (gpsLocationLoading) {
      cancelGpsAcquisition('Acquisition annulée; la coordonnée a été modifiée manuellement.');
    }
    const savedLatitude = gpsSettings?.latitude == null ? '' : String(gpsSettings.latitude);
    const savedLongitude = gpsSettings?.longitude == null ? '' : String(gpsSettings.longitude);
    const mapKey = gpsMapCandidateKeySequenceRef.current + 1;
    gpsMapCandidateKeySequenceRef.current = mapKey;
    gpsMapCandidateKeyRef.current = mapKey;
    setGpsMapAvailability({ candidateKey: mapKey, status: 'loading' });
    setGpsCoordinateCandidate((current) => ({
      mapKey,
      source: 'manual',
      latitude: coordinate === 'latitude' ? value : current?.latitude ?? savedLatitude,
      longitude: coordinate === 'longitude' ? value : current?.longitude ?? savedLongitude,
      confirmed: false,
      samples: [],
      maxSpreadMeters: null,
    }));
    setGpsLocationMessage('Coordonnée modifiée manuellement; le nouvel emplacement devra être confirmé.');
  };

  const discardGpsCoordinateCandidate = () => {
    setGpsCoordinateCandidate(null);
    gpsMapCandidateKeyRef.current = null;
    setGpsMapAvailability({ candidateKey: null, status: 'loading' });
    setGpsLocationMessage('Position candidate abandonnée; les coordonnées enregistrées sont conservées.');
  };

  const handleGpsMapAvailabilityChange = (candidateKey: number, status: GpsMapAvailability) => {
    if (gpsMapCandidateKeyRef.current !== candidateKey) return;
    setGpsMapAvailability({ candidateKey, status });
  };

  const handleGpsMapPositionChange = (candidateKey: number, latitude: number, longitude: number) => {
    if (gpsMapCandidateKeyRef.current !== candidateKey) return;
    setGpsCoordinateCandidate((current) => current?.mapKey === candidateKey
      ? {
        ...current,
        source: 'manual',
        latitude: latitude.toFixed(6),
        longitude: longitude.toFixed(6),
        confirmed: false,
      }
      : current);
    setGpsLocationMessage('Position corrigée sur la carte; vérifiez les nouvelles coordonnées et confirmez à nouveau avant l’enregistrement.');
  };

  const importGpsCoordinate = () => {
    const result = parseGoogleMapsCoordinateInput(gpsCoordinateImportInput);
    if (!result.coordinates) {
      setGpsCoordinateImportError(result.error);
      return;
    }

    if (gpsLocationLoading) {
      cancelGpsAcquisition('Acquisition annulée au profit de la position importée.');
    }
    const mapKey = gpsMapCandidateKeySequenceRef.current + 1;
    gpsMapCandidateKeySequenceRef.current = mapKey;
    gpsMapCandidateKeyRef.current = mapKey;
    setGpsMapAvailability({ candidateKey: mapKey, status: 'loading' });
    setGpsCoordinateCandidate({
      mapKey,
      source: 'google_maps',
      latitude: result.coordinates.latitude.toString(),
      longitude: result.coordinates.longitude.toString(),
      confirmed: false,
      samples: [],
      maxSpreadMeters: null,
    });
    setGpsCoordinateImportInput('');
    setGpsCoordinateImportError('');
    setGpsLocationMessage('Position importée depuis Google Maps. Vérifiez le point et confirmez explicitement avant toute sauvegarde.');
  };

  const getSchoolLocation = () => {
    if (!canManageGps || gpsLocationLoading) return;
    if (gpsCoordinateCandidate) {
      setGpsLocationMessage('Abandonnez la position candidate avant de lancer une nouvelle acquisition.');
      return;
    }
    if (window.isSecureContext === false) {
      setGpsLocationMessage('La géolocalisation nécessite une connexion sécurisée (HTTPS ou localhost).');
      return;
    }
    if (currentDocumentAllowsGeolocation() === false) {
      setGpsLocationMessage('La géolocalisation est bloquée par la politique de sécurité de cette page. Ouvrez EcoleTrack depuis sa page principale sur la même origine.');
      return;
    }
    if (!navigator.geolocation?.watchPosition) {
      setGpsLocationMessage('La géolocalisation n’est pas disponible sur cet appareil.');
      return;
    }

    const gpsDebugRunId = beginGpsDebugRun('school-admin', 'Acquisition automatique pour configuration');
    gpsAdminDebugRunIdRef.current = gpsDebugRunId;
    const generation = gpsAcquisitionGenerationRef.current + 1;
    gpsAcquisitionGenerationRef.current = generation;
    const acquisition: ActiveGpsAcquisition = {
      generation,
      batchNumber: 0,
      samples: [],
      watchId: null,
      timeoutId: null,
    };
    let debugReadingSequence = 0;
    gpsAcquisitionRef.current = acquisition;
    setGpsLocationLoading(true);
    setGpsLocationMessage('Acquisition de trois mesures GPS fraîches…');

    const finish = (message: string) => {
      if (gpsAcquisitionRef.current !== acquisition || generation !== gpsAcquisitionGenerationRef.current) return;
      clearGpsAcquisitionResources(acquisition);
      gpsAcquisitionRef.current = null;
      setGpsLocationLoading(false);
      setGpsLocationMessage(message);
    };

    const beginBatch = (batchNumber: number) => {
      if (gpsAcquisitionRef.current !== acquisition || generation !== gpsAcquisitionGenerationRef.current) return;
      acquisition.batchNumber = batchNumber;
      acquisition.samples = [];
      setGpsLocationMessage(batchNumber === 0
        ? 'Acquisition de trois mesures GPS fraîches…'
        : 'Mesures contradictoires; nouvelle série bornée de trois mesures…');
      const batchStartedAt = Date.now();
      acquisition.timeoutId = window.setTimeout(() => {
        finish('Délai dépassé avant d’obtenir trois mesures GPS valides. Aucune nouvelle position n’a été sélectionnée; la position enregistrée est conservée. Réessayez ou saisissez la position manuellement.');
      }, GPS_ADMIN_BATCH_TIMEOUT_MS);

      let sampleRequestSequence = 0;
      const requestNextSample = () => {
        if (gpsAcquisitionRef.current !== acquisition
          || generation !== gpsAcquisitionGenerationRef.current
          || acquisition.batchNumber !== batchNumber) return;

        const requestSequence = ++sampleRequestSequence;
        const timeoutRemaining = Math.max(1, GPS_ADMIN_BATCH_TIMEOUT_MS - (Date.now() - batchStartedAt));
        try {
          acquisition.watchId = navigator.geolocation.watchPosition((position) => {
            if (gpsAcquisitionRef.current !== acquisition
              || generation !== gpsAcquisitionGenerationRef.current
              || acquisition.batchNumber !== batchNumber
              || requestSequence !== sampleRequestSequence) return;

            const { latitude: measuredLatitude, longitude: measuredLongitude, accuracy: accuracyMeters } = position.coords;
            const timestamp = position.timestamp;
            const ageMilliseconds = Date.now() - timestamp;
            const debugBase = gpsDebugRunId == null ? null : {
              acquisitionNumber: batchNumber * GPS_ADMIN_SAMPLE_COUNT + requestSequence,
              readingNumber: ++debugReadingSequence,
              batchNumber: batchNumber + 1,
              receivedAt: new Date().toISOString(),
              latitude: String(measuredLatitude),
              longitude: String(measuredLongitude),
              accuracyMeters: String(accuracyMeters),
              timestamp: String(timestamp),
              ageMilliseconds: String(ageMilliseconds),
            };
            const recordDiagnostic = (decision: string) => {
              if (debugBase) appendGpsDebugReading(gpsDebugRunId, { ...debugBase, decision });
            };
            if (!Number.isFinite(measuredLatitude) || measuredLatitude < -90 || measuredLatitude > 90
              || !Number.isFinite(measuredLongitude) || measuredLongitude < -180 || measuredLongitude > 180
              || !Number.isFinite(accuracyMeters) || accuracyMeters < 0
              || !Number.isFinite(timestamp) || ageMilliseconds < 0 || ageMilliseconds > GPS_ADMIN_MAX_SAMPLE_AGE_MS) {
              recordDiagnostic('Rejeté : coordonnées, précision ou horodatage invalide/périmé.');
              setGpsLocationMessage('Mesure rejetée : coordonnées, précision ou horodatage invalides ou trop anciens.');
              return;
            }

            const maxGpsAccuracyMeters = gpsSettings?.maxGpsAccuracyMeters ?? MAX_GPS_ACCURACY_METERS;
            if (!Number.isSafeInteger(maxGpsAccuracyMeters)
              || maxGpsAccuracyMeters < 1
              || maxGpsAccuracyMeters > MAX_CONFIGURABLE_GPS_ACCURACY_METERS) {
              finish('Le seuil de précision GPS configuré est invalide. Aucune position candidate n’a été sélectionnée.');
              return;
            }
            if (accuracyMeters > maxGpsAccuracyMeters) {
              recordDiagnostic(`Rejeté : précision supérieure au seuil configuré de ${maxGpsAccuracyMeters} m.`);
              setGpsLocationMessage(`Mesure rejetée : précision ${Math.ceil(accuracyMeters)} m, supérieure au seuil configuré de ${maxGpsAccuracyMeters} m.`);
              return;
            }

            const previousSample = acquisition.samples[acquisition.samples.length - 1];
            if (previousSample && timestamp <= previousSample.timestamp) {
              recordDiagnostic('Rejeté : l’horodatage ne progresse pas par rapport au relevé précédent.');
              return;
            }
            acquisition.samples.push({
              latitude: measuredLatitude,
              longitude: measuredLongitude,
              accuracyMeters,
              timestamp,
            });
            recordDiagnostic(`Admissible dans la série ${batchNumber + 1}; cohérence à vérifier.`);
            setGpsLocationMessage(`Mesure ${acquisition.samples.length}/${GPS_ADMIN_SAMPLE_COUNT} reçue; précision annoncée ${Math.ceil(accuracyMeters)} m.`);
            if (acquisition.samples.length < GPS_ADMIN_SAMPLE_COUNT) {
              if (acquisition.watchId != null) navigator.geolocation.clearWatch(acquisition.watchId);
              acquisition.watchId = null;
              requestNextSample();
              return;
            }

            const samples = [...acquisition.samples];
            if (samples.some((sample) => {
              const sampleAgeMilliseconds = Date.now() - sample.timestamp;
              return sampleAgeMilliseconds < 0 || sampleAgeMilliseconds > GPS_ADMIN_MAX_SAMPLE_AGE_MS;
            })) {
              finish('Une mesure est devenue trop ancienne pendant la série. Aucune position candidate n’a été sélectionnée; relancez l’acquisition.');
              return;
            }
            const maxSpreadMeters = maximumGpsSampleSpreadMeters(samples);
            if (maxSpreadMeters <= GPS_ADMIN_MAX_SPREAD_METERS) {
              const latitude = samples.reduce((sum, sample) => sum + sample.latitude, 0) / samples.length;
              const longitude = samples.reduce((sum, sample) => sum + sample.longitude, 0) / samples.length;
              const mapKey = gpsMapCandidateKeySequenceRef.current + 1;
              gpsMapCandidateKeySequenceRef.current = mapKey;
              gpsMapCandidateKeyRef.current = mapKey;
              setGpsMapAvailability({ candidateKey: mapKey, status: 'loading' });
              setGpsCoordinateCandidate({
                mapKey,
                source: 'automatic',
                latitude: latitude.toFixed(6),
                longitude: longitude.toFixed(6),
                confirmed: false,
                samples,
                maxSpreadMeters,
              });
              selectGpsDebugFix(gpsDebugRunId, {
                latitude: latitude.toFixed(6),
                longitude: longitude.toFixed(6),
                accuracyMeters: 'moyenne de trois relevés; voir les précisions brutes',
                timestamp: 'coordonnées moyennées; voir les timestamps bruts',
              });
              finish(`Trois mesures cohérentes obtenues; écart maximal ${maxSpreadMeters} m. Vérifiez la carte et confirmez l’emplacement avant l’enregistrement.`);
              return;
            }

            clearGpsAcquisitionResources(acquisition);
            if (batchNumber + 1 < GPS_ADMIN_MAX_BATCHES) {
              setGpsLocationMessage(`Écart maximal de ${maxSpreadMeters} m (limite ${GPS_ADMIN_MAX_SPREAD_METERS} m); une seule nouvelle série est tentée.`);
              beginBatch(batchNumber + 1);
              return;
            }
            finish(`Les mesures restent contradictoires (écart maximal ${maxSpreadMeters} m). Aucune position n’a été sélectionnée; vérifiez manuellement l’emplacement.`);
          }, (geoError) => {
            if (gpsAcquisitionRef.current !== acquisition
              || generation !== gpsAcquisitionGenerationRef.current
              || acquisition.batchNumber !== batchNumber
              || requestSequence !== sampleRequestSequence) return;
            const message = geoError.code === geoError.PERMISSION_DENIED
              ? currentDocumentAllowsGeolocation() === false
                ? 'La géolocalisation est bloquée par la politique de sécurité de cette page.'
                : 'Le navigateur a refusé la géolocalisation. Aucune nouvelle position n’a été sélectionnée; la position enregistrée est conservée. Vérifiez l’autorisation du site puis réessayez.'
              : geoError.code === geoError.POSITION_UNAVAILABLE
                ? 'Position indisponible. Aucune nouvelle position n’a été sélectionnée; la position enregistrée est conservée. Vérifiez que la localisation de l’appareil est activée puis réessayez.'
                : geoError.code === geoError.TIMEOUT
                  ? 'Délai dépassé lors de l’acquisition GPS. Aucune nouvelle position n’a été sélectionnée; la position enregistrée est conservée. Réessayez.'
                  : 'Erreur inattendue lors de l’acquisition GPS. Aucune nouvelle position n’a été sélectionnée; la position enregistrée est conservée. Réessayez.';
            finish(message);
          }, {
            enableHighAccuracy: true,
            maximumAge: 0,
            timeout: timeoutRemaining,
          });
        } catch (acquisitionError) {
          finish(acquisitionError instanceof Error
            ? `Impossible de démarrer l’acquisition GPS : ${acquisitionError.message}`
            : 'Impossible de démarrer l’acquisition GPS. Réessayez.');
        }
      };

      requestNextSample();
    };

    beginBatch(0);
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

  const getReportPeriodLabel = (from: string, to: string) => {
    const formatDate = (value: string) => new Intl.DateTimeFormat('fr-FR', {
      timeZone: 'UTC',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).format(new Date(`${value}T00:00:00.000Z`));
    return `Du ${formatDate(from)} au ${formatDate(to)}`;
  };

  const downloadBlob = (blob: Blob, filename: string) => {
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(objectUrl);
  };

  const exportTeacherHours = async (format: 'excel' | 'pdf') => {
    if (reportExportInFlight.current) return;
    reportExportInFlight.current = true;
    setExportingReport(format);
    setError(null);
    setSuccess(null);
    try {
      if (!reportSelection.from || !reportSelection.to || reportSelection.from > reportSelection.to) {
        throw new Error('Sélectionnez une date de début et une date de fin valides pour le relevé.');
      }
      if (!isTeacher && !reportSelection.teacherId) {
        throw new Error('Sélectionnez un enseignant ou « Tous les enseignants » avant le téléchargement.');
      }

      const selectedTeacherId = !isTeacher && reportSelection.teacherId !== 'all'
        ? Number(reportSelection.teacherId)
        : null;
      if (selectedTeacherId != null && !Number.isSafeInteger(selectedTeacherId)) {
        throw new Error('L’enseignant sélectionné est invalide.');
      }
      const selectedTeacher = selectedTeacherId == null
        ? undefined
        : reportTeacherOptions.find((teacher) => teacher.teacherId === selectedTeacherId);
      if (selectedTeacherId != null && !selectedTeacher) {
        throw new Error('L’enseignant sélectionné n’est pas disponible dans ce périmètre.');
      }

      const params = new URLSearchParams();
      params.set('from', `${reportSelection.from}T00:00:00.000Z`);
      params.set('to', `${reportSelection.to}T23:59:59.999Z`);
      params.set('status', 'completed');
      params.set('limit', '100');
      if (isSuperAdmin && schoolId != null) params.set('schoolId', String(schoolId));
      if (selectedTeacherId != null) params.set('teacherId', String(selectedTeacherId));

      const sessions: Session[] = [];
      const cursors = new Set<string>();
      let expectedTotal: number | null = null;
      while (true) {
        const page = await apiFetch(`/api/teacher-control/sessions?${params.toString()}`) as SessionPage;
        if (!page || !Array.isArray(page.items) || typeof page.totalCount !== 'number') {
          throw new Error('La réponse des séances est invalide ; le relevé ne peut pas être généré.');
        }
        if (expectedTotal == null) expectedTotal = page.totalCount;
        sessions.push(...page.items);
        if (!page.nextCursor) {
          if (page.hasMore) throw new Error('La pagination des séances est incomplète ; réessayez le téléchargement.');
          break;
        }
        if (cursors.has(page.nextCursor)) {
          throw new Error('La pagination des séances est incohérente ; réessayez le téléchargement.');
        }
        cursors.add(page.nextCursor);
        params.set('cursor', page.nextCursor);
      }
      if (expectedTotal !== sessions.length) {
        throw new Error('Le nombre de séances reçues ne correspond pas au relevé complet ; réessayez le téléchargement.');
      }

      const emptyTeacher: TeacherHoursReportIdentity | undefined = isTeacher
        ? {
          schoolId: schoolId ?? 0,
          schoolName: selectedSchool?.name ?? `Établissement #${schoolId ?? 0}`,
          teacherId: currentTeacherId ?? 0,
          teacherName: currentTeacherName?.trim() || 'Enseignant',
        }
        : selectedTeacher;
      const report = buildTeacherHoursReport(sessions, {
        periodLabel: getReportPeriodLabel(reportSelection.from, reportSelection.to),
        scopeLabel: selectedSchool?.name ?? (isSuperAdmin ? 'Tous les établissements' : 'Établissement'),
        emptyTeacher,
        teachers: !isTeacher && reportSelection.teacherId === 'all' ? reportTeacherOptions : undefined,
        includeGeneralSummary: !isTeacher && reportSelection.teacherId === 'all',
      });
      const data = format === 'excel'
        ? await createTeacherHoursExcel(report)
        : await createTeacherHoursPdf(report);
      const mimeType = format === 'excel'
        ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        : 'application/pdf';
      const extension = format === 'excel' ? 'xlsx' : 'pdf';
      const filename = `releve-heures-effectuees-${new Date().toISOString().slice(0, 10)}.${extension}`;
      downloadBlob(new Blob([data], { type: mimeType }), filename);
      setSuccess(`Le relevé a été téléchargé au format ${format === 'excel' ? 'Excel' : 'PDF'}.`);
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : 'Impossible de générer le relevé.');
    } finally {
      reportExportInFlight.current = false;
      setExportingReport(null);
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

  if (viewMode === 'regularizations') {
    return (
      <section className="space-y-5" aria-label={isTeacher ? 'Régularisations en attente' : 'Régularisations à traiter'}>
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-slate-900">
              {isTeacher ? 'Régularisations en attente' : 'Régularisations à traiter'}
            </h1>
            <p className="mt-1 text-sm text-slate-600">
              {isTeacher
                ? 'Consultez le statut et l’historique de vos demandes.'
                : 'Examinez les demandes et enregistrez une décision.'}
            </p>
          </div>
          <button type="button" className={secondaryButtonClass} disabled={loading} onClick={() => void loadData()}>
            {loading && <RefreshCw className="h-4 w-4 animate-spin" />}
            Actualiser
          </button>
        </header>

        {error && <ErrorNotice message={error} />}
        {success && <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{success}</p>}
        {GPS_DIAGNOSTICS_ENABLED && gpsDebugSnapshot?.pathway === 'teacher' && (
          <GpsDiagnosticsPanel snapshot={gpsDebugSnapshot} />
        )}
        {loading && <p role="status" className="text-sm text-slate-500">Chargement des régularisations…</p>}
        {!loading && visibleRegularizations.length === 0 && (
          <EmptyState>{isTeacher ? 'Vous n’avez aucune demande de régularisation.' : 'Aucune demande de régularisation à afficher.'}</EmptyState>
        )}

        {visibleRegularizations.map((entry) => (
          <article key={entry.request.id} className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-bold text-slate-900">
                  {regularizationTypeLabel(entry.request.requestType)}
                  {!isTeacher && entry.request.teacherNameSnapshot ? ` · ${entry.request.teacherNameSnapshot}` : ''}
                  {entry.request.schoolNameSnapshot ? ` · ${entry.request.schoolNameSnapshot}` : ''}
                  {` · Demande #${entry.request.id}`}
                </p>
                {entry.request.requestType === 'incomplete_session' ? (
                  <p className="mt-1 text-sm text-slate-600">
                    Séance #{entry.request.sessionId} · fin proposée {formatLomeDate(entry.request.proposedEndedAt)}
                  </p>
                ) : (
                  <div className="mt-1 space-y-1 text-sm text-slate-600">
                    <p>{entry.request.classNameSnapshot || 'Classe non précisée'} · {entry.request.subjectNameSnapshot || 'Matière non précisée'}</p>
                    <p>
                      {entry.request.requestType === 'immediate_report'
                        ? `Signalement et début de référence : ${formatLomeDate(entry.request.referenceStartedAt)}`
                        : `Début déclaré : ${formatLomeDate(entry.request.declaredStartedAt)}`}
                    </p>
                    <p>Fin déclarée : {formatLomeDate(entry.request.proposedEndedAt)}</p>
                    {entry.request.incidentType && <p>Origine : {incidentTypeLabel(entry.request.incidentType)}</p>}
                    {(entry.request.gpsLatitude != null || entry.request.gpsLongitude != null) && (
                      <p className="text-xs text-amber-800">
                        Position déclarée : {entry.request.gpsLatitude ?? '—'}, {entry.request.gpsLongitude ?? '—'} · précision {entry.request.gpsAccuracyMeters ?? '—'} m.
                      </p>
                    )}
                  </div>
                )}
                {entry.request.sessionId != null && (
                  <p className="mt-1 text-sm text-slate-600">Séance concernée : #{entry.request.sessionId}</p>
                )}
                <p className="mt-1 text-sm text-slate-600">Demandée le {formatLomeDate(entry.request.createdAt)}</p>
                <p className="mt-2 text-sm text-slate-700">Motif : {entry.request.reason}</p>
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
                <TeacherImmediateReportCompletion
                  request={entry.request}
                  reason={completionReasons[entry.request.id] ?? ''}
                  description={unrecordedCompletionDescription[entry.request.id] ?? ''}
                  busy={busyAction != null}
                  gpsAcquisitionMessage={busyAction === `complete-report-${entry.request.id}`
                    && (gpsStatus === 'locating' || gpsStatus === 'improving')
                    ? gpsStatusLabel(gpsStatus, gpsReading, gpsStatusDetail)
                    : null}
                  gpsDiagnosticMessage={gpsDiagnostic
                    ? teacherGpsDiagnosticLabel(gpsDiagnostic, gpsReading)
                    : null}
                  onCancelGps={cancelTeacherGpsAcquisition}
                  onReasonChange={(value) => setCompletionReasons((current) => ({ ...current, [entry.request.id]: value }))}
                  onDescriptionChange={(value) => setUnrecordedCompletionDescription((current) => ({ ...current, [entry.request.id]: value }))}
                  onSubmit={(mode) => void completeImmediateRegularization(entry.request, mode)}
                />
            )}

            {canManageSchoolControl && entry.request.status === 'pending' && (
              <div className="mt-4 grid gap-3 rounded-xl border border-indigo-100 bg-indigo-50/50 p-3">
                <label className="text-xs font-semibold text-slate-700">
                  Heure de début retenue · heure de Lomé
                  <input
                    type="datetime-local"
                    className={`${inputClass} mt-1`}
                    value={regularizationStartTimes[entry.request.id]
                      ?? formatLomeInput(new Date(entry.request.sessionId != null
                        ? entry.request.linkedSessionStartedAt
                          ?? sessions.find((session) => session.id === entry.request.sessionId)?.startedAt
                          ?? entry.request.referenceStartedAt ?? entry.request.createdAt
                        : entry.request.referenceStartedAt ?? entry.request.declaredStartedAt ?? entry.request.createdAt))}
                    max={formatLomeInput()}
                    onChange={(event) => setRegularizationStartTimes((current) => ({ ...current, [entry.request.id]: event.target.value }))}
                  />
                </label>
                <label className="text-xs font-semibold text-slate-700">
                  Heure de fin modifiée (facultative sauf acceptation après modification)
                  <input
                    type="datetime-local"
                    className={`${inputClass} mt-1`}
                    value={regularizationEndTimes[entry.request.id] ?? (entry.request.proposedEndedAt ? formatLomeInput(new Date(entry.request.proposedEndedAt)) : '')}
                    max={formatLomeInput()}
                    onChange={(event) => setRegularizationEndTimes((current) => ({ ...current, [entry.request.id]: event.target.value }))}
                  />
                </label>
                <label className="text-xs font-semibold text-slate-700">
                  Motif (obligatoire pour refus ou modification)
                  <textarea
                    className={`${inputClass} mt-1 min-h-20`}
                    value={regularizationReasons[entry.request.id] ?? ''}
                    onChange={(event) => setRegularizationReasons((current) => ({ ...current, [entry.request.id]: event.target.value }))}
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
      </section>
    );
  }

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
            {activeTab === 'requests' && (
              <section className="space-y-3" aria-label="Régularisations à traiter">
                <h2 className="font-bold text-slate-900">Régularisations à traiter · tous les établissements</h2>
                {regularizations.length === 0 ? (
                  <EmptyState>Aucune demande de régularisation.</EmptyState>
                ) : regularizations.map(({ request }) => (
                  <article key={request.id} className="rounded-2xl border border-slate-200 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="font-bold text-slate-900">
                          {regularizationTypeLabel(request.requestType)} · {request.teacherNameSnapshot} · {request.schoolNameSnapshot} · Demande #{request.id}
                        </p>
                        <p className="mt-1 text-sm text-slate-600">
                          {request.classNameSnapshot ?? (request.sessionId == null ? 'Séance non enregistrée' : `Séance #${request.sessionId}`)}
                          {request.subjectNameSnapshot ? ` · ${request.subjectNameSnapshot}` : ''}
                          {` · Demandée le ${formatLomeDate(request.createdAt)}`}
                        </p>
                        <p className="mt-2 text-sm text-slate-700">Motif : {request.reason}</p>
                      </div>
                      <StatusBadge status={request.status} />
                    </div>
                    {request.status === 'pending' && (
                      <div className="mt-4 flex flex-wrap items-end gap-3">
                        <label className="min-w-56 flex-1 text-xs font-semibold text-slate-700">
                          Motif de refus (obligatoire pour refuser)
                          <input
                            className={`${inputClass} mt-1`}
                            value={regularizationReasons[request.id] ?? ''}
                            onChange={(event) => setRegularizationReasons((current) => ({ ...current, [request.id]: event.target.value }))}
                          />
                        </label>
                        <button type="button" className={buttonClass} disabled={busyAction != null} onClick={() => void decideRegularization(request, 'accepted')}>
                          Accepter
                        </button>
                        <button type="button" className={secondaryButtonClass} disabled={busyAction != null || !regularizationReasons[request.id]?.trim()} onClick={() => void decideRegularization(request, 'rejected')}>
                          Refuser
                        </button>
                      </div>
                    )}
                  </article>
                ))}
              </section>
            )}
            <div className="space-y-4 bg-[radial-gradient(circle_at_top_left,_rgba(99,102,241,0.10),_transparent_28%),radial-gradient(circle_at_bottom_right,_rgba(56,189,248,0.12),_transparent_30%)] p-1 md:p-2">
              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" data-testid="teacher-control-statistics-grid">
                <StatCard label="Séances" value={String(globalStatistics.totalSessions)} detail={`${globalStatistics.openSessions} en cours · ${globalStatistics.incompleteSessions} sans fin validée`} tone="indigo" icon={CalendarClock} />
                <StatCard label="Séances terminées" value={String(globalStatistics.completedSessions)} detail={`${globalStatistics.regularizedSessions} régularisée(s)`} tone="emerald" icon={ShieldCheck} />
                <StatCard label="Durée validée" value={formatDuration(globalStatistics.validatedDurationMilliseconds)} tone="sky" icon={Clock3} />
                <StatCard label="Rémunération validée" value={formatAmount(globalStatistics.estimatedCompensationXof)} detail={`${globalStatistics.pendingRegularizations} demande(s) en attente`} tone="amber" icon={Banknote} />
              </div>
              <p className="rounded-2xl border border-slate-200/80 bg-white/70 px-4 py-3 text-xs text-slate-600 shadow-[0_10px_25px_rgba(15,23,42,0.05)] backdrop-blur-sm">
                Durées comptabilisées : GPS {formatDuration(globalStatistics.gpsDurationMilliseconds ?? 0)} ({globalStatistics.gpsCompletedSessions ?? 0} séances) · régularisation après séance incomplète {formatDuration(globalStatistics.incompleteRegularizedDurationMilliseconds ?? 0)} ({globalStatistics.incompleteSessionRegularizations ?? 0}) · signalements immédiats {formatDuration(globalStatistics.immediateRegularizedDurationMilliseconds ?? 0)} ({globalStatistics.immediateRegularizedSessions ?? 0}) · déclarations tardives {formatDuration(globalStatistics.lateRegularizedDurationMilliseconds ?? 0)} ({globalStatistics.lateRegularizedSessions ?? 0}).
              </p>
            </div>
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
            <TeacherHoursReportControls
              isTeacher={isTeacher}
              teachers={reportTeacherOptions}
              selection={reportSelection}
              setSelection={setReportSelection}
              exporting={exportingReport}
              disabled={loading || filterResultsLoading || sessionFilterOptionsLoading}
              onExport={(format) => void exportTeacherHours(format)}
            />
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

      {statistics && (
        <div className="space-y-4 bg-[radial-gradient(circle_at_top_left,_rgba(99,102,241,0.10),_transparent_28%),radial-gradient(circle_at_bottom_right,_rgba(56,189,248,0.12),_transparent_30%)] p-1 md:p-2">
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" data-testid="teacher-control-statistics-grid">
            <StatCard label="Séances" value={String(statistics.totalSessions)} detail={`${statistics.openSessions} en cours`} tone="indigo" icon={CalendarClock} />
            <StatCard label="Séances terminées" value={String(statistics.completedSessions)} detail={`${statistics.incompleteSessions} sans fin validée · ${statistics.regularizedSessions} régularisée(s)`} tone="emerald" icon={ShieldCheck} />
            <StatCard label="Durée validée" value={formatDuration(statistics.validatedDurationMilliseconds)} tone="sky" icon={Clock3} />
            <StatCard label="Montant validé" value={formatAmount(statistics.estimatedCompensationXof)} detail={`${statistics.pendingRegularizations} demande(s) en attente · fins validées uniquement`} tone="amber" icon={Banknote} />
          </div>
          <p className="rounded-2xl border border-slate-200/80 bg-white/70 px-4 py-3 text-xs text-slate-600 shadow-[0_10px_25px_rgba(15,23,42,0.05)] backdrop-blur-sm">
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
            onClick={() => {
              if (id === 'requests' && activeTab !== 'requests' && !(isSuperAdmin && schoolId == null)) {
                void refreshRegularizations();
              }
              setActiveTab(id);
              onTabChange?.(id);
            }}
            className={`inline-flex shrink-0 items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold transition ${
              activeTab === id ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <Icon className="h-4 w-4" /> {label}
          </button>
        ))}
      </div>

      {GPS_DIAGNOSTICS_ENABLED && gpsDebugSnapshot && (
        <GpsDiagnosticsPanel snapshot={gpsDebugSnapshot} />
      )}

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
                    {loading ? 'Chargement de vos associations pédagogiques…' : assignmentLoadErrorMessage}
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
                    {gpsStatusLabel(gpsStatus, gpsReading, gpsStatusDetail)}
                  </p>
                  {gpsDiagnostic && (
                    <p role="status" aria-live="polite" className="text-sm text-rose-700">
                      {teacherGpsDiagnosticLabel(gpsDiagnostic, gpsReading)}
                    </p>
                  )}
                  {(gpsStatus === 'locating' || gpsStatus === 'improving') && busyAction === 'start' && (
                    <button type="button" className={secondaryButtonClass} onClick={cancelTeacherGpsAcquisition}>
                      Annuler la recherche GPS
                    </button>
                  )}
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
                          }`}>{gpsStatusLabel(gpsStatus, gpsReading, gpsStatusDetail)}</p>
                          {gpsDiagnostic && (
                            <p role="status" aria-live="polite" className="text-sm text-rose-700">
                              {teacherGpsDiagnosticLabel(gpsDiagnostic, gpsReading)}
                            </p>
                          )}
                          {(gpsStatus === 'locating' || gpsStatus === 'improving')
                            && busyAction === `end-${selectedOpenSession.id}` && (
                            <button type="button" className={secondaryButtonClass} onClick={cancelTeacherGpsAcquisition}>
                              Annuler la recherche GPS
                            </button>
                          )}
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
          <TeacherHoursReportControls
            isTeacher={isTeacher}
            teachers={reportTeacherOptions}
            selection={reportSelection}
            setSelection={setReportSelection}
            exporting={exportingReport}
            disabled={loading || filterResultsLoading || sessionFilterOptionsLoading}
            onExport={(format) => void exportTeacherHours(format)}
          />

          {isTeacher && sessions.some((session) => session.status === 'open' && !regularizations.some((entry) => entry.request.sessionId === session.id && entry.request.status === 'pending')) && (
            <TeacherRegularizationForms
              sessions={sessions.filter((session) => session.status === 'open')}
              regularizations={regularizations}
              requestReasons={requestReasons}
              busyAction={busyAction}
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
                    isSchoolAdmin={canManageSchoolControl}
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

          {selectedSession && canManageSchoolControl && selectedSession.status === 'completed' && (
            <SessionTimeCorrectionForm
              key={`${selectedSession.id}:${selectedSession.startedAt}:${selectedSession.validatedEndedAt}`}
              session={selectedSession}
              busy={busyAction === `correct-session-${selectedSession.id}`}
              disabled={busyAction != null}
              onSubmit={(correction) => void correctCompletedSession(selectedSession, correction)}
            />
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
                      <p>Fin déclarée : {formatLomeDate(entry.request.proposedEndedAt)}</p>
                      {entry.request.incidentType && <p>Origine : {incidentTypeLabel(entry.request.incidentType)}</p>}
                      {(entry.request.gpsLatitude != null || entry.request.gpsLongitude != null) && (
                        <p className="text-xs text-amber-800">
                          Position fournie lors de la tentative, non vérifiée par le contrôle GPS : {entry.request.gpsLatitude ?? '—'}, {entry.request.gpsLongitude ?? '—'} · précision déclarée {entry.request.gpsAccuracyMeters ?? '—'} m.
                        </p>
                      )}
                    </div>
                  )}
                  {entry.request.sessionId != null && (
                    <p className="mt-1 text-sm text-slate-600">Séance concernée : #{entry.request.sessionId}</p>
                  )}
                  <p className="mt-1 text-sm text-slate-600">Demandée le {formatLomeDate(entry.request.createdAt)}</p>
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
                    <TeacherImmediateReportCompletion
                      request={entry.request}
                      reason={completionReasons[entry.request.id] ?? ''}
                      description={unrecordedCompletionDescription[entry.request.id] ?? ''}
                      busy={busyAction != null}
                      gpsAcquisitionMessage={busyAction === `complete-report-${entry.request.id}`
                        && (gpsStatus === 'locating' || gpsStatus === 'improving')
                        ? gpsStatusLabel(gpsStatus, gpsReading, gpsStatusDetail)
                        : null}
                      gpsDiagnosticMessage={gpsDiagnostic
                        ? teacherGpsDiagnosticLabel(gpsDiagnostic, gpsReading)
                        : null}
                      onCancelGps={cancelTeacherGpsAcquisition}
                      onReasonChange={(value) => setCompletionReasons((current) => ({ ...current, [entry.request.id]: value }))}
                      onDescriptionChange={(value) => setUnrecordedCompletionDescription((current) => ({ ...current, [entry.request.id]: value }))}
                      onSubmit={(mode) => void completeImmediateRegularization(entry.request, mode)}
                    />
                  )}
                {canManageSchoolControl && entry.request.status === 'pending' && (
                  <div className="mt-4 grid gap-3 rounded-xl border border-indigo-100 bg-indigo-50/50 p-3">
                    <label className="text-xs font-semibold text-slate-700">
                      Heure de début retenue · heure de Lomé
                      <input
                        type="datetime-local"
                        className={`${inputClass} mt-1`}
                        value={regularizationStartTimes[entry.request.id]
                          ?? formatLomeInput(new Date(entry.request.sessionId != null
                            ? entry.request.linkedSessionStartedAt
                              ?? sessions.find((session) => session.id === entry.request.sessionId)?.startedAt
                              ?? entry.request.referenceStartedAt ?? entry.request.createdAt
                            : entry.request.referenceStartedAt ?? entry.request.declaredStartedAt ?? entry.request.createdAt))}
                        max={formatLomeInput()}
                        onChange={(event) => setRegularizationStartTimes((current) => ({ ...current, [entry.request.id]: event.target.value }))}
                      />
                    </label>
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
              <p className="mt-1 text-sm text-slate-600">Le rayon est indépendant de la précision maximale acceptée ({gpsSettings?.maxGpsAccuracyMeters ?? MAX_GPS_ACCURACY_METERS} m). Aucun rayon n’est augmenté automatiquement.</p>
            </div>
          </div>
          {gpsSettings && (
            <section aria-labelledby="gps-radius-title" className="rounded-2xl border border-indigo-200 bg-indigo-50/50 p-4">
              <h3 id="gps-radius-title" className="font-bold text-slate-900">Rayon de présence de l’établissement</h3>
              <p className="mt-1 text-sm text-slate-600">Ce rayon détermine la distance maximale entre l’enseignant et l’établissement. Il est distinct de la précision GPS maximale de {gpsSettings.maxGpsAccuracyMeters ?? MAX_GPS_ACCURACY_METERS} m.</p>
              <form className="mt-4 flex flex-wrap items-end gap-3" onSubmit={(event) => void saveGeofenceRadius(event)}>
                <label className="flex flex-col text-sm font-semibold text-slate-700">Rayon de présence (mètres)
                  <input
                    className={`${inputClass} mt-1 w-48`}
                    type="number"
                    step="1"
                    min="1"
                    max={MAX_GEOFENCE_RADIUS_METERS}
                    value={gpsRadius}
                    onChange={(event) => setGpsRadius(event.target.value)}
                    disabled={!canManageGps || busyAction != null}
                    required
                  />
                </label>
                <p className="pb-2 text-sm text-slate-600">Valeur actuellement enregistrée : <strong>{gpsSettings.geofenceRadiusMeters} m</strong> · maximum : {MAX_GEOFENCE_RADIUS_METERS} m</p>
                {canManageGps && (
                  <button className={buttonClass} type="submit" disabled={busyAction != null}>
                    {busyAction === 'gps-radius' ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                    Enregistrer le rayon
                  </button>
                )}
              </form>
            </section>
          )}
          {gpsSettings && (
            <section aria-labelledby="gps-accuracy-title" className="rounded-2xl border border-amber-200 bg-amber-50/50 p-4">
              <h3 id="gps-accuracy-title" className="font-bold text-slate-900">Précision GPS maximale acceptée</h3>
              <p className="mt-1 text-sm text-slate-600">Ce seuil contrôle la qualité de la mesure GPS. Il est indépendant du rayon de présence de l’établissement.</p>
              <form className="mt-4 flex flex-wrap items-end gap-3" onSubmit={(event) => void saveGpsAccuracyThreshold(event)}>
                <label className="flex flex-col text-sm font-semibold text-slate-700">Précision GPS maximale (mètres)
                  <input
                    className={`${inputClass} mt-1 w-48`}
                    type="number"
                    step="1"
                    min="1"
                    max={MAX_CONFIGURABLE_GPS_ACCURACY_METERS}
                    value={gpsAccuracyThreshold}
                    onChange={(event) => setGpsAccuracyThreshold(event.target.value)}
                    disabled={!canManageGps || busyAction != null}
                    required
                  />
                </label>
                <p className="pb-2 text-sm text-slate-600">Valeur actuellement enregistrée : <strong>{gpsSettings.maxGpsAccuracyMeters ?? MAX_GPS_ACCURACY_METERS} m</strong> · maximum configurable : {MAX_CONFIGURABLE_GPS_ACCURACY_METERS} m</p>
                {canManageGps && (
                  <button className={buttonClass} type="submit" disabled={busyAction != null}>
                    {busyAction === 'gps-accuracy' ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                    Enregistrer la précision
                  </button>
                )}
              </form>
            </section>
          )}
          {gpsSettings && (
            <form className="grid gap-4 rounded-2xl border border-slate-200 p-4 sm:grid-cols-2" onSubmit={(event) => void saveGpsSettings(event)}>
              <label className="flex items-center gap-3 rounded-xl bg-slate-50 p-3 text-sm font-semibold text-slate-800 sm:col-span-2">
                <input type="checkbox" checked={gpsForm.isEnabled} onChange={(event) => setGpsForm({ ...gpsForm, isEnabled: event.target.checked })} disabled={!canManageGps} />
                Contrôle GPS activé
              </label>
              <div className="rounded-xl bg-slate-50 p-3 text-sm text-slate-700 sm:col-span-2">
                <h3 className="font-semibold">Emplacement actuellement enregistré</h3>
                <p className="mt-1 break-words">
                  Latitude : {gpsSettings.latitude ?? 'Non définie'} · Longitude : {gpsSettings.longitude ?? 'Non définie'}
                </p>
              </div>
              <label className="flex min-w-0 flex-col text-sm font-semibold text-slate-700">Latitude de l’emplacement à enregistrer
                <input
                  className={`${inputClass} mt-1`}
                  type="number"
                  step="any"
                  min="-90"
                  max="90"
                  value={gpsCandidateLatitude}
                  onChange={(event) => updateManualGpsCoordinate('latitude', event.target.value)}
                  disabled={!canManageGps || busyAction != null}
                />
              </label>
              <label className="flex min-w-0 flex-col text-sm font-semibold text-slate-700">Longitude de l’emplacement à enregistrer
                <input
                  className={`${inputClass} mt-1`}
                  type="number"
                  step="any"
                  min="-180"
                  max="180"
                  value={gpsCandidateLongitude}
                  onChange={(event) => updateManualGpsCoordinate('longitude', event.target.value)}
                  disabled={!canManageGps || busyAction != null}
                />
              </label>
              {canManageGps && (
                <div className="space-y-2 sm:col-span-2">
                  <p className="text-xs text-slate-500">
                    {gpsCoordinateCandidate
                      ? 'Nouvelle position candidate affichée; l’emplacement enregistré ne change qu’après confirmation et sauvegarde.'
                      : 'Position enregistrée : les champs affichent les coordonnées déjà sauvegardées. Aucune nouvelle position n’est retenue avant trois mesures GPS valides et cohérentes.'}
                  </p>
                  <button className={secondaryButtonClass} type="button" onClick={getSchoolLocation} disabled={gpsLocationLoading || busyAction != null || gpsCoordinateCandidate != null}>
                    {gpsLocationLoading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <MapPin className="h-4 w-4" />}
                    {gpsLocationLoading
                      ? 'Acquisition de mesures GPS…'
                      : gpsCoordinateCandidate
                        ? 'Abandonnez la candidate pour acquérir à nouveau'
                        : 'Obtenir ma position automatiquement'}
                  </button>
                  {gpsLocationLoading && (
                    <button
                      className={secondaryButtonClass}
                      type="button"
                      onClick={() => cancelGpsAcquisition('Acquisition annulée; les coordonnées enregistrées sont conservées.')}
                    >
                      Annuler l’acquisition
                    </button>
                  )}
                  {gpsLocationMessage && (
                    <p role="status" aria-live="polite" className="text-sm text-slate-600">{gpsLocationMessage}</p>
                  )}
                  <p className="text-xs text-slate-500">Effectuez cette action depuis l’établissement, puis vérifiez ou corrigez les coordonnées avant de les enregistrer.</p>
                </div>
              )}
              {(gpsCoordinateCandidate || canManageGps) && (
                <div ref={gpsCandidateBlockRef} className="space-y-3 rounded-xl border border-indigo-200 bg-indigo-50/50 p-4 sm:col-span-2">
                  {gpsCoordinateCandidate ? (
                    <>
                      <h3 className="font-semibold text-slate-900">
                        {gpsCoordinateCandidate.source === 'automatic'
                          ? 'Position GPS proposée'
                          : gpsCoordinateCandidate.source === 'google_maps'
                            ? 'Position candidate importée depuis Google Maps'
                            : 'Position candidate corrigée manuellement'}
                      </h3>
                      <p className="mt-1 text-sm text-slate-700">
                        Latitude : {gpsCoordinateCandidate.latitude} · Longitude : {gpsCoordinateCandidate.longitude}
                      </p>
                      {googleMapsCandidateUrl && (
                        <div className="mt-3 space-y-2">
                          <p className="text-sm text-slate-700">
                            Ouvrez Google Maps pour reconnaître les routes, commerces et bâtiments autour du point proposé. Revenez ensuite dans EcoleTrack pour confirmer ou corriger l’emplacement.
                          </p>
                          <a
                            className={secondaryButtonClass}
                            href={googleMapsCandidateUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            <MapPin className="h-4 w-4" />
                            Vérifier dans Google Maps
                          </a>
                          <p className="text-xs text-slate-500">
                            À l’ouverture, seules les coordonnées candidates sont transmises à Google; aucune donnée personnelle ni aucun jeton EcoleTrack ne sont ajoutés au lien.
                          </p>
                        </div>
                      )}
                      <p className="mt-1 text-sm text-slate-700">
                        Repérez l’établissement à l’aide des rues, quartiers, bâtiments et points de repère visibles. Les détails dépendent des données cartographiques disponibles.
                      </p>
                      {gpsCoordinateCandidate.samples.length > 0 && (
                        <p className="mt-1 text-sm text-slate-600">
                          {gpsCoordinateCandidate.samples.length} mesures; écart maximal {gpsCoordinateCandidate.maxSpreadMeters} m; précision annoncée maximale {Math.ceil(Math.max(...gpsCoordinateCandidate.samples.map((sample) => sample.accuracyMeters)))} m.
                          La précision ne garantit pas que le lieu corresponde à l’établissement.
                        </p>
                      )}
                      {gpsCandidateChangesLocation && !gpsCandidateCoordinates && (
                        <p role="alert" className="mt-1 text-sm text-rose-700">Renseignez une latitude et une longitude valides pour prévisualiser cette candidate.</p>
                      )}
                      {!gpsCandidateChangesLocation && (
                        <p className="mt-1 text-sm text-slate-600">Cette candidate correspond aux coordonnées enregistrées; elle ne bloque pas la modification des autres paramètres GPS.</p>
                      )}
                      {gpsCandidateCoordinates && (
                        <TeacherControlGpsMapPreview
                          key={gpsCoordinateCandidate.mapKey}
                          candidateKey={gpsCoordinateCandidate.mapKey}
                          latitude={gpsCandidateCoordinates.latitude}
                          longitude={gpsCandidateCoordinates.longitude}
                          onAvailabilityChange={handleGpsMapAvailabilityChange}
                          onPositionChange={handleGpsMapPositionChange}
                        />
                      )}
                      {gpsCandidateChangesLocation && (
                        <label className="flex items-start gap-2 text-sm font-semibold text-slate-800">
                          <input
                            type="checkbox"
                            checked={gpsCoordinateCandidate.confirmed}
                            disabled={busyAction != null || !gpsCandidateMapReady}
                            onChange={(event) => setGpsCoordinateCandidate((current) => current
                              ? { ...current, confirmed: event.target.checked }
                              : current)}
                          />
                          <span>Je confirme explicitement que le point affiché correspond à l’emplacement de cet établissement.</span>
                        </label>
                      )}
                      <button className={secondaryButtonClass} type="button" onClick={discardGpsCoordinateCandidate} disabled={busyAction != null}>
                        Abandonner la position candidate
                      </button>
                    </>
                  ) : (
                    <div>
                      <h3 className="font-semibold text-slate-900">Importer une position sans acquisition GPS</h3>
                      <p className="mt-1 text-sm text-slate-600">Aucune position candidate n’est active; les coordonnées enregistrées restent inchangées.</p>
                    </div>
                  )}
                  {canManageGps && (
                    <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-3">
                      <label className="flex flex-col text-sm font-semibold text-slate-700" htmlFor="gps-coordinate-import">
                        Coordonnées ou lien Google Maps
                        <input
                          id="gps-coordinate-import"
                          className={`${inputClass} mt-1`}
                          type="text"
                          autoComplete="off"
                          value={gpsCoordinateImportInput}
                          onChange={(event) => {
                            setGpsCoordinateImportInput(event.target.value);
                            setGpsCoordinateImportError('');
                          }}
                          disabled={busyAction != null}
                        />
                      </label>
                      <p className="text-xs text-slate-600">
                        Dans Google Maps, ouvrez l’établissement puis copiez ses coordonnées exactes (latitude, longitude) ou l’URL complète. Les liens raccourcis doivent être ouverts manuellement pour copier les coordonnées; ils ne sont pas résolus ici.
                      </p>
                      {gpsCoordinateImportError && (
                        <p role="alert" className="text-sm text-rose-700">{gpsCoordinateImportError}</p>
                      )}
                      <button
                        className={secondaryButtonClass}
                        type="button"
                        onClick={importGpsCoordinate}
                        disabled={busyAction != null || !gpsCoordinateImportInput.trim()}
                      >
                        Utiliser cette position
                      </button>
                    </div>
                  )}
                </div>
              )}
              {canManageGps && (
                <div className="sm:col-span-2">
                  <button
                    className={buttonClass}
                    type="submit"
                    disabled={busyAction != null
                      || gpsLocationLoading
                      || (gpsCandidateChangesLocation
                        && (!gpsCoordinateCandidate?.confirmed || !gpsCandidateMapReady))}
                  >
                    {busyAction === 'gps-settings' ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                    Enregistrer les coordonnées GPS
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
      : role === 'school_accountant' ? 'Secrétariat comptable de l’établissement'
        : 'Super Administrateur · consultation par établissement';
  return (
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-indigo-600">EcoleTrack · Suivi des séances</p>
        <h1 id="teacher-control-title" className="mt-1 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
          {role === 'teacher' ? 'Déclaration de présence' : 'Contrôle des enseignants'}
        </h1>
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

function TeacherHoursReportControls({
  isTeacher,
  teachers,
  selection,
  setSelection,
  exporting,
  disabled,
  onExport,
}: {
  isTeacher: boolean;
  teachers: ReportTeacherOption[];
  selection: ReportSelection;
  setSelection: Dispatch<SetStateAction<ReportSelection>>;
  exporting: 'excel' | 'pdf' | null;
  disabled: boolean;
  onExport: (format: 'excel' | 'pdf') => void;
}) {
  const isDisabled = disabled
    || exporting != null
    || !selection.from
    || !selection.to
    || selection.from > selection.to
    || (!isTeacher && !selection.teacherId);
  return (
    <div className="w-full space-y-3 rounded-xl border border-slate-200 bg-white p-3" aria-label="Paramètres du relevé d'heures">
      {!isTeacher && (
        <label className="block max-w-xl text-xs font-semibold text-slate-600">
          Enseignant ou périmètre du relevé
          <select
            className={`${inputClass} mt-1`}
            aria-label="Enseignant ou périmètre du relevé"
            required
            value={selection.teacherId}
            onChange={(event) => setSelection((current) => ({ ...current, teacherId: event.target.value }))}
            disabled={disabled || exporting != null}
          >
            <option value="">Sélectionnez un enseignant</option>
            <option value="all">Tous les enseignants</option>
            {teachers.map((teacher) => (
              <option key={`${teacher.schoolId}:${teacher.teacherId}`} value={teacher.teacherId}>
                {teachers.some((item) => item.schoolId !== teacher.schoolId)
                  ? `${teacher.teacherName} · ${teacher.schoolName}`
                  : teacher.teacherName}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-xs font-semibold text-slate-600">
          Date de début
          <input
            className={`${inputClass} mt-1`}
            type="date"
            aria-label="Date de début du relevé"
            required
            value={selection.from}
            onChange={(event) => setSelection((current) => ({ ...current, from: event.target.value }))}
            disabled={disabled || exporting != null}
          />
        </label>
        <label className="text-xs font-semibold text-slate-600">
          Date de fin
          <input
            className={`${inputClass} mt-1`}
            type="date"
            aria-label="Date de fin du relevé"
            required
            value={selection.to}
            onChange={(event) => setSelection((current) => ({ ...current, to: event.target.value }))}
            disabled={disabled || exporting != null}
          />
        </label>
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={secondaryButtonClass}
          disabled={isDisabled}
          onClick={() => onExport('excel')}
        >
          <FileSpreadsheet className="h-4 w-4" aria-hidden="true" />
          {exporting === 'excel' ? 'Génération Excel…' : 'Télécharger en Excel (.xlsx)'}
        </button>
        <button
          type="button"
          className={secondaryButtonClass}
          disabled={isDisabled}
          onClick={() => onExport('pdf')}
        >
          <FileText className="h-4 w-4" aria-hidden="true" />
          {exporting === 'pdf' ? 'Génération PDF…' : 'Télécharger en PDF'}
        </button>
      </div>
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
  requestReasons,
  busyAction,
  onReasonChange,
  onSubmit,
}: {
  sessions: Session[];
  regularizations: Regularization[];
  requestReasons: Record<number, string>;
  busyAction: string | null;
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
      <p className="mt-1 text-sm text-slate-600">L’heure de fin proposée est générée par le serveur lors de l’envoi. L’acceptation doit encore être décidée par l’administrateur d’établissement.</p>
      <div className="mt-4 grid gap-4">
        {openSessionsWithoutPending.map((session) => (
          <form key={session.id} className="grid gap-3 rounded-xl border border-white bg-white p-3 sm:grid-cols-[1fr_auto]" onSubmit={(event) => { event.preventDefault(); onSubmit(session); }}>
            <div className="text-sm">
              <p className="font-semibold text-slate-900">{session.classNameSnapshot} · {session.subjectNameSnapshot}</p>
              <p className="text-xs text-slate-500">Début : {formatLomeDate(session.startedAt)}</p>
            </div>
            <div className="flex items-end">
              <button type="submit" className={buttonClass} disabled={busyAction != null}>
                {busyAction === `regularize-${session.id}` ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                Envoyer
              </button>
            </div>
            <label className="text-xs font-semibold text-slate-700 sm:col-span-2">
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
        Les preuves GPS originales et les corrections d’heures sont conservées dans le journal détaillé de cette séance.
      </p>
    </section>
  );
}

function SessionTimeCorrectionForm({
  session,
  busy,
  disabled,
  onSubmit,
}: {
  session: Session;
  busy: boolean;
  disabled: boolean;
  onSubmit: (correction: { startedAt?: string; endedAt?: string; reason: string }) => void;
}) {
  const originalStartedAt = formatLomeInput(new Date(session.startedAt));
  const originalEndedAt = formatLomeInput(new Date(session.validatedEndedAt ?? session.startedAt));
  const [startedAtInput, setStartedAtInput] = useState(originalStartedAt);
  const [endedAtInput, setEndedAtInput] = useState(originalEndedAt);
  const [reason, setReason] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const startedAt = startedAtInput === originalStartedAt ? undefined : parseLomeInput(startedAtInput) ?? undefined;
    const endedAt = endedAtInput === originalEndedAt ? undefined : parseLomeInput(endedAtInput) ?? undefined;
    if (!startedAt && !endedAt) {
      setFormError('Modifiez au moins une heure avant l’enregistrement.');
      return;
    }
    if ((startedAtInput !== originalStartedAt && !startedAt) || (endedAtInput !== originalEndedAt && !endedAt)) {
      setFormError('Les heures corrigées doivent être valides.');
      return;
    }
    if (!reason.trim()) {
      setFormError('Le motif de correction est obligatoire.');
      return;
    }
    setFormError(null);
    onSubmit({ ...(startedAt ? { startedAt } : {}), ...(endedAt ? { endedAt } : {}), reason: reason.trim() });
  };

  return (
    <form className="grid gap-3 rounded-2xl border border-amber-200 bg-amber-50/60 p-4 sm:grid-cols-2" onSubmit={submit}>
      <h2 className="font-bold text-slate-900 sm:col-span-2">Corriger les heures de la séance terminée</h2>
      <label className="text-xs font-semibold text-slate-700">
        Début retenu · heure de Lomé
        <input
          type="datetime-local"
          className={`${inputClass} mt-1`}
          value={startedAtInput}
          max={formatLomeInput()}
          onChange={(event) => setStartedAtInput(event.target.value)}
          required
        />
      </label>
      <label className="text-xs font-semibold text-slate-700">
        Fin retenue · heure de Lomé
        <input
          type="datetime-local"
          className={`${inputClass} mt-1`}
          value={endedAtInput}
          min={startedAtInput}
          max={formatLomeInput()}
          onChange={(event) => setEndedAtInput(event.target.value)}
          required
        />
      </label>
      <label className="text-xs font-semibold text-slate-700 sm:col-span-2">
        Motif obligatoire
        <textarea
          className={`${inputClass} mt-1 min-h-16`}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          required
        />
      </label>
      {formError && <p role="alert" className="text-sm text-rose-700 sm:col-span-2">{formError}</p>}
      <div className="sm:col-span-2">
        <button type="submit" className={buttonClass} disabled={disabled || !reason.trim()}>
          {busy ? <RefreshCw className="h-4 w-4 animate-spin" /> : <CalendarClock className="h-4 w-4" />}
          Enregistrer et auditer la correction
        </button>
      </div>
    </form>
  );
}

function GpsDiagnosticsPanel({ snapshot }: { snapshot: GpsDebugSnapshot }) {
  const formatFix = (fix: GpsDebugFix) => (
    `lat ${fix.latitude}, lon ${fix.longitude} · précision ${fix.accuracyMeters} · timestamp ${fix.timestamp}`
  );
  return (
    <details open className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-xs text-slate-800">
      <summary className="cursor-pointer font-bold">
        Diagnostic GPS — développement uniquement · {snapshot.pathway === 'school-admin' ? 'School Admin' : 'Enseignant'} · {snapshot.action}
      </summary>
      <p className="mt-2">
        Local au navigateur; le panneau ne transmet ni ne journalise les coordonnées. Les requêtes métier affichées sont celles déjà nécessaires au parcours.
      </p>
      <p className="mt-2">
        Sélection après filtrage: {snapshot.selected ? formatFix(snapshot.selected) : 'aucune position sélectionnée'}
      </p>
      <p className="mt-1">
        Coordonnées utilisées pour la requête: {snapshot.used
          ? `${snapshot.used.endpoint} · ${formatFix(snapshot.used.fix)}`
          : 'aucune requête de validation/configuration envoyée'}
      </p>
      {snapshot.readings.length === 0 ? (
        <p className="mt-2">Aucun relevé reçu du navigateur pour cette acquisition.</p>
      ) : (
        <ol className="mt-3 space-y-2">
          {snapshot.readings.map((reading) => (
            <li
              key={`${snapshot.runId}-${reading.readingNumber}`}
              className="rounded-lg border border-amber-200 bg-white/80 p-2"
            >
              <p className="font-semibold">
                Acquisition {reading.acquisitionNumber} · série {reading.batchNumber} · relevé {reading.readingNumber}
              </p>
              <p>Brut navigateur: lat {reading.latitude}, lon {reading.longitude} · précision {reading.accuracyMeters} m</p>
              <p>Timestamp {reading.timestamp} · âge au traitement {reading.ageMilliseconds} ms · reçu à {reading.receivedAt}</p>
              <p>Filtrage: {reading.decision}</p>
            </li>
          ))}
        </ol>
      )}
    </details>
  );
}

function TeacherImmediateReportCompletion({
    request,
    reason,
    description,
    busy,
    gpsAcquisitionMessage,
    gpsDiagnosticMessage,
    onCancelGps,
    onReasonChange,
    onDescriptionChange,
    onSubmit,
}: {
    request: Regularization['request'];
    reason: string;
    description: string;
    busy: boolean;
    gpsAcquisitionMessage: string | null;
    gpsDiagnosticMessage: string | null;
    onCancelGps: () => void;
    onReasonChange: (value: string) => void;
    onDescriptionChange: (value: string) => void;
    onSubmit: (mode: 'gps' | 'regularization') => void;
}) {
    return (
      <div className="mt-4 grid gap-3 rounded-xl border border-amber-200 bg-amber-50/50 p-3 sm:grid-cols-2">
        <p className="text-sm text-slate-700 sm:col-span-2">
          Complétez la fin de séance. L’heure sera enregistrée par le serveur; aucune heure manuelle n’est demandée.
        </p>
        <label className="text-xs font-semibold text-slate-700">
          Motif obligatoire
          <textarea
            className={`${inputClass} mt-1 min-h-16`}
            value={reason}
            onChange={(event) => onReasonChange(event.target.value)}
            required
          />
        </label>
        <label className="text-xs font-semibold text-slate-700">
          Précision facultative
          <textarea
            className={`${inputClass} mt-1 min-h-16`}
            value={description}
            maxLength={2000}
            onChange={(event) => onDescriptionChange(event.target.value)}
          />
        </label>
        <div className="flex flex-wrap gap-2 sm:col-span-2">
          {gpsAcquisitionMessage && (
            <div className="flex w-full flex-wrap items-center gap-3">
              <p role="status" aria-live="polite" className="text-sm text-slate-600">{gpsAcquisitionMessage}</p>
              <button type="button" className={secondaryButtonClass} onClick={onCancelGps}>
                Annuler la recherche GPS
              </button>
            </div>
          )}
          {gpsDiagnosticMessage && (
            <p role="status" aria-live="polite" className="w-full text-sm text-rose-700">
              {gpsDiagnosticMessage}
            </p>
          )}
          <button className={buttonClass} type="button" disabled={busy || !reason.trim()} onClick={() => onSubmit('gps')}>
            <MapPin className="h-4 w-4" /> Terminer avec GPS
          </button>
          <button className={secondaryButtonClass} type="button" disabled={busy || !reason.trim()} onClick={() => onSubmit('regularization')}>
            <Clock3 className="h-4 w-4" /> Signaler l’échec GPS et proposer l’heure serveur
          </button>
        </div>
      </div>
    );
}

function Detail({ label, value }: { label: string; value: string }) {
  return <div><dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</dt><dd className="mt-1 break-words font-medium text-slate-800">{value}</dd></div>;
}
