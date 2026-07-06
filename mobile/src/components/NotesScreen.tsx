import { useEffect, useState } from 'react';
import type { Evaluation, Grade } from '../types';
import { fetchEvaluations, fetchGrades } from './api';

interface Props {
  classId: string;
  onBack: () => void;
}

export default function NotesScreen({ classId, onBack }: Props) {
  const [evaluations, setEvaluations] = useState<Evaluation[]>([]);
  const [gradesByEvaluation, setGradesByEvaluation] = useState<Record<number, Grade[]>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (classId) {
      loadEvaluations();
    }
  }, [classId]);

  const loadEvaluations = async () => {
    setError(null);
    setLoading(true);

    try {
      const evaluationsPayload = await fetchEvaluations(classId);
      setEvaluations(Array.isArray(evaluationsPayload) ? evaluationsPayload : []);

      const gradesResponse: Record<number, Grade[]> = {};
      if (Array.isArray(evaluationsPayload)) {
        await Promise.all(
          evaluationsPayload.map(async (evaluation) => {
            const gradePayload = await fetchGrades(String(evaluation.id));
            gradesResponse[evaluation.id] = Array.isArray(gradePayload) ? gradePayload : [];
          }),
        );
      }

      setGradesByEvaluation(gradesResponse);
    } catch (err) {
      setError('Impossible de charger les évaluations ou les notes.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="card">
      <div className="dashboard-header">
        <div>
          <h2>Notes de la classe</h2>
          <p>Classe {classId}</p>
        </div>
        <button className="secondary" type="button" onClick={onBack}>Retour</button>
      </div>

      {loading && <div className="empty-state">Chargement...</div>}
      {error && <div className="error-message">{error}</div>}

      {!loading && !error && (
        <div className="section">
          {evaluations.length === 0 ? (
            <div className="empty-state">Aucune évaluation disponible pour cette classe.</div>
          ) : (
            evaluations.map((evaluation) => (
              <div key={evaluation.id} className="notification-card">
                <h3>{evaluation.title}</h3>
                <p>{evaluation.subject} • coefficient {evaluation.coefficient}</p>
                <p>Max : {evaluation.maxScore} points</p>
                <div className="grade-list">
                  {gradesByEvaluation[evaluation.id]?.length ? (
                    gradesByEvaluation[evaluation.id].map((grade) => (
                      <div key={grade.id} className="grade-item">
                        Élève {grade.studentId} — {grade.score} / {evaluation.maxScore}
                      </div>
                    ))
                  ) : (
                    <div className="empty-state">Aucune note enregistrée pour cette évaluation.</div>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
