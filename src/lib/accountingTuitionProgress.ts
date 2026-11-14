import { calculateStudentFeeBalance } from './accountingRules.ts';
import {
  calculateTuitionProgress,
  type TuitionProgressPeriod,
} from './tuitionProgress.ts';

export type AccountingTuitionProgressInput = {
  schoolId: number;
  academicYearId: number;
  cycleId: number;
  assessmentDate: string;
};

export type AccountingTuitionProgressAcademicYear = {
  id: number;
  schoolId: number | null;
};

export type AccountingTuitionProgressObligation = {
  id: number;
  studentId: number;
  schoolId: number;
  academicYearId: number;
  classId: number;
  categoryId: number;
  amount: number;
  currency: string;
  studentSchoolId: number | null;
  firstName: string | null;
  lastName: string | null;
  matricule: string | null;
  classSchoolId: number | null;
  classAcademicYearId: number | null;
  className: string | null;
  cycleId: number | null;
};

export type AccountingTuitionProgressAllocation = {
  id: number;
  obligationId: number;
  installmentId: number | null;
  installmentObligationId: number | null;
  amount: number;
  paymentId: number;
  paymentSchoolId: number;
  paymentStudentId: number;
  paymentAcademicYearId: number;
  paymentStatus: string;
  paidAtDate: string | null;
};

export type AccountingTuitionProgressAdjustment = {
  adjustmentId: number;
  paymentAllocationId: number;
  adjustmentPaymentId: number;
  amount: number;
  kind: string;
  recordedAtDate: string | null;
};

export type AccountingTuitionProgressDataSource = {
  loadAcademicYear: (
    schoolId: number,
    academicYearId: number,
  ) => Promise<AccountingTuitionProgressAcademicYear | null>;
  loadPeriods: (
    schoolId: number,
    academicYearId: number,
    cycleId: number,
  ) => Promise<readonly TuitionProgressPeriod[]>;
  loadTuitionObligations: (
    schoolId: number,
    academicYearId: number,
  ) => Promise<readonly AccountingTuitionProgressObligation[]>;
  loadPaymentAllocations: (
    schoolId: number,
    academicYearId: number,
    allocationObligationIds: readonly number[],
  ) => Promise<readonly AccountingTuitionProgressAllocation[]>;
  loadPaymentAdjustments: (
    paymentAllocationIds: readonly number[],
  ) => Promise<readonly AccountingTuitionProgressAdjustment[]>;
};

export type AccountingTuitionProgressStudent =
  | {
    studentId: number;
    firstName: string | null;
    lastName: string | null;
    matricule: string | null;
    className: string | null;
    status: 'up_to_date' | 'below_target' | 'outside_school_year';
    annualNetAmount: number;
    netPaidAmount: number;
    month: string | null;
    expectedCumulativeAmount: number | null;
    shortfallAmount: number;
  }
  | {
    studentId: number;
    firstName: string | null;
    lastName: string | null;
    matricule: string | null;
    className: string | null;
    status: 'excluded_ambiguous';
    reasonCode: string;
    reason: string;
  };

export type AccountingTuitionProgressResult =
  | {
    status: 'calendar_invalid';
    reasonCode: string;
    reason: string;
  }
  | {
    status: 'ready';
    schoolId: number;
    academicYearId: number;
    cycleId: number;
    calendar: {
      system: 'trimester' | 'semester';
      startDate: string;
      endDate: string;
      durationDays: number;
    };
    students: AccountingTuitionProgressStudent[];
  };

type StudentProgressData = {
  studentId: number;
  firstName: string | null;
  lastName: string | null;
  matricule: string | null;
  className: string | null;
};

const isPositiveSafeInteger = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Number(value) > 0;

const isNonNegativeSafeInteger = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Number(value) >= 0;

const isValidIsoDate = (value: unknown): value is string => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};

const calendarInvalid = (
  reasonCode: string,
  reason: string,
): AccountingTuitionProgressResult => ({
  status: 'calendar_invalid',
  reasonCode,
  reason,
});

const ambiguity = (
  student: StudentProgressData,
  reasonCode: string,
  reason: string,
): AccountingTuitionProgressStudent => ({
  ...student,
  status: 'excluded_ambiguous',
  reasonCode,
  reason,
});

export const getAccountingTuitionProgressCandidates = async (
  input: AccountingTuitionProgressInput,
  source: AccountingTuitionProgressDataSource,
): Promise<AccountingTuitionProgressResult> => {
  if (!isPositiveSafeInteger(input.schoolId)
    || !isPositiveSafeInteger(input.academicYearId)
    || !isPositiveSafeInteger(input.cycleId)) {
    return calendarInvalid('invalid_context', 'L’établissement, l’année scolaire ou le cycle est invalide.');
  }
  if (!isValidIsoDate(input.assessmentDate)) {
    return calendarInvalid('invalid_assessment_date', 'La date de contrôle est invalide.');
  }

  const [academicYear, periods] = await Promise.all([
    source.loadAcademicYear(input.schoolId, input.academicYearId),
    source.loadPeriods(input.schoolId, input.academicYearId, input.cycleId),
  ]);
  if (!academicYear || academicYear.id !== input.academicYearId
    || (academicYear.schoolId != null && academicYear.schoolId !== input.schoolId)) {
    return calendarInvalid('academic_year_scope_mismatch', 'L’année scolaire est absente ou rattachée à un autre établissement.');
  }
  if (periods.some((period) =>
    period.academicYearId !== input.academicYearId
    || period.cycleId !== input.cycleId
    || (period.schoolId != null && period.schoolId !== input.schoolId))) {
    return calendarInvalid('period_scope_mismatch', 'Une période ne correspond pas à l’établissement, l’année et le cycle demandés.');
  }

  const calendarResult = calculateTuitionProgress({
    schoolId: input.schoolId,
    academicYearId: input.academicYearId,
    academicYearSchoolId: academicYear.schoolId,
    cycleId: input.cycleId,
    periods,
    annualNetAmount: 0,
    netPaidAmount: 0,
    assessmentDate: input.assessmentDate,
  });
  if ('error' in calendarResult) {
    return calendarInvalid(calendarResult.error.code, calendarResult.error.message);
  }

  const obligations = await source.loadTuitionObligations(input.schoolId, input.academicYearId);
  const obligationsByStudent = new Map<number, AccountingTuitionProgressObligation[]>();
  const studentData = new Map<number, StudentProgressData>();
  for (const obligation of obligations) {
    if (!isPositiveSafeInteger(obligation.studentId)) continue;
    const grouped = obligationsByStudent.get(obligation.studentId) ?? [];
    grouped.push(obligation);
    obligationsByStudent.set(obligation.studentId, grouped);
    if (!studentData.has(obligation.studentId)) {
      studentData.set(obligation.studentId, {
        studentId: obligation.studentId,
        firstName: obligation.firstName,
        lastName: obligation.lastName,
        matricule: obligation.matricule,
        className: obligation.className,
      });
    }
  }

  const studentResults: AccountingTuitionProgressStudent[] = [];
  const selectedObligations: AccountingTuitionProgressObligation[] = [];
  const ambiguousStudentIds = new Set<number>();
  for (const [studentId, studentObligations] of obligationsByStudent) {
    const student = studentData.get(studentId)!;
    const cycleObligations = studentObligations.filter((obligation) => obligation.cycleId === input.cycleId);
    const unresolvedCycle = studentObligations.some((obligation) => obligation.cycleId == null);
    if (!cycleObligations.length) {
      if (unresolvedCycle) {
        studentResults.push(ambiguity(
          student,
          'obligation_cycle_unresolved',
          'Le cycle d’une obligation active de scolarité ne peut pas être déterminé.',
        ));
      }
      continue;
    }
    if (studentObligations.length !== 1) {
      studentResults.push(ambiguity(
        student,
        'multiple_active_tuition_obligations',
        'Plusieurs obligations actives de scolarité empêchent de déterminer le montant annuel sans ambiguïté.',
      ));
      continue;
    }

    const obligation = cycleObligations[0];
    if (obligation.schoolId !== input.schoolId
      || obligation.academicYearId !== input.academicYearId
      || obligation.studentSchoolId !== input.schoolId
      || (obligation.classSchoolId != null && obligation.classSchoolId !== input.schoolId)
      || obligation.classAcademicYearId !== input.academicYearId
      || obligation.cycleId !== input.cycleId
      || !isPositiveSafeInteger(obligation.id)
      || !isPositiveSafeInteger(obligation.classId)
      || !isPositiveSafeInteger(obligation.categoryId)
      || !isPositiveSafeInteger(obligation.amount)
      || obligation.currency !== 'XOF') {
      studentResults.push(ambiguity(
        student,
        'obligation_scope_or_amount_invalid',
        'L’obligation active de scolarité contient un rattachement ou un montant incohérent.',
      ));
      continue;
    }
    selectedObligations.push(obligation);
  }

  const obligationIdCounts = new Map<number, number>();
  for (const obligation of selectedObligations) {
    obligationIdCounts.set(obligation.id, (obligationIdCounts.get(obligation.id) ?? 0) + 1);
  }
  for (const obligation of selectedObligations) {
    if ((obligationIdCounts.get(obligation.id) ?? 0) > 1) ambiguousStudentIds.add(obligation.studentId);
  }

  const validObligations = selectedObligations.filter((obligation) =>
    !ambiguousStudentIds.has(obligation.studentId));
  const allocations = validObligations.length
    ? await source.loadPaymentAllocations(
      input.schoolId,
      input.academicYearId,
      validObligations.map((obligation) => obligation.id),
    )
    : [];
  const allocationById = new Map<number, AccountingTuitionProgressAllocation>();
  const allocationStudentById = new Map<number, number>();
  const netPaidByObligation = new Map<number, number>();
  const studentByObligationId = new Map(validObligations.map((item) => [item.id, item.studentId]));
  const obligationById = new Map(validObligations.map((item) => [item.id, item]));

  for (const allocation of allocations) {
    const obligation = obligationById.get(allocation.obligationId);
    if (!obligation) continue;
    const student = studentData.get(obligation.studentId)!;
    if (!isPositiveSafeInteger(allocation.id)) {
      ambiguousStudentIds.add(student.studentId);
      continue;
    }
    const previousStudentId = allocationStudentById.get(allocation.id);
    if (previousStudentId != null) {
      ambiguousStudentIds.add(student.studentId);
      ambiguousStudentIds.add(previousStudentId);
      continue;
    }
    allocationStudentById.set(allocation.id, student.studentId);
    if (!isPositiveSafeInteger(allocation.paymentId)
      || allocation.paymentSchoolId !== input.schoolId
      || allocation.paymentStudentId !== obligation.studentId
      || allocation.paymentAcademicYearId !== input.academicYearId
      || allocation.paymentStatus !== 'posted' && allocation.paymentStatus !== 'cancelled'
      || !isPositiveSafeInteger(allocation.amount)
      || (allocation.installmentId != null
        && (!isPositiveSafeInteger(allocation.installmentId)
          || allocation.installmentObligationId !== obligation.id))
      || (allocation.installmentId == null && allocation.installmentObligationId != null)) {
      ambiguousStudentIds.add(student.studentId);
      continue;
    }
    allocationById.set(allocation.id, allocation);
  }

  const relevantPostedAllocations = [...allocationById.values()].filter((allocation) => {
    if (allocation.paymentStatus !== 'posted') return false;
    const studentId = studentByObligationId.get(allocation.obligationId);
    if (studentId == null) return false;
    if (!isValidIsoDate(allocation.paidAtDate)) {
      ambiguousStudentIds.add(studentId);
      return false;
    }
    return allocation.paidAtDate <= input.assessmentDate;
  });
  const adjustments = allocationById.size
    ? await source.loadPaymentAdjustments([...allocationById.keys()])
    : [];
  const adjustmentTotals = new Map<number, number>();
  const adjustmentEntries = new Set<string>();
  const relevantPostedAllocationIds = new Set(relevantPostedAllocations.map((allocation) => allocation.id));
  for (const adjustment of adjustments) {
    const allocation = allocationById.get(adjustment.paymentAllocationId);
    if (!allocation) continue;
    const studentId = studentByObligationId.get(allocation.obligationId);
    if (studentId == null || !relevantPostedAllocationIds.has(allocation.id)) continue;
    if (!isValidIsoDate(adjustment.recordedAtDate)) {
      ambiguousStudentIds.add(studentId);
      continue;
    }
    if (adjustment.recordedAtDate > input.assessmentDate) continue;
    if (adjustment.adjustmentPaymentId !== allocation.paymentId
      || !isPositiveSafeInteger(adjustment.adjustmentId)
      || !isPositiveSafeInteger(adjustment.amount)
      || (adjustment.kind !== 'refund' && adjustment.kind !== 'cancellation')) {
      ambiguousStudentIds.add(studentId);
      continue;
    }
    const entryKey = `${adjustment.adjustmentId}:${adjustment.paymentAllocationId}`;
    if (adjustmentEntries.has(entryKey)) {
      ambiguousStudentIds.add(studentId);
      continue;
    }
    adjustmentEntries.add(entryKey);
    if (adjustment.kind === 'cancellation') {
      ambiguousStudentIds.add(studentId);
      continue;
    }
    adjustmentTotals.set(
      adjustment.paymentAllocationId,
      (adjustmentTotals.get(adjustment.paymentAllocationId) ?? 0) + adjustment.amount,
    );
  }

  for (const allocation of relevantPostedAllocations) {
    const studentId = studentByObligationId.get(allocation.obligationId);
    if (studentId == null || ambiguousStudentIds.has(studentId)) continue;
    const adjustedAmount = adjustmentTotals.get(allocation.id) ?? 0;
    if (!isNonNegativeSafeInteger(adjustedAmount) || adjustedAmount > allocation.amount) {
      ambiguousStudentIds.add(studentId);
      continue;
    }
    netPaidByObligation.set(
      allocation.obligationId,
      (netPaidByObligation.get(allocation.obligationId) ?? 0) + allocation.amount - adjustedAmount,
    );
  }

  for (const studentId of ambiguousStudentIds) {
    const student = studentData.get(studentId);
    if (!student || studentResults.some((result) => result.studentId === studentId)) continue;
    studentResults.push(ambiguity(
      student,
      'payment_data_ambiguous',
      'Les paiements ou leurs ajustements ne permettent pas de calculer un solde net fiable.',
    ));
  }

  for (const obligation of validObligations) {
    if (ambiguousStudentIds.has(obligation.studentId)) continue;
    const student = studentData.get(obligation.studentId)!;
    const paidAmount = netPaidByObligation.get(obligation.id) ?? 0;
    if (!isNonNegativeSafeInteger(paidAmount)) {
      studentResults.push(ambiguity(
        student,
        'payment_total_invalid',
        'Le cumul net des paiements dépasse les montants numériques exploitables.',
      ));
      continue;
    }
    const balance = calculateStudentFeeBalance({
      studentId: obligation.studentId,
      categoryId: obligation.categoryId,
      obligations: [{ id: obligation.id, amount: obligation.amount }],
      allocations: [{ obligationId: obligation.id, amount: paidAmount, adjustedAmount: 0 }],
    });
    if (!isNonNegativeSafeInteger(balance.due) || !isNonNegativeSafeInteger(balance.paid)) {
      studentResults.push(ambiguity(
        student,
        'payment_total_invalid',
        'Le cumul net des paiements dépasse les montants numériques exploitables.',
      ));
      continue;
    }

    const progress = calculateTuitionProgress({
      schoolId: input.schoolId,
      academicYearId: input.academicYearId,
      academicYearSchoolId: academicYear.schoolId,
      cycleId: input.cycleId,
      periods,
      annualNetAmount: balance.due,
      netPaidAmount: balance.paid,
      assessmentDate: input.assessmentDate,
    });
    if ('error' in progress) return calendarInvalid(progress.error.code, progress.error.message);
    const assessment = progress.currentAssessment;
    studentResults.push({
      ...student,
      status: assessment == null
        ? 'outside_school_year'
        : assessment.reminderJustified ? 'below_target' : 'up_to_date',
      annualNetAmount: balance.due,
      netPaidAmount: balance.paid,
      month: assessment?.month ?? null,
      expectedCumulativeAmount: assessment?.expectedCumulativeAmount ?? null,
      shortfallAmount: assessment?.shortfallAmount ?? 0,
    });
  }

  return {
    status: 'ready',
    schoolId: input.schoolId,
    academicYearId: input.academicYearId,
    cycleId: input.cycleId,
    calendar: {
      system: calendarResult.system,
      startDate: calendarResult.startDate,
      endDate: calendarResult.endDate,
      durationDays: calendarResult.durationDays,
    },
    students: studentResults.sort((left, right) => left.studentId - right.studentId),
  };
};
