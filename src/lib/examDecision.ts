export const EXAM_TYPES = ['CEPD', 'BEPC', 'BAC_I', 'BAC_II'] as const;
export type ExamType = typeof EXAM_TYPES[number];

export const EXAM_RESULT_STATUSES = ['ADMITTED', 'NOT_ADMITTED', 'ABSENT'] as const;
export type ExamResultStatus = typeof EXAM_RESULT_STATUSES[number];

export const isExamType = (value: unknown): value is ExamType => (
  typeof value === 'string' && (EXAM_TYPES as readonly string[]).includes(value)
);

export const isExamResultStatus = (value: unknown): value is ExamResultStatus => (
  typeof value === 'string' && (EXAM_RESULT_STATUSES as readonly string[]).includes(value)
);

const EXAM_LABELS: Record<ExamType, string> = {
  CEPD: 'CEPD',
  BEPC: 'BEPC',
  BAC_I: 'BAC I',
  BAC_II: 'BAC II',
};

export const getExamLabel = (examType: ExamType): string => EXAM_LABELS[examType];

export const resolveExamPromotionDecision = ({
  examType,
  resultStatus,
}: {
  examType: ExamType;
  resultStatus: ExamResultStatus | null | undefined;
}): string | null => {
  if (!resultStatus || resultStatus === 'ABSENT') return null;
  const examLabel = getExamLabel(examType);
  return resultStatus === 'ADMITTED'
    ? `Admis au ${examLabel}`
    : `Non admis au ${examLabel}`;
};