import { createHash, randomBytes } from 'node:crypto';
import type { Express, Request, RequestHandler, Response } from 'express';
import { and, asc, desc, eq, exists, gt, gte, inArray, isNotNull, isNull, lt, lte, notExists, or, sql } from 'drizzle-orm';
import { db } from '../../db/index.ts';
import {
  classTeachers,
  classes,
  schoolClasses,
  schoolSubjects,
  schools,
  subjects,
  teacherClassSubjects,
  teacherControlAuditEvents,
  teacherControlGpsChallenges,
  teacherControlGpsSettings,
  teacherControlHourlyRates,
  teacherControlRegularizationDecisions,
  teacherControlRegularizationRequests,
  teacherControlSessions,
  teacherSubjects,
  teachers,
  users,
} from '../../db/schema.ts';
import {
  resolveTeacherControlSchoolAccess,
  type TeacherControlRole,
} from './authorization.ts';
import {
  TEACHER_CONTROL_DOCUMENT_AUTH_COOKIE,
  TEACHER_CONTROL_DOCUMENT_AUTH_COOKIE_MAX_AGE_SECONDS,
  TEACHER_CONTROL_TEACHER_DOCUMENT_PATH,
} from './security.ts';
import {
  calculateTeacherControlCompensation,
  MAX_CONFIGURABLE_GPS_ACCURACY_METERS,
  MAX_GEOFENCE_RADIUS_METERS,
  MAX_GPS_ACCURACY_METERS,
  validateTeacherControlGpsFix,
} from './domain.ts';
import type { TeacherControlAuditInput } from './audit.ts';

const GPS_CHALLENGE_TTL_MS = 2 * 60 * 1000;
const MAX_PAGE_SIZE = 100;
type TeacherControlExecutor = Pick<typeof db, 'select'>;

function selectTeacherPedagogicalPairs(
  executor: TeacherControlExecutor,
  teacherId: number,
  schoolId: number,
  selectedPair?: { classId: number; subjectId: number },
) {
  const conditions = [
    eq(classTeachers.teacherId, teacherId),
    eq(classTeachers.schoolId, schoolId),
    eq(teacherSubjects.teacherId, teacherId),
    eq(teacherSubjects.schoolId, schoolId),
    or(
      eq(classes.schoolId, schoolId),
      isNotNull(schoolClasses.id),
    ),
    or(
      eq(subjects.schoolId, schoolId),
      isNotNull(schoolSubjects.id),
    ),
  ];
  if (selectedPair) {
    conditions.push(
      eq(classTeachers.classId, selectedPair.classId),
      eq(teacherSubjects.subjectId, selectedPair.subjectId),
    );
  }
  return executor.select({
    classTeacherAssociationId: classTeachers.id,
    teacherSubjectAssociationId: teacherSubjects.id,
    classId: classes.id,
    className: classes.name,
    subjectId: subjects.id,
    subjectName: subjects.name,
  }).from(classTeachers)
    .innerJoin(classes, eq(classes.id, classTeachers.classId))
    .innerJoin(teacherSubjects, and(
      eq(teacherSubjects.teacherId, teacherId),
      eq(teacherSubjects.schoolId, schoolId),
    ))
    .innerJoin(subjects, eq(subjects.id, teacherSubjects.subjectId))
    .leftJoin(schoolClasses, and(
      eq(schoolClasses.classId, classes.id),
      eq(schoolClasses.schoolId, schoolId),
      eq(schoolClasses.status, 'approved'),
    ))
    .leftJoin(schoolSubjects, and(
      eq(schoolSubjects.subjectId, subjects.id),
      eq(schoolSubjects.schoolId, schoolId),
      eq(schoolSubjects.status, 'approved'),
    ))
    .where(and(...conditions));
}

type SessionStatus = 'open' | 'completed' | 'closed_without_end';
type RegularizationFilter = 'pending' | 'resolved' | 'none';

interface TeacherControlSessionFilters {
  from: Date | null;
  to: Date | null;
  teacherId: number | null;
  classId: number | null;
  subjectId: number | null;
  status: SessionStatus | null;
  regularizationState: RegularizationFilter | null;
}

function parseTeacherControlPeriod(query: Request['query'], now = new Date()): { from: Date | null; to: Date | null } {
  const from = query.from == null ? null : parseDate(query.from);
  const to = query.to == null ? null : parseDate(query.to);
  if (query.from != null && !from) throw new TeacherControlApiError(400, 'from must be a valid timestamp');
  if (query.to != null && !to) throw new TeacherControlApiError(400, 'to must be a valid timestamp');

  const period = query.period == null ? null : String(query.period);
  if (period != null && !['day', 'week', 'month', 'year', 'custom'].includes(period)) {
    throw new TeacherControlApiError(400, 'period must be day, week, month, year or custom');
  }
  if (period === 'custom' && (!from || !to)) {
    throw new TeacherControlApiError(400, 'custom period requires from and to');
  }
  if (from && to && from > to) throw new TeacherControlApiError(400, 'from must not be after to');
  if (from || to || period === 'custom') return { from, to };
  if (!period) return { from: null, to: null };

  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  if (period === 'week') {
    const weekday = (start.getUTCDay() + 6) % 7;
    start.setUTCDate(start.getUTCDate() - weekday);
  } else if (period === 'month') {
    start.setUTCDate(1);
  } else if (period === 'year') {
    start.setUTCMonth(0, 1);
  }
  const end = new Date(start);
  if (period === 'day') end.setUTCDate(end.getUTCDate() + 1);
  else if (period === 'week') end.setUTCDate(end.getUTCDate() + 7);
  else if (period === 'month') end.setUTCMonth(end.getUTCMonth() + 1);
  else if (period === 'year') end.setUTCFullYear(end.getUTCFullYear() + 1);
  end.setUTCMilliseconds(end.getUTCMilliseconds() - 1);
  return { from: from ?? start, to: to ?? end };
}

function parseSessionFilters(query: Request['query']): TeacherControlSessionFilters {
  const range = parseTeacherControlPeriod(query);
  const teacherId = query.teacherId == null || query.teacherId === '' ? null : positiveInteger(query.teacherId);
  const classId = query.classId == null || query.classId === '' ? null : positiveInteger(query.classId);
  const subjectId = query.subjectId == null || query.subjectId === '' ? null : positiveInteger(query.subjectId);
  const statusValue = query.status == null || query.status === '' ? null : String(query.status);
  const regularizationValue = query.regularizationState == null || query.regularizationState === ''
    ? null
    : String(query.regularizationState);
  if (query.teacherId != null && query.teacherId !== '' && teacherId == null) {
    throw new TeacherControlApiError(400, 'teacherId must be a positive integer');
  }
  if (query.classId != null && query.classId !== '' && classId == null) {
    throw new TeacherControlApiError(400, 'classId must be a positive integer');
  }
  if (query.subjectId != null && query.subjectId !== '' && subjectId == null) {
    throw new TeacherControlApiError(400, 'subjectId must be a positive integer');
  }
  if (statusValue != null && !['open', 'completed', 'closed_without_end'].includes(statusValue)) {
    throw new TeacherControlApiError(400, 'status is invalid');
  }
  if (regularizationValue != null && !['pending', 'resolved', 'none'].includes(regularizationValue)) {
    throw new TeacherControlApiError(400, 'regularizationState is invalid');
  }
  return {
    ...range,
    teacherId,
    classId,
    subjectId,
    status: statusValue as SessionStatus | null,
    regularizationState: regularizationValue as RegularizationFilter | null,
  };
}

function sessionFilterConditions(filters: TeacherControlSessionFilters) {
  const conditions = [];
  if (filters.from) conditions.push(gte(teacherControlSessions.startedAt, filters.from));
  if (filters.to) conditions.push(lte(teacherControlSessions.startedAt, filters.to));
  if (filters.teacherId) conditions.push(eq(teacherControlSessions.teacherId, filters.teacherId));
  if (filters.classId) conditions.push(eq(teacherControlSessions.classId, filters.classId));
  if (filters.subjectId) conditions.push(eq(teacherControlSessions.subjectId, filters.subjectId));
  if (filters.status) conditions.push(eq(teacherControlSessions.status, filters.status));
  if (filters.regularizationState) {
    const pendingRequest = db.select({ id: teacherControlRegularizationRequests.id })
      .from(teacherControlRegularizationRequests)
      .where(and(
        eq(teacherControlRegularizationRequests.sessionId, teacherControlSessions.id),
        eq(teacherControlRegularizationRequests.status, 'pending'),
      ));
    const anyRequest = db.select({ id: teacherControlRegularizationRequests.id })
      .from(teacherControlRegularizationRequests)
      .where(eq(teacherControlRegularizationRequests.sessionId, teacherControlSessions.id));
    if (filters.regularizationState === 'pending') conditions.push(exists(pendingRequest));
    else if (filters.regularizationState === 'resolved') conditions.push(and(exists(anyRequest), notExists(pendingRequest)));
    else conditions.push(notExists(anyRequest));
  }
  return conditions;
}

function parsePageLimit(query: Request['query']): number {
  const raw = query.limit == null ? 50 : Number(query.limit);
  if (!Number.isSafeInteger(raw) || raw < 1) throw new TeacherControlApiError(400, 'limit must be a positive integer');
  return Math.min(raw, MAX_PAGE_SIZE);
}

function decodeSessionCursor(value: unknown): { startedAt: Date; id: number } | null {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || value.length > 256) throw new TeacherControlApiError(400, 'cursor is invalid');
  try {
    const [timestamp, rawId] = Buffer.from(value, 'base64url').toString('utf8').split('|');
    const startedAt = new Date(timestamp);
    const id = positiveInteger(rawId);
    if (!Number.isFinite(startedAt.getTime()) || !id) throw new Error('Invalid cursor payload');
    return { startedAt, id };
  } catch {
    throw new TeacherControlApiError(400, 'cursor is invalid');
  }
}

function encodeSessionCursor(session: { startedAt: Date; id: number }): string {
  return Buffer.from(`${session.startedAt.toISOString()}|${session.id}`).toString('base64url');
}

function sumIntegerRows(rows: Array<Record<string, unknown>>, key: string): number {
  return rows.reduce((total, row) => total + Number(row[key] ?? 0), 0);
}

function redactGpsCoordinates(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactGpsCoordinates);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).flatMap(([key, child]) => (
    /^(lat|latitude|lon|lng|longitude|coordinates|gpscoordinates)$/i.test(key)
      ? []
      : [[key, redactGpsCoordinates(child)]]
  )));
}

export interface TeacherControlActor {
  id?: number | null;
  role: string;
  schoolId: number | null;
  name?: string | null;
  email?: string | null;
}

export type TeacherControlActorResolver = (request: Request) => Promise<TeacherControlActor | null>;

export interface TeacherControlApiDependencies {
  resolveActor: TeacherControlActorResolver;
  requireAuth: RequestHandler;
}

class TeacherControlApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

function positiveInteger(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function parseDate(value: unknown): Date | null {
  if (typeof value !== 'string') return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function nonEmptyText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized ? normalized : null;
}

type UnrecordedRequestType = 'immediate_report' | 'late_declaration';
type IncidentType = 'gps_unavailable' | 'gps_accuracy' | 'permission_denied' | 'network' | 'application' | 'other';

function parseBoundedText(value: unknown, maximumLength: number, field: string): string | null {
  const text = nonEmptyText(value);
  if (text && text.length > maximumLength) {
    throw new TeacherControlApiError(400, `${field} cannot exceed ${maximumLength} characters`);
  }
  return text;
}

function requestGpsDetails(body: Record<string, unknown>) {
  const values = [body.latitude, body.longitude, body.accuracyMeters];
  if (values.every((value) => value == null)) return null;
  const [latitude, longitude, accuracyMeters] = values;
  if (typeof latitude !== 'number'
    || !Number.isFinite(latitude)
    || latitude < -90
    || latitude > 90
    || typeof longitude !== 'number'
    || !Number.isFinite(longitude)
    || longitude < -180
    || longitude > 180
    || typeof accuracyMeters !== 'number'
    || !Number.isFinite(accuracyMeters)
    || accuracyMeters < 0) {
    throw new TeacherControlApiError(400, 'Optional GPS evidence must contain valid coordinates and accuracy');
  }
  return { latitude, longitude, accuracyMeters };
}

async function getActiveTeacherPair(
  executor: TeacherControlExecutor,
  teacherId: number,
  schoolId: number,
  classId: number,
  subjectId: number,
) {
  const [pair] = await selectTeacherPedagogicalPairs(
    executor,
    teacherId,
    schoolId,
    { classId, subjectId },
  ).limit(1);
  if (!pair) throw new TeacherControlApiError(403, 'The selected class and subject are not assigned to this teacher');

  const [canonical] = await executor.select({
    id: teacherClassSubjects.id,
    isActive: teacherClassSubjects.isActive,
  }).from(teacherClassSubjects).where(and(
    eq(teacherClassSubjects.teacherId, teacherId),
    eq(teacherClassSubjects.schoolId, schoolId),
    eq(teacherClassSubjects.classId, classId),
    eq(teacherClassSubjects.subjectId, subjectId),
  )).limit(1);
  if (canonical && !canonical.isActive) {
    throw new TeacherControlApiError(403, 'The selected class and subject assignment is inactive');
  }
  return {
    ...pair,
    teachingAssignmentId: canonical?.id ?? null,
  };
}

async function assertNoTeacherControlOverlap(
  executor: TeacherControlExecutor,
  input: {
    schoolId: number;
    teacherId: number;
    startedAt: Date;
    endedAt: Date | null;
    excludedSessionId?: number;
    excludedRequestId?: number;
  },
) {
  const sessions = await executor.select().from(teacherControlSessions).where(and(
    eq(teacherControlSessions.schoolId, input.schoolId),
    eq(teacherControlSessions.teacherId, input.teacherId),
  ));
  const overlapsSession = sessions.some((session) => {
    if (session.id === input.excludedSessionId
      || (input.endedAt != null && session.startedAt >= input.endedAt)) return false;
    const knownEnd = session.validatedEndedAt ?? session.closedAt;
    return knownEnd == null || knownEnd > input.startedAt;
  });
  if (overlapsSession) throw new TeacherControlApiError(409, 'The requested session overlaps another recorded session');

  const requests = await executor.select().from(teacherControlRegularizationRequests).where(and(
    eq(teacherControlRegularizationRequests.schoolId, input.schoolId),
    eq(teacherControlRegularizationRequests.teacherId, input.teacherId),
    eq(teacherControlRegularizationRequests.status, 'pending'),
  ));
  const overlapsRequest = requests.some((requestRow) => {
    if (requestRow.id === input.excludedRequestId) return false;
    const requestStart = requestRow.requestType === 'immediate_report'
      ? requestRow.referenceStartedAt
      : requestRow.requestType === 'incomplete_session'
        ? sessions.find((session) => session.id === requestRow.sessionId)?.startedAt
        : requestRow.declaredStartedAt;
    if (!requestStart || (input.endedAt != null && requestStart >= input.endedAt)) return false;
    return requestRow.proposedEndedAt == null || requestRow.proposedEndedAt > input.startedAt;
  });
  if (overlapsRequest) throw new TeacherControlApiError(409, 'The requested session overlaps another pending regularization');
}

async function lockTeacherControlTeacher(
  executor: TeacherControlExecutor,
  teacherId: number,
  schoolId: number,
) {
  const [teacher] = await executor.select({
    id: teachers.id,
    userId: teachers.userId,
  }).from(teachers).where(and(
    eq(teachers.id, teacherId),
    eq(teachers.schoolId, schoolId),
  )).for('update').limit(1);
  if (!teacher) throw new TeacherControlApiError(409, 'The teacher is no longer available in this school');
  return teacher;
}

function isControlRole(role: string): role is TeacherControlRole {
  return role === 'teacher' || role === 'school_admin' || role === 'super_admin';
}

function actorAuditName(actor: TeacherControlActor): string {
  return actor.name?.trim() || actor.email?.trim() || `Utilisateur ${actor.id ?? 'inconnu'}`;
}

function auditInput(input: Omit<TeacherControlAuditInput, 'actorUserId' | 'actorRole' | 'actorNameSnapshot' | 'actorEmailSnapshot'>, actor: TeacherControlActor): TeacherControlAuditInput {
  if (!isControlRole(actor.role)) throw new TeacherControlApiError(403, 'Forbidden');
  return {
    ...input,
    actorUserId: actor.id ?? null,
    actorRole: actor.role,
    actorNameSnapshot: actorAuditName(actor),
    actorEmailSnapshot: actor.email ?? null,
  };
}

async function insertAudit(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], audit: TeacherControlAuditInput): Promise<void> {
  await tx.insert(teacherControlAuditEvents).values({
    schoolId: audit.schoolId,
    schoolNameSnapshot: audit.schoolNameSnapshot,
    actorUserId: audit.actorUserId,
    actorRole: audit.actorRole,
    actorEmailSnapshot: audit.actorEmailSnapshot ?? null,
    actorNameSnapshot: audit.actorNameSnapshot,
    action: audit.action,
    resourceType: audit.resourceType,
    resourceId: audit.resourceId ?? null,
    beforeValues: audit.beforeValues ?? null,
    afterValues: audit.afterValues ?? null,
    reason: audit.reason ?? null,
  });
}

async function requireSchoolAccess(
  actor: TeacherControlActor,
  requestedSchoolId: unknown,
  allowedRoles: readonly TeacherControlRole[],
) {
  if (!actor.id || !allowedRoles.includes(actor.role as TeacherControlRole)) {
    throw new TeacherControlApiError(403, 'Forbidden');
  }
  if (actor.role !== 'super_admin' && requestedSchoolId != null && requestedSchoolId !== '') {
    const requested = positiveInteger(requestedSchoolId);
    if (requested == null) throw new TeacherControlApiError(400, 'schoolId must be a positive integer');
    if (requested !== actor.schoolId) throw new TeacherControlApiError(403, 'schoolId is outside the actor school scope');
  }
  const selectedSchoolId = actor.role === 'super_admin'
    ? positiveInteger(requestedSchoolId)
    : actor.schoolId;
  if (actor.role === 'super_admin' && selectedSchoolId == null) {
    throw new TeacherControlApiError(400, 'schoolId is required for a super admin request');
  }

  const access = await resolveTeacherControlSchoolAccess(actor, selectedSchoolId);
  if (access.allowed === false) {
    const status = access.reason === 'missing_school' ? 404
      : access.reason === 'school_suspended' ? 423
        : 403;
    throw new TeacherControlApiError(status, access.reason);
  }
  return access;
}

async function getTeacherId(actor: TeacherControlActor, schoolId: number, executor: typeof db = db): Promise<number> {
  if (actor.id == null) throw new TeacherControlApiError(401, 'Unauthenticated');
  const [teacher] = await executor.select({ id: teachers.id })
    .from(teachers)
    .where(and(eq(teachers.userId, actor.id), eq(teachers.schoolId, schoolId)))
    .limit(1);
  if (!teacher) throw new TeacherControlApiError(403, 'Teacher profile not found for the active school');
  return teacher.id;
}

function gpsCoordinates(body: Record<string, unknown>) {
  const latitude = body.latitude;
  const longitude = body.longitude;
  const accuracyMeters = body.accuracyMeters;
  if (typeof latitude !== 'number' || typeof longitude !== 'number' || typeof accuracyMeters !== 'number') {
    throw new TeacherControlApiError(400, 'GPS coordinates and accuracy must be numbers');
  }
  return { latitude, longitude, accuracyMeters };
}

function handleRoute(
  action: (request: Request, response: Response, actor: TeacherControlActor) => Promise<unknown>,
  resolveActor: TeacherControlActorResolver,
) {
  return async (request: Request, response: Response) => {
    try {
      const actor = await resolveActor(request);
      if (!actor) throw new TeacherControlApiError(401, 'Unauthenticated');
      const result = await action(request, response, actor);
      if (!response.headersSent && result !== undefined) response.json(result);
    } catch (error) {
      if (error instanceof TeacherControlApiError) {
        response.status(error.status).json({ error: error.message });
        return;
      }
      if ((error as { code?: string })?.code === '23505') {
        response.status(409).json({ error: 'Conflicting teacher-control operation' });
        return;
      }
      console.error('Teacher control API request failed:', error);
      if (!response.headersSent) response.status(500).json({ error: 'Teacher-control operation failed' });
    }
  };
}

function gpsSiteFromSettings(settings: {
  isEnabled: boolean;
  latitude: string | null;
  longitude: string | null;
  geofenceRadiusMeters: number;
  maxGpsAccuracyMeters?: number | null;
} | null | undefined) {
  if (!settings?.isEnabled || settings.latitude == null || settings.longitude == null) {
    throw new TeacherControlApiError(409, 'GPS control is not enabled for this school');
  }
  const maxGpsAccuracyMeters = settings.maxGpsAccuracyMeters ?? MAX_GPS_ACCURACY_METERS;
  if (!Number.isSafeInteger(maxGpsAccuracyMeters)
    || maxGpsAccuracyMeters < 1
    || maxGpsAccuracyMeters > MAX_CONFIGURABLE_GPS_ACCURACY_METERS) {
    throw new TeacherControlApiError(500, 'Stored GPS accuracy threshold is invalid');
  }
  return {
    latitude: Number(settings.latitude),
    longitude: Number(settings.longitude),
    geofenceRadiusMeters: settings.geofenceRadiusMeters,
    maxGpsAccuracyMeters,
  };
}

async function getEnabledGpsSettings(schoolId: number) {
  const [settings] = await db.select({
    isEnabled: teacherControlGpsSettings.isEnabled,
    latitude: teacherControlGpsSettings.latitude,
    longitude: teacherControlGpsSettings.longitude,
    geofenceRadiusMeters: teacherControlGpsSettings.geofenceRadiusMeters,
    maxGpsAccuracyMeters: teacherControlGpsSettings.maxGpsAccuracyMeters,
  }).from(teacherControlGpsSettings)
    .where(eq(teacherControlGpsSettings.schoolId, schoolId))
    .limit(1);
  return gpsSiteFromSettings(settings);
}

type GpsChallengeInput = {
  token: unknown;
  actorUserId: number;
  schoolId: number;
  action: 'start_session' | 'end_session';
  resourceId?: number;
};

function gpsChallengeConditions(input: GpsChallengeInput, now: Date) {
  if (typeof input.token !== 'string' || input.token.length < 32 || input.token.length > 256) {
    throw new TeacherControlApiError(400, 'A valid GPS challenge is required');
  }
  const challengeHash = createHash('sha256').update(input.token).digest('hex');
  const conditions = [
    eq(teacherControlGpsChallenges.challengeHash, challengeHash),
    eq(teacherControlGpsChallenges.actorUserId, input.actorUserId),
    eq(teacherControlGpsChallenges.schoolId, input.schoolId),
    eq(teacherControlGpsChallenges.action, input.action),
    isNull(teacherControlGpsChallenges.consumedAt),
    gt(teacherControlGpsChallenges.expiresAt, now),
  ];
  conditions.push(input.resourceId == null
    ? isNull(teacherControlGpsChallenges.resourceId)
    : eq(teacherControlGpsChallenges.resourceId, input.resourceId));
  return conditions;
}

async function assertGpsChallengeAvailable(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  input: GpsChallengeInput,
): Promise<void> {
  const [challenge] = await tx.select({ id: teacherControlGpsChallenges.id })
    .from(teacherControlGpsChallenges)
    .where(and(...gpsChallengeConditions(input, new Date())))
    .limit(1);
  if (!challenge) throw new TeacherControlApiError(409, 'GPS challenge is invalid, expired or already used');
}

async function consumeGpsChallenge(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  input: GpsChallengeInput,
): Promise<void> {
  const now = new Date();
  const [challenge] = await tx.update(teacherControlGpsChallenges)
    .set({ consumedAt: now })
    .where(and(...gpsChallengeConditions(input, now)))
    .returning({ id: teacherControlGpsChallenges.id });
  if (!challenge) throw new TeacherControlApiError(409, 'GPS challenge is invalid, expired or already used');
}

export function registerTeacherControlApi(app: Express, dependencies: TeacherControlApiDependencies): void {
  const { resolveActor, requireAuth } = dependencies;
  app.use('/api/teacher-control', requireAuth);

  app.post('/api/teacher-control/teacher-document-session', handleRoute(async (req, res, actor) => {
    if (actor.role !== 'teacher' || actor.id == null) throw new TeacherControlApiError(403, 'Forbidden');
    const authorization = req.get('authorization');
    if (!authorization?.startsWith('Bearer ') || !authorization.slice('Bearer '.length)) {
      throw new TeacherControlApiError(401, 'Authenticated access token is required');
    }

    const access = await requireSchoolAccess(actor, null, ['teacher']);
    await getTeacherId(actor, access.schoolId);
    await getEnabledGpsSettings(access.schoolId);

    const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
    res.setHeader('Cache-Control', 'no-store');
    res.append('Set-Cookie', [
      `${TEACHER_CONTROL_DOCUMENT_AUTH_COOKIE}=${encodeURIComponent(authorization.slice('Bearer '.length))}`,
      `Path=${TEACHER_CONTROL_TEACHER_DOCUMENT_PATH}`,
      `Max-Age=${TEACHER_CONTROL_DOCUMENT_AUTH_COOKIE_MAX_AGE_SECONDS}`,
      'HttpOnly',
      'SameSite=Strict',
    ].join('; ') + secure);
    return { ready: true };
  }, resolveActor));

  app.get('/api/teacher-control/gps-settings', handleRoute(async (req, res, actor) => {
    res.setHeader('Cache-Control', 'no-store');
    if (actor.role === 'teacher') {
      const access = await requireSchoolAccess(actor, null, ['teacher']);
      const [settings] = await db.select({
        maxGpsAccuracyMeters: teacherControlGpsSettings.maxGpsAccuracyMeters,
      }).from(teacherControlGpsSettings)
        .where(eq(teacherControlGpsSettings.schoolId, access.schoolId))
        .limit(1);
      return {
        maxGpsAccuracyMeters: settings?.maxGpsAccuracyMeters ?? MAX_GPS_ACCURACY_METERS,
      };
    }
    const access = await requireSchoolAccess(
      actor,
      req.query.schoolId,
      ['school_admin', 'super_admin'],
    );
    const [settings] = await db.select().from(teacherControlGpsSettings)
      .where(eq(teacherControlGpsSettings.schoolId, access.schoolId))
      .limit(1);
    return {
      schoolId: access.schoolId,
      schoolName: access.schoolName,
      isEnabled: settings?.isEnabled ?? false,
      latitude: settings?.latitude ?? null,
      longitude: settings?.longitude ?? null,
      geofenceRadiusMeters: settings?.geofenceRadiusMeters ?? 200,
      maxGpsAccuracyMeters: settings?.maxGpsAccuracyMeters ?? MAX_GPS_ACCURACY_METERS,
      updatedAt: settings?.updatedAt ?? null,
    };
  }, resolveActor));

  app.get('/api/teacher-control/gps-settings/history', handleRoute(async (req, _res, actor) => {
    const access = await requireSchoolAccess(actor, req.query.schoolId, ['school_admin', 'super_admin']);
    const rawLimit = Number(req.query.limit ?? 50);
    const limit = Number.isSafeInteger(rawLimit) ? Math.min(Math.max(rawLimit, 1), MAX_PAGE_SIZE) : 50;
    const rawOffset = Number(req.query.offset ?? 0);
    const offset = Number.isSafeInteger(rawOffset) ? Math.max(rawOffset, 0) : 0;
    return db.select().from(teacherControlAuditEvents)
      .where(and(
        eq(teacherControlAuditEvents.schoolId, access.schoolId),
        eq(teacherControlAuditEvents.resourceType, 'gps_settings'),
      ))
      .orderBy(desc(teacherControlAuditEvents.createdAt))
      .limit(limit)
      .offset(offset);
  }, resolveActor));

  app.put('/api/teacher-control/gps-settings', handleRoute(async (req, res, actor) => {
    res.setHeader('Cache-Control', 'no-store');
    const body = req.body as Record<string, unknown>;
    const access = await requireSchoolAccess(actor, body.schoolId, ['school_admin', 'super_admin']);
    if (typeof body.isEnabled !== 'boolean') throw new TeacherControlApiError(400, 'isEnabled must be a boolean');
    const latitude = body.latitude == null ? null : body.latitude;
    const longitude = body.longitude == null ? null : body.longitude;
    const radius = body.geofenceRadiusMeters == null ? 200 : body.geofenceRadiusMeters;
    if (typeof radius !== 'number'
      || !Number.isSafeInteger(radius)
      || radius <= 0
      || radius > MAX_GEOFENCE_RADIUS_METERS) {
      throw new TeacherControlApiError(400, `geofenceRadiusMeters must be a positive integer no greater than ${MAX_GEOFENCE_RADIUS_METERS}`);
    }
    const requestedAccuracyValue: unknown = body.maxGpsAccuracyMeters;
    let requestedAccuracy: number | null = null;
    if (requestedAccuracyValue != null) {
      if (typeof requestedAccuracyValue !== 'number'
        || !Number.isSafeInteger(requestedAccuracyValue)
        || requestedAccuracyValue < 1
        || requestedAccuracyValue > MAX_CONFIGURABLE_GPS_ACCURACY_METERS) {
        throw new TeacherControlApiError(400, `maxGpsAccuracyMeters must be a positive integer no greater than ${MAX_CONFIGURABLE_GPS_ACCURACY_METERS}`);
      }
      requestedAccuracy = requestedAccuracyValue;
    }
    if (latitude != null && (typeof latitude !== 'number' || !Number.isFinite(latitude) || latitude < -90 || latitude > 90)) {
      throw new TeacherControlApiError(400, 'latitude is invalid');
    }
    if (longitude != null && (typeof longitude !== 'number' || !Number.isFinite(longitude) || longitude < -180 || longitude > 180)) {
      throw new TeacherControlApiError(400, 'longitude is invalid');
    }
    if (body.isEnabled && (latitude == null || longitude == null)) {
      throw new TeacherControlApiError(400, 'Coordinates are required when GPS control is enabled');
    }
    const next = {
      schoolId: access.schoolId,
      schoolNameSnapshot: access.schoolName,
      isEnabled: body.isEnabled,
      latitude: latitude == null ? null : String(latitude),
      longitude: longitude == null ? null : String(longitude),
      geofenceRadiusMeters: radius,
      maxGpsAccuracyMeters: requestedAccuracy,
      updatedByUserId: actor.id ?? null,
      updatedByNameSnapshot: actorAuditName(actor),
      updatedAt: new Date(),
    };
    return db.transaction(async (tx) => {
      const [lockedSchool] = await tx.select({ id: schools.id }).from(schools)
        .where(eq(schools.id, access.schoolId))
        .for('update')
        .limit(1);
      if (!lockedSchool) throw new TeacherControlApiError(404, 'School not found');
      const [previous] = await tx.select().from(teacherControlGpsSettings)
        .where(eq(teacherControlGpsSettings.schoolId, access.schoolId))
        .limit(1);
      const maxGpsAccuracyMeters = next.maxGpsAccuracyMeters
        ?? previous?.maxGpsAccuracyMeters
        ?? MAX_GPS_ACCURACY_METERS;
      const nextSettings = { ...next, maxGpsAccuracyMeters };
      const [saved] = await tx.insert(teacherControlGpsSettings).values(nextSettings)
        .onConflictDoUpdate({
          target: teacherControlGpsSettings.schoolId,
          set: {
            schoolNameSnapshot: nextSettings.schoolNameSnapshot,
            isEnabled: nextSettings.isEnabled,
            latitude: nextSettings.latitude,
            longitude: nextSettings.longitude,
            geofenceRadiusMeters: nextSettings.geofenceRadiusMeters,
            maxGpsAccuracyMeters: nextSettings.maxGpsAccuracyMeters,
            updatedByUserId: nextSettings.updatedByUserId,
            updatedByNameSnapshot: nextSettings.updatedByNameSnapshot,
            updatedAt: nextSettings.updatedAt,
          },
        })
        .returning();
      await insertAudit(tx, auditInput({
        schoolId: access.schoolId,
        schoolNameSnapshot: access.schoolName,
        action: 'gps_settings_updated',
        resourceType: 'gps_settings',
        resourceId: saved.id,
        beforeValues: previous ? {
          isEnabled: previous.isEnabled,
          latitude: previous.latitude,
          longitude: previous.longitude,
          geofenceRadiusMeters: previous.geofenceRadiusMeters,
          maxGpsAccuracyMeters: previous.maxGpsAccuracyMeters ?? MAX_GPS_ACCURACY_METERS,
        } : null,
        afterValues: {
          isEnabled: saved.isEnabled,
          latitude: saved.latitude,
          longitude: saved.longitude,
          geofenceRadiusMeters: saved.geofenceRadiusMeters,
          maxGpsAccuracyMeters: saved.maxGpsAccuracyMeters,
        },
      }, actor));
      return saved;
    });
  }, resolveActor));

  app.put('/api/teacher-control/teachers/:teacherId/hourly-rate', handleRoute(async (req, _res, actor) => {
    const body = req.body as Record<string, unknown>;
    const access = await requireSchoolAccess(actor, body.schoolId, ['school_admin', 'super_admin']);
    const teacherId = positiveInteger(req.params.teacherId);
    if (!teacherId) throw new TeacherControlApiError(400, 'teacherId is invalid');
    const [teacher] = await db.select({ id: teachers.id, userId: teachers.userId })
      .from(teachers)
      .where(and(eq(teachers.id, teacherId), eq(teachers.schoolId, access.schoolId)))
      .limit(1);
    if (!teacher) throw new TeacherControlApiError(404, 'Teacher not found');
    const rate = body.hourlyRateXof == null ? null : Number(body.hourlyRateXof);
    if (rate != null && (!Number.isSafeInteger(rate) || rate < 0 || rate > 2_147_483_647)) {
      throw new TeacherControlApiError(400, 'hourlyRateXof must be a non-negative whole number or null');
    }
    return db.transaction(async (tx) => {
      const [lockedTeacher] = await tx.select({ id: teachers.id })
        .from(teachers)
        .where(and(eq(teachers.id, teacher.id), eq(teachers.schoolId, access.schoolId)))
        .for('update')
        .limit(1);
      if (!lockedTeacher) throw new TeacherControlApiError(404, 'Teacher not found');
      const [previous] = await tx.select().from(teacherControlHourlyRates)
        .where(and(
          eq(teacherControlHourlyRates.schoolId, access.schoolId),
          eq(teacherControlHourlyRates.teacherId, teacher.id),
        ))
        .limit(1);
      let saved = null;
      if (rate == null) {
        await tx.delete(teacherControlHourlyRates).where(and(
          eq(teacherControlHourlyRates.schoolId, access.schoolId),
          eq(teacherControlHourlyRates.teacherId, teacher.id),
        ));
      } else {
        const [teacherUser] = await tx.select({ name: users.name })
          .from(users)
          .where(eq(users.id, teacher.userId))
          .limit(1);
        const [result] = await tx.insert(teacherControlHourlyRates).values({
          schoolId: access.schoolId,
          schoolNameSnapshot: access.schoolName,
          teacherId: teacher.id,
          teacherNameSnapshot: teacherUser?.name ?? `Enseignant ${teacher.id}`,
          hourlyRateXof: rate,
          updatedByUserId: actor.id ?? null,
          updatedByNameSnapshot: actorAuditName(actor),
          updatedAt: new Date(),
        }).onConflictDoUpdate({
          target: [teacherControlHourlyRates.schoolId, teacherControlHourlyRates.teacherId],
          set: {
            schoolNameSnapshot: access.schoolName,
            hourlyRateXof: rate,
            updatedByUserId: actor.id ?? null,
            updatedByNameSnapshot: actorAuditName(actor),
            updatedAt: new Date(),
          },
        }).returning();
        saved = result;
      }
      await insertAudit(tx, auditInput({
        schoolId: access.schoolId,
        schoolNameSnapshot: access.schoolName,
        action: rate == null ? 'teacher_hourly_rate_removed' : 'teacher_hourly_rate_updated',
        resourceType: 'teacher_hourly_rate',
        resourceId: teacher.id,
        beforeValues: previous ? { hourlyRateXof: previous.hourlyRateXof } : null,
        afterValues: rate == null ? null : { hourlyRateXof: rate },
      }, actor));
      return saved;
    });
  }, resolveActor));

  app.get('/api/teacher-control/teachers/:teacherId/hourly-rate', handleRoute(async (req, _res, actor) => {
    const access = await requireSchoolAccess(
      actor,
      req.query.schoolId,
      ['school_admin', 'super_admin'],
    );
    const teacherId = positiveInteger(req.params.teacherId);
    if (!teacherId) throw new TeacherControlApiError(400, 'teacherId is invalid');
    const [rate] = await db.select().from(teacherControlHourlyRates)
      .where(and(
        eq(teacherControlHourlyRates.schoolId, access.schoolId),
        eq(teacherControlHourlyRates.teacherId, teacherId),
      ))
      .limit(1);
    return rate ?? null;
  }, resolveActor));

  app.get('/api/teacher-control/assignments', handleRoute(async (_req, _res, actor) => {
    if (actor.role !== 'teacher') throw new TeacherControlApiError(403, 'Forbidden');
    const access = await requireSchoolAccess(actor, null, ['teacher']);
    const teacherId = await getTeacherId(actor, access.schoolId);
    const [pedagogicalPairs, canonicalAssignments] = await Promise.all([
      selectTeacherPedagogicalPairs(db, teacherId, access.schoolId),
      db.select({
        id: teacherClassSubjects.id,
        classId: teacherClassSubjects.classId,
        subjectId: teacherClassSubjects.subjectId,
        isActive: teacherClassSubjects.isActive,
      }).from(teacherClassSubjects).where(and(
        eq(teacherClassSubjects.teacherId, teacherId),
        eq(teacherClassSubjects.schoolId, access.schoolId),
      )),
    ]);
    const canonicalByPair = new Map(canonicalAssignments.map((assignment) => [
      `${assignment.classId}:${assignment.subjectId}`,
      assignment,
    ]));
    const seenPairs = new Set<string>();
    return pedagogicalPairs.flatMap((pair) => {
      const pairKey = `${pair.classId}:${pair.subjectId}`;
      if (seenPairs.has(pairKey)) return [];
      seenPairs.add(pairKey);
      const canonical = canonicalByPair.get(pairKey);
      if (canonical && !canonical.isActive) return [];
      return [{
        classId: pair.classId,
        className: pair.className,
        subjectId: pair.subjectId,
        subjectName: pair.subjectName,
      }];
    });
  }, resolveActor));

  app.post('/api/teacher-control/gps-challenges', handleRoute(async (req, _res, actor) => {
    if (actor.role !== 'teacher' || actor.id == null) throw new TeacherControlApiError(403, 'Forbidden');
    const body = req.body as Record<string, unknown>;
    const action = body.action;
    if (action !== 'start_session' && action !== 'end_session') throw new TeacherControlApiError(400, 'action is invalid');
    const access = await requireSchoolAccess(actor, null, ['teacher']);
    const settings = await getEnabledGpsSettings(access.schoolId);
    const teacherId = await getTeacherId(actor, access.schoolId);
    const resourceId = action === 'end_session' ? positiveInteger(body.sessionId) : null;
    if (action === 'end_session') {
      if (!resourceId) throw new TeacherControlApiError(400, 'sessionId is required for an end challenge');
      const [session] = await db.select({ id: teacherControlSessions.id })
        .from(teacherControlSessions)
        .where(and(
          eq(teacherControlSessions.id, resourceId),
          eq(teacherControlSessions.schoolId, access.schoolId),
          eq(teacherControlSessions.teacherId, teacherId),
          eq(teacherControlSessions.status, 'open'),
        ))
        .limit(1);
      if (!session) throw new TeacherControlApiError(404, 'Open session not found');
    }
    await db.delete(teacherControlGpsChallenges).where(lt(teacherControlGpsChallenges.expiresAt, new Date()));
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + GPS_CHALLENGE_TTL_MS);
    await db.insert(teacherControlGpsChallenges).values({
      challengeHash: createHash('sha256').update(token).digest('hex'),
      actorUserId: actor.id,
      schoolId: access.schoolId,
      action,
      resourceId,
      expiresAt,
    });
    return {
      challenge: token,
      action,
      schoolId: access.schoolId,
      sessionId: resourceId,
      expiresAt,
    };
  }, resolveActor));

  app.post('/api/teacher-control/sessions/start', handleRoute(async (req, _res, actor) => {
    if (actor.role !== 'teacher' || actor.id == null) throw new TeacherControlApiError(403, 'Forbidden');
    const body = req.body as Record<string, unknown>;
    const classId = positiveInteger(body.classId);
    const subjectId = positiveInteger(body.subjectId);
    if (!classId || !subjectId) throw new TeacherControlApiError(400, 'classId and subjectId are required');
    const fix = gpsCoordinates(body);
    const access = await requireSchoolAccess(actor, null, ['teacher']);
    const teacherId = await getTeacherId(actor, access.schoolId);

    return db.transaction(async (tx) => {
      await lockTeacherControlTeacher(tx, teacherId, access.schoolId);
      const startedAt = new Date();
      await assertNoTeacherControlOverlap(tx, {
        schoolId: access.schoolId,
        teacherId,
        startedAt,
        endedAt: null,
      });
      const [gpsSettings] = await tx.select({
        isEnabled: teacherControlGpsSettings.isEnabled,
        latitude: teacherControlGpsSettings.latitude,
        longitude: teacherControlGpsSettings.longitude,
        geofenceRadiusMeters: teacherControlGpsSettings.geofenceRadiusMeters,
        maxGpsAccuracyMeters: teacherControlGpsSettings.maxGpsAccuracyMeters,
      }).from(teacherControlGpsSettings)
        .where(eq(teacherControlGpsSettings.schoolId, access.schoolId))
        .limit(1);
      const settings = gpsSiteFromSettings(gpsSettings);
      const gps = validateTeacherControlGpsFix(fix, settings);
      if (gps.accepted === false) throw new TeacherControlApiError(400, `GPS validation failed: ${gps.reason}`);

      const [pedagogicalPair] = await selectTeacherPedagogicalPairs(
        tx,
        teacherId,
        access.schoolId,
        { classId, subjectId },
      ).limit(1);
      if (!pedagogicalPair) {
        throw new TeacherControlApiError(403, 'Teacher is not assigned to this class and subject combination');
      }

      const [assignment] = await tx.select({
        id: teacherClassSubjects.id,
        isActive: teacherClassSubjects.isActive,
      }).from(teacherClassSubjects).where(and(
        eq(teacherClassSubjects.teacherId, teacherId),
        eq(teacherClassSubjects.schoolId, access.schoolId),
        eq(teacherClassSubjects.classId, classId),
        eq(teacherClassSubjects.subjectId, subjectId),
      )).limit(1);
      if (assignment && !assignment.isActive) {
        throw new TeacherControlApiError(403, 'This class and subject combination is inactive');
      }

      const [school] = await tx.select({ id: schools.id, name: schools.name, isSuspended: schools.isSuspended })
        .from(schools).where(eq(schools.id, access.schoolId)).limit(1);
      if (!school || school.isSuspended) throw new TeacherControlApiError(423, 'School is suspended or unavailable');

      const [rate] = await tx.select({ hourlyRateXof: teacherControlHourlyRates.hourlyRateXof })
        .from(teacherControlHourlyRates).where(and(
          eq(teacherControlHourlyRates.schoolId, access.schoolId),
          eq(teacherControlHourlyRates.teacherId, teacherId),
        )).limit(1);
      await consumeGpsChallenge(tx, {
        token: body.gpsChallenge,
        actorUserId: actor.id as number,
        schoolId: access.schoolId,
        action: 'start_session',
      });

      const [session] = await tx.insert(teacherControlSessions).values({
        schoolId: access.schoolId,
        schoolNameSnapshot: access.schoolName,
        teacherId,
        teacherUserId: actor.id as number,
        teacherNameSnapshot: actorAuditName(actor),
        teachingAssignmentId: assignment?.isActive ? assignment.id : null,
        classTeacherAssociationId: assignment ? null : pedagogicalPair.classTeacherAssociationId,
        teacherSubjectAssociationId: assignment ? null : pedagogicalPair.teacherSubjectAssociationId,
        classId,
        classNameSnapshot: pedagogicalPair.className,
        subjectId,
        subjectNameSnapshot: pedagogicalPair.subjectName,
        status: 'open',
        startedAt,
        startDistanceMeters: gps.distanceMeters,
        startAccuracyMeters: gps.accuracyMeters,
        startGeofenceRadiusMeters: settings.geofenceRadiusMeters,
        hourlyRateXofSnapshot: rate?.hourlyRateXof ?? null,
        updatedAt: startedAt,
      }).returning();
      await insertAudit(tx, auditInput({
        schoolId: access.schoolId,
        schoolNameSnapshot: access.schoolName,
        action: 'session_started',
        resourceType: 'session',
        resourceId: session.id,
        afterValues: {
          status: session.status,
          classId: session.classId,
          subjectId: session.subjectId,
          startedAt: session.startedAt,
          startDistanceMeters: session.startDistanceMeters,
          startAccuracyMeters: session.startAccuracyMeters,
          startGeofenceRadiusMeters: session.startGeofenceRadiusMeters,
        },
      }, actor));
      return session;
    });
  }, resolveActor));

  app.post('/api/teacher-control/sessions/:sessionId/validate-end', handleRoute(async (req, res, actor) => {
    if (actor.role !== 'teacher' || actor.id == null) throw new TeacherControlApiError(403, 'Forbidden');
    const sessionId = positiveInteger(req.params.sessionId);
    if (!sessionId) throw new TeacherControlApiError(400, 'sessionId is invalid');
    const body = req.body as Record<string, unknown>;
    const fix = gpsCoordinates(body);
    const access = await requireSchoolAccess(actor, null, ['teacher']);
    const teacherId = await getTeacherId(actor, access.schoolId);

    return db.transaction(async (tx) => {
      await lockTeacherControlTeacher(tx, teacherId, access.schoolId);
      const [session] = await tx.select({
        id: teacherControlSessions.id,
        startedAt: teacherControlSessions.startedAt,
      }).from(teacherControlSessions).where(and(
        eq(teacherControlSessions.id, sessionId),
        eq(teacherControlSessions.schoolId, access.schoolId),
        eq(teacherControlSessions.teacherId, teacherId),
        eq(teacherControlSessions.status, 'open'),
      )).for('update').limit(1);
      if (!session) throw new TeacherControlApiError(404, 'Open session not found');
      const [gpsSettings] = await tx.select({
        isEnabled: teacherControlGpsSettings.isEnabled,
        latitude: teacherControlGpsSettings.latitude,
        longitude: teacherControlGpsSettings.longitude,
        geofenceRadiusMeters: teacherControlGpsSettings.geofenceRadiusMeters,
        maxGpsAccuracyMeters: teacherControlGpsSettings.maxGpsAccuracyMeters,
      }).from(teacherControlGpsSettings)
        .where(eq(teacherControlGpsSettings.schoolId, access.schoolId))
        .limit(1);
      const settings = gpsSiteFromSettings(gpsSettings);
      const gps = validateTeacherControlGpsFix(fix, settings);
      if (gps.accepted === false) throw new TeacherControlApiError(400, `GPS validation failed: ${gps.reason}`);
      await assertGpsChallengeAvailable(tx, {
        token: body.gpsChallenge,
        actorUserId: actor.id,
        schoolId: access.schoolId,
        action: 'end_session',
        resourceId: sessionId,
      });

      const validatedAt = new Date();
      if (validatedAt < session.startedAt) throw new TeacherControlApiError(409, 'End time cannot precede session start');
      res.setHeader('Cache-Control', 'no-store');
      return {
        sessionId,
        latitude: fix.latitude,
        longitude: fix.longitude,
        validatedAt,
      };
    });
  }, resolveActor));

  app.post('/api/teacher-control/sessions/:sessionId/end', handleRoute(async (req, _res, actor) => {
    if (actor.role !== 'teacher' || actor.id == null) throw new TeacherControlApiError(403, 'Forbidden');
    const sessionId = positiveInteger(req.params.sessionId);
    if (!sessionId) throw new TeacherControlApiError(400, 'sessionId is invalid');
    const body = req.body as Record<string, unknown>;
    const fix = gpsCoordinates(body);
    const access = await requireSchoolAccess(actor, null, ['teacher']);
    const teacherId = await getTeacherId(actor, access.schoolId);

    return db.transaction(async (tx) => {
      await lockTeacherControlTeacher(tx, teacherId, access.schoolId);
      const [session] = await tx.select().from(teacherControlSessions).where(and(
        eq(teacherControlSessions.id, sessionId),
        eq(teacherControlSessions.schoolId, access.schoolId),
        eq(teacherControlSessions.teacherId, teacherId),
        eq(teacherControlSessions.status, 'open'),
      )).for('update').limit(1);
      if (!session) throw new TeacherControlApiError(404, 'Open session not found');
      const [gpsSettings] = await tx.select({
        isEnabled: teacherControlGpsSettings.isEnabled,
        latitude: teacherControlGpsSettings.latitude,
        longitude: teacherControlGpsSettings.longitude,
        geofenceRadiusMeters: teacherControlGpsSettings.geofenceRadiusMeters,
        maxGpsAccuracyMeters: teacherControlGpsSettings.maxGpsAccuracyMeters,
      }).from(teacherControlGpsSettings)
        .where(eq(teacherControlGpsSettings.schoolId, access.schoolId))
        .limit(1);
      const settings = gpsSiteFromSettings(gpsSettings);
      const gps = validateTeacherControlGpsFix(fix, settings);
      if (gps.accepted === false) throw new TeacherControlApiError(400, `GPS validation failed: ${gps.reason}`);
      await consumeGpsChallenge(tx, {
        token: body.gpsChallenge,
        actorUserId: actor.id as number,
        schoolId: access.schoolId,
        action: 'end_session',
        resourceId: sessionId,
      });
      const endedAt = new Date();
      if (endedAt < session.startedAt) throw new TeacherControlApiError(409, 'End time cannot precede session start');

      const [updated] = await tx.update(teacherControlSessions).set({
        status: 'completed',
        validatedEndedAt: endedAt,
        endSource: 'gps',
        endDistanceMeters: gps.distanceMeters,
        endAccuracyMeters: gps.accuracyMeters,
        endGeofenceRadiusMeters: settings.geofenceRadiusMeters,
        updatedAt: endedAt,
      }).where(eq(teacherControlSessions.id, sessionId)).returning();
      await insertAudit(tx, auditInput({
        schoolId: access.schoolId,
        schoolNameSnapshot: session.schoolNameSnapshot,
        action: 'session_ended',
        resourceType: 'session',
        resourceId: session.id,
        beforeValues: { status: session.status },
        afterValues: {
          status: updated.status,
          validatedEndedAt: updated.validatedEndedAt,
          endDistanceMeters: updated.endDistanceMeters,
          endAccuracyMeters: updated.endAccuracyMeters,
          endGeofenceRadiusMeters: updated.endGeofenceRadiusMeters,
        },
      }, actor));
      return updated;
    });
  }, resolveActor));

  app.post('/api/teacher-control/sessions/:sessionId/close-incomplete', handleRoute(async (req, _res, actor) => {
    if (actor.role !== 'school_admin') throw new TeacherControlApiError(403, 'Forbidden');
    const sessionId = positiveInteger(req.params.sessionId);
    const reason = nonEmptyText((req.body as Record<string, unknown>).reason);
    if (!sessionId || !reason) throw new TeacherControlApiError(400, 'sessionId and a reason are required');
    const access = await requireSchoolAccess(actor, null, ['school_admin']);
    const now = new Date();
    return db.transaction(async (tx) => {
      const [sessionSnapshot] = await tx.select({
        teacherId: teacherControlSessions.teacherId,
      }).from(teacherControlSessions).where(and(
        eq(teacherControlSessions.id, sessionId),
        eq(teacherControlSessions.schoolId, access.schoolId),
        eq(teacherControlSessions.status, 'open'),
      )).limit(1);
      if (!sessionSnapshot) throw new TeacherControlApiError(404, 'Open session not found');
      await lockTeacherControlTeacher(tx, sessionSnapshot.teacherId, access.schoolId);
      const [session] = await tx.select().from(teacherControlSessions).where(and(
        eq(teacherControlSessions.id, sessionId),
        eq(teacherControlSessions.schoolId, access.schoolId),
        eq(teacherControlSessions.status, 'open'),
      )).for('update').limit(1);
      if (!session) throw new TeacherControlApiError(404, 'Open session not found');
      const [pendingRequest] = await tx.select({ id: teacherControlRegularizationRequests.id })
        .from(teacherControlRegularizationRequests)
        .where(and(
          eq(teacherControlRegularizationRequests.sessionId, sessionId),
          eq(teacherControlRegularizationRequests.status, 'pending'),
        ))
        .limit(1);
      if (pendingRequest) throw new TeacherControlApiError(409, 'Resolve the pending regularization before closing the session');
      const [updated] = await tx.update(teacherControlSessions).set({
        status: 'closed_without_end',
        closedAt: now,
        closedByUserId: actor.id ?? null,
        closedByNameSnapshot: actorAuditName(actor),
        closeReason: reason,
        updatedAt: now,
      }).where(eq(teacherControlSessions.id, session.id)).returning();
      await insertAudit(tx, auditInput({
        schoolId: access.schoolId,
        schoolNameSnapshot: session.schoolNameSnapshot,
        action: 'session_closed_without_end',
        resourceType: 'session',
        resourceId: session.id,
        beforeValues: { status: session.status },
        afterValues: { status: updated.status, closedAt: updated.closedAt },
        reason,
      }, actor));
      return updated;
    });
  }, resolveActor));

  app.post('/api/teacher-control/sessions/:sessionId/regularizations', handleRoute(async (req, _res, actor) => {
    if (actor.role !== 'teacher' || actor.id == null) throw new TeacherControlApiError(403, 'Forbidden');
    const sessionId = positiveInteger(req.params.sessionId);
    const body = req.body as Record<string, unknown>;
    const proposedEndedAt = parseDate(body.proposedEndedAt);
    const reason = nonEmptyText(body.reason);
    if (!sessionId || !proposedEndedAt || !reason) throw new TeacherControlApiError(400, 'sessionId, proposedEndedAt and reason are required');
    const access = await requireSchoolAccess(actor, null, ['teacher']);
    const teacherId = await getTeacherId(actor, access.schoolId);
    const now = new Date();
    if (proposedEndedAt > now) throw new TeacherControlApiError(400, 'Proposed end time cannot be in the future');
    return db.transaction(async (tx) => {
      await lockTeacherControlTeacher(tx, teacherId, access.schoolId);
      const [session] = await tx.select().from(teacherControlSessions).where(and(
        eq(teacherControlSessions.id, sessionId),
        eq(teacherControlSessions.schoolId, access.schoolId),
        eq(teacherControlSessions.teacherId, teacherId),
        eq(teacherControlSessions.status, 'open'),
      )).for('update').limit(1);
      if (!session) throw new TeacherControlApiError(404, 'Open session not found');
      if (proposedEndedAt < session.startedAt) throw new TeacherControlApiError(400, 'Proposed end time cannot precede the session start');
      await assertNoTeacherControlOverlap(tx, {
        schoolId: access.schoolId,
        teacherId,
        startedAt: session.startedAt,
        endedAt: proposedEndedAt,
        excludedSessionId: sessionId,
      });
      const [created] = await tx.insert(teacherControlRegularizationRequests).values({
        sessionId,
        schoolId: access.schoolId,
        schoolNameSnapshot: session.schoolNameSnapshot,
        teacherId,
        teacherNameSnapshot: session.teacherNameSnapshot,
        proposedEndedAt,
        reason,
        status: 'pending',
        submittedByUserId: actor.id as number,
        submittedByNameSnapshot: actorAuditName(actor),
        updatedAt: now,
      }).returning();
      await insertAudit(tx, auditInput({
        schoolId: access.schoolId,
        schoolNameSnapshot: session.schoolNameSnapshot,
        action: 'regularization_requested',
        resourceType: 'regularization_request',
        resourceId: created.id,
        afterValues: { sessionId, proposedEndedAt, status: created.status },
        reason,
      }, actor));
      return created;
    });
  }, resolveActor));

  app.post('/api/teacher-control/regularizations/unrecorded', handleRoute(async (req, _res, actor) => {
    if (actor.role !== 'teacher' || actor.id == null) throw new TeacherControlApiError(403, 'Forbidden');
    const body = req.body as Record<string, unknown>;
    const requestType = body.requestType;
    if (requestType !== 'immediate_report' && requestType !== 'late_declaration') {
      throw new TeacherControlApiError(400, 'requestType must be immediate_report or late_declaration');
    }
    if (body.referenceStartedAt != null || body.startedAt != null || body.submittedAt != null) {
      throw new TeacherControlApiError(400, 'The official submission timestamp is generated by the server');
    }
    const classId = positiveInteger(body.classId);
    const subjectId = positiveInteger(body.subjectId);
    const reason = parseBoundedText(body.reason, 1000, 'reason');
    const description = parseBoundedText(body.description, 2000, 'description');
    if (!classId || !subjectId || !reason) {
      throw new TeacherControlApiError(400, 'classId, subjectId and reason are required');
    }
    const incidentType = body.incidentType;
    if (requestType === 'immediate_report'
      && !['gps_unavailable', 'gps_accuracy', 'permission_denied', 'network', 'application', 'other'].includes(String(incidentType))) {
      throw new TeacherControlApiError(400, 'A valid incidentType is required for an immediate report');
    }
    const declaredStartedAt = requestType === 'late_declaration' ? parseDate(body.declaredStartedAt) : null;
    const proposedEndedAt = requestType === 'late_declaration' ? parseDate(body.proposedEndedAt) : null;
    if (requestType === 'late_declaration' && (!declaredStartedAt || !proposedEndedAt)) {
      throw new TeacherControlApiError(400, 'A late declaration requires declaredStartedAt and proposedEndedAt');
    }
    const now = new Date();
    if (declaredStartedAt && proposedEndedAt && (declaredStartedAt >= proposedEndedAt || proposedEndedAt > now)) {
      throw new TeacherControlApiError(400, 'Declared session times must be ordered and cannot be in the future');
    }
    const gps = requestType === 'immediate_report' ? requestGpsDetails(body) : null;
    const technicalDetailsRaw = body.technicalDetails;
    if (technicalDetailsRaw != null
      && (typeof technicalDetailsRaw !== 'object'
        || Array.isArray(technicalDetailsRaw)
        || JSON.stringify(technicalDetailsRaw).length > 4000)) {
      throw new TeacherControlApiError(400, 'technicalDetails must be a small object');
    }
    const technicalDetails = technicalDetailsRaw as Record<string, unknown> | null | undefined;
    const safeTechnicalDetails = technicalDetails
      ? Object.fromEntries(Object.entries(technicalDetails).filter(([key, value]) => (
        ['gpsErrorCode', 'gpsErrorMessage', 'networkOnline', 'gpsAccuracyMeters'].includes(key)
        && (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
      )))
      : null;
    const access = await requireSchoolAccess(actor, body.schoolId, ['teacher']);
    const teacherId = await getTeacherId(actor, access.schoolId);

    return db.transaction(async (tx) => {
      await lockTeacherControlTeacher(tx, teacherId, access.schoolId);
      const pair = await getActiveTeacherPair(tx, teacherId, access.schoolId, classId, subjectId);
      const startedAt = requestType === 'immediate_report' ? now : declaredStartedAt!;
      await assertNoTeacherControlOverlap(tx, {
        schoolId: access.schoolId,
        teacherId,
        startedAt,
        endedAt: requestType === 'immediate_report' ? null : proposedEndedAt!,
      });
      const [created] = await tx.insert(teacherControlRegularizationRequests).values({
        sessionId: null,
        schoolId: access.schoolId,
        schoolNameSnapshot: access.schoolName,
        teacherId,
        teacherNameSnapshot: actorAuditName(actor),
        requestType,
        classId,
        classNameSnapshot: pair.className,
        subjectId,
        subjectNameSnapshot: pair.subjectName,
        referenceStartedAt: requestType === 'immediate_report' ? now : null,
        declaredStartedAt,
        proposedEndedAt,
        reason,
        description,
        incidentType: requestType === 'immediate_report' ? incidentType as IncidentType : null,
        technicalDetails: safeTechnicalDetails ?? null,
        gpsLatitude: gps?.latitude.toFixed(6) ?? null,
        gpsLongitude: gps?.longitude.toFixed(6) ?? null,
        gpsAccuracyMeters: gps?.accuracyMeters.toFixed(2) ?? null,
        status: 'pending',
        submittedByUserId: actor.id,
        submittedByNameSnapshot: actorAuditName(actor),
        createdAt: now,
        updatedAt: now,
      }).returning();
      await insertAudit(tx, auditInput({
        schoolId: access.schoolId,
        schoolNameSnapshot: access.schoolName,
        action: requestType === 'immediate_report' ? 'immediate_session_reported' : 'late_session_declared',
        resourceType: 'regularization_request',
        resourceId: created.id,
        afterValues: {
          requestType,
          classId,
          subjectId,
          referenceStartedAt: created.referenceStartedAt,
          declaredStartedAt,
          proposedEndedAt,
          incidentType: created.incidentType,
          status: created.status,
        },
        reason,
      }, actor));
      return created;
    });
  }, resolveActor));

  app.post('/api/teacher-control/regularizations/:requestId/complete', handleRoute(async (req, _res, actor) => {
    if (actor.role !== 'teacher' || actor.id == null) throw new TeacherControlApiError(403, 'Forbidden');
    const requestId = positiveInteger(req.params.requestId);
    const body = req.body as Record<string, unknown>;
    const proposedEndedAt = parseDate(body.proposedEndedAt);
    const description = parseBoundedText(body.description, 2000, 'description');
    if (!requestId || !proposedEndedAt) throw new TeacherControlApiError(400, 'A valid proposedEndedAt is required');
    const access = await requireSchoolAccess(actor, body.schoolId, ['teacher']);
    const teacherId = await getTeacherId(actor, access.schoolId);
    return db.transaction(async (tx) => {
      await lockTeacherControlTeacher(tx, teacherId, access.schoolId);
      const [requestRow] = await tx.select().from(teacherControlRegularizationRequests).where(and(
        eq(teacherControlRegularizationRequests.id, requestId),
        eq(teacherControlRegularizationRequests.schoolId, access.schoolId),
        eq(teacherControlRegularizationRequests.teacherId, teacherId),
        eq(teacherControlRegularizationRequests.status, 'pending'),
        eq(teacherControlRegularizationRequests.requestType, 'immediate_report'),
      )).for('update').limit(1);
      if (!requestRow || !requestRow.referenceStartedAt || requestRow.sessionId != null) {
        throw new TeacherControlApiError(404, 'Pending immediate report not found');
      }
      const now = new Date();
      if (proposedEndedAt <= requestRow.referenceStartedAt || proposedEndedAt > now) {
        throw new TeacherControlApiError(400, 'The declared end time must follow the server report time and cannot be in the future');
      }
      await assertNoTeacherControlOverlap(tx, {
        schoolId: access.schoolId,
        teacherId,
        startedAt: requestRow.referenceStartedAt,
        endedAt: proposedEndedAt,
        excludedRequestId: requestId,
      });
      const [updated] = await tx.update(teacherControlRegularizationRequests).set({
        proposedEndedAt,
        description: description ? [requestRow.description, description].filter(Boolean).join('\n\n') : requestRow.description,
        updatedAt: now,
      }).where(eq(teacherControlRegularizationRequests.id, requestId)).returning();
      await insertAudit(tx, auditInput({
        schoolId: access.schoolId,
        schoolNameSnapshot: requestRow.schoolNameSnapshot,
        action: 'immediate_session_report_completed',
        resourceType: 'regularization_request',
        resourceId: requestId,
        beforeValues: { proposedEndedAt: requestRow.proposedEndedAt },
        afterValues: { proposedEndedAt: updated.proposedEndedAt },
      }, actor));
      return updated;
    });
  }, resolveActor));

  app.get('/api/teacher-control/regularizations', handleRoute(async (req, _res, actor) => {
    if (actor.role === 'teacher') {
      const access = await requireSchoolAccess(actor, null, ['teacher']);
      const teacherId = await getTeacherId(actor, access.schoolId);
      const rows = await db.select({
        request: teacherControlRegularizationRequests,
        decision: teacherControlRegularizationDecisions,
      }).from(teacherControlRegularizationRequests)
        .leftJoin(teacherControlRegularizationDecisions, eq(
          teacherControlRegularizationDecisions.requestId,
          teacherControlRegularizationRequests.id,
        ))
        .where(and(
          eq(teacherControlRegularizationRequests.schoolId, access.schoolId),
          eq(teacherControlRegularizationRequests.teacherId, teacherId),
        ))
        .orderBy(desc(teacherControlRegularizationRequests.createdAt));
      return groupRegularizationHistory(rows);
    }
    const access = await requireSchoolAccess(actor, req.query.schoolId, ['school_admin', 'super_admin']);
    const rows = await db.select({
      request: teacherControlRegularizationRequests,
      decision: teacherControlRegularizationDecisions,
    }).from(teacherControlRegularizationRequests)
      .leftJoin(teacherControlRegularizationDecisions, eq(
        teacherControlRegularizationDecisions.requestId,
        teacherControlRegularizationRequests.id,
      ))
      .where(eq(teacherControlRegularizationRequests.schoolId, access.schoolId))
      .orderBy(desc(teacherControlRegularizationRequests.createdAt));
    return groupRegularizationHistory(rows);
  }, resolveActor));

  app.post('/api/teacher-control/regularizations/:requestId/decision', handleRoute(async (req, _res, actor) => {
    if (actor.role !== 'school_admin' && actor.role !== 'super_admin') throw new TeacherControlApiError(403, 'Forbidden');
    const requestId = positiveInteger(req.params.requestId);
    const body = req.body as Record<string, unknown>;
    const decision = body.decision;
    const reason = nonEmptyText(body.reason);
    if (!requestId || (decision !== 'accepted' && decision !== 'rejected' && decision !== 'modified_accepted')) {
      throw new TeacherControlApiError(400, 'requestId or decision is invalid');
    }
    if ((decision === 'rejected' || decision === 'modified_accepted') && !reason) {
      throw new TeacherControlApiError(400, 'A reason is required for this decision');
    }
    const access = await requireSchoolAccess(actor, body.schoolId, ['school_admin', 'super_admin']);
    return db.transaction(async (tx) => {
      const [requestSnapshot] = await tx.select({
        teacherId: teacherControlRegularizationRequests.teacherId,
        requestType: teacherControlRegularizationRequests.requestType,
        sessionId: teacherControlRegularizationRequests.sessionId,
      }).from(teacherControlRegularizationRequests).where(and(
        eq(teacherControlRegularizationRequests.id, requestId),
        eq(teacherControlRegularizationRequests.schoolId, access.schoolId),
        eq(teacherControlRegularizationRequests.status, 'pending'),
      )).limit(1);
      if (!requestSnapshot) throw new TeacherControlApiError(404, 'Pending regularization request not found');
      const isExistingSessionRequest = requestSnapshot.requestType === 'incomplete_session';
      const teacherForRegularization = await lockTeacherControlTeacher(
        tx,
        requestSnapshot.teacherId,
        access.schoolId,
      );
      const [session] = requestSnapshot.sessionId == null
        ? []
        : await tx.select().from(teacherControlSessions).where(and(
          eq(teacherControlSessions.id, requestSnapshot.sessionId),
          eq(teacherControlSessions.schoolId, access.schoolId),
          eq(teacherControlSessions.status, 'open'),
        )).for('update').limit(1);
      if (isExistingSessionRequest && !session) {
        throw new TeacherControlApiError(409, 'The related session is no longer open');
      }
      const [requestRow] = await tx.select().from(teacherControlRegularizationRequests).where(and(
        eq(teacherControlRegularizationRequests.id, requestId),
        eq(teacherControlRegularizationRequests.schoolId, access.schoolId),
        eq(teacherControlRegularizationRequests.status, 'pending'),
      )).for('update').limit(1);
      if (!requestRow) throw new TeacherControlApiError(404, 'Pending regularization request not found');
      if (isExistingSessionRequest && !session) {
        throw new TeacherControlApiError(409, 'The related session is no longer open');
      }
      if (!isExistingSessionRequest && requestRow.sessionId != null) {
        throw new TeacherControlApiError(409, 'This request has already been linked to a session');
      }

      const proposedStartedAt = isExistingSessionRequest
        ? session?.startedAt ?? null
        : requestRow.requestType === 'immediate_report'
          ? requestRow.referenceStartedAt
          : requestRow.declaredStartedAt;
      if (requestRow.requestType === 'immediate_report' && !requestRow.proposedEndedAt && decision !== 'rejected') {
        throw new TeacherControlApiError(409, 'The teacher must submit the declared end time before this report can be accepted');
      }
      const decidedStartedAt = decision === 'rejected'
        ? null
        : decision === 'modified_accepted' && !isExistingSessionRequest
          ? parseDate(body.proposedStartedAt)
          : proposedStartedAt;
      const decidedEndedAt = decision === 'rejected'
        ? null
        : decision === 'modified_accepted'
          ? parseDate(body.proposedEndedAt)
          : requestRow.proposedEndedAt;
      if (decision !== 'rejected' && (!decidedStartedAt || !decidedEndedAt)) {
        throw new TeacherControlApiError(400, 'Valid accepted start and end times are required');
      }
      const now = new Date();
      if (decidedStartedAt && decidedEndedAt
        && (decidedStartedAt >= decidedEndedAt || decidedEndedAt > now)) {
        throw new TeacherControlApiError(400, 'Accepted times must be ordered and cannot be in the future');
      }
      if (decidedStartedAt && decidedEndedAt) {
        await assertNoTeacherControlOverlap(tx, {
          schoolId: access.schoolId,
          teacherId: requestRow.teacherId,
          startedAt: decidedStartedAt,
          endedAt: decidedEndedAt,
          excludedSessionId: session?.id,
          excludedRequestId: requestId,
        });
      }

      let updatedSession = session ?? null;
      let linkedSessionId = session?.id ?? null;
      if (decision !== 'rejected' && !isExistingSessionRequest) {
        if (requestRow.classId == null || requestRow.subjectId == null) {
          throw new TeacherControlApiError(409, 'The teacher or pedagogical association is no longer available');
        }
        const pair = await getActiveTeacherPair(
          tx,
          requestRow.teacherId,
          access.schoolId,
          requestRow.classId,
          requestRow.subjectId,
        );
        const [rate] = await tx.select({
          hourlyRateXof: teacherControlHourlyRates.hourlyRateXof,
        }).from(teacherControlHourlyRates).where(and(
          eq(teacherControlHourlyRates.schoolId, access.schoolId),
          eq(teacherControlHourlyRates.teacherId, requestRow.teacherId),
        )).limit(1);
        const [createdSession] = await tx.insert(teacherControlSessions).values({
          schoolId: access.schoolId,
          schoolNameSnapshot: requestRow.schoolNameSnapshot,
          teacherId: requestRow.teacherId,
          teacherUserId: teacherForRegularization.userId,
          teacherNameSnapshot: requestRow.teacherNameSnapshot,
          teachingAssignmentId: pair.teachingAssignmentId,
          classTeacherAssociationId: pair.teachingAssignmentId == null ? pair.classTeacherAssociationId : null,
          teacherSubjectAssociationId: pair.teachingAssignmentId == null ? pair.teacherSubjectAssociationId : null,
          classId: pair.classId,
          classNameSnapshot: pair.className,
          subjectId: pair.subjectId,
          subjectNameSnapshot: pair.subjectName,
          startSource: 'regularization',
          regularizationOrigin: requestRow.requestType,
          regularizationRequestId: requestId,
          status: 'completed',
          startedAt: decidedStartedAt,
          startDistanceMeters: null,
          startAccuracyMeters: null,
          startGeofenceRadiusMeters: null,
          validatedEndedAt: decidedEndedAt,
          endSource: 'regularization',
          endDistanceMeters: null,
          endAccuracyMeters: null,
          endGeofenceRadiusMeters: null,
          closedAt: null,
          closedByUserId: null,
          closedByNameSnapshot: null,
          closeReason: null,
          hourlyRateXofSnapshot: rate?.hourlyRateXof ?? null,
          updatedAt: now,
        }).returning();
        updatedSession = createdSession;
        linkedSessionId = createdSession.id;
        await insertAudit(tx, auditInput({
          schoolId: access.schoolId,
          schoolNameSnapshot: requestRow.schoolNameSnapshot,
          action: 'session_created_by_regularization',
          resourceType: 'session',
          resourceId: createdSession.id,
          afterValues: {
            requestId,
            requestType: requestRow.requestType,
            startedAt: decidedStartedAt,
            validatedEndedAt: decidedEndedAt,
            startSource: createdSession.startSource,
            endSource: createdSession.endSource,
          },
          reason,
        }, actor));
      }

      const [updatedRequest] = await tx.update(teacherControlRegularizationRequests).set({
        status: decision,
        ...(decision !== 'rejected' && linkedSessionId != null && !isExistingSessionRequest
          ? { sessionId: linkedSessionId }
          : {}),
        updatedAt: now,
      }).where(eq(teacherControlRegularizationRequests.id, requestId)).returning();
      const [history] = await tx.insert(teacherControlRegularizationDecisions).values({
        requestId,
        sessionId: linkedSessionId,
        schoolId: access.schoolId,
        schoolNameSnapshot: requestRow.schoolNameSnapshot,
        decision,
        previousProposedEndedAt: requestRow.proposedEndedAt,
        previousProposedStartedAt: proposedStartedAt,
        decidedStartedAt,
        decidedEndedAt,
        reason,
        actorUserId: actor.id ?? null,
        actorRole: actor.role,
        actorNameSnapshot: actorAuditName(actor),
      }).returning();
      if (isExistingSessionRequest && decision !== 'rejected' && session && decidedEndedAt) {
        [updatedSession] = await tx.update(teacherControlSessions).set({
          status: 'completed',
          validatedEndedAt: decidedEndedAt,
          endSource: 'regularization',
          updatedAt: now,
        }).where(eq(teacherControlSessions.id, session.id)).returning();
      }
      await insertAudit(tx, auditInput({
        schoolId: access.schoolId,
        schoolNameSnapshot: requestRow.schoolNameSnapshot,
        action: `regularization_${decision}`,
        resourceType: 'regularization_request',
        resourceId: requestId,
        beforeValues: {
          status: requestRow.status,
          proposedStartedAt,
          proposedEndedAt: requestRow.proposedEndedAt,
        },
        afterValues: {
          status: updatedRequest.status,
          sessionId: linkedSessionId,
          decidedStartedAt,
          decidedEndedAt,
          decisionId: history.id,
        },
        reason,
      }, actor));
      return { request: updatedRequest, decision: history, session: updatedSession };
    });
  }, resolveActor));

  app.get('/api/teacher-control/sessions/:sessionId/audit', handleRoute(async (req, _res, actor) => {
    const sessionId = positiveInteger(req.params.sessionId);
    if (!sessionId) throw new TeacherControlApiError(400, 'sessionId is invalid');
    const isTeacher = actor.role === 'teacher';
    const access = await requireSchoolAccess(
      actor,
      isTeacher ? null : req.query.schoolId,
      isTeacher ? ['teacher'] : ['school_admin', 'super_admin'],
    );
    const teacherId = isTeacher ? await getTeacherId(actor, access.schoolId) : null;
    const [session] = await db.select({ id: teacherControlSessions.id })
      .from(teacherControlSessions)
      .where(and(
        eq(teacherControlSessions.id, sessionId),
        eq(teacherControlSessions.schoolId, access.schoolId),
        ...(teacherId == null ? [] : [eq(teacherControlSessions.teacherId, teacherId)]),
      ))
      .limit(1);
    if (!session) throw new TeacherControlApiError(404, 'Session not found');

    const requests = await db.select({ id: teacherControlRegularizationRequests.id })
      .from(teacherControlRegularizationRequests)
      .where(and(
        eq(teacherControlRegularizationRequests.sessionId, sessionId),
        eq(teacherControlRegularizationRequests.schoolId, access.schoolId),
        ...(teacherId == null ? [] : [eq(teacherControlRegularizationRequests.teacherId, teacherId)]),
      ));
    const auditConditions = [
      and(
        eq(teacherControlAuditEvents.resourceType, 'session'),
        eq(teacherControlAuditEvents.resourceId, sessionId),
      ),
    ];
    if (requests.length > 0) {
      auditConditions.push(and(
        eq(teacherControlAuditEvents.resourceType, 'regularization_request'),
        inArray(teacherControlAuditEvents.resourceId, requests.map((entry) => entry.id)),
      ));
    }
    const events = await db.select({
      id: teacherControlAuditEvents.id,
      schoolId: teacherControlAuditEvents.schoolId,
      schoolNameSnapshot: teacherControlAuditEvents.schoolNameSnapshot,
      actorUserId: teacherControlAuditEvents.actorUserId,
      actorRole: teacherControlAuditEvents.actorRole,
      actorNameSnapshot: teacherControlAuditEvents.actorNameSnapshot,
      actorEmailSnapshot: teacherControlAuditEvents.actorEmailSnapshot,
      action: teacherControlAuditEvents.action,
      resourceType: teacherControlAuditEvents.resourceType,
      resourceId: teacherControlAuditEvents.resourceId,
      beforeValues: teacherControlAuditEvents.beforeValues,
      afterValues: teacherControlAuditEvents.afterValues,
      reason: teacherControlAuditEvents.reason,
      createdAt: teacherControlAuditEvents.createdAt,
    }).from(teacherControlAuditEvents)
      .where(and(
        eq(teacherControlAuditEvents.schoolId, access.schoolId),
        or(...auditConditions),
      ))
      .orderBy(asc(teacherControlAuditEvents.createdAt), asc(teacherControlAuditEvents.id));

    return events.map((event) => ({
      ...event,
      beforeValues: redactGpsCoordinates(event.beforeValues),
      afterValues: redactGpsCoordinates(event.afterValues),
    }));
  }, resolveActor));

  app.get('/api/teacher-control/filter-options', handleRoute(async (req, _res, actor) => {
    if (actor.role !== 'school_admin' && actor.role !== 'super_admin') {
      throw new TeacherControlApiError(403, 'Forbidden');
    }

    const schoolId = actor.role === 'super_admin' && (req.query.schoolId == null || req.query.schoolId === '')
      ? null
      : (await requireSchoolAccess(actor, req.query.schoolId, ['school_admin', 'super_admin'])).schoolId;
    const selectOptions = (
      idColumn: typeof teacherControlSessions.teacherId | typeof teacherControlSessions.classId | typeof teacherControlSessions.subjectId,
      nameColumn: typeof teacherControlSessions.teacherNameSnapshot | typeof teacherControlSessions.classNameSnapshot | typeof teacherControlSessions.subjectNameSnapshot,
    ) => {
      const query = db.select({
        id: idColumn,
        name: nameColumn,
        schoolName: teacherControlSessions.schoolNameSnapshot,
      }).from(teacherControlSessions);
      const scopedQuery = schoolId == null
        ? query
        : query.where(eq(teacherControlSessions.schoolId, schoolId));
      return scopedQuery.groupBy(idColumn, nameColumn, teacherControlSessions.schoolNameSnapshot)
        .orderBy(asc(nameColumn), asc(idColumn));
    };
    const [teachersOptions, classesOptions, subjectsOptions] = await Promise.all([
      selectOptions(teacherControlSessions.teacherId, teacherControlSessions.teacherNameSnapshot),
      selectOptions(teacherControlSessions.classId, teacherControlSessions.classNameSnapshot),
      selectOptions(teacherControlSessions.subjectId, teacherControlSessions.subjectNameSnapshot),
    ]);

    const mapOptions = (options: Array<{ id: number; name: string; schoolName: string }>) => options.map((option) => ({
      id: option.id,
      name: schoolId == null && actor.role === 'super_admin'
        ? `${option.name} · ${option.schoolName}`
        : option.name,
    }));

    return {
      teachers: mapOptions(teachersOptions),
      classes: mapOptions(classesOptions),
      subjects: mapOptions(subjectsOptions),
    };
  }, resolveActor));

  app.get('/api/teacher-control/sessions', handleRoute(async (req, _res, actor) => {
    const isTeacher = actor.role === 'teacher';
    const isGlobalSuperAdmin = actor.role === 'super_admin' && req.query.schoolId == null;
    let schoolId: number | null;
    let teacherId: number | null = null;
    if (isGlobalSuperAdmin) {
      if (actor.id == null) throw new TeacherControlApiError(403, 'Forbidden');
      schoolId = null;
    } else {
      const access = await requireSchoolAccess(
        actor,
        isTeacher ? null : req.query.schoolId,
        isTeacher ? ['teacher'] : ['school_admin', 'super_admin'],
      );
      schoolId = access.schoolId;
      if (isTeacher) teacherId = await getTeacherId(actor, access.schoolId);
    }

    const limit = parsePageLimit(req.query);
    const cursor = decodeSessionCursor(req.query.cursor);
    const filters = parseSessionFilters(req.query);
    if (isTeacher) filters.teacherId = null;
    const filterConditions = sessionFilterConditions(filters);
    if (schoolId != null) filterConditions.push(eq(teacherControlSessions.schoolId, schoolId));
    if (teacherId != null) filterConditions.push(eq(teacherControlSessions.teacherId, teacherId));
    const countConditions = [...filterConditions];
    const conditions = [...filterConditions];
    if (cursor) {
      conditions.push(or(
        lt(teacherControlSessions.startedAt, cursor.startedAt),
        and(
          eq(teacherControlSessions.startedAt, cursor.startedAt),
          lt(teacherControlSessions.id, cursor.id),
        ),
      ));
    }

    const allConditions = conditions.length > 0 ? and(...conditions) : undefined;
    const [countRow] = await db.select({ count: sql<number>`count(*)::integer` })
      .from(teacherControlSessions)
      .where(countConditions.length > 0 ? and(...countConditions) : undefined);
    const rows = await db.select().from(teacherControlSessions)
      .where(allConditions)
      .orderBy(desc(teacherControlSessions.startedAt), desc(teacherControlSessions.id))
      .limit(limit + 1);
    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;
    const lastRow = pageRows.at(-1);
    return {
      items: pageRows.map((session) => ({
        ...session,
        ...calculateTeacherControlCompensation({
          startedAt: session.startedAt,
          validatedEndedAt: session.validatedEndedAt,
          hourlyRateXof: session.hourlyRateXofSnapshot,
        }),
      })),
      nextCursor: hasMore && lastRow ? encodeSessionCursor(lastRow) : null,
      hasMore,
      limit,
      totalCount: Number(countRow?.count ?? 0),
    };
  }, resolveActor));

  app.get('/api/teacher-control/statistics', handleRoute(async (req, _res, actor) => {
    const isTeacher = actor.role === 'teacher';
    const access = await requireSchoolAccess(
      actor,
      isTeacher ? null : req.query.schoolId,
      isTeacher ? ['teacher'] : ['school_admin', 'super_admin'],
    );
    const filters = parseSessionFilters(req.query);
    if (isTeacher) {
      filters.teacherId = await getTeacherId(actor, access.schoolId);
    }
    const conditions = [
      eq(teacherControlSessions.schoolId, access.schoolId),
      ...sessionFilterConditions(filters),
    ];
    const [summary] = await db.select({
      totalSessions: sql<number>`count(*)::integer`,
      openSessions: sql<number>`count(*) FILTER (WHERE ${teacherControlSessions.status} = 'open')::integer`,
      completedSessions: sql<number>`count(*) FILTER (WHERE ${teacherControlSessions.validatedEndedAt} IS NOT NULL)::integer`,
      incompleteSessions: sql<number>`count(*) FILTER (WHERE ${teacherControlSessions.status} = 'closed_without_end')::integer`,
      regularizedSessions: sql<number>`count(*) FILTER (WHERE ${teacherControlSessions.endSource} = 'regularization')::integer`,
      gpsCompletedSessions: sql<number>`count(*) FILTER (WHERE ${teacherControlSessions.validatedEndedAt} IS NOT NULL AND ${teacherControlSessions.endSource} = 'gps')::integer`,
      incompleteSessionRegularizations: sql<number>`count(*) FILTER (WHERE ${teacherControlSessions.startSource} = 'gps' AND ${teacherControlSessions.endSource} = 'regularization')::integer`,
      immediateRegularizedSessions: sql<number>`count(*) FILTER (WHERE ${teacherControlSessions.regularizationOrigin} = 'immediate_report')::integer`,
      lateRegularizedSessions: sql<number>`count(*) FILTER (WHERE ${teacherControlSessions.regularizationOrigin} = 'late_declaration')::integer`,
      gpsDurationMilliseconds: sql<number>`coalesce(sum(extract(epoch FROM (${teacherControlSessions.validatedEndedAt} - ${teacherControlSessions.startedAt})) * 1000) FILTER (WHERE ${teacherControlSessions.validatedEndedAt} IS NOT NULL AND ${teacherControlSessions.endSource} = 'gps'), 0)::bigint`,
      incompleteRegularizedDurationMilliseconds: sql<number>`coalesce(sum(extract(epoch FROM (${teacherControlSessions.validatedEndedAt} - ${teacherControlSessions.startedAt})) * 1000) FILTER (WHERE ${teacherControlSessions.validatedEndedAt} IS NOT NULL AND ${teacherControlSessions.startSource} = 'gps' AND ${teacherControlSessions.endSource} = 'regularization'), 0)::bigint`,
      immediateRegularizedDurationMilliseconds: sql<number>`coalesce(sum(extract(epoch FROM (${teacherControlSessions.validatedEndedAt} - ${teacherControlSessions.startedAt})) * 1000) FILTER (WHERE ${teacherControlSessions.regularizationOrigin} = 'immediate_report'), 0)::bigint`,
      lateRegularizedDurationMilliseconds: sql<number>`coalesce(sum(extract(epoch FROM (${teacherControlSessions.validatedEndedAt} - ${teacherControlSessions.startedAt})) * 1000) FILTER (WHERE ${teacherControlSessions.regularizationOrigin} = 'late_declaration'), 0)::bigint`,
      validatedDurationMilliseconds: sql<number>`
        coalesce(sum(extract(epoch FROM (${teacherControlSessions.validatedEndedAt} - ${teacherControlSessions.startedAt})) * 1000)
          FILTER (WHERE ${teacherControlSessions.validatedEndedAt} IS NOT NULL), 0)::bigint
      `,
      estimatedCompensationXof: sql<number>`
        coalesce(sum(round(${teacherControlSessions.hourlyRateXofSnapshot}
          * extract(epoch FROM (${teacherControlSessions.validatedEndedAt} - ${teacherControlSessions.startedAt})) / 3600))
          FILTER (WHERE ${teacherControlSessions.validatedEndedAt} IS NOT NULL
            AND ${teacherControlSessions.hourlyRateXofSnapshot} IS NOT NULL), 0)::bigint
      `,
    }).from(teacherControlSessions).where(and(...conditions));
    const pendingConditions = [
      eq(teacherControlRegularizationRequests.schoolId, access.schoolId),
      eq(teacherControlRegularizationRequests.status, 'pending'),
      ...sessionFilterConditions(filters),
    ];
    const [pendingRow] = await db.select({
      pendingRegularizations: sql<number>`count(*)::integer`,
    }).from(teacherControlRegularizationRequests)
      .innerJoin(
        teacherControlSessions,
        eq(teacherControlSessions.id, teacherControlRegularizationRequests.sessionId),
      )
      .where(and(...pendingConditions));
    const unrecordedConditions = [
      eq(teacherControlRegularizationRequests.schoolId, access.schoolId),
      eq(teacherControlRegularizationRequests.status, 'pending'),
      inArray(teacherControlRegularizationRequests.requestType, ['immediate_report', 'late_declaration']),
      ...(filters.teacherId == null ? [] : [eq(teacherControlRegularizationRequests.teacherId, filters.teacherId)]),
      ...(filters.classId == null ? [] : [eq(teacherControlRegularizationRequests.classId, filters.classId)]),
      ...(filters.subjectId == null ? [] : [eq(teacherControlRegularizationRequests.subjectId, filters.subjectId)]),
      ...(filters.from == null ? [] : [gte(
        sql<Date>`coalesce(${teacherControlRegularizationRequests.referenceStartedAt}, ${teacherControlRegularizationRequests.declaredStartedAt})`,
        filters.from,
      )]),
      ...(filters.to == null ? [] : [lte(
        sql<Date>`coalesce(${teacherControlRegularizationRequests.referenceStartedAt}, ${teacherControlRegularizationRequests.declaredStartedAt})`,
        filters.to,
      )]),
    ];
    const [unrecordedPendingRow] = await db.select({
      pendingRegularizations: sql<number>`count(*)::integer`,
    }).from(teacherControlRegularizationRequests).where(and(...unrecordedConditions));
    return {
      schoolId: access.schoolId,
      ...summary,
      pendingRegularizations: Number(pendingRow?.pendingRegularizations ?? 0)
        + Number(unrecordedPendingRow?.pendingRegularizations ?? 0),
      validatedDurationMilliseconds: Number(summary?.validatedDurationMilliseconds ?? 0),
      estimatedCompensationXof: Number(summary?.estimatedCompensationXof ?? 0),
    };
  }, resolveActor));

  app.get('/api/teacher-control/statistics/global', handleRoute(async (req, _res, actor) => {
    if (actor.role !== 'super_admin' || actor.id == null) throw new TeacherControlApiError(403, 'Forbidden');
    const filters = parseSessionFilters(req.query);
    const sessionConditions = sessionFilterConditions(filters);
    const perSchoolQuery = db.select({
      schoolId: teacherControlSessions.schoolId,
      schoolName: sql<string>`coalesce(${schools.name}, 'École supprimée')`,
      totalSessions: sql<number>`count(*)::integer`,
      openSessions: sql<number>`count(*) FILTER (WHERE ${teacherControlSessions.status} = 'open')::integer`,
      completedSessions: sql<number>`count(*) FILTER (WHERE ${teacherControlSessions.validatedEndedAt} IS NOT NULL)::integer`,
      incompleteSessions: sql<number>`count(*) FILTER (WHERE ${teacherControlSessions.status} = 'closed_without_end')::integer`,
      regularizedSessions: sql<number>`count(*) FILTER (WHERE ${teacherControlSessions.endSource} = 'regularization')::integer`,
      gpsCompletedSessions: sql<number>`count(*) FILTER (WHERE ${teacherControlSessions.validatedEndedAt} IS NOT NULL AND ${teacherControlSessions.endSource} = 'gps')::integer`,
      incompleteSessionRegularizations: sql<number>`count(*) FILTER (WHERE ${teacherControlSessions.startSource} = 'gps' AND ${teacherControlSessions.endSource} = 'regularization')::integer`,
      immediateRegularizedSessions: sql<number>`count(*) FILTER (WHERE ${teacherControlSessions.regularizationOrigin} = 'immediate_report')::integer`,
      lateRegularizedSessions: sql<number>`count(*) FILTER (WHERE ${teacherControlSessions.regularizationOrigin} = 'late_declaration')::integer`,
      gpsDurationMilliseconds: sql<number>`coalesce(sum(extract(epoch FROM (${teacherControlSessions.validatedEndedAt} - ${teacherControlSessions.startedAt})) * 1000) FILTER (WHERE ${teacherControlSessions.validatedEndedAt} IS NOT NULL AND ${teacherControlSessions.endSource} = 'gps'), 0)::bigint`,
      incompleteRegularizedDurationMilliseconds: sql<number>`coalesce(sum(extract(epoch FROM (${teacherControlSessions.validatedEndedAt} - ${teacherControlSessions.startedAt})) * 1000) FILTER (WHERE ${teacherControlSessions.validatedEndedAt} IS NOT NULL AND ${teacherControlSessions.startSource} = 'gps' AND ${teacherControlSessions.endSource} = 'regularization'), 0)::bigint`,
      immediateRegularizedDurationMilliseconds: sql<number>`coalesce(sum(extract(epoch FROM (${teacherControlSessions.validatedEndedAt} - ${teacherControlSessions.startedAt})) * 1000) FILTER (WHERE ${teacherControlSessions.regularizationOrigin} = 'immediate_report'), 0)::bigint`,
      lateRegularizedDurationMilliseconds: sql<number>`coalesce(sum(extract(epoch FROM (${teacherControlSessions.validatedEndedAt} - ${teacherControlSessions.startedAt})) * 1000) FILTER (WHERE ${teacherControlSessions.regularizationOrigin} = 'late_declaration'), 0)::bigint`,
      validatedDurationMilliseconds: sql<number>`
        coalesce(sum(extract(epoch FROM (${teacherControlSessions.validatedEndedAt} - ${teacherControlSessions.startedAt})) * 1000)
          FILTER (WHERE ${teacherControlSessions.validatedEndedAt} IS NOT NULL), 0)::bigint
      `,
      estimatedCompensationXof: sql<number>`
        coalesce(sum(round(${teacherControlSessions.hourlyRateXofSnapshot}
          * extract(epoch FROM (${teacherControlSessions.validatedEndedAt} - ${teacherControlSessions.startedAt})) / 3600))
          FILTER (WHERE ${teacherControlSessions.validatedEndedAt} IS NOT NULL
            AND ${teacherControlSessions.hourlyRateXofSnapshot} IS NOT NULL), 0)::bigint
      `,
    }).from(teacherControlSessions)
      .leftJoin(schools, eq(teacherControlSessions.schoolId, schools.id));
    const perSchoolRows = await (sessionConditions.length > 0
      ? perSchoolQuery.where(and(...sessionConditions))
      : perSchoolQuery)
      .groupBy(teacherControlSessions.schoolId, schools.name)
      .orderBy(asc(schools.name), asc(teacherControlSessions.schoolId));

    const pendingConditions = [
      eq(teacherControlRegularizationRequests.status, 'pending'),
      ...sessionFilterConditions(filters),
    ];
    const pendingRows = await db.select({
      schoolId: teacherControlRegularizationRequests.schoolId,
      pendingRegularizations: sql<number>`count(*)::integer`,
    }).from(teacherControlRegularizationRequests)
      .innerJoin(
        teacherControlSessions,
        eq(teacherControlSessions.id, teacherControlRegularizationRequests.sessionId),
      )
      .where(and(...pendingConditions))
      .groupBy(teacherControlRegularizationRequests.schoolId);
    const unrecordedPendingConditions = [
      eq(teacherControlRegularizationRequests.status, 'pending'),
      inArray(teacherControlRegularizationRequests.requestType, ['immediate_report', 'late_declaration']),
      ...(filters.teacherId == null ? [] : [eq(teacherControlRegularizationRequests.teacherId, filters.teacherId)]),
      ...(filters.classId == null ? [] : [eq(teacherControlRegularizationRequests.classId, filters.classId)]),
      ...(filters.subjectId == null ? [] : [eq(teacherControlRegularizationRequests.subjectId, filters.subjectId)]),
      ...(filters.from == null ? [] : [gte(
        sql<Date>`coalesce(${teacherControlRegularizationRequests.referenceStartedAt}, ${teacherControlRegularizationRequests.declaredStartedAt})`,
        filters.from,
      )]),
      ...(filters.to == null ? [] : [lte(
        sql<Date>`coalesce(${teacherControlRegularizationRequests.referenceStartedAt}, ${teacherControlRegularizationRequests.declaredStartedAt})`,
        filters.to,
      )]),
    ];
    const unrecordedPendingRows = await db.select({
      schoolId: teacherControlRegularizationRequests.schoolId,
      pendingRegularizations: sql<number>`count(*)::integer`,
    }).from(teacherControlRegularizationRequests)
      .where(and(...unrecordedPendingConditions))
      .groupBy(teacherControlRegularizationRequests.schoolId);
    const pendingBySchool = new Map<number, number>();
    for (const row of pendingRows) {
      pendingBySchool.set(row.schoolId, Number(row.pendingRegularizations ?? 0));
    }
    for (const row of unrecordedPendingRows) {
      pendingBySchool.set(row.schoolId, (pendingBySchool.get(row.schoolId) ?? 0) + Number(row.pendingRegularizations ?? 0));
    }
    const schoolsWithSessions = new Map(perSchoolRows.map((row) => [row.schoolId, {
      schoolId: row.schoolId,
      schoolName: row.schoolName,
      totalSessions: Number(row.totalSessions ?? 0),
      openSessions: Number(row.openSessions ?? 0),
      completedSessions: Number(row.completedSessions ?? 0),
      incompleteSessions: Number(row.incompleteSessions ?? 0),
      regularizedSessions: Number(row.regularizedSessions ?? 0),
      gpsCompletedSessions: Number(row.gpsCompletedSessions ?? 0),
      incompleteSessionRegularizations: Number(row.incompleteSessionRegularizations ?? 0),
      immediateRegularizedSessions: Number(row.immediateRegularizedSessions ?? 0),
      lateRegularizedSessions: Number(row.lateRegularizedSessions ?? 0),
      gpsDurationMilliseconds: Number(row.gpsDurationMilliseconds ?? 0),
      incompleteRegularizedDurationMilliseconds: Number(row.incompleteRegularizedDurationMilliseconds ?? 0),
      immediateRegularizedDurationMilliseconds: Number(row.immediateRegularizedDurationMilliseconds ?? 0),
      lateRegularizedDurationMilliseconds: Number(row.lateRegularizedDurationMilliseconds ?? 0),
      pendingRegularizations: pendingBySchool.get(row.schoolId) ?? 0,
      validatedDurationMilliseconds: Number(row.validatedDurationMilliseconds ?? 0),
      estimatedCompensationXof: Number(row.estimatedCompensationXof ?? 0),
    }]));
    const existingSchools = await db.select({
      schoolId: schools.id,
      schoolName: schools.name,
    }).from(schools);
    for (const school of existingSchools) {
      if (!schoolsWithSessions.has(school.schoolId)) {
        schoolsWithSessions.set(school.schoolId, {
          schoolId: school.schoolId,
          schoolName: school.schoolName,
          totalSessions: 0,
          openSessions: 0,
          completedSessions: 0,
          incompleteSessions: 0,
          regularizedSessions: 0,
          gpsCompletedSessions: 0,
          incompleteSessionRegularizations: 0,
          immediateRegularizedSessions: 0,
          lateRegularizedSessions: 0,
          gpsDurationMilliseconds: 0,
          incompleteRegularizedDurationMilliseconds: 0,
          immediateRegularizedDurationMilliseconds: 0,
          lateRegularizedDurationMilliseconds: 0,
          pendingRegularizations: 0,
          validatedDurationMilliseconds: 0,
          estimatedCompensationXof: 0,
        });
      }
    }
    const schoolsSummary = [...schoolsWithSessions.values()]
      .sort((left, right) => left.schoolName.localeCompare(right.schoolName) || left.schoolId - right.schoolId);
    return {
      scope: 'global',
      from: filters.from,
      to: filters.to,
      totalSessions: sumIntegerRows(schoolsSummary, 'totalSessions'),
      openSessions: sumIntegerRows(schoolsSummary, 'openSessions'),
      completedSessions: sumIntegerRows(schoolsSummary, 'completedSessions'),
      incompleteSessions: sumIntegerRows(schoolsSummary, 'incompleteSessions'),
      regularizedSessions: sumIntegerRows(schoolsSummary, 'regularizedSessions'),
      gpsCompletedSessions: sumIntegerRows(schoolsSummary, 'gpsCompletedSessions'),
      incompleteSessionRegularizations: sumIntegerRows(schoolsSummary, 'incompleteSessionRegularizations'),
      immediateRegularizedSessions: sumIntegerRows(schoolsSummary, 'immediateRegularizedSessions'),
      lateRegularizedSessions: sumIntegerRows(schoolsSummary, 'lateRegularizedSessions'),
      gpsDurationMilliseconds: sumIntegerRows(schoolsSummary, 'gpsDurationMilliseconds'),
      incompleteRegularizedDurationMilliseconds: sumIntegerRows(schoolsSummary, 'incompleteRegularizedDurationMilliseconds'),
      immediateRegularizedDurationMilliseconds: sumIntegerRows(schoolsSummary, 'immediateRegularizedDurationMilliseconds'),
      lateRegularizedDurationMilliseconds: sumIntegerRows(schoolsSummary, 'lateRegularizedDurationMilliseconds'),
      pendingRegularizations: sumIntegerRows(schoolsSummary, 'pendingRegularizations'),
      validatedDurationMilliseconds: sumIntegerRows(schoolsSummary, 'validatedDurationMilliseconds'),
      estimatedCompensationXof: sumIntegerRows(schoolsSummary, 'estimatedCompensationXof'),
      schools: schoolsSummary,
    };
  }, resolveActor));
}

function groupRegularizationHistory(
  rows: Array<{
    request: typeof teacherControlRegularizationRequests.$inferSelect;
    decision: typeof teacherControlRegularizationDecisions.$inferSelect | null;
  }>,
) {
  const grouped = new Map<number, {
    request: typeof teacherControlRegularizationRequests.$inferSelect;
    decisions: NonNullable<typeof rows[number]['decision']>[];
  }>();
  for (const row of rows) {
    let entry = grouped.get(row.request.id);
    if (!entry) {
      entry = { request: row.request, decisions: [] };
      grouped.set(row.request.id, entry);
    }
    if (row.decision) entry.decisions.push(row.decision);
  }
  return [...grouped.values()];
}
