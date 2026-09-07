import { and, eq, or, sql, count } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { classes, cycles, levels, schoolCycles, schoolTerms } from '../db/schema.ts';

export type EducationCycleCode = 'college' | 'lycee';
export type PeriodType = 'trimester' | 'semester';

const LEVEL_ALIASES: Array<{ code: string; cycle: EducationCycleCode; pattern: RegExp }> = [
  { code: '6e', cycle: 'college', pattern: /^(6e|6eme|6ème)(?:\b|\s)/i },
  { code: '5e', cycle: 'college', pattern: /^(5e|5eme|5ème)(?:\b|\s)/i },
  { code: '4e', cycle: 'college', pattern: /^(4e|4eme|4ème)(?:\b|\s)/i },
  { code: '3e', cycle: 'college', pattern: /^(3e|3eme|3ème)(?:\b|\s)/i },
  { code: '2nde', cycle: 'lycee', pattern: /^(2de|2nde)(?:\b|\s)/i },
  { code: '1ere', cycle: 'lycee', pattern: /^(1ere|1ère)(?:\b|\s)/i },
  { code: 'tle', cycle: 'lycee', pattern: /^(tle|terminale)(?:\b|\s|$)/i },
];

export function inferLevelCodeFromClassName(name: string | null | undefined): string | null {
  const normalized = String(name ?? '').trim().replace(/\s+/g, ' ');
  return LEVEL_ALIASES.find((level) => level.pattern.test(normalized))?.code ?? null;
}

export function getExpectedPeriodTypeForCycle(cycleCode: EducationCycleCode | string | null | undefined): PeriodType | null {
  if (cycleCode === 'college') return 'trimester';
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
  if (education.cycleId == null || education.cycleCode == null) return true;
  if (term.cycleId != null) return term.cycleId === education.cycleId;

  const expectedPeriodType = getExpectedPeriodTypeForCycle(education.cycleCode);
  if (expectedPeriodType == null) return true;

  const termPeriodType = term.periodType ?? inferPeriodTypeFromLegacyName(term.name);
  return termPeriodType === expectedPeriodType;
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
  if (!education) return [];

  const baseConditions = [
    eq(schoolTerms.academicYearId, academicYearId),
    or(sql`${schoolTerms.schoolId} IS NULL`, schoolId == null ? sql`false` : eq(schoolTerms.schoolId, schoolId)),
  ];

  const rows = await db.select().from(schoolTerms).where(and(...baseConditions));
  if (education.cycleId == null) {
    return rows;
  }

  return rows.filter((term) => isTermCompatibleWithCycle(term, education));
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

  const matched = eligibleTerms.find((term) => term.startDate && term.endDate && params.date >= term.startDate && params.date <= term.endDate);
  if (matched) return { term: matched, education };

  const activeTerms = eligibleTerms.filter((term) => term.isActive);
  if (activeTerms.length === 1) return { term: activeTerms[0], education };
  if (activeTerms.length > 1) return { error: 'Multiple active terms match the class cycle; select a term explicitly' as const };
  if (eligibleTerms.length === 1) return { term: eligibleTerms[0], education };
  return { error: 'Unable to resolve a term for the class cycle' as const };
}
