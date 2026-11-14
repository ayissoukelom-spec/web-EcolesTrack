import type {
  AccountingTuitionProgressResult,
  AccountingTuitionProgressStudent,
} from './accountingTuitionProgress.ts';
import type { TuitionProgressReminderExecutionScope } from './tuitionProgressReminderExecution.ts';

export type TuitionProgressReminderNotificationControl = {
  id: number;
  schoolId: number;
  academicYearId: number;
  cycleId: number;
  studentId: number;
  monthStart: string;
  scheduledAt: Date;
  expiresAt: Date;
  timeZone: string;
  status: string;
  notificationId: number | null;
};

export type TuitionProgressReminderNotificationAssessment =
  | { status: 'not_due' }
  | { status: 'already_created' }
  | { status: 'expired' }
  | { status: 'skipped_invalid_calendar' }
  | { status: 'skipped_ambiguous'; lastError: string }
  | { status: 'suppressed_paid'; targetAmount: number; netPaidAmount: number; shortfallAmount: 0 }
  | {
    status: 'below_target';
    annualNetAmount: number;
    targetAmount: number;
    netPaidAmount: number;
    shortfallAmount: number;
    student: {
      studentId: number;
      firstName: string | null;
      lastName: string | null;
      status: 'below_target';
    };
    assessmentDate: string;
  };

export type TuitionProgressReminderInAppNotificationResult =
  | { controlId: number; status: 'created' | 'already_created' | 'not_due' | 'expired' }
  | {
    controlId: number;
    status: 'suppressed_paid' | 'skipped_ambiguous' | 'skipped_invalid_calendar' | 'skipped_no_recipient';
  };

export type TuitionProgressReminderInAppNotificationBatch = {
  processedCount: number;
  createdCount: number;
  pushQueuedCount: number;
  pushUnavailableDeviceCount: number;
  results: TuitionProgressReminderInAppNotificationResult[];
};

export type TuitionProgressReminderInAppNotificationSource = {
  listDueControlIds: (input: {
    now: Date;
    limit: number;
    scope?: TuitionProgressReminderExecutionScope;
  }) => Promise<number[]>;
  processControl: (input: { controlId: number; now: Date }) =>
    Promise<TuitionProgressReminderInAppNotificationResult['status']>;
  queuePushForControl: (input: { controlId: number; now: Date; testDeviceId?: string }) =>
    Promise<'queued' | 'already_queued' | 'unavailable_device' | 'expired' | 'suppressed_paid' | 'invalid_scope'>;
};

export const getTuitionProgressReminderAssessmentDate = (
  instant: Date,
  timeZone: string,
): string | null => {
  if (!(instant instanceof Date) || !Number.isFinite(instant.getTime())
    || typeof timeZone !== 'string' || timeZone.trim().length === 0) return null;
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(instant);
    const values = Object.fromEntries(
      parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]),
    );
    if (!values.year || !values.month || !values.day) return null;
    return `${values.year.padStart(4, '0')}-${values.month}-${values.day}`;
  } catch {
    return null;
  }
};

export const assessTuitionProgressReminderNotification = (input: {
  control: TuitionProgressReminderNotificationControl;
  now: Date;
  accounting: AccountingTuitionProgressResult;
}): TuitionProgressReminderNotificationAssessment => {
  const { control, now, accounting } = input;
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new Error('A valid current timestamp is required to assess a tuition progress notification.');
  }
  if (control.status !== 'checked_below_target' || control.notificationId != null) {
    return { status: 'already_created' };
  }
  if (control.expiresAt.getTime() <= now.getTime()) return { status: 'expired' };
  if (control.scheduledAt.getTime() > now.getTime()) return { status: 'not_due' };

  const assessmentDate = getTuitionProgressReminderAssessmentDate(now, control.timeZone);
  if (!assessmentDate || !/^\d{4}-\d{2}-01$/.test(control.monthStart)
    || control.monthStart !== `${assessmentDate.slice(0, 7)}-01`) {
    return { status: 'skipped_invalid_calendar' };
  }
  if (accounting.status === 'calendar_invalid') return { status: 'skipped_invalid_calendar' };
  if (accounting.schoolId !== control.schoolId
    || accounting.academicYearId !== control.academicYearId
    || accounting.cycleId !== control.cycleId) {
    throw new Error('The accounting service returned results outside the notification control scope.');
  }

  const student = accounting.students.find((candidate) => candidate.studentId === control.studentId);
  if (!student) return { status: 'skipped_ambiguous', lastError: 'student_missing_from_accounting_result' };
  if (student.status === 'excluded_ambiguous') {
    return { status: 'skipped_ambiguous', lastError: student.reasonCode };
  }
  if (student.status === 'outside_school_year') return { status: 'skipped_invalid_calendar' };

  const annualNetAmount = student.annualNetAmount;
  const targetAmount = student.expectedCumulativeAmount;
  const netPaidAmount = student.netPaidAmount;
  const shortfallAmount = student.shortfallAmount;
  if (targetAmount == null || ![annualNetAmount, targetAmount, netPaidAmount, shortfallAmount].every((amount) =>
    Number.isSafeInteger(amount) && amount >= 0)
    || shortfallAmount !== Math.max(targetAmount - netPaidAmount, 0)
    || (student.status === 'below_target') !== (shortfallAmount > 0)) {
    throw new Error('The accounting service returned inconsistent tuition-progress amounts.');
  }

  if (student.status === 'up_to_date') {
    return { status: 'suppressed_paid', targetAmount, netPaidAmount, shortfallAmount: 0 };
  }
  if (student.status !== 'below_target') return { status: 'skipped_invalid_calendar' };
  return {
    status: 'below_target',
    annualNetAmount,
    targetAmount,
    netPaidAmount,
    shortfallAmount,
    student: {
      studentId: student.studentId,
      firstName: student.firstName,
      lastName: student.lastName,
      status: 'below_target',
    },
    assessmentDate,
  };
};

export const getTuitionProgressReminderNotificationDedupeKey = (controlId: number): string => {
  if (!Number.isSafeInteger(controlId) || controlId <= 0) {
    throw new Error('A valid tuition progress reminder control ID is required.');
  }
  return `tuition-progress-reminder:${controlId}`;
};

export const buildTuitionProgressReminderInAppNotification = (
  assessment: Extract<TuitionProgressReminderNotificationAssessment, { status: 'below_target' }>,
): { title: string; body: string } => {
  const studentName = [assessment.student.firstName, assessment.student.lastName]
    .filter((name): name is string => typeof name === 'string' && name.trim().length > 0)
    .map((name) => name.trim())
    .join(' ');
  const childLabel = studentName ? `votre enfant ${studentName}` : 'votre enfant';
  const [year, month, day] = assessment.assessmentDate.split('-');
  const formatAmount = (amount: number) => new Intl.NumberFormat('fr-FR', {
    maximumFractionDigits: 0,
  }).format(amount);
  return {
    title: 'Rappel de scolarité',
    body: [
      `Cher parent, au ${day}/${month}/${year}, voici la situation des versements de scolarité de ${childLabel} :`,
      '',
      `• Scolarité annuelle : ${formatAmount(assessment.annualNetAmount)} FCFA`,
      `• Montant déjà versé : ${formatAmount(assessment.netPaidAmount)} FCFA`,
      `• Montant recommandé à ce jour : ${formatAmount(assessment.targetAmount)} FCFA`,
      `• Complément de versement conseillé : ${formatAmount(assessment.shortfallAmount)} FCFA`,
      '',
      'Nous vous invitons à verser ce complément pour être à jour par rapport au rythme recommandé de paiement.',
      '',
      'Si vous avez récemment effectué un versement non encore enregistré, veuillez vous rapprocher de l’établissement.',
      '',
      'Merci pour votre collaboration.',
    ].join('\n'),
  };
};

export const createTuitionProgressReminderInAppNotifications = async (input: {
  now: Date;
  source: TuitionProgressReminderInAppNotificationSource;
  scope?: TuitionProgressReminderExecutionScope;
  testDeviceId?: string;
  limit?: number;
  clock?: () => Date;
}): Promise<TuitionProgressReminderInAppNotificationBatch> => {
  const { now, source } = input;
  const limit = input.limit ?? 25;
  const clock = input.clock ?? (() => new Date());
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())
    || !Number.isSafeInteger(limit) || limit < 1) {
    throw new Error('A valid timestamp and positive batch limit are required.');
  }

  const controlIds = await source.listDueControlIds({
    now: new Date(now),
    limit,
    scope: input.scope,
  });
  if (controlIds.length > limit
    || controlIds.some((id) => !Number.isSafeInteger(id) || id <= 0)
    || new Set(controlIds).size !== controlIds.length) {
    throw new Error('The notification source returned invalid or duplicate control IDs.');
  }

  const results: TuitionProgressReminderInAppNotificationResult[] = [];
  let pushQueuedCount = 0;
  let pushUnavailableDeviceCount = 0;
  for (const controlId of controlIds) {
    const processingNow = clock();
    if (!(processingNow instanceof Date) || !Number.isFinite(processingNow.getTime())) {
      throw new Error('The notification clock returned an invalid timestamp.');
    }
    const status = await source.processControl({ controlId, now: new Date(processingNow) });
    results.push({
      controlId,
      status,
    });
    if (status === 'created' || status === 'already_created') {
      const queueNow = clock();
      if (!(queueNow instanceof Date) || !Number.isFinite(queueNow.getTime())) {
        throw new Error('The notification clock returned an invalid timestamp.');
      }
      const queueResult = await source.queuePushForControl({
        controlId,
        now: new Date(queueNow),
        testDeviceId: input.testDeviceId,
      });
      if (queueResult === 'queued' || queueResult === 'already_queued') pushQueuedCount += 1;
      if (queueResult === 'unavailable_device') pushUnavailableDeviceCount += 1;
    }
  }

  const createdCount = results.filter((result) => result.status === 'created').length;
  return {
    processedCount: results.length,
    createdCount,
    pushQueuedCount,
    pushUnavailableDeviceCount,
    results,
  };
};
