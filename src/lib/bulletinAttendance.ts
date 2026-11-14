import { sql } from 'drizzle-orm';
import { absences, lateArrivals } from '../db/schema.ts';

export class InvalidBulletinTermPeriodError extends Error {
  constructor() {
    super('Les dates de début et de fin de la période du bulletin sont requises et doivent former une période valide.');
    this.name = 'InvalidBulletinTermPeriodError';
  }
}

export interface BulletinAttendanceSnapshotFields {
  termStartDateSnapshot: string | null;
  termEndDateSnapshot: string | null;
  unjustifiedAbsencesCount: number | null;
  unjustifiedLateArrivalMinutes: number | null;
}

export interface CompleteBulletinAttendanceSnapshot {
  termStartDateSnapshot: string;
  termEndDateSnapshot: string;
  unjustifiedAbsencesCount: number;
  unjustifiedLateArrivalMinutes: number;
}

const isValidIsoDate = (value: string): boolean => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || month < 1 || month > 12) return false;

  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day >= 1 && day <= daysInMonth[month - 1];
};

export const validateBulletinTermPeriod = (
  startDate: string | null | undefined,
  endDate: string | null | undefined,
): { startDate: string; endDate: string } => {
  if (
    typeof startDate !== 'string'
    || typeof endDate !== 'string'
    || !isValidIsoDate(startDate)
    || !isValidIsoDate(endDate)
    || startDate > endDate
  ) {
    throw new InvalidBulletinTermPeriodError();
  }

  return { startDate, endDate };
};

export const getCompleteBulletinAttendanceSnapshot = (
  fields: BulletinAttendanceSnapshotFields,
): CompleteBulletinAttendanceSnapshot | null => {
  const {
    termStartDateSnapshot,
    termEndDateSnapshot,
    unjustifiedAbsencesCount,
    unjustifiedLateArrivalMinutes,
  } = fields;

  if (
    termStartDateSnapshot == null
    && termEndDateSnapshot == null
    && unjustifiedAbsencesCount == null
    && unjustifiedLateArrivalMinutes == null
  ) {
    return null;
  }

  if (
    termStartDateSnapshot == null
    || termEndDateSnapshot == null
    || unjustifiedAbsencesCount == null
    || unjustifiedLateArrivalMinutes == null
  ) {
    throw new Error('Le snapshot des absences et retards du bulletin est incomplet.');
  }

  const period = validateBulletinTermPeriod(termStartDateSnapshot, termEndDateSnapshot);
  if (
    !Number.isInteger(unjustifiedAbsencesCount)
    || unjustifiedAbsencesCount < 0
    || !Number.isInteger(unjustifiedLateArrivalMinutes)
    || unjustifiedLateArrivalMinutes < 0
  ) {
    throw new Error('Le snapshot des absences et retards du bulletin contient un total invalide.');
  }

  return {
    termStartDateSnapshot: period.startDate,
    termEndDateSnapshot: period.endDate,
    unjustifiedAbsencesCount,
    unjustifiedLateArrivalMinutes,
  };
};

const excludedJustificationStatuses: readonly string[] = ['APPROVED'];

export const isLateArrivalCountedInBulletin = (
  justificationStatus: 'PENDING' | 'APPROVED' | 'REJECTED' | null,
): boolean => justificationStatus == null || !excludedJustificationStatuses.includes(justificationStatus);

export const unjustifiedLateArrivalCondition = () => sql`
  NOT EXISTS (
    SELECT 1
    FROM late_arrival_justifications laj
    WHERE laj.late_arrival_id = ${lateArrivals.id}
      AND laj.status IN (${sql.join(excludedJustificationStatuses.map((status) => sql`${status}`), sql`, `)})
  )
`;

export const unjustifiedAbsenceCondition = () => sql`(
  ${absences.justificationStatus} = 'REJECTED'
  OR (
    ${absences.justificationStatus} IS NULL
    AND ${absences.isJustified} = false
    AND ${absences.declarationId} IS NULL
  )
)`;
