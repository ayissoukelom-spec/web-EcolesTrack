import type { Grade } from '../types';

export function upsertGradeInList(grades: Grade[], incomingGrade: Grade): Grade[] {
  const existingIndex = grades.findIndex(
    (grade) => grade.evaluationId === incomingGrade.evaluationId && grade.studentId === incomingGrade.studentId
  );

  if (existingIndex === -1) {
    return [...grades, incomingGrade];
  }

  const next = [...grades];
  next[existingIndex] = {
    ...next[existingIndex],
    ...incomingGrade,
  };
  return next;
}
