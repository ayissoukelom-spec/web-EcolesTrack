import type { AuditEvent } from '../types.ts';

const auditContextKey = '$auditContext';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isAuditEvent(value: unknown): value is AuditEvent {
  return isRecord(value)
    && typeof value.id === 'number'
    && typeof value.actorRole === 'string'
    && typeof value.action === 'string'
    && typeof value.resourceType === 'string'
    && typeof value.description === 'string';
}

function readAuditContext(value: unknown): AuditEvent['auditContext'] | undefined {
  if (!isRecord(value)) return undefined;

  const schoolId = value.actorActiveSchoolId;
  const schoolName = value.actorActiveSchoolName;
  if (schoolId !== undefined && schoolId !== null
    && (typeof schoolId !== 'number' || !Number.isInteger(schoolId))) {
    return undefined;
  }
  if (schoolName !== undefined && schoolName !== null && typeof schoolName !== 'string') {
    return undefined;
  }

  return {
    actorActiveSchoolId: typeof schoolId === 'number' || schoolId === null ? schoolId : undefined,
    actorActiveSchoolName: typeof schoolName === 'string' || schoolName === null ? schoolName : undefined,
  };
}

export function normalizeAuditEvent(event: AuditEvent): AuditEvent {
  const beforeValues = event.beforeValues;
  if (!isRecord(beforeValues) || !(auditContextKey in beforeValues)) return event;

  const auditContext = readAuditContext(beforeValues[auditContextKey]);
  if (!auditContext) return event;

  const { [auditContextKey]: _auditContext, ...businessValues } = beforeValues;
  return {
    ...event,
    beforeValues: Object.keys(businessValues).length > 0 ? businessValues : null,
    auditContext,
  };
}

export function normalizeAuditEvents(value: unknown): AuditEvent[] {
  if (!Array.isArray(value)) throw new TypeError('Audit events response must be an array.');
  return value.map((event) => {
    if (!isAuditEvent(event)) throw new TypeError('Audit events response contains an invalid entry.');
    return normalizeAuditEvent(event);
  });
}
