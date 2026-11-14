export type TuitionProgressPeriod = {
  schoolId?: number | null;
  academicYearId?: number | null;
  cycleId?: number | null;
  periodType?: string | null;
  orderIndex?: number | null;
  startDate?: string | null;
  endDate?: string | null;
  isActive?: boolean | null;
};

export type TuitionProgressInput = {
  schoolId: number;
  academicYearId: number;
  academicYearSchoolId: number | null;
  cycleId: number;
  periods: readonly TuitionProgressPeriod[];
  annualNetAmount: number;
  netPaidAmount: number;
  assessmentDate: string;
};

export type TuitionProgressErrorCode =
  | 'invalid_context'
  | 'invalid_amounts'
  | 'invalid_assessment_date'
  | 'period_scope_mismatch'
  | 'periods_incomplete'
  | 'period_type_ambiguous'
  | 'period_dates_invalid'
  | 'period_order_invalid';

export type TuitionProgressCheckpoint = {
  index: number;
  month: string;
  checkDate: string;
  elapsedDays: number;
  expectedCumulativeAmount: number;
};

export type TuitionProgressResult =
  | {
    ok: false;
    error: { code: TuitionProgressErrorCode; message: string };
  }
  | {
    ok: true;
    schoolId: number;
    academicYearId: number;
    cycleId: number;
    system: 'trimester' | 'semester';
    startDate: string;
    endDate: string;
    startMonth: string;
    endMonth: string;
    durationDays: number;
    annualNetAmount: number;
    netPaidAmount: number;
    checkpoints: TuitionProgressCheckpoint[];
    currentAssessment: {
      month: string;
      assessmentDate: string;
      elapsedDays: number;
      durationDays: number;
      expectedCumulativeAmount: number;
      netPaidAmount: number;
      shortfallAmount: number;
      reminderJustified: boolean;
    } | null;
  };

const isPositiveSafeInteger = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Number(value) > 0;

const isValidIsoDate = (value: unknown): value is string => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};

const monthOrdinal = (date: string) => {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  return year * 12 + month - 1;
};

const monthKey = (ordinal: number) => {
  const year = Math.floor(ordinal / 12);
  const month = (ordinal % 12) + 1;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`;
};

const daysBetween = (startDate: string, endDate: string) =>
  Math.floor((Date.parse(`${endDate}T00:00:00.000Z`) - Date.parse(`${startDate}T00:00:00.000Z`)) / 86_400_000);

const expectedCumulativeAmount = (annualAmount: number, elapsedDays: number, durationDays: number) => {
  const wholePerDay = Math.floor(annualAmount / durationDays);
  const remainder = annualAmount % durationDays;
  const roundedRemainder = Math.floor(
    (remainder * elapsedDays + Math.floor(durationDays / 2)) / durationDays,
  );
  return Math.min(annualAmount, wholePerDay * elapsedDays + roundedRemainder);
};

const endOfMonth = (ordinal: number) => {
  const nextMonth = `${monthKey(ordinal + 1)}-01T00:00:00.000Z`;
  return new Date(Date.parse(nextMonth) - 86_400_000).toISOString().slice(0, 10);
};

const failure = (
  code: TuitionProgressErrorCode,
  message: string,
): TuitionProgressResult => ({ ok: false, error: { code, message } });

export const calculateTuitionProgress = (input: TuitionProgressInput): TuitionProgressResult => {
  if (!isPositiveSafeInteger(input.schoolId)
    || !isPositiveSafeInteger(input.academicYearId)
    || !isPositiveSafeInteger(input.cycleId)
    || input.academicYearSchoolId === undefined
    || (input.academicYearSchoolId != null && !isPositiveSafeInteger(input.academicYearSchoolId))
    || (input.academicYearSchoolId != null && input.academicYearSchoolId !== input.schoolId)) {
    return failure('invalid_context', 'L’établissement, l’année scolaire ou le cycle est invalide.');
  }
  if (!Number.isSafeInteger(input.annualNetAmount) || input.annualNetAmount < 0
    || !Number.isSafeInteger(input.netPaidAmount) || input.netPaidAmount < 0) {
    return failure('invalid_amounts', 'Les montants nets doivent être des entiers positifs ou nuls.');
  }
  if (!isValidIsoDate(input.assessmentDate)) {
    return failure('invalid_assessment_date', 'La date de calcul est invalide.');
  }

  const cyclePeriods = input.periods.filter((period) =>
    period.academicYearId === input.academicYearId && period.cycleId === input.cycleId);
  if (!cyclePeriods.length) {
    return failure('periods_incomplete', 'Aucune période configurée pour cette année et ce cycle.');
  }

  for (const period of cyclePeriods) {
    if (period.schoolId === undefined
      || (period.schoolId != null && period.schoolId !== input.schoolId)) {
      return failure('period_scope_mismatch', 'Une période n’est pas rattachée sans ambiguïté à cet établissement.');
    }
    if (typeof period.isActive !== 'boolean') {
      return failure('periods_incomplete', 'Le statut actif d’une période est indéterminé.');
    }
  }

  const activePeriods = cyclePeriods.filter((period) => period.isActive);
  if (!activePeriods.length) {
    return failure('periods_incomplete', 'Aucune période active n’est configurée pour ce cycle.');
  }
  if (activePeriods.some((period) => period.periodType !== 'trimester' && period.periodType !== 'semester')) {
    return failure('period_type_ambiguous', 'Le type pédagogique d’une période active est absent ou invalide.');
  }

  const periodTypes = new Set(activePeriods.map((period) => period.periodType));
  if (periodTypes.size !== 1) {
    return failure('period_type_ambiguous', 'Le cycle mélange des trimestres et des semestres actifs.');
  }
  const firstPeriodType = activePeriods[0].periodType;
  if (firstPeriodType !== 'trimester' && firstPeriodType !== 'semester') {
    return failure('period_type_ambiguous', 'Le type pédagogique d’une période active est absent ou invalide.');
  }
  const system = firstPeriodType;
  const expectedPeriodCount = system === 'trimester' ? 3 : 2;
  if (activePeriods.length !== expectedPeriodCount) {
    return failure('periods_incomplete', 'Le nombre de périodes ne correspond pas au système configuré.');
  }

  const datedPeriods = activePeriods.filter((period): period is TuitionProgressPeriod & {
    startDate: string;
    endDate: string;
  } => isValidIsoDate(period.startDate) && isValidIsoDate(period.endDate));
  if (datedPeriods.length !== activePeriods.length) {
    return failure('period_dates_invalid', 'Les dates de début et de fin de chaque période doivent être complètes et valides.');
  }
  const chronologicallyOrderedPeriods = [...datedPeriods].sort((left, right) =>
    left.startDate.localeCompare(right.startDate) || left.endDate.localeCompare(right.endDate));
  if (chronologicallyOrderedPeriods.some((period, index) =>
    period.startDate > period.endDate
    || (index > 0 && chronologicallyOrderedPeriods[index - 1].endDate >= period.startDate))) {
    return failure('period_order_invalid', 'Les périodes se chevauchent ou ne sont pas dans l’ordre chronologique.');
  }

  const firstPeriod = chronologicallyOrderedPeriods[0];
  const lastPeriod = chronologicallyOrderedPeriods[chronologicallyOrderedPeriods.length - 1];
  const startDate = firstPeriod.startDate;
  const endDate = lastPeriod.endDate;
  const durationDays = daysBetween(startDate, endDate) + 1;
  if (durationDays <= 0) {
    return failure('period_order_invalid', 'La durée scolaire doit être positive.');
  }

  const startOrdinal = monthOrdinal(startDate);
  const endOrdinal = monthOrdinal(endDate);
  const checkpoints: TuitionProgressCheckpoint[] = [];
  for (let ordinal = startOrdinal; ordinal <= endOrdinal; ordinal += 1) {
    const checkDate = ordinal === endOrdinal ? endDate : endOfMonth(ordinal);
    const elapsedDays = daysBetween(startDate, checkDate) + 1;
    checkpoints.push({
      index: checkpoints.length + 1,
      month: monthKey(ordinal),
      checkDate,
      elapsedDays,
      expectedCumulativeAmount: expectedCumulativeAmount(
        input.annualNetAmount,
        elapsedDays,
        durationDays,
      ),
    });
  }

  const isWithinReminderWindow = input.assessmentDate >= startDate
    && input.assessmentDate <= endDate;
  const currentMonth = isWithinReminderWindow
    ? checkpoints.find((checkpoint) => checkpoint.month === input.assessmentDate.slice(0, 7))
    : undefined;
  const elapsedDays = currentMonth
    ? daysBetween(startDate, input.assessmentDate) + 1
    : null;
  const currentExpectedAmount = elapsedDays == null
    ? null
    : expectedCumulativeAmount(input.annualNetAmount, elapsedDays, durationDays);
  const currentAssessment = currentMonth && elapsedDays != null && currentExpectedAmount != null
    ? {
      month: currentMonth.month,
      assessmentDate: input.assessmentDate,
      elapsedDays,
      durationDays,
      expectedCumulativeAmount: currentExpectedAmount,
      netPaidAmount: input.netPaidAmount,
      shortfallAmount: Math.max(0, currentExpectedAmount - input.netPaidAmount),
      reminderJustified: input.netPaidAmount < currentExpectedAmount,
    }
    : null;

  return {
    ok: true,
    schoolId: input.schoolId,
    academicYearId: input.academicYearId,
    cycleId: input.cycleId,
    system,
    startDate,
    endDate,
    startMonth: monthKey(startOrdinal),
    endMonth: monthKey(endOrdinal),
    durationDays,
    annualNetAmount: input.annualNetAmount,
    netPaidAmount: input.netPaidAmount,
    checkpoints,
    currentAssessment,
  };
};
