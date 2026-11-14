import type { Absence } from '../types.ts';

export function getEffectiveAbsenceJustificationStatus(
  absence: Pick<Absence, 'justificationStatus' | 'isJustified'>,
): NonNullable<Absence['justificationStatus']> | null {
  return absence.justificationStatus ?? (absence.isJustified ? 'APPROVED' : null);
}
