import { describe, expect, it } from 'vitest';
import {
  assertNoIncompatibleTariffRanges,
  createTariffVersionService,
  getTariffVersionState,
  localDateAtMidnightToInstant,
  resolveApplicableTariffs,
  resolveTariffEffectiveAt,
  resolveTariffVersionAt,
  TariffVersionError,
} from './accountingTariffVersions.ts';
import type {
  TariffScope,
  TariffVersion,
  TariffVersionEvent,
  TariffVersionRepository,
  TariffVersionTransaction,
} from './accountingTariffVersions.ts';

const makeTariff = (overrides: Partial<TariffScope> = {}): TariffScope => ({
  id: 8,
  schoolId: 1,
  academicYearId: 4,
  categoryId: 2,
  classId: 20,
  classFromId: null,
  classToId: null,
  ...overrides,
});

const makeVersion = (overrides: Partial<TariffVersion> = {}): TariffVersion => ({
  id: 10,
  tariffId: 8,
  schoolId: 1,
  versionNumber: 1,
  amount: 10000,
  label: 'Scolarité',
  isEnabled: true,
  effectiveAt: new Date('2026-01-01T00:00:00.000Z'),
  terminalState: null,
  ...overrides,
});

const createMemoryRepository = (
  initialVersions: TariffVersion[] = [],
): TariffVersionRepository & { snapshot: () => { versions: TariffVersion[]; events: TariffVersionEvent[] } } => {
  let state = {
    versions: structuredClone(initialVersions),
    events: [] as TariffVersionEvent[],
    nextId: Math.max(0, ...initialVersions.map((version) => version.id)) + 1,
  };
  let pending = Promise.resolve();

  const createTransaction = (draft: typeof state): TariffVersionTransaction => ({
    lockIdempotencyKey: async () => {},
    lockTariff: async (schoolId, tariffId) => (
      schoolId === 1 && tariffId === 8 ? makeTariff() : null
    ),
    findIdempotentEvent: async (schoolId, key) => {
      const event = draft.events.find((item) => item.schoolId === schoolId && item.idempotencyKey === key);
      return event ? { requestFingerprint: event.requestFingerprint, after: structuredClone(event.after) } : null;
    },
    listVersions: async (schoolId, tariffId) => structuredClone(draft.versions.filter((version) =>
      version.schoolId === schoolId && version.tariffId === tariffId)),
    getVersion: async (schoolId, tariffId, versionId) => {
      const version = draft.versions.find((item) => item.schoolId === schoolId
        && item.tariffId === tariffId && item.id === versionId);
      return version ? structuredClone(version) : null;
    },
    insertVersion: async (input) => {
      const version = { ...structuredClone(input), id: draft.nextId++ };
      draft.versions.push(version);
      return structuredClone(version);
    },
    setTerminalState: async (schoolId, tariffId, versionId, terminalState, replacedByVersionId) => {
      const version = draft.versions.find((item) => item.schoolId === schoolId
        && item.tariffId === tariffId && item.id === versionId);
      if (!version) throw new Error('test fixture version not found');
      version.terminalState = terminalState;
      version.replacedByVersionId = replacedByVersionId ?? null;
    },
    insertEvent: async (event) => {
      draft.events.push(structuredClone(event));
    },
  });

  return {
    transaction: async <T>(operation: (tx: TariffVersionTransaction) => Promise<T>) => {
      let release = () => {};
      const previous = pending;
      pending = new Promise<void>((resolve) => { release = resolve; });
      await previous;
      try {
        const draft = structuredClone(state);
        const result = await operation(createTransaction(draft));
        state = draft;
        return result;
      } finally {
        release();
      }
    },
    listHistory: async (schoolId, tariffId) => {
      if (schoolId !== 1 || tariffId !== 8) return null;
      return structuredClone(state.versions.filter((version) => version.schoolId === schoolId
        && version.tariffId === tariffId));
    },
    snapshot: () => structuredClone({ versions: state.versions, events: state.events }),
  };
};

const versionRequest = {
  schoolId: 1,
  tariffId: 8,
  actorId: 7,
  idempotencyKey: 'key-1',
  mode: 'scheduled' as const,
  effectiveDate: '2026-02-01',
  amount: 12000,
  label: 'Scolarité',
  isEnabled: true,
};

describe('accounting tariff version rules', () => {
  it('resolves future local midnights using the requested time zone', () => {
    expect(localDateAtMidnightToInstant('2026-01-03', 'Africa/Lome').toISOString())
      .toBe('2026-01-03T00:00:00.000Z');
    expect(localDateAtMidnightToInstant('2026-01-03', 'America/New_York').toISOString())
      .toBe('2026-01-03T05:00:00.000Z');
  });

  it('uses the server instant for immediate changes and rejects past schedules', () => {
    const now = new Date('2026-01-10T12:30:00.000Z');
    expect(resolveTariffEffectiveAt({
      mode: 'immediate',
      amount: 1000,
      label: 'Transport',
      isEnabled: true,
    }, now)).toEqual(now);

    expect(() => resolveTariffEffectiveAt({
      ...versionRequest,
      effectiveDate: '2026-01-10',
    }, now)).toThrow('past or already-started');
  });

  it('rejects invalid time zones, dates, and non-integer XOF amounts', () => {
    expect(() => localDateAtMidnightToInstant('2026-02-30')).toThrow(TariffVersionError);
    expect(() => localDateAtMidnightToInstant('2026-02-01', 'Unknown/Zone')).toThrow(TariffVersionError);
    expect(() => resolveTariffEffectiveAt({
      ...versionRequest,
      amount: 1.5,
    }, new Date('2026-01-01T00:00:00.000Z'))).toThrow('positive integer XOF');
  });

  it('selects the exact class tariff and falls back to a range when the exact tariff is disabled', () => {
    const at = new Date('2026-02-01T00:00:00.000Z');
    const range = {
      tariff: makeTariff({ id: 9, classId: null, classFromId: 10, classToId: 30 }),
      versions: [makeVersion({ id: 11, tariffId: 9 })],
    };
    const enabledExact = {
      tariff: makeTariff(),
      versions: [makeVersion({ id: 12 })],
    };
    const input = {
      schoolId: 1,
      academicYearId: 4,
      classId: 20,
      at,
      classOrderById: new Map([[10, 1], [20, 2], [30, 3]]),
      tariffs: [range, enabledExact],
    };
    expect(resolveApplicableTariffs(input).map(({ tariff }) => tariff.id)).toEqual([8]);
    const disabledExact = {
      ...enabledExact,
      versions: [makeVersion({ id: 12, isEnabled: false })],
    };
    expect(resolveApplicableTariffs({ ...input, tariffs: [range, disabledExact] })
      .map(({ tariff }) => tariff.id)).toEqual([9]);
  });

  it('rejects overlapping ranges for the same school year and category', () => {
    expect(() => assertNoIncompatibleTariffRanges([
      makeTariff({ id: 8, classId: null, classFromId: 10, classToId: 20 }),
      makeTariff({ id: 9, classId: null, classFromId: 20, classToId: 30 }),
    ], new Map([[10, 1], [20, 2], [30, 3]]))).toThrow('overlap');
  });

  it('rejects tariff versions crossing establishment boundaries', () => {
    expect(() => resolveApplicableTariffs({
      schoolId: 1,
      academicYearId: 4,
      classId: 20,
      at: new Date('2026-02-01T00:00:00.000Z'),
      classOrderById: new Map(),
      tariffs: [{
        tariff: makeTariff({ schoolId: 2 }),
        versions: [makeVersion({ schoolId: 2 })],
      }],
    })).toThrow('establishment boundary');
  });

  it('resolves the latest non-cancelled version and derives timeline states', () => {
    const current = makeVersion();
    const cancelled = makeVersion({
      id: 11,
      versionNumber: 2,
      effectiveAt: new Date('2026-02-01T00:00:00.000Z'),
      terminalState: 'cancelled',
    });
    expect(resolveTariffVersionAt([current, cancelled], new Date('2026-03-01T00:00:00.000Z'))?.id).toBe(current.id);
    expect(getTariffVersionState(cancelled, [current, cancelled], new Date('2026-01-15T00:00:00.000Z'))).toBe('cancelled');
    expect(getTariffVersionState(current, [current, cancelled], new Date('2026-01-15T00:00:00.000Z'))).toBe('applicable');
  });
});

describe('accounting tariff version service', () => {
  it('stores the version and audit event atomically and replays identical idempotent requests', async () => {
    const repository = createMemoryRepository();
    const service = createTariffVersionService(repository, () => new Date('2026-01-01T12:00:00.000Z'));

    const [first, retry] = await Promise.all([
      service.create(versionRequest),
      service.create(versionRequest),
    ]);

    expect(retry).toEqual(first);
    expect(first).toMatchObject({ versionNumber: 1, amount: 12000, isEnabled: true });
    expect(first.effectiveAt.toISOString()).toBe('2026-02-01T00:00:00.000Z');
    expect(repository.snapshot().versions).toHaveLength(1);
    expect(repository.snapshot().events).toHaveLength(1);
  });

  it('refuses reuse of an idempotency key for a different request', async () => {
    const service = createTariffVersionService(createMemoryRepository(), () => new Date('2026-01-01T12:00:00.000Z'));
    await service.create(versionRequest);
    await expect(service.create({ ...versionRequest, amount: 13000 })).rejects.toMatchObject({ code: 'conflict' });
  });

  it('serializes competing schedules for the same tariff and effective instant', async () => {
    const repository = createMemoryRepository();
    const service = createTariffVersionService(repository, () => new Date('2026-01-01T12:00:00.000Z'));
    const results = await Promise.allSettled([
      service.create({ ...versionRequest, idempotencyKey: 'admin-a' }),
      service.create({ ...versionRequest, idempotencyKey: 'admin-b' }),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(repository.snapshot().versions).toHaveLength(1);
    expect(repository.snapshot().events).toHaveLength(1);
  });

  it('replaces and cancels only future schedules while preserving the applicable version', async () => {
    const current = makeVersion();
    const repository = createMemoryRepository([current]);
    const service = createTariffVersionService(repository, () => new Date('2026-01-15T12:00:00.000Z'));
    const scheduled = await service.create({ ...versionRequest, idempotencyKey: 'scheduled' });
    const replaced = await service.replaceScheduled({
      ...versionRequest,
      idempotencyKey: 'replacement',
      versionId: scheduled.id,
      reason: 'Correction tarifaire',
      effectiveDate: '2026-03-01',
      amount: 14000,
    });
    expect(repository.snapshot().versions.find((version) => version.id === scheduled.id)?.terminalState).toBe('replaced');
    expect(repository.snapshot().events.at(-1)).toMatchObject({
      action: 'replaced',
      reason: 'Correction tarifaire',
      before: scheduled,
      after: replaced,
      actorId: 7,
      schoolId: 1,
    });

    const cancelled = await service.cancelScheduled({
      schoolId: 1,
      tariffId: 8,
      actorId: 7,
      idempotencyKey: 'cancel',
      versionId: replaced.id,
      reason: 'Programmation annulée',
    });
    const versions = repository.snapshot().versions;
    expect(cancelled.terminalState).toBe('cancelled');
    expect(resolveTariffVersionAt(versions, new Date('2026-01-20T00:00:00.000Z'))?.id).toBe(current.id);
  });

  it('refuses to modify an already effective version', async () => {
    const repository = createMemoryRepository([makeVersion()]);
    const service = createTariffVersionService(repository, () => new Date('2026-01-15T12:00:00.000Z'));
    await expect(service.cancelScheduled({
      schoolId: 1,
      tariffId: 8,
      actorId: 7,
      idempotencyKey: 'cancel-effective',
      versionId: 10,
      reason: 'Trop tard',
    })).rejects.toMatchObject({ code: 'conflict' });
    expect(repository.snapshot().events).toHaveLength(0);
  });
});
