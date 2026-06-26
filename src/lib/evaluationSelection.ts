import type { Evaluation } from '../types';

export interface ResolveSelectedEvaluationArgs {
  selectedClassId: string;
  selectedEvalId: string;
  classEvaluations: Evaluation[];
}

export const resolveSelectedEvaluationId = ({
  selectedClassId,
  selectedEvalId,
  classEvaluations,
}: ResolveSelectedEvaluationArgs): string => {
  if (!selectedClassId) return '';

  const matchingEvaluations = classEvaluations.filter((ev) => String(ev.classId) === selectedClassId);
  if (matchingEvaluations.length === 0) return '';

  const selectedStillExists = matchingEvaluations.some((ev) => String(ev.id) === selectedEvalId);
  if (selectedStillExists) {
    return selectedEvalId;
  }

  return String(matchingEvaluations[0].id);
};
