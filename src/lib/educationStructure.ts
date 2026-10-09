import { and, eq, or, sql, count } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { classes, cycles, levels, schoolCycles, schoolPeriodTypeApprovals, schoolTerms } from '../db/schema.ts';

export type EducationCycleCode = 'college' | 'lycee' | 'primaire';
export type PeriodType = 'trimester' | 'semester';
export type PeriodApprovalStatus = 'pending' | 'approved' | 'rejected';

const PERIOD_CYCLE_CODES: Record<PeriodType, EducationCycleCode[]> = {
  trimester: ['college', 'primaire'],
  semester: ['lycee'],
};

export interface SchoolPeriodTypeState {
  periodType: PeriodType;
  cycleCode: EducationCycleCode;
  cycleId: number | null;
  activeCycleIds: number[];
  cycleActive: boolean;
  status: PeriodApprovalStatus;
  available: boolean;
}

export function resolveSchoolPeriodTypeStates(
  activeCycles: Array<{ id: number; code: string }>,
  approvals: Array<{ periodType: string; status: string }>,
): SchoolPeriodTypeState[] {
  return (Object.entries(PERIOD_CYCLE_CODES) as Array<[PeriodType, EducationCycleCode[]]>).map(([periodType, cycleCodes]) => {
    const matchingCycles = activeCycles.filter((entry) => cycleCodes.includes(entry.code as EducationCycleCode));
    const cycle = matchingCycles[0];
    const approval = approvals.find((entry) => entry.periodType === periodType);
    const status: PeriodApprovalStatus = approval?.status === 'approved' || approval?.status === 'rejected'
      ? approval.status
      : 'pending';
    const cycleActive = matchingCycles.length > 0;
    const cycleCode = (cycle?.code as EducationCycleCode | undefined) ?? cycleCodes[0];
    return {
      periodType,
      cycleCode,
      cycleId: cycle?.id ?? null,
      activeCycleIds: matchingCycles.map((entry) => entry.id),
      cycleActive,
      status,
      available: cycleActive && status === 'approved',
    };
  });
}

export function filterAvailableSchoolTerms<T extends {
  periodType?: string | null;
  name?: string | null;
  cycleId?: number | null;
  isActive?: boolean | null;
}>(
  terms: T[],
  periodStates: SchoolPeriodTypeState[],
  education?: { cycleId?: number | null; cycleCode?: EducationCycleCode | string | null } | null,
): T[] {
  const stateByType = new Map(periodStates.map((state) => [state.periodType, state]));
  return terms.filter((term) => {
    if (term.isActive === false) return false;
    const periodType = term.periodType ?? inferPeriodTypeFromLegacyName(term.name);
    if (periodType !== 'trimester' && periodType !== 'semester') return false;
    const state = stateByType.get(periodType);
    if (!state?.available) return false;
    if (education) {
      if (education.cycleId == null || !state.activeCycleIds.includes(education.cycleId)) return false;
    } else if (term.cycleId != null && term.cycleId !== state.cycleId) {
      return false;
    }
    return !education || isTermCompatibleWithCycle(term, education);
  });
}

export async function getSchoolPeriodTypeStates(schoolId: number): Promise<SchoolPeriodTypeState[]> {
  const [activeCycles, approvals] = await Promise.all([
    db.select({ id: cycles.id, code: cycles.code })
      .from(schoolCycles)
      .innerJoin(cycles, eq(schoolCycles.cycleId, cycles.id))
      .where(and(
        eq(schoolCycles.schoolId, schoolId),
        eq(schoolCycles.isActive, true),
        eq(cycles.isActive, true),
      )),
    db.select({ periodType: schoolPeriodTypeApprovals.periodType, status: schoolPeriodTypeApprovals.status })
      .from(schoolPeriodTypeApprovals)
      .where(eq(schoolPeriodTypeApprovals.schoolId, schoolId)),
  ]);
  return resolveSchoolPeriodTypeStates(activeCycles, approvals);
}

const LEVEL_ALIASES: Array<{ code: string; cycle: EducationCycleCode; pattern: RegExp }> = [
  { code: '6e', cycle: 'college', pattern: /^(6e|6eme|6ème)(?:\b|\s)/i },
  { code: '5e', cycle: 'college', pattern: /^(5e|5eme|5ème)(?:\b|\s)/i },
  { code: '4e', cycle: 'college', pattern: /^(4e|4eme|4ème)(?:\b|\s)/i },
  { code: '3e', cycle: 'college', pattern: /^(3e|3eme|3ème)(?:\b|\s)/i },
  { code: 'maternelle1', cycle: 'primaire', pattern: /^(maternelle\s*1|m\s*1)(?:\b|\s)/i },
  { code: 'maternelle2', cycle: 'primaire', pattern: /^(maternelle\s*2|m\s*2)(?:\b|\s)/i },
  { code: 'cp1', cycle: 'primaire', pattern: /^(cp\s*1)(?:\b|\s|$)/i },
  { code: 'cp2', cycle: 'primaire', pattern: /^(cp\s*2)(?:\b|\s|$)/i },
  { code: 'ce1', cycle: 'primaire', pattern: /^(ce\s*1)(?:\b|\s|$)/i },
  { code: 'ce2', cycle: 'primaire', pattern: /^(ce\s*2)(?:\b|\s|$)/i },
  { code: 'cm1', cycle: 'primaire', pattern: /^(cm\s*1)(?:\b|\s|$)/i },
  { code: 'cm2', cycle: 'primaire', pattern: /^(cm\s*2)(?:\b|\s|$)/i },
  { code: '2nde', cycle: 'lycee', pattern: /^(2de|2nde)(?:\b|\s)/i },
  { code: '1ere', cycle: 'lycee', pattern: /^(1ere|1ère)(?:\b|\s)/i },
  { code: 'tle', cycle: 'lycee', pattern: /^(tle|terminale)(?:\b|\s|$)/i },
];

export function inferLevelCodeFromClassName(name: string | null | undefined): string | null {
  const normalized = String(name ?? '').trim().replace(/\s+/g, ' ');
  return LEVEL_ALIASES.find((level) => level.pattern.test(normalized))?.code ?? null;
}

export function getExpectedPeriodTypeForCycle(cycleCode: EducationCycleCode | string | null | undefined): PeriodType | null {
  if (cycleCode === 'college' || cycleCode === 'primaire') return 'trimester';
  if (cycleCode === 'lycee') return 'semester';
  return null;
}

export function inferPeriodTypeFromLegacyName(name: string | null | undefined): PeriodType | null {
  const normalized = String(name ?? '').trim();
  if (/^Trimestre\b/i.test(normalized)) return 'trimester';
  if (/^Semestre\b/i.test(normalized)) return 'semester';
  return null;
}

export function isTermCompatibleWithCycle(
  term: { cycleId?: number | null; periodType?: string | null; name?: string | null },
  education: { cycleId?: number | null; cycleCode?: EducationCycleCode | string | null },
): boolean {
  if (education.cycleId == null || education.cycleCode == null) return false;
  const expectedPeriodType = getExpectedPeriodTypeForCycle(education.cycleCode);
  if (expectedPeriodType == null) return false;

  const termPeriodType = term.periodType ?? inferPeriodTypeFromLegacyName(term.name);
  if (termPeriodType !== expectedPeriodType) return false;
  return term.cycleId == null || term.cycleId === education.cycleId;
}

export function normalizeSchoolDate(value: string | null | undefined): string | null {
  const match = String(value ?? '').trim().match(/^(\d{4}-\d{2}-\d{2})(?:$|T)/);
  if (!match) return null;

  const parsedDate = new Date(`${match[1]}T00:00:00.000Z`);
  if (Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== match[1]) return null;
  return match[1];
}

export function resolveSchoolTermByDate<T extends { startDate?: string | null; endDate?: string | null }>(
  terms: T[],
  evaluationDate: string,
): { term: T } | { error: 'No school term matches the evaluation date' | 'Multiple active terms match the class cycle; select a term explicitly' } {
  const day = normalizeSchoolDate(evaluationDate);
  const matchingTerms = day == null ? [] : terms.filter((term) =>
    Boolean(term.startDate && term.endDate && term.startDate <= day && day <= term.endDate)
  );

  if (matchingTerms.length === 1) return { term: matchingTerms[0] };
  if (matchingTerms.length > 1) {
    return { error: 'Multiple active terms match the class cycle; select a term explicitly' };
  }
  return { error: 'No school term matches the evaluation date' };
}

export function getPeriodTypeShortName(periodType: string | null | undefined, orderIndex: number, legacyName?: string | null): string {
  if (periodType === 'trimester') return `T${orderIndex}`;
  if (periodType === 'semester') return `S${orderIndex}`;
  const name = String(legacyName ?? '').trim();
  const trimesterMatch = name.match(/^Trimestre\s+(\d+)$/i);
  if (trimesterMatch) return `T${trimesterMatch[1]}`;
  const semesterMatch = name.match(/^Semestre\s+(\d+)$/i);
  if (semesterMatch) return `S${semesterMatch[1]}`;
  return `S${orderIndex || 1}`;
}

export async function resolveClassEducation(classId: number) {
  const [row] = await db
    .select({
      classId: classes.id,
      className: classes.name,
      schoolId: classes.schoolId,
      academicYearId: classes.academicYearId,
      levelId: classes.levelId,
      levelCode: levels.code,
      levelName: levels.name,
      cycleId: cycles.id,
      cycleCode: cycles.code,
      cycleName: cycles.name,
    })
    .from(classes)
    .leftJoin(levels, eq(classes.levelId, levels.id))
    .leftJoin(cycles, eq(levels.cycleId, cycles.id))
    .where(eq(classes.id, classId));

  if (!row) return null;
  return {
    ...row,
    cycleCode: row.cycleCode as EducationCycleCode | null,
    inferredLevelCode: row.levelCode ?? inferLevelCodeFromClassName(row.className),
  };
}

export async function resolveCycleForClass(classId: number) {
  const education = await resolveClassEducation(classId);
  if (!education) return null;
  if (education.cycleId != null && education.cycleCode) return education;
  return { ...education, cycleId: null, cycleCode: null, cycleName: null };
}

export async function listTermsForClass(classId: number, academicYearId: number, schoolId: number | null) {
  const education = await resolveCycleForClass(classId);
  if (!education || schoolId == null) return [];

  const baseConditions = [
    eq(schoolTerms.academicYearId, academicYearId),
    or(sql`${schoolTerms.schoolId} IS NULL`, schoolId == null ? sql`false` : eq(schoolTerms.schoolId, schoolId)),
  ];

  const rows = await db.select().from(schoolTerms).where(and(...baseConditions));
  const periodStates = await getSchoolPeriodTypeStates(schoolId);
  return filterAvailableSchoolTerms(rows, periodStates, education);
}

export async function validateSchoolCycle(schoolId: number | null, cycleId: number | null) {
  if (schoolId == null || cycleId == null) return true;
  const [{ total }] = await db.select({ total: count() }).from(schoolCycles).where(eq(schoolCycles.schoolId, schoolId));
  if (Number(total) === 0) return true;
  const [assignment] = await db.select({ id: schoolCycles.id }).from(schoolCycles).where(and(
    eq(schoolCycles.schoolId, schoolId),
    eq(schoolCycles.cycleId, cycleId),
    eq(schoolCycles.isActive, true),
  ));
  return Boolean(assignment);
}

export async function resolveSchoolTermForClass(params: {
  classId: number;
  academicYearId: number;
  schoolId: number | null;
  date: string;
  requestedTermId?: number | null;
}) {
  const education = await resolveCycleForClass(params.classId);
  if (!education) return { error: 'Class not found' as const };

  if (education.cycleId != null && !(await validateSchoolCycle(params.schoolId, education.cycleId))) {
    return { error: 'Class cycle is not enabled for this school' as const };
  }

  const terms = await listTermsForClass(params.classId, params.academicYearId, params.schoolId);
  // listTermsForClass already applies cycle compatibility, including legacy terms
  // whose period type matches but whose cycleId was not stored historically.
  const eligibleTerms = terms;

  if (params.requestedTermId != null) {
    const selected = eligibleTerms.find((term) => term.id === params.requestedTermId);
    if (!selected) return { error: 'Selected term is not compatible with the class cycle' as const };
    return { term: selected, education };
  }

  const resolved = resolveSchoolTermByDate(eligibleTerms, params.date);
  if ('error' in resolved) return resolved;
  return { term: resolved.term, education };
}
