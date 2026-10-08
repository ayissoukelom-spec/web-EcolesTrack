export const EXAM_MENTIONS = [
  'Passable',
  'Assez bien',
  'Bien',
  'Très bien',
  'Excellent',
] as const;

export type ExamMention = typeof EXAM_MENTIONS[number];

export const isExamMention = (value: unknown): value is ExamMention => (
  typeof value === 'string' && (EXAM_MENTIONS as readonly string[]).includes(value)
);
