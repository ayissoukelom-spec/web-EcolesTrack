export function normalizeSubjectName(value: string): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9 ]+/g, '')
    .replace(/\s+/g, ' ');
}

export function getTeacherAvailableSubjects(
  approvedSubjectsList: { id: number; name: string }[] = [],
  teacherSpecializations: string[] = [],
) {
  const approvedSubjectNames = Array.isArray(approvedSubjectsList)
    ? approvedSubjectsList.map((subject) => String(subject.name || '').trim()).filter(Boolean)
    : [];

  const assigned = (teacherSpecializations || [])
    .map((value) => normalizeSubjectName(String(value || '')))
    .filter(Boolean);

  return approvedSubjectNames.filter((subjectName) =>
    assigned.some((assignedName) => normalizeSubjectName(subjectName) === assignedName)
  );
}
