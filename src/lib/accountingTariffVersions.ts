export type TariffVersionTerminalState = 'replaced' | 'cancelled';
export type TariffVersionDerivedState = 'scheduled' | 'applicable' | 'historical' | TariffVersionTerminalState;

export interface TariffScope {
  id: number;
  schoolId: number;
  academicYearId: number;
  categoryId: number;
  classId: number | null;
  classFromId: number | null;
  classToId: number | null;
}

export interface TariffVersion {
  id: number;
  tariffId: number;
  schoolId: number;
  versionNumber: number;
  amount: number;
  label: string;
  isEnabled: boolean;
  effectiveAt: Date;
  terminalState: TariffVersionTerminalState | null;
  replacedByVersionId?: number | null;
}

export interface VersionedTariff {
  tariff: TariffScope;
  versions: TariffVersion[];
}

export interface TariffVersionRequest {
  mode: 'immediate' | 'scheduled';
  effectiveDate?: string;
  amount: number;
  label: string;
  isEnabled: boolean;
}

export class TariffVersionError extends Error {
  constructor(
    message: string,
    readonly code: 'invalid_request' | 'not_found' | 'conflict',
  ) {
    super(message);
    this.name = 'TariffVersionError';
  }
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_AMOUNT = 2_147_483_647;

const parseDateOnly = (value: string): { year: number; month: number; day: number } => {
  if (!DATE_PATTERN.test(value)) {
    throw new TariffVersionError('A valid YYYY-MM-DD effective date is required', 'invalid_request');
  }
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new TariffVersionError('The effective date is not a valid calendar date', 'invalid_request');
  }
  return { year, month, day };
};

const dateTimeParts = (instant: Date, timeZone: string) => {
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
  } catch {
    throw new TariffVersionError('A valid IANA time zone is required', 'invalid_request');
  }
  const parts = Object.fromEntries(formatter.formatToParts(instant)
    .filter((part) => part.type !== 'literal')
    .map((part) => [part.type, Number(part.value)]));
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute,
    second: parts.second,
  };
};

const sameLocalMidnight = (instant: Date, date: { year: number; month: number; day: number }, timeZone: string) => {
  const parts = dateTimeParts(instant, timeZone);
  return parts.year === date.year && parts.month === date.month && parts.day === date.day
    && parts.hour === 0 && parts.minute === 0 && parts.second === 0;
};

export const localDateAtMidnightToInstant = (dateValue: string, timeZone = 'Africa/Lome'): Date => {
  const date = parseDateOnly(dateValue);
  const localAsUtc = Date.UTC(date.year, date.month - 1, date.day);
  const offsets = new Set<number>();

  for (let hours = -36; hours <= 36; hours += 3) {
    const probe = new Date(localAsUtc + hours * 60 * 60 * 1000);
    const parts = dateTimeParts(probe, timeZone);
    const representedAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
    offsets.add(representedAsUtc - probe.getTime());
  }

  const candidates = [...offsets]
    .map((offset) => new Date(localAsUtc - offset))
    .filter((candidate) => sameLocalMidnight(candidate, date, timeZone));
  if (candidates.length !== 1) {
    throw new TariffVersionError(
      candidates.length === 0
        ? 'Local midnight does not exist in the selected time zone'
        : 'Local midnight is ambiguous in the selected time zone',
      'invalid_request',
    );
  }
  return candidates[0];
};

export const resolveTariffEffectiveAt = (
  request: TariffVersionRequest,
  now: Date,
  timeZone = 'Africa/Lome',
): Date => {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new TariffVersionError('A valid server timestamp is required', 'invalid_request');
  }
  if (!Number.isSafeInteger(request.amount) || request.amount <= 0 || request.amount > MAX_AMOUNT) {
    throw new TariffVersionError('Amount must be a positive integer XOF value', 'invalid_request');
  }
  if (typeof request.label !== 'string' || !request.label.trim() || request.label.trim().length > 120) {
    throw new TariffVersionError('A tariff label of 1 to 120 characters is required', 'invalid_request');
  }
  if (typeof request.isEnabled !== 'boolean') {
    throw new TariffVersionError('isEnabled must be a boolean', 'invalid_request');
  }
  if (request.mode === 'immediate') {
    if (request.effectiveDate != null) {
      throw new TariffVersionError('Immediate tariffs must not include an effective date', 'invalid_request');
    }
    return new Date(now.getTime());
  }
  if (request.mode !== 'scheduled' || typeof request.effectiveDate !== 'string') {
    throw new TariffVersionError('Scheduled tariffs require a local effective date', 'invalid_request');
  }
  const effectiveAt = localDateAtMidnightToInstant(request.effectiveDate, timeZone);
  if (effectiveAt.getTime() <= now.getTime()) {
    throw new TariffVersionError('A tariff cannot be scheduled for a past or already-started instant', 'invalid_request');
  }
  return effectiveAt;
};

const normalizeVersionRequest = (request: TariffVersionRequest): TariffVersionRequest => {
  if (!Number.isSafeInteger(request.amount) || request.amount <= 0 || request.amount > MAX_AMOUNT) {
    throw new TariffVersionError('Amount must be a positive integer XOF value', 'invalid_request');
  }
  if (typeof request.label !== 'string' || !request.label.trim() || request.label.trim().length > 120) {
    throw new TariffVersionError('A tariff label of 1 to 120 characters is required', 'invalid_request');
  }
  if (typeof request.isEnabled !== 'boolean') {
    throw new TariffVersionError('isEnabled must be a boolean', 'invalid_request');
  }
  if (request.mode === 'immediate') {
    if (request.effectiveDate != null) {
      throw new TariffVersionError('Immediate tariffs must not include an effective date', 'invalid_request');
    }
  } else if (request.mode === 'scheduled') {
    if (typeof request.effectiveDate !== 'string') {
      throw new TariffVersionError('Scheduled tariffs require a local effective date', 'invalid_request');
    }
    parseDateOnly(request.effectiveDate);
  } else {
    throw new TariffVersionError('A valid tariff effect mode is required', 'invalid_request');
  }
  return {
    ...request,
    label: request.label.trim(),
  };
};

const instantOf = (value: Date | string) => {
  const instant = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(instant.getTime())) {
    throw new TariffVersionError('A tariff version has an invalid effective timestamp', 'conflict');
  }
  return instant.getTime();
};

export const resolveTariffVersionAt = (
  versions: TariffVersion[],
  at: Date,
): TariffVersion | null => {
  if (!Number.isFinite(at.getTime())) throw new TariffVersionError('A valid resolution timestamp is required', 'invalid_request');
  const applicable = versions.filter((version) => version.terminalState == null
    && instantOf(version.effectiveAt) <= at.getTime())
    .sort((left, right) => instantOf(left.effectiveAt) - instantOf(right.effectiveAt)
      || left.versionNumber - right.versionNumber);
  const seenEffectiveInstants = new Set<number>();
  for (const version of applicable) {
    const effectiveAt = instantOf(version.effectiveAt);
    if (seenEffectiveInstants.has(effectiveAt)) {
      throw new TariffVersionError('Multiple tariff versions are effective at the same instant', 'conflict');
    }
    seenEffectiveInstants.add(effectiveAt);
  }
  return applicable.at(-1) ?? null;
};

export const getTariffVersionState = (
  version: TariffVersion,
  versions: TariffVersion[],
  at: Date,
): TariffVersionDerivedState => {
  if (version.terminalState) return version.terminalState;
  if (instantOf(version.effectiveAt) > at.getTime()) return 'scheduled';
  return resolveTariffVersionAt(versions, at)?.id === version.id ? 'applicable' : 'historical';
};

export const assertNoIncompatibleTariffRanges = (
  scopes: TariffScope[],
  classOrderById: ReadonlyMap<number, number>,
): void => {
  const ranges = scopes.filter((scope) => scope.classId == null);
  for (let leftIndex = 0; leftIndex < ranges.length; leftIndex += 1) {
    const left = ranges[leftIndex];
    const leftStart = left.classFromId == null ? undefined : classOrderById.get(left.classFromId);
    const leftEnd = left.classToId == null ? undefined : classOrderById.get(left.classToId);
    if (leftStart == null || leftEnd == null || leftStart > leftEnd) {
      throw new TariffVersionError('A tariff range has an invalid class scope', 'conflict');
    }
    for (const right of ranges.slice(leftIndex + 1)) {
      if (left.schoolId !== right.schoolId || left.academicYearId !== right.academicYearId
        || left.categoryId !== right.categoryId) continue;
      const rightStart = right.classFromId == null ? undefined : classOrderById.get(right.classFromId);
      const rightEnd = right.classToId == null ? undefined : classOrderById.get(right.classToId);
      if (rightStart == null || rightEnd == null || rightStart > rightEnd) {
        throw new TariffVersionError('A tariff range has an invalid class scope', 'conflict');
      }
      if (Math.max(leftStart, rightStart) <= Math.min(leftEnd, rightEnd)) {
        throw new TariffVersionError('Incompatible tariff ranges overlap for the same school year and category', 'conflict');
      }
    }
  }
};

export const resolveApplicableTariffs = (
  input: {
    schoolId: number;
    academicYearId: number;
    classId: number;
    at: Date;
    classOrderById: ReadonlyMap<number, number>;
    tariffs: VersionedTariff[];
  },
) => {
  const { schoolId, academicYearId, classId, at, classOrderById, tariffs } = input;
  if (!Number.isFinite(at.getTime())) throw new TariffVersionError('A valid resolution timestamp is required', 'invalid_request');
  if (tariffs.some(({ tariff, versions }) => tariff.schoolId !== schoolId
    || versions.some((version) => version.schoolId !== schoolId || version.tariffId !== tariff.id))) {
    throw new TariffVersionError('Tariff data crossed an establishment boundary', 'conflict');
  }

  const matching = tariffs.filter(({ tariff }) => tariff.academicYearId === academicYearId
    && (tariff.classId === classId || (tariff.classId == null && tariff.classFromId != null && tariff.classToId != null
      && classOrderById.get(tariff.classFromId) != null
      && classOrderById.get(tariff.classToId) != null
      && classOrderById.get(classId) != null
      && classOrderById.get(tariff.classFromId)! <= classOrderById.get(classId)!
      && classOrderById.get(classId)! <= classOrderById.get(tariff.classToId)!)));

  const rangesByCategory = new Map<number, VersionedTariff[]>();
  const exactByCategory = new Map<number, VersionedTariff[]>();
  for (const item of matching) {
    const target = item.tariff.classId === classId ? exactByCategory : rangesByCategory;
    const entries = target.get(item.tariff.categoryId) ?? [];
    entries.push(item);
    target.set(item.tariff.categoryId, entries);
  }

  const categoryIds = new Set([...exactByCategory.keys(), ...rangesByCategory.keys()]);
  const resolved: Array<{ tariff: TariffScope; version: TariffVersion }> = [];
  for (const categoryId of categoryIds) {
    const exact = exactByCategory.get(categoryId) ?? [];
    const ranges = rangesByCategory.get(categoryId) ?? [];
    if (exact.length > 1 || ranges.length > 1) {
      throw new TariffVersionError('More than one tariff scope applies to the same category', 'conflict');
    }
    const exactVersion = exact.length ? resolveTariffVersionAt(exact[0].versions, at) : null;
    if (exactVersion?.isEnabled) {
      resolved.push({ tariff: exact[0].tariff, version: exactVersion });
      continue;
    }
    const rangeVersion = ranges.length ? resolveTariffVersionAt(ranges[0].versions, at) : null;
    if (rangeVersion?.isEnabled) resolved.push({ tariff: ranges[0].tariff, version: rangeVersion });
  }
  return resolved;
};

export interface TariffVersionEvent {
  schoolId: number;
  tariffId: number;
  actorId: number | null;
  action: 'created' | 'scheduled' | 'replaced' | 'cancelled';
  reason: string | null;
  idempotencyKey: string;
  requestFingerprint: string;
  occurredAt: Date;
  before: TariffVersion | null;
  after: TariffVersion;
}

export interface TariffVersionTransaction {
  lockIdempotencyKey(schoolId: number, key: string): Promise<void>;
  lockTariff(schoolId: number, tariffId: number): Promise<TariffScope | null>;
  findIdempotentEvent(schoolId: number, key: string): Promise<Pick<TariffVersionEvent, 'requestFingerprint' | 'after'> | null>;
  listVersions(schoolId: number, tariffId: number): Promise<TariffVersion[]>;
  getVersion(schoolId: number, tariffId: number, versionId: number): Promise<TariffVersion | null>;
  insertVersion(input: Omit<TariffVersion, 'id'>): Promise<TariffVersion>;
  setTerminalState(
    schoolId: number,
    tariffId: number,
    versionId: number,
    state: TariffVersionTerminalState,
    replacedByVersionId?: number,
  ): Promise<void>;
  insertEvent(event: TariffVersionEvent): Promise<void>;
}

export interface TariffVersionRepository {
  transaction<T>(operation: (tx: TariffVersionTransaction) => Promise<T>): Promise<T>;
  listHistory(schoolId: number, tariffId: number): Promise<TariffVersion[] | null>;
}

export interface TariffVersionActor {
  schoolId: number;
  tariffId: number;
  actorId: number | null;
  idempotencyKey: string;
}

const requireReason = (reason: unknown) => {
  if (typeof reason !== 'string' || !reason.trim() || reason.trim().length > 500) {
    throw new TariffVersionError('A non-empty reason of at most 500 characters is required', 'invalid_request');
  }
  return reason.trim();
};

const requireIdempotencyKey = (key: string) => {
  if (typeof key !== 'string' || !key.trim() || key.trim().length > 128) {
    throw new TariffVersionError('A non-empty idempotency key of at most 128 characters is required', 'invalid_request');
  }
  return key.trim();
};

const fingerprint = (values: unknown[]) => JSON.stringify(values);

export const createTariffVersionService = (
  repository: TariffVersionRepository,
  clock: () => Date = () => new Date(),
  resolveSchoolTimeZone: (schoolId: number) => Promise<string> = async () => 'Africa/Lome',
) => {
  const begin = async (
    tx: TariffVersionTransaction,
    input: TariffVersionActor,
    requestFingerprint: string,
  ) => {
    const key = requireIdempotencyKey(input.idempotencyKey);
    await tx.lockIdempotencyKey(input.schoolId, key);
    const tariff = await tx.lockTariff(input.schoolId, input.tariffId);
    if (!tariff) throw new TariffVersionError('Tariff not found for this establishment', 'not_found');
    const existing = await tx.findIdempotentEvent(input.schoolId, key);
    if (existing) {
      if (existing.requestFingerprint !== requestFingerprint) {
        throw new TariffVersionError('The idempotency key was already used for a different request', 'conflict');
      }
      return existing.after;
    }
    return null;
  };

  const insertNewVersion = async (
    tx: TariffVersionTransaction,
    input: TariffVersionActor,
    request: TariffVersionRequest,
    now: Date,
    timeZone: string,
    before: TariffVersion | null,
    reason: string | null,
    action: TariffVersionEvent['action'],
    key: string,
    requestFingerprint: string,
    replacedVersionId?: number,
  ) => {
    const tariff = await tx.lockTariff(input.schoolId, input.tariffId);
    if (!tariff) throw new TariffVersionError('Tariff not found for this establishment', 'not_found');
    const effectiveAt = resolveTariffEffectiveAt(request, now, timeZone);
    const versions = await tx.listVersions(input.schoolId, input.tariffId);
    if (versions.some((version) => version.terminalState == null
      && instantOf(version.effectiveAt) === effectiveAt.getTime())) {
      throw new TariffVersionError('A version is already scheduled for this effective instant', 'conflict');
    }
    const versionNumber = versions.reduce((maximum, version) => Math.max(maximum, version.versionNumber), 0) + 1;
    const created = await tx.insertVersion({
      tariffId: input.tariffId,
      schoolId: input.schoolId,
      versionNumber,
      amount: request.amount,
      label: request.label.trim(),
      isEnabled: request.isEnabled,
      effectiveAt,
      terminalState: null,
    });
    if (replacedVersionId != null) {
      await tx.setTerminalState(input.schoolId, input.tariffId, replacedVersionId, 'replaced', created.id);
    }
    await tx.insertEvent({
      schoolId: input.schoolId,
      tariffId: input.tariffId,
      actorId: input.actorId,
      action,
      reason,
      idempotencyKey: key,
      requestFingerprint,
      occurredAt: now,
      before,
      after: created,
    });
    return created;
  };

  return {
    create: (input: TariffVersionActor & TariffVersionRequest) => repository.transaction(async (tx) => {
      const request = normalizeVersionRequest({
        mode: input.mode,
        effectiveDate: input.effectiveDate,
        amount: input.amount,
        label: input.label,
        isEnabled: input.isEnabled,
      });
      const requestFingerprint = fingerprint([
        'create', input.tariffId, request.mode, request.effectiveDate ?? null, request.amount,
        request.label, request.isEnabled,
      ]);
      const existing = await begin(tx, input, requestFingerprint);
      if (existing) return existing;
      const now = clock();
      const timeZone = await resolveSchoolTimeZone(input.schoolId);
      const key = requireIdempotencyKey(input.idempotencyKey);
      return insertNewVersion(tx, input, request, now, timeZone, null, null,
        request.mode === 'immediate' ? 'created' : 'scheduled', key, requestFingerprint);
    }),

    replaceScheduled: (
      input: TariffVersionActor & { versionId: number; reason: string } & TariffVersionRequest,
    ) => repository.transaction(async (tx) => {
      const request = normalizeVersionRequest({
        mode: input.mode,
        effectiveDate: input.effectiveDate,
        amount: input.amount,
        label: input.label,
        isEnabled: input.isEnabled,
      });
      const reason = requireReason(input.reason);
      const requestFingerprint = fingerprint([
        'replace', input.tariffId, input.versionId, request.mode, request.effectiveDate ?? null,
        request.amount, request.label, request.isEnabled, reason,
      ]);
      const existing = await begin(tx, input, requestFingerprint);
      if (existing) return existing;
      const now = clock();
      const timeZone = await resolveSchoolTimeZone(input.schoolId);
      const target = await tx.getVersion(input.schoolId, input.tariffId, input.versionId);
      if (!target) throw new TariffVersionError('Scheduled tariff version not found', 'not_found');
      if (target.terminalState || instantOf(target.effectiveAt) <= now.getTime()) {
        throw new TariffVersionError('An effective tariff version cannot be replaced retroactively', 'conflict');
      }
      const key = requireIdempotencyKey(input.idempotencyKey);
      return insertNewVersion(tx, input, request, now, timeZone, target, reason, 'replaced', key,
        requestFingerprint, target.id);
    }),

    cancelScheduled: (input: TariffVersionActor & { versionId: number; reason: string }) => repository.transaction(async (tx) => {
      const reason = requireReason(input.reason);
      const requestFingerprint = fingerprint(['cancel', input.tariffId, input.versionId, reason]);
      const existing = await begin(tx, input, requestFingerprint);
      if (existing) return existing;
      const now = clock();
      const target = await tx.getVersion(input.schoolId, input.tariffId, input.versionId);
      if (!target) throw new TariffVersionError('Scheduled tariff version not found', 'not_found');
      if (target.terminalState || instantOf(target.effectiveAt) <= now.getTime()) {
        throw new TariffVersionError('An effective tariff version cannot be cancelled', 'conflict');
      }
      await tx.setTerminalState(input.schoolId, input.tariffId, target.id, 'cancelled');
      await tx.insertEvent({
        schoolId: input.schoolId,
        tariffId: input.tariffId,
        actorId: input.actorId,
        action: 'cancelled',
        reason,
        idempotencyKey: requireIdempotencyKey(input.idempotencyKey),
        requestFingerprint,
        occurredAt: now,
        before: target,
        after: { ...target, terminalState: 'cancelled' },
      });
      return { ...target, terminalState: 'cancelled' as const };
    }),

    history: async (schoolId: number, tariffId: number) => {
      const versions = await repository.listHistory(schoolId, tariffId);
      if (!versions) throw new TariffVersionError('Tariff not found for this establishment', 'not_found');
      return versions;
    },
  };
};
