export interface BuildGradeNotificationMessageParams {
  studentName: string;
  score: string | number;
  maxScore?: string | number | null;
  subjectName: string;
  evaluationName: string;
}

export function buildGradeNotificationMessage(params: BuildGradeNotificationMessageParams): string {
  const { studentName, score, maxScore, subjectName, evaluationName } = params;
  const normalizedScore = typeof score === 'number' ? String(score) : String(score).trim();
  const normalizedMaxScore = maxScore === undefined || maxScore === null ? undefined : typeof maxScore === 'number' ? String(maxScore) : String(maxScore).trim();
  const scoreDisplay = normalizedMaxScore ? `${normalizedScore}/${normalizedMaxScore}` : normalizedScore;
  const normalizedSubjectName = String(subjectName).trim().toLowerCase();
  const normalizedEvaluationName = String(evaluationName).trim();

  return `${studentName} a obtenu une nouvelle note: ${scoreDisplay} en ${normalizedSubjectName} : ${normalizedEvaluationName}`;
}
