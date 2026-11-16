import { auditEvents } from '../db/schema.ts';

const auditSnapshotMarker: unique symbol = Symbol('AuditSnapshot');

export type AuditSnapshotValue = string | number | boolean | null;

export interface AuditSnapshot {
  readonly [auditSnapshotMarker]: true;
  readonly values: Readonly<Record<string, AuditSnapshotValue>>;
}

export interface AuditEventExecutor {
  insert(table: typeof auditEvents): {
    values(values: typeof auditEvents.$inferInsert): PromiseLike<unknown>;
  };
}

export interface AuditEventActor {
  userId: number | null;
  role: string;
  email?: string | null;
  name?: string | null;
  activeFunction?: {
    id?: string | null;
    name?: string | null;
  } | null;
  activeSchool?: {
    id?: number | null;
    name?: string | null;
  } | null;
}

export interface AuditEventInput {
  actor: AuditEventActor;
  targetSchool?: {
    id: number | null;
    name?: string | null;
  } | null;
  module?: string | null;
  action: string;
  resourceType: string;
  resourceId?: number | null;
  beforeValues?: AuditSnapshot | null;
  afterValues?: AuditSnapshot | null;
  result?: string | null;
  source?: string | null;
  reason?: string | null;
  correlationId?: string | null;
  occurredAt?: Date;
  createdAt?: Date;
  description: string;
}

export type AuditEventAfterRollbackResult =
  | { status: 'recorded'; businessError: unknown }
  | { status: 'failed'; businessError: unknown; auditError: unknown };

const sensitiveFieldTokens = new Set([
  'password',
  'passwd',
  'passphrase',
  'token',
  'jwt',
  'bearer',
  'secret',
  'credential',
  'salt',
  'hash',
  'authorization',
  'cookie',
  'session',
  'refresh',
  'key',
  'keys',
  'auth',
  'otp',
  'mfa',
]);

function isSensitiveAuditField(field: string): boolean {
  const tokens = field
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  return tokens.some((token) => (
    sensitiveFieldTokens.has(token) || token.startsWith('auth')
  ));
}

export function createAuditSnapshot<T extends object, K extends keyof T>(
  source: T | null | undefined,
  allowedFields: readonly K[],
): AuditSnapshot | null {
  if (!source) return null;

  const values: Record<string, AuditSnapshotValue> = {};
  for (const field of allowedFields) {
    const name = String(field);
    if (name === '$auditContext' || isSensitiveAuditField(name)) continue;

    const value = source[field];
    if (value instanceof Date) {
      if (!Number.isNaN(value.getTime())) values[name] = value.toISOString();
    } else if (value === null || typeof value === 'string' || typeof value === 'boolean') {
      values[name] = value;
    } else if (typeof value === 'number' && Number.isFinite(value)) {
      values[name] = value;
    }
  }

  if (Object.keys(values).length === 0) return null;
  return Object.freeze({
    [auditSnapshotMarker]: true as const,
    values: Object.freeze(values),
  });
}

function serializeSnapshot(
  snapshot: AuditSnapshot | null | undefined,
  activeSchool: AuditEventActor['activeSchool'],
): Record<string, unknown> | null {
  const values = snapshot ? { ...snapshot.values } : {};
  if (activeSchool && (activeSchool.id != null || activeSchool.name != null)) {
    values.$auditContext = {
      actorActiveSchoolId: activeSchool.id ?? null,
      actorActiveSchoolName: activeSchool.name ?? null,
    };
  }
  return Object.keys(values).length > 0 ? values : null;
}

export async function appendAuditEvent(
  executor: AuditEventExecutor,
  event: AuditEventInput,
): Promise<void> {
  if (!event.actor.role.trim()) throw new TypeError('An audited event requires a verified actor role.');

  await executor.insert(auditEvents).values({
    actorUserId: event.actor.userId,
    actorRole: event.actor.role,
    actorEmail: event.actor.email ?? null,
    actorName: event.actor.name ?? null,
    activeFunctionId: event.actor.activeFunction?.id ?? null,
    activeFunctionName: event.actor.activeFunction?.name ?? null,
    schoolId: event.targetSchool?.id ?? null,
    schoolNameSnapshot: event.targetSchool?.name ?? null,
    occurredAt: event.occurredAt,
    createdAt: event.createdAt,
    module: event.module ?? null,
    action: event.action,
    resourceType: event.resourceType,
    resourceId: event.resourceId ?? null,
    beforeValues: serializeSnapshot(event.beforeValues, event.actor.activeSchool),
    afterValues: serializeSnapshot(event.afterValues, null),
    result: event.result ?? null,
    source: event.source ?? null,
    reason: event.reason ?? null,
    correlationId: event.correlationId ?? null,
    description: event.description,
  });
}

export async function appendAuditEventAfterRollback(
  executor: AuditEventExecutor,
  event: Omit<AuditEventInput, 'result'> & { result: 'denied' | 'failure' },
  businessError: unknown,
): Promise<AuditEventAfterRollbackResult> {
  // The caller must inspect this result, report auditError when present, then preserve businessError.
  try {
    await appendAuditEvent(executor, event);
    return { status: 'recorded', businessError };
  } catch (error) {
    return { status: 'failed', businessError, auditError: error };
  }
}
