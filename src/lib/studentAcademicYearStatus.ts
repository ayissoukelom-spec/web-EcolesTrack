export const STUDENT_ACADEMIC_YEAR_STATUSES = [
  'Nouveau',
  'Doublant',
  'Triplant',
  'Quadruplant',
  'Quintuplant',
  'Sextuplant',
] as const;

export type StudentAcademicYearStatus = typeof STUDENT_ACADEMIC_YEAR_STATUSES[number];

export const STUDENT_STATUS_ABBREVIATIONS: Record<StudentAcademicYearStatus, string> = {
  Nouveau: 'N',
  Doublant: 'D',
  Triplant: 'T',
  Quadruplant: 'Q',
  Quintuplant: '5',
  Sextuplant: '6',
};

export function isStudentAcademicYearStatus(value: unknown): value is StudentAcademicYearStatus {
  return typeof value === 'string' && (STUDENT_ACADEMIC_YEAR_STATUSES as readonly string[]).includes(value);
}

export function abbreviateStudentAcademicYearStatus(value: string | null | undefined): string | null {
  return isStudentAcademicYearStatus(value) ? STUDENT_STATUS_ABBREVIATIONS[value] : null;
}
