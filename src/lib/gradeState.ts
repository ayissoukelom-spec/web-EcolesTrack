export function upsertGradeInList<T extends { id?: number; evaluationId?: number; studentId?: number }>(
  grades: T[],
  incomingGrade: T,
): T[] {
  const existingIndex = grades.findIndex((grade) => {
    if (incomingGrade.id != null && grade.id != null) {
      return Number(grade.id) === Number(incomingGrade.id);
    }
    return grade.evaluationId === incomingGrade.evaluationId && grade.studentId === incomingGrade.studentId;
  });

  if (existingIndex >= 0) {
    const nextGrades = [...grades];
    nextGrades[existingIndex] = { ...nextGrades[existingIndex], ...incomingGrade };
    return nextGrades;
  }

  return [...grades, incomingGrade];
}
