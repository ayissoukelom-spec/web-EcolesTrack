import React, { useEffect, useState } from 'react';
import { Evaluation, Grade, Student, Class, UserRole } from '../types.ts';
import { sortClasses } from '../lib/classOrdering';
import {
  Award,
  BookOpen,
  Plus,
  Calculator,
  Calendar,
  CheckCircle,
  HelpCircle,
  Edit2
} from 'lucide-react';
import {
  getDateOnlyMs,
  getEligibleStudentsForEvaluation as getEligibleStudentsForEvaluationUtil,
  getEligibleStudentsForEvaluationWithGrades as getEligibleStudentsForEvaluationWithGradesUtil,
  getEligibleStudentsWithHistoryForEvaluation as getEligibleStudentsWithHistoryForEvaluationUtil,
  getEligibleGradesForEvaluation,
  isEvaluationFullyGraded as isEvaluationFullyGradedUtil,
  isEvaluationCompleted as isEvaluationCompletedUtil,
  isStudentEligibleForEvaluation,
  parseDateValue,
} from '../lib/evaluationUtils';
import { validateGradeScore } from '../lib/gradeValidation';

interface NotesViewProps {
  userRole: UserRole;
  evaluationsList: Evaluation[];
  gradesList: Grade[];
  studentsList: Student[];
  classesList: Class[];
  schoolsList: { id: number; name: string }[];
  schoolFilterId?: number | null;
  onSchoolFilterChange?: (schoolId: number | null) => void;
  teacherClassIds?: number[];
  teacherSpecializations?: string[];
  approvedSubjectsList?: { id: number; name: string; status?: string }[];
  teacherId?: number;
  onAddEvaluation: (data: { classId: number; subject: string; title: string; coefficient: number; maxScore: number; date: string }) => void;
  onAddGrade: (data: { evaluationId: number; studentId: number; score: string; remarks: string }) => void;
}

export default function NotesView({
  userRole,
  evaluationsList,
  gradesList,
  studentsList,
  classesList,
  schoolsList,
  schoolFilterId,
  onSchoolFilterChange,
  teacherClassIds = [],
  teacherSpecializations = [],
  approvedSubjectsList = [],
  teacherId,
  onAddEvaluation,
  onAddGrade,
}: NotesViewProps) {
  const sortedClasses = sortClasses(classesList || []);
  const availableClasses = userRole === 'teacher'
    ? sortedClasses.filter((c) => teacherClassIds.includes(c.id))
    : sortedClasses;
  const filteredClasses = schoolFilterId
    ? availableClasses.filter((c) => c.schoolId === schoolFilterId)
    : availableClasses;
  const [selectedClassId, setSelectedClassId] = useState('');
  const [selectedEvalId, setSelectedEvalId] = useState('');
  const [isNewEvalFormOpen, setIsNewEvalFormOpen] = useState(false);
  const [gradeInputValues, setGradeInputValues] = useState<{ [studentId: number]: { score: string; remarks: string } }>({});
  const [saveStatus, setSaveStatus] = useState<string | null>(null);

  // New Eval form states
  const formatLocalDatetime = (value = new Date()) => {
    const date = value instanceof Date ? value : new Date(value);
    const tzOffset = date.getTimezoneOffset() * 60000;
    const localDate = new Date(date.getTime() - tzOffset);
    return localDate.toISOString().slice(0, 16);
  };

  const [newEvalClassId, setNewEvalClassId] = useState('');
  const [newEvalSubject, setNewEvalSubject] = useState('');
  const [newEvalTitle, setNewEvalTitle] = useState('');
  const [newEvalCoefficient, setNewEvalCoefficient] = useState(1);
  const [newEvalMaxScore, setNewEvalMaxScore] = useState(20);
  const [newEvalDate, setNewEvalDate] = useState(formatLocalDatetime());

  const approvedSubjectNames = approvedSubjectsList && approvedSubjectsList.length > 0
    ? approvedSubjectsList.map((subject) => String(subject.name || '').trim()).filter(Boolean)
    : [];

  const availableSubjects = userRole === 'teacher'
    ? approvedSubjectNames.filter((subjectName) => {
      const assigned = teacherSpecializations.map((value) => String(value || '').trim());
      return assigned.includes(subjectName);
    })
    : approvedSubjectNames;

  const isGradeModified = (grade: Grade) => {
    return grade.isModified ?? ((grade.editCount ?? 0) > 0);
  };

  const populateGradeInputsForEvaluation = (evaluationId: string | null) => {
    if (!evaluationId) {
      setGradeInputValues({});
      return;
    }

    const matchedGrades = gradesList.filter((g) => String(g.evaluationId) === evaluationId);
    const initialGrades: Record<number, { score: string; remarks: string }> = {};
    matchedGrades.forEach((g) => {
      initialGrades[g.studentId] = { score: g.score, remarks: g.remarks || '' };
    });
    setGradeInputValues(initialGrades);
  };

  const handleCreateEvaluation = (e: React.FormEvent) => {
    e.preventDefault();
    console.debug('NotesView: creating evaluation with subject', newEvalSubject);
    if (!newEvalClassId) {
      console.warn('NotesView: missing classId for evaluation');
      return;
    }
    if (!newEvalSubject) {
      console.warn('NotesView: missing subject for evaluation');
      return;
    }
    if (!newEvalTitle.trim()) {
      console.warn('NotesView: missing title for evaluation');
      return;
    }

    onAddEvaluation({
      classId: parseInt(newEvalClassId),
      subject: newEvalSubject,
      title: newEvalTitle,
      coefficient: Number(newEvalCoefficient),
      maxScore: Number(newEvalMaxScore),
      date: normalizeDateToISODate(newEvalDate) || newEvalDate,
    });
    setIsNewEvalFormOpen(false);
    setNewEvalClassId('');
    setNewEvalSubject('');
    setNewEvalTitle('');
    setNewEvalCoefficient(1);
    setNewEvalMaxScore(20);
    setNewEvalDate(formatLocalDatetime());
  };

  const handleSaveStudentGrade = async (studentId: number) => {
    if (!selectedEvalId) return;
    const existingGrade = gradesList.find(
      (g) => String(g.evaluationId) === selectedEvalId && g.studentId === studentId
    );
    if (existingGrade) {
      const message = userRole === 'teacher'
        ? 'Cette note a déjà été saisie. Pour toute modification, veuillez contacter le school admin.'
        : 'Cette note a déjà été saisie. Pour toute modification, veuillez contacter le super admin.';
      setSaveStatus(message);
      setTimeout(() => setSaveStatus(null), 4000);
      return;
    }

    const input = gradeInputValues[studentId];
    if (!input || input.score === undefined) return;

    const validation = validateGradeScore(input.score, currentEvaluation?.maxScore);
    if (!validation.isValid) {
      setSaveStatus(validation.error || 'Note invalide');
      setTimeout(() => setSaveStatus(null), 3000);
      return;
    }

    try {
      await onAddGrade({
        evaluationId: parseInt(selectedEvalId),
        studentId,
        score: input.score,
        remarks: input.remarks || '',
      });
      setSaveStatus(`Note sauvegardée pour l’élève !`);
    } catch (err: any) {
      setSaveStatus(err?.message || 'Erreur lors de l’enregistrement de la note');
      console.error('Failed to save grade:', err);
    }
    setTimeout(() => setSaveStatus(null), 3000);
  };

  const normalizeDateToISODate = (value: string | Date | undefined | null): string | null => {
    const date = parseDateValue(value);
    if (!date) return null;
    return date.toISOString().slice(0, 10);
  };

  const handleSaveAllGrades = async () => {
    if (!selectedEvalId) return;

    const saveableGrades = currentClassStudents
      .map((student) => {
        const existingGrade = gradesList.find(
          (g) => String(g.evaluationId) === selectedEvalId && g.studentId === student.id
        );
        const input = gradeInputValues[student.id];
        if (!input || input.score === undefined || input.score === '') return null;
        if (existingGrade) return null;

        const validation = validateGradeScore(input.score, currentEvaluation?.maxScore);
        if (!validation.isValid) {
          setSaveStatus(validation.error || 'Note invalide');
          setTimeout(() => setSaveStatus(null), 3000);
          return null;
        }

        return {
          evaluationId: parseInt(selectedEvalId),
          studentId: student.id,
          score: input.score,
          remarks: input.remarks || '',
        };
      })
      .filter(Boolean) as Array<{ evaluationId: number; studentId: number; score: string; remarks: string }>;

    if (saveableGrades.length === 0) {
      setSaveStatus('Aucune nouvelle note à enregistrer.');
      setTimeout(() => setSaveStatus(null), 3000);
      return;
    }

    try {
      await Promise.all(saveableGrades.map((grade) => onAddGrade(grade)));
      setSaveStatus(`Toutes les notes ont été enregistrées.`);
    } catch (err: any) {
      setSaveStatus('Erreur lors de l’enregistrement de certaines notes.');
      console.error('Failed to save all grades:', err);
    }

    setTimeout(() => setSaveStatus(null), 3000);
  };

  // Check if a student is eligible for an evaluation (was enrolled before or at the evaluation timestamp)
  const currentClassStudents = studentsList.filter((st) => {
    if (!selectedClassId) return true;
    return String(st.classId) === selectedClassId;
  });

  // Get eligible students for currently selected evaluation
  const getEligibleStudentsForEvaluation = (evaluation: Evaluation | null): Student[] =>
    getEligibleStudentsForEvaluationUtil(evaluation, currentClassStudents);

  const getEligibleStudentsWithHistoryForEvaluation = (evaluation: Evaluation | null): Student[] =>
    getEligibleStudentsWithHistoryForEvaluationUtil(evaluation, currentClassStudents, gradesList);

  const currentEvaluation = evaluationsList.find((ev) => String(ev.id) === selectedEvalId) || null;
  const eligibleStudentsForSelectedEval = getEligibleStudentsForEvaluationWithGradesUtil(currentEvaluation, currentClassStudents, gradesList);
  const selectedEvalGrades = gradesList.filter((g) => String(g.evaluationId) === selectedEvalId);
  const ineligibleStudentsForSelectedEval = currentClassStudents.filter(
    (st) => !eligibleStudentsForSelectedEval.includes(st) && !selectedEvalGrades.some((g) => g.studentId === st.id)
  );

  const displayStudentsForSelectedEval = eligibleStudentsForSelectedEval;

  const isEvaluationFullyGraded = (ev: Evaluation) =>
    isEvaluationFullyGradedUtil(ev, studentsList, gradesList);

  const isEvaluationCompleted = (ev: Evaluation) =>
    isEvaluationCompletedUtil(ev, studentsList, gradesList);

  const openEvaluations = evaluationsList.filter((ev) => {
    if (userRole === 'teacher') {
      if (teacherId == null) return false;
      if (ev.teacherId !== teacherId) return false;
    }
    if (!selectedClassId) return false;
    if (String(ev.classId) !== selectedClassId) return false;
    return !isEvaluationFullyGraded(ev);
  });

  const selectableEvaluations = evaluationsList.filter((ev) => {
    if (userRole === 'teacher') {
      if (teacherId == null) return false;
      if (ev.teacherId !== teacherId) return false;
    }
    if (!selectedClassId) return false;
    if (String(ev.classId) !== selectedClassId) return false;
    return userRole !== 'teacher' || !isEvaluationCompleted(ev);
  });

  useEffect(() => {
    if (!filteredClasses.length) {
      setSelectedClassId('');
      setSelectedEvalId('');
      setGradeInputValues({});
      return;
    }

    if (!selectedClassId) {
      const firstClassId = String(filteredClasses[0].id);
      setSelectedClassId(firstClassId);
      const firstSelectableEval = selectableEvaluations.find((ev) => String(ev.classId) === firstClassId);
      if (firstSelectableEval) {
        setSelectedEvalId(String(firstSelectableEval.id));
        populateGradeInputsForEvaluation(String(firstSelectableEval.id));
      } else {
        setSelectedEvalId('');
        setGradeInputValues({});
      }
      return;
    }

    // Only auto-select if no evaluation is currently selected for this class
    if (!selectedEvalId) {
      const firstSelectableEval = selectableEvaluations.find((ev) => String(ev.classId) === selectedClassId);
      if (firstSelectableEval) {
        setSelectedEvalId(String(firstSelectableEval.id));
        populateGradeInputsForEvaluation(String(firstSelectableEval.id));
      } else {
        setGradeInputValues({});
      }
    }
  }, [filteredClasses, selectableEvaluations, selectedClassId]);

  const archivedEvaluations = evaluationsList.filter((ev) => {
    if (userRole === 'teacher') {
      if (teacherId == null) return false;
      if (ev.teacherId !== teacherId) return false;
    }
    if (!selectedClassId) return false;
    if (String(ev.classId) !== selectedClassId) return false;
    return isEvaluationCompleted(ev);
  });

  const gradesForSelectedEval = gradesList.filter((g) => String(g.evaluationId) === selectedEvalId);
  const eligibleStudentsWithHistory = getEligibleStudentsForEvaluationWithGradesUtil(currentEvaluation, currentClassStudents, gradesList);
  const eligibleGradesForSelectedEval = getEligibleGradesForEvaluation(currentEvaluation, currentClassStudents, gradesList);
  const saveableStudentCount = eligibleStudentsWithHistory.filter((student) => {
    const existingGrade = gradesForSelectedEval.find((g) => g.studentId === student.id);
    return !(userRole === 'teacher' && existingGrade);
  }).length;

  const today = new Date();
  const overdueThresholdMs = 7 * 24 * 60 * 60 * 1000;
  const overdueEvaluations = evaluationsList
    .filter((ev) => {
      if (!ev.date) return false;
      const evalDate = parseDateValue(ev.date);
      if (!evalDate) return false;
      const ageMs = today.getTime() - evalDate.getTime();
      if (ageMs < overdueThresholdMs) return false;
      const classStudents = studentsList.filter((st) => st.classId === ev.classId);
      if (classStudents.length === 0) return false;

      const evaluationTimestamp = parseDateValue(ev.createdAt || ev.date);
      const eligibleStudents = classStudents.filter((st) => {
        if (!st.enrolledAt || !evaluationTimestamp) return true;
        const enrollmentDate = parseDateValue(st.enrolledAt);
        return enrollmentDate ? enrollmentDate.getTime() <= evaluationTimestamp.getTime() : true;
      });
      if (eligibleStudents.length === 0) return false;

      const eligibleStudentIds = new Set(eligibleStudents.map((st) => st.id));
      const gradesForEval = gradesList.filter(
        (g) => g.evaluationId === ev.id && eligibleStudentIds.has(g.studentId)
      );
      return gradesForEval.length < eligibleStudents.length;
    })
    .filter((ev) => userRole !== 'teacher' || (teacherId != null && ev.teacherId === teacherId));

  const overdueCount = overdueEvaluations.length;

  // Calculate averages
  const getStudentAverage = (studentId: number) => {
    let studentGrades = gradesList.filter((g) => g.studentId === studentId);
    if (userRole === 'teacher' && teacherId != null) {
      studentGrades = studentGrades.filter((g) => {
        const evaluation = evaluationsList.find((ev) => ev.id === g.evaluationId);
        return evaluation ? evaluation.teacherId === teacherId : false;
      });
    }
    if (studentGrades.length === 0) return '—';

    let totalPoints = 0;
    let totalCoefficients = 0;

    studentGrades.forEach((g) => {
      const parsedScore = parseFloat(g.score);
      if (!isNaN(parsedScore)) {
        // Find coefficient in evaluations
        const evaluation = evaluationsList.find((ev) => ev.id === g.evaluationId);
        const coeff = evaluation?.coefficient || 1;
        totalPoints += parsedScore * coeff;
        totalCoefficients += coeff;
      }
    });

    if (totalCoefficients === 0) return '—';
    return (totalPoints / totalCoefficients).toFixed(2);
  };

  const getClassAverage = () => {
    if (!selectedEvalId) return '—';
    const evalGrades = gradesList.filter((g) => String(g.evaluationId) === selectedEvalId);
    const validScores = evalGrades.map((g) => parseFloat(g.score)).filter((s) => !isNaN(s));
    
    if (validScores.length === 0) return '—';
    const sum = validScores.reduce((acc, curr) => acc + curr, 0);
    return (sum / validScores.length).toFixed(2);
  };

  return (
    <div className="space-y-6" id="notes-view">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">Gestion des Notes & Évaluations</h2>
          <p className="text-sm text-slate-500">Planifiez les devoirs, saisissez les résultats et consultez les bulletins scolaires</p>
        </div>

        {['super_admin', 'school_admin', 'teacher'].includes(userRole) && (
          <button
            type="button"
            onClick={() => {
              const initialClasses = filteredClasses.length > 0 ? filteredClasses : availableClasses;
              if (initialClasses.length > 0) {
                setNewEvalClassId(String(initialClasses[0].id));
              }
              setNewEvalSubject('');
              setNewEvalTitle('');
              setNewEvalCoefficient(1);
              setNewEvalMaxScore(20);
              setNewEvalDate(formatLocalDatetime());
              setIsNewEvalFormOpen(!isNewEvalFormOpen);
            }}
            disabled={userRole === 'teacher' && availableClasses.length === 0}
            className={`flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs sm:text-sm px-4 py-2.5 rounded-xl shadow-md transition-colors w-full sm:w-auto justify-center ${userRole === 'teacher' && availableClasses.length === 0 ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
            id="btn-new-eval-trigger"
          >
            <Plus className="h-4.5 w-4.5" />
            Créer un Devoir / Évaluation
          </button>
        )}
      </div>

      {overdueCount > 0 && (
        <div className="bg-amber-50 border border-amber-200 text-amber-900 rounded-2xl p-4 shadow-sm space-y-2">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <HelpCircle className="h-4 w-4" />
            Alerte devoirs en retard
          </div>
          <p className="text-xs sm:text-sm text-amber-800">
            {overdueCount} devoir{overdueCount > 1 ? 's' : ''} publi{overdueCount > 1 ? 'és' : 'é'} il y a plus de 7 jours n'ont pas encore toutes les notes renseignées.
          </p>
          <div className="text-[11px] text-amber-700">
            {userRole === 'teacher'
              ? 'Veuillez compléter les notes manquantes ou demander à un administrateur de le faire pour vous.'
              : 'Les administrateurs peuvent consulter et compléter ces devoirs en retard.'}
          </div>
        </div>
      )}

      {/* NEW EVALUATION CREATION FORM */}
      {isNewEvalFormOpen && (
        <div className="bg-slate-50 border border-slate-100 p-5 rounded-2xl animate-fade-in" id="box-eval-form">
          <h3 className="font-bold text-slate-800 mb-3 text-sm sm:text-base flex items-center gap-2">
            <Calendar className="h-5 w-5 text-indigo-600" />
            Planifier une nouvelle évaluation
          </h3>
          <form onSubmit={handleCreateEvaluation} className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Classe concernée</label>
              <select
                required
                value={newEvalClassId}
                onChange={(e) => setNewEvalClassId(e.target.value)}
                className="w-full px-3 py-2 bg-white border border-slate-200 text-xs sm:text-sm rounded-xl focus:outline-none placeholder-slate-400"
              >
                <option value="">-- Choisissez --</option>
                {filteredClasses.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Matière</label>
              <select
                required
                value={newEvalSubject}
                onChange={(e) => {
                  console.debug('NotesView: subject changed to', e.target.value);
                  setNewEvalSubject(e.target.value);
                }}
                className="w-full px-3 py-2 bg-white border border-slate-200 text-xs sm:text-sm rounded-xl focus:outline-none"
              >
                <option value="">-- Choisir une matière --</option>
                {availableSubjects.length > 0 ? (
                  availableSubjects.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))
                ) : (
                  <option value="" disabled>Aucune matière approuvée disponible</option>
                )}
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Intitulé du devoir (ex: "DS n°3")</label>
              <input
                required
                type="text"
                value={newEvalTitle}
                onChange={(e) => setNewEvalTitle(e.target.value)}
                placeholder="ex. Devoir Surveillé Fractions"
                className="w-full px-3 py-2 bg-white border border-slate-200 text-xs sm:text-sm rounded-xl focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Coefficient</label>
              <input
                type="number"
                min="1"
                max="5"
                value={newEvalCoefficient}
                onChange={(e) => setNewEvalCoefficient(parseInt(e.target.value) || 1)}
                className="w-full px-3 py-2 bg-white border border-slate-200 text-xs sm:text-sm rounded-xl focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Note maximale</label>
              <input
                type="number"
                value={newEvalMaxScore}
                onChange={(e) => setNewEvalMaxScore(parseInt(e.target.value) || 20)}
                className="w-full px-3 py-2 bg-white border border-slate-200 text-xs sm:text-sm rounded-xl focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Date et heure de l'évaluation</label>
              <input
                type="datetime-local"
                value={newEvalDate}
                onChange={(e) => setNewEvalDate(e.target.value)}
                className="w-full px-3 py-2 bg-white border border-slate-200 text-xs sm:text-sm rounded-xl focus:outline-none"
              />
            </div>
            <div className="md:col-span-3 flex justify-end gap-2 p-2">
              <button
                type="button"
                onClick={() => setIsNewEvalFormOpen(false)}
                className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-xl text-xs sm:text-sm font-semibold transition-colors cursor-pointer"
              >
                Annuler
              </button>
              <button
                type="submit"
                className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs sm:text-sm font-semibold shadow-md cursor-pointer"
              >
                Publier le Devoir
              </button>
            </div>
          </form>
        </div>
      )}

      {/* FILTER PANEL */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-white p-4 border border-slate-50 rounded-2xl shadow-sm">
        {userRole === 'super_admin' && (
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Filtrer par école</label>
            <select
              value={schoolFilterId ?? ''}
              onChange={(e) => {
                const value = e.target.value;
                if (onSchoolFilterChange) onSchoolFilterChange(value ? parseInt(value, 10) : null);
                setSelectedClassId('');
                setSelectedEvalId('');
              }}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-100 text-xs sm:text-sm rounded-xl focus:outline-none"
            >
              <option value="">Toutes les écoles</option>
              {schoolsList.map((school) => (
                <option key={school.id} value={school.id}>{school.name}</option>
              ))}
            </select>
          </div>
        )}
        <div>
          <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Division (Classe)</label>
          <select
            value={selectedClassId}
            onChange={(e) => {
              const nextClassId = e.target.value;
              setSelectedClassId(nextClassId);
              const firstEvalForClass = evaluationsList.find((ev) => String(ev.classId) === nextClassId);
              if (firstEvalForClass) {
                setSelectedEvalId(String(firstEvalForClass.id));
                populateGradeInputsForEvaluation(String(firstEvalForClass.id));
              } else {
                setSelectedEvalId('');
                setGradeInputValues({});
              }
            }}
            disabled={userRole === 'teacher' && availableClasses.length === 0}
            className="w-full px-3 py-2 bg-slate-50 border border-slate-100 text-xs sm:text-sm rounded-xl focus:outline-none disabled:opacity-50"
          >
            <option value="">Sélectionner une classe</option>
            {filteredClasses.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          {userRole === 'teacher' && availableClasses.length === 0 && (
            <p className="mt-2 text-[11px] text-amber-600 italic">
              Vous n’avez actuellement aucune classe assignée. Contactez l’administrateur pour en ajouter.
            </p>
          )}
        </div>

        <div>
          <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Évaluation (Devoir de la classe)</label>
          <select
            value={selectedEvalId}
            onChange={(e) => {
              const evId = e.target.value;
              setSelectedEvalId(evId);
              populateGradeInputsForEvaluation(evId);
            }}
            disabled={!selectedClassId}
            className="w-full px-3 py-2 bg-slate-50 border border-slate-100 text-xs sm:text-sm rounded-xl focus:outline-none disabled:opacity-50"
          >
            <option value="">-- Sélectionnez un devoir --</option>
            {selectableEvaluations.map((ev) => (
              <option key={ev.id} value={ev.id}>
                {ev.subject} — {ev.title} ({ev.date}){userRole !== 'teacher' && isEvaluationCompleted(ev) ? ' — Archivée' : ''}
              </option>
            ))}
          </select>
        </div>
      </div>

      {saveStatus && (
        <div className="p-3 bg-emerald-50 text-emerald-700 text-xs border border-emerald-100 rounded-xl font-semibold animate-bounce">
          {saveStatus}
        </div>
      )}

      {selectedClassId && archivedEvaluations.length > 0 && (
        <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 mb-4">
          <div className="flex items-center justify-between gap-3 mb-3">
            <div>
              <h3 className="text-sm font-bold text-slate-800">Archive des devoirs terminés</h3>
              <p className="text-xs text-slate-500">Les devoirs dont toutes les notes ont été saisies ne sont plus affichés dans la sélection principale.</p>
            </div>
            <span className="px-3 py-1 rounded-full bg-slate-200 text-slate-700 text-[11px] font-semibold">
              {archivedEvaluations.length} devoir{archivedEvaluations.length > 1 ? 's' : ''}
            </span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {archivedEvaluations.map((ev) => {
              const gradesForEval = gradesList.filter((g) => g.evaluationId === ev.id);
              return (
                <div key={ev.id} className="rounded-2xl border border-slate-100 bg-white p-3 shadow-sm">
                  <div className="text-xs uppercase tracking-[0.18em] text-slate-400 font-bold mb-1">{ev.subject}</div>
                  <div className="font-semibold text-slate-800">{ev.title}</div>
                  <div className="mt-2 text-[13px] text-slate-500">Date : {ev.date}</div>
                  <div className="mt-2 text-[13px] text-slate-500">État : <span className="font-semibold text-emerald-700">Toutes notes enregistrées</span></div>

                  <div className="mt-4 rounded-2xl bg-slate-50 border border-slate-100 p-3">
                    <div className="flex items-center justify-between gap-2 mb-3 text-[12px] text-slate-500 uppercase tracking-[0.14em] font-semibold">
                      <span>Notes</span>
                      <span>{gradesForEval.length} / {getEligibleStudentsForEvaluationUtil(ev, studentsList.filter((st) => st.classId === ev.classId)).length}</span>
                    </div>
                    {gradesForEval.length > 0 ? (
                      <div className="space-y-2 text-[13px] text-slate-700">
                        {gradesForEval.map((grade) => {
                          const student = studentsList.find((st) => st.id === grade.studentId);
                          return (
                            <div key={grade.id} className="rounded-xl border border-slate-200 bg-white p-3">
                              <div className="font-semibold text-slate-800">{grade.studentName || `${student?.firstName || 'Élève'} ${student?.lastName || ''}`.trim() || 'Élève'}</div>
                              <div className="flex flex-col gap-1 mt-1 text-slate-600">
                                <span>Note : <span className="font-bold text-slate-900">{grade.score}</span></span>
                                <span>Remarque : <span className="text-slate-700">{grade.remarks || '—'}</span></span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="text-[13px] text-slate-500 italic">Aucune note enregistrée.</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* MARKS RECORDING LIST */}
      <div className="bg-white border border-slate-50 rounded-2xl shadow-sm overflow-visible" id="grades-table-container">
        
        {selectedClassId ? (
          <div>
            {/* Header statistics block */}
            {selectedEvalId && (
              <div className="bg-indigo-600 p-5 text-white flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                <div className="space-y-1">
                  <span className="text-[10px] font-bold text-indigo-200 uppercase tracking-wider">Statistiques du devoir</span>
                  <h4 className="text-sm sm:text-base font-bold">
                    Moyenne générale de la classe : <span className="font-mono text-lg font-black bg-white/20 px-2.5 py-1 rounded-xl text-yellow-300 ml-1">{getClassAverage()} / 20</span>
                  </h4>
                </div>
                <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 text-xs text-indigo-100">
                  <div>Total copies saisies : {eligibleGradesForSelectedEval.length} / {eligibleStudentsForSelectedEval.length}</div>
                  <button
                    type="button"
                    onClick={handleSaveAllGrades}
                    disabled={userRole === 'teacher' ? saveableStudentCount === 0 : eligibleStudentsForSelectedEval.length === 0}
                    className="px-4 py-2 bg-emerald-500 hover:bg-emerald-400 disabled:bg-slate-400 disabled:cursor-not-allowed rounded-xl text-white text-xs font-semibold transition-colors"
                  >
                    Enregistrer tout
                  </button>
                </div>
              </div>
            )}

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs sm:text-sm text-slate-600">
                <thead className="bg-slate-50 text-slate-500 uppercase tracking-wider text-[10px] font-bold border-b border-slate-100">
                  <tr>
                    <th className="px-6 py-4">Nom de l'Élève</th>
                    <th className="px-6 py-4">Moyenne Générale du Trimestre</th>
                    {selectedEvalId && (
                      <>
                        <th className="px-6 py-4">Note au devoir ( / 20)</th>
                        <th className="px-6 py-4">Appréciation / Remarques</th>
                        {['super_admin', 'school_admin', 'teacher'].includes(userRole) && (
                          <th className="px-6 py-4 text-right">Actions</th>
                        )}
                      </>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {displayStudentsForSelectedEval.length > 0 ? (
                    displayStudentsForSelectedEval.map((st) => {
                      const studentAverage = getStudentAverage(st.id);
                      const isEvaluationSelected = !!selectedEvalId;
                      const existingGrade = gradesList.find(
                        (g) => String(g.evaluationId) === selectedEvalId && g.studentId === st.id
                      );
                      const canEditGrade = ['super_admin', 'school_admin', 'teacher'].includes(userRole);
                      const isLockedBySchoolAdmin = !!existingGrade;
                      const isEligible = eligibleStudentsForSelectedEval.some((s) => s.id === st.id);
                      const isIneligibleWithGrade = !isEligible && existingGrade;

                    return (
                      <tr key={st.id} className="hover:bg-slate-50/60 transition-colors">
                        <td className="px-6 py-4 font-bold text-slate-800">{st.firstName} {st.lastName}</td>
                        <td className="px-6 py-4 font-bold text-slate-700">
                          <span className="bg-slate-100 px-2.5 py-1 rounded-lg text-xs">
                            {studentAverage} / 20
                          </span>
                        </td>

                        {/* If evaluation is selected, show edit inputs */}
                        {isEvaluationSelected && (
                          <>
                            <td className="px-6 py-4">
                              {['super_admin', 'school_admin', 'teacher'].includes(userRole) ? (
                                existingGrade && userRole === 'teacher' ? (
                                  <div className="text-xs space-y-1">
                                    <div className="font-mono font-bold text-indigo-700">{existingGrade.score} / 20</div>
                                    <div className="text-slate-400 text-[10px]">Note déjà enregistrée</div>
                                  </div>
                                ) : isEligible ? (
                                    <input
                                      type="number"
                                      inputMode="decimal"
                                      step="0.01"
                                      min="0"
                                      max={currentEvaluation?.maxScore ?? undefined}
                                      value={gradeInputValues[st.id]?.score || ''}
                                      onChange={(e) => {
                                        if (!canEditGrade) return;
                                        const val = e.target.value;
                                        setGradeInputValues({
                                          ...gradeInputValues,
                                          [st.id]: {
                                            score: val,
                                            remarks: gradeInputValues[st.id]?.remarks || '',
                                          },
                                        });
                                      }}
                                      placeholder="ex. 15.5 or Abs"
                                      className="w-24 px-2.5 py-1.5 bg-slate-50 border border-slate-200 text-xs sm:text-sm rounded-lg focus:outline-indigo-500 text-center font-bold text-slate-800"
                                    />
                                  ) : (
                                    <div className="text-left text-xs text-amber-800 font-semibold">
                                      Non éligible<br />(inscrit après le devoir)
                                    </div>
                                  )
                              ) : (
                                <span className="font-mono text-xs font-extrabold text-indigo-700">
                                  {gradeInputValues[st.id]?.score || '—'} / 20
                                </span>
                              )}
                            </td>

                            <td className="px-6 py-4">
                              {['super_admin', 'school_admin', 'teacher'].includes(userRole) ? (
                                existingGrade && userRole === 'teacher' ? (
                                  <div className="text-xs text-slate-500 italic">Remarque enregistrée</div>
                                ) : isEligible ? (
                                  <input
                                    type="text"
                                    value={gradeInputValues[st.id]?.remarks || ''}
                                    onChange={(e) => {
                                      if (!canEditGrade) return;
                                      const val = e.target.value;
                                      setGradeInputValues({
                                        ...gradeInputValues,
                                        [st.id]: {
                                          score: gradeInputValues[st.id]?.score || '',
                                          remarks: val,
                                        },
                                      });
                                    }}
                                    placeholder="Entrez vos remarques..."
                                    className="w-full px-3 py-1.5 bg-slate-50 border border-slate-200 text-xs rounded-lg focus:outline-indigo-500 text-slate-700"
                                  />
                                ) : (
                                  <span className="text-xs text-slate-500 italic">Aucune saisie requise</span>
                                )
                              ) : (
                                <span className="text-xs text-slate-500 italic">
                                  {gradeInputValues[st.id]?.remarks || 'Pas d’observation rédigée.'}
                                </span>
                              )}
                            </td>

                            {['super_admin', 'school_admin', 'teacher'].includes(userRole) && (
                              <td className="px-6 py-4 text-right">
                                {existingGrade ? (
                                  userRole === 'teacher' ? (
                                    <button
                                      type="button"
                                      disabled
                                      className="px-3 py-1.5 bg-slate-400 cursor-not-allowed text-white font-bold text-xs rounded-lg shadow-sm"
                                    >
                                      Enregistrée
                                    </button>
                                  ) : isLockedBySchoolAdmin ? (
                                    <button
                                      type="button"
                                      disabled
                                      className="px-3 py-1.5 bg-slate-400 cursor-not-allowed text-white font-bold text-xs rounded-lg shadow-sm"
                                    >
                                      Bloquée
                                    </button>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() => handleSaveStudentGrade(st.id)}
                                      className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-lg shadow-sm transition-colors"
                                      id={`btn-save-grade-${st.id}`}
                                    >
                                      {userRole === 'super_admin' ? 'Mettre à jour' : 'Mettre à jour'}
                                    </button>
                                  )
                                ) : isEligible ? (
                                  <button
                                    type="button"
                                    onClick={() => handleSaveStudentGrade(st.id)}
                                    className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-lg shadow-sm transition-colors"
                                    id={`btn-save-grade-${st.id}`}
                                  >
                                    Enregistrer
                                  </button>
                                ) : (
                                  <span className="text-xs text-amber-700 font-semibold">Aucune action</span>
                                )}
                              </td>
                            )}
                          </>
                        )}
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={5} className="px-6 py-8 text-center text-slate-400 text-sm">
                      Sélectionnez un devoir pour afficher les notes
                    </td>
                  </tr>
                )}
                </tbody>
              </table>
              
              {/* Ineligible students notice */}
              {selectedEvalId && ineligibleStudentsForSelectedEval.length > 0 && (
                <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3">
                  <p className="text-xs font-semibold text-amber-900 mb-2">
                    ⚠️ {ineligibleStudentsForSelectedEval.length} élève(s) non éligible(s) pour cette évaluation (inscrit(s) après la date du devoir)
                  </p>
                  <div className="text-xs text-amber-800 space-y-1">
                    {ineligibleStudentsForSelectedEval.map((student) => (
                      <div key={student.id} className="flex justify-between">
                        <span>{student.firstName} {student.lastName}</span>
                        <span className="text-amber-700 font-mono">
                          Inscrit le {student.enrolledAt ? new Date(student.enrolledAt).toLocaleDateString('fr-FR') : 'date inconnue'}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="p-8 text-center text-slate-400 text-xs space-y-2">
            <Calculator className="h-10 w-10 mx-auto text-slate-300" />
            <p>Veuillez sélectionner une division (une classe) ci-dessus pour afficher le carnet de notes.</p>
          </div>
        )}
      </div>
    </div>
  );
}
